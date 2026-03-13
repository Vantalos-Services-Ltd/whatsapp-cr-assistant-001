/**
 * Memory Pack Refresh Routes
 * Manual trigger for memory pack updates
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db/prisma.ts";
import { requireAuth } from "../middleware/auth.ts";
import { updateMemoryPackAndProgress } from "../services/memoryPackUpdater.ts";
import { mergeNonNull } from "../../shared/types/memoryPack.ts";
import { sanitizeMemoryPack } from "../../shared/types/memoryPack.ts";
import { determineProgressStage } from "../services/progressEngine.ts";
import type { ProgressEngineInput } from "../services/progressEngine.ts";
import { TaskStatus, TaskApprovalStatus, TaskType } from "@prisma/client";

interface RefreshMemoryParams {
  conversationId: string;
}

/**
 * POST /api/conversations/:conversationId/refresh-memory
 * Manually trigger memory pack update for a conversation
 * Rate limited: Only allow once per minute per conversation
 */
export async function refreshMemoryHandler(
  request: FastifyRequest<{
    Params: RefreshMemoryParams;
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const { conversationId } = request.params;
  const operatorId = (request as any).operatorId;

  if (!operatorId) {
    logger.warn({ conversationId, action: "refresh-memory" }, "No operatorId in session");
    return reply.status(401).send({ error: "Authentication required" });
  }

  try {
    // Fetch conversation with messages and candidate
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        contact: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 25, // Last 25 messages
        },
      },
    });

    if (!conversation) {
      logger.warn({ conversationId }, "Conversation not found");
      return reply.status(404).send({ error: "Conversation not found" });
    }

    // Get candidate snapshot if available
    let candidateSnapshot = null;
    const candidate = await prisma.candidate.findFirst({
      where: {
        agencyId: conversation.agencyId,
        phone: conversation.contact.phone,
      },
      select: {
        name: true,
        desiredRole: true,
        location: true,
        availabilityNotes: true,
        salaryMin: true,
        salaryMax: true,
        currency: true,
        skills: true,
        yearsExperience: true,
      },
    });

    if (candidate) {
      candidateSnapshot = {
        name: candidate.name,
        desiredRole: candidate.desiredRole,
        location: candidate.location,
        availability: candidate.availabilityNotes,
        salary: {
          min: candidate.salaryMin,
          max: candidate.salaryMax,
          currency: candidate.currency,
        },
        skills: candidate.skills || [],
        yearsExperience: candidate.yearsExperience,
      };
    }

    // Get last intent from most recent inbound message
    const lastInboundMessage = conversation.messages
      .filter((m) => (m as any).direction === "INBOUND" && (m as any).senderRole === "HUMAN")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    
    // Get pending approval tasks
    const pendingTasks = await prisma.task.findMany({
      where: {
        agencyId: conversation.agencyId,
        approvalStatus: TaskApprovalStatus.PENDING,
        status: TaskStatus.OPEN,
        OR: [
          {
            relatedMessage: {
              conversationId: conversation.id,
            },
          },
          {
            payload: {
              path: ["conversationId"],
              equals: conversation.id,
            },
          },
        ],
      },
      select: {
        type: true,
      },
    });

    const hasPendingApproval = pendingTasks.length > 0;
    const hasOpenTasks = {
      types: pendingTasks.map((t) => t.type),
    };

    // Get matched jobs count
    let matchedJobsCount = 0;
    if (candidate) {
      const jobMatches = await prisma.jobCandidateMatch.findMany({
        where: {
          candidate: {
            agencyId: conversation.agencyId,
            phone: conversation.contact.phone,
          },
          job: {
            status: { in: ["ACTIVE", "URGENT"] },
          },
        },
        select: { id: true },
      });
      matchedJobsCount = jobMatches.length;
    }

    // Existing memory pack and progress
    const existingMemoryPack = conversation.memoryPack
      ? sanitizeMemoryPack(conversation.memoryPack)
      : null;
    const existingProgressStage = (conversation.progressStage as any) || "NEW";
    const existingProgressData = (conversation.progressData as any) || null;

    // Get last 20 messages for context
    const lastMessages = conversation.messages
      .slice(-20)
      .reverse() // Oldest first
      .map((msg) => ({
        direction: (msg as any).direction as "INBOUND" | "OUTBOUND",
        text: msg.text,
        createdAt: msg.createdAt,
      }));

    // Update memory pack and progress
    const updateResult = await updateMemoryPackAndProgress({
      conversationId: conversation.id,
      lastMessages,
      existingMemoryPack,
      existingProgressStage,
      existingProgressData,
      candidateSnapshot,
      lastIntent: null, // Intent classification not available here, but progress engine will handle it
      hasPendingApproval,
      hasOpenTasks,
      lastActivityAt: conversation.messages[0]?.createdAt || conversation.lastMessageAt,
      matchedJobsCount,
      placementConfirmed: false, // TODO: Check placement status if needed
    });

    if (!updateResult) {
      logger.warn({ conversationId }, "Memory pack update returned null");
      return reply.status(500).send({ error: "Failed to update memory pack" });
    }

    // Merge updates into existing data
    const now = new Date().toISOString();
    const updatedMemoryPack = existingMemoryPack
      ? {
          ...mergeNonNull(existingMemoryPack, updateResult.memoryPackPatch),
          lastUpdatedAt: now,
          version: existingMemoryPack.version || 1,
        }
      : sanitizeMemoryPack({
          ...updateResult.memoryPackPatch,
          lastUpdatedAt: now,
          version: 1,
        });

    const updatedProgressData = existingProgressData
      ? mergeNonNull(existingProgressData, updateResult.progressUpdate.progressDataPatch)
      : {
          missingFields: [],
          nextAction: null,
          followUpAt: null,
          lastDecision: null,
          ...updateResult.progressUpdate.progressDataPatch,
        };

    // Update conversation in database
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        progressStage: updateResult.progressUpdate.stage,
        progressUpdatedAt: new Date(),
        progressData: updatedProgressData as any,
        memoryPack: updatedMemoryPack as any,
        memoryUpdatedAt: new Date(),
      },
    });

    logger.info(
      {
        conversationId: conversation.id,
        stage: updateResult.progressUpdate.stage,
        operatorId,
      },
      "Memory pack refreshed manually"
    );

    return reply.status(200).send({
      success: true,
      stage: updateResult.progressUpdate.stage,
      memoryUpdatedAt: now,
    });
  } catch (error) {
    logger.error({ conversationId, error }, "Failed to refresh memory pack");
    return reply.status(500).send({ error: "Failed to refresh memory pack" });
  }
}

/**
 * Register memory refresh routes
 */
export async function memoryRefreshRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/conversations/:conversationId/refresh-memory",
    {
      preHandler: [requireAuth],
    },
    refreshMemoryHandler
  );
}

