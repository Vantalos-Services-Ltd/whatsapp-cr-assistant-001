/**
 * Review API Routes
 * 
 * Endpoints for managing message review samples for quality control.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db/prisma.ts";
import { requireAuth } from "../middleware/auth.ts";
import { requireAgencyId } from "../utils/agencyContext.ts";
import { scopeWhere, findFirstOr404 } from "../db/tenantScope.ts";
import { notFoundIfNull } from "../utils/httpErrors.ts";
import { ReviewVerdict } from "@prisma/client";
import { createTimelineEvent } from "../services/timelineService.ts";
import { toReviewSampleDTO } from "../dto/transformers.ts";
import type { ReviewSampleDTO } from "../dto/operator.ts";

interface ReviewSampleParams {
  id: string;
}

interface ReviewSampleQuery {
  bucket?: "pending" | "reviewed";
  limit?: string;
  cursor?: string;
}

interface SetVerdictBody {
  verdict: ReviewVerdict;
  notes?: string;
}

// Removed getAgencyId() - use requireAgencyId(request) from agencyContext instead

/**
 * GET /api/review/samples
 * List review samples with pagination
 */
export async function listReviewSamplesHandler(
  request: FastifyRequest<{
    Querystring: ReviewSampleQuery;
  }>,
  reply: FastifyReply
) {
  const { bucket = "pending", limit = "25", cursor } = request.query;
  const logger = request.log;
  const operatorId = (request as any).operatorId;

  if (!operatorId) {
    return reply.status(401).send({ error: "Authentication required" });
  }

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);
    const limitNum = Math.min(parseInt(limit, 10) || 25, 100);

    // Build where clause based on bucket
    const where: any = scopeWhere(agencyId, {});

    if (bucket === "pending") {
      where.verdict = null;
    } else if (bucket === "reviewed") {
      where.verdict = { not: null };
    }

    // Cursor-based pagination
    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, "base64url").toString("utf-8");
        const parsed = JSON.parse(decoded);
        where.createdAt = { lt: new Date(parsed.createdAt) };
        where.id = { not: parsed.id };
      } catch (error) {
        logger.warn({ cursor, error }, "Invalid cursor, ignoring");
      }
    }

    // Fetch samples
    const samples = await prisma.messageReviewSample.findMany({
      where,
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: limitNum + 1, // Fetch one extra to determine hasMore
      include: {
        reviewedByOperator: {
          select: {
            email: true,
          },
        },
      },
    });

    const hasMore = samples.length > limitNum;
    const results = samples.slice(0, limitNum);

    // Generate next cursor
    let nextCursor: string | null = null;
    if (hasMore && results.length > 0) {
      const last = results[results.length - 1];
      const cursorData = {
        id: last.id,
        createdAt: last.createdAt.toISOString(),
      };
      nextCursor = Buffer.from(JSON.stringify(cursorData), "utf-8").toString("base64url");
    }

    // Transform to DTOs
    const dtos: ReviewSampleDTO[] = results.map((sample) =>
      toReviewSampleDTO(sample, null, null, null, null)
    );

    return reply.send({
      samples: dtos,
      nextCursor,
      hasMore,
    });
  } catch (error) {
    logger.error({ error }, "Failed to list review samples");
    return reply.status(500).send({
      error: "Failed to list review samples",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * GET /api/review/samples/:id
 * Get review sample detail with context
 */
export async function getReviewSampleHandler(
  request: FastifyRequest<{
    Params: ReviewSampleParams;
  }>,
  reply: FastifyReply
) {
  const { id } = request.params;
  const logger = request.log;
  const operatorId = (request as any).operatorId;

  if (!operatorId) {
    return reply.status(401).send({ error: "Authentication required" });
  }

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    // Fetch sample with relations (use findFirst with agency scoping - MessageReviewSample has @@unique([agencyId, taskId]))
    const sample = await prisma.messageReviewSample.findFirst({
      where: scopeWhere(agencyId, { id }),
      include: {
        reviewedByOperator: {
          select: {
            email: true,
          },
        },
      },
    });

    if (!sample) {
      return reply.status(404).send({ error: "Review sample not found" });
    }

    // Fetch task context (use findFirst with agency scoping)
    let task: any = null;
    if (sample.taskId) {
      task = await prisma.task.findFirst({
        where: scopeWhere(agencyId, { id: sample.taskId }),
        select: {
          type: true,
          createdAt: true,
        },
      });
    }

    // Fetch candidate context (use findFirst with agency scoping)
    let candidate: any = null;
    if (sample.candidateId) {
      candidate = await prisma.candidate.findFirst({
        where: scopeWhere(agencyId, { id: sample.candidateId }),
        select: {
          name: true,
          desiredRole: true,
          phone: true,
        },
      });
    }

    // Fetch job context (use findFirst with agency scoping)
    let job: any = null;
    if (sample.jobId) {
      job = await prisma.job.findFirst({
        where: scopeWhere(agencyId, { id: sample.jobId }),
        select: {
          title: true,
          city: true,
        },
      });
    }

    // Fetch conversation snippet (last 3 messages)
    let conversationSnippet: any[] = [];
    if (sample.conversationId) {
      conversationSnippet = await prisma.message.findMany({
        where: {
          conversationId: sample.conversationId,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 3,
        select: {
          id: true,
          direction: true,
          text: true,
          createdAt: true,
        },
      });

      // Reverse to show chronological order
      conversationSnippet.reverse();
    }

    // Transform to DTO
    const dto = toReviewSampleDTO(sample, task, candidate, job, conversationSnippet);

    return reply.send(dto);
  } catch (error) {
    logger.error({ error, sampleId: id }, "Failed to get review sample");
    return reply.status(500).send({
      error: "Failed to get review sample",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * POST /api/review/samples/:id/verdict
 * Set verdict for a review sample
 */
export async function setReviewVerdictHandler(
  request: FastifyRequest<{
    Params: ReviewSampleParams;
    Body: SetVerdictBody;
  }>,
  reply: FastifyReply
) {
  const { id } = request.params;
  const { verdict, notes } = request.body;
  const logger = request.log;
  const operatorId = (request as any).operatorId;

  if (!operatorId) {
    return reply.status(401).send({ error: "Authentication required" });
  }

  if (!verdict || !["GOOD", "NEEDS_IMPROVEMENT", "UNSAFE"].includes(verdict)) {
    return reply.status(400).send({
      error: "Invalid verdict",
      validValues: ["GOOD", "NEEDS_IMPROVEMENT", "UNSAFE"],
    });
  }

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    // Fetch sample (use findFirst with agency scoping - MessageReviewSample has @@unique([agencyId, taskId]))
    const sample = await prisma.messageReviewSample.findFirst({
      where: scopeWhere(agencyId, { id }),
    });

    notFoundIfNull(sample, "Review sample not found");

    // Update sample (MessageReviewSample has @@unique([agencyId, taskId]), but we use id for update)
    // Verify ownership is already done by findFirst above
    const updated = await prisma.messageReviewSample.update({
      where: { id },
      data: {
        verdict,
        notes: notes || null,
        reviewedAt: new Date(),
        reviewedByOperatorId: operatorId,
      },
    });

    // Create timeline event if conversationId exists
    if (sample.conversationId) {
      try {
        const conversation = await prisma.conversation.findFirst({
          where: scopeWhere(agencyId, { id: sample.conversationId }),
          include: {
            contact: true,
          },
        });

        if (conversation) {
          await createTimelineEvent({
            agencyId: sample.agencyId,
            conversationId: sample.conversationId,
            contactId: conversation.contactId,
            candidateId: sample.candidateId || null,
            type: "REVIEW_VERDICT_SET",
            actorRole: "OPERATOR",
            actorOperatorId: operatorId,
            summary: `Review verdict set: ${verdict}`,
            data: {
              reviewSampleId: sample.id,
              taskId: sample.taskId,
              verdict,
              sampledReason: sample.sampledReason,
            },
            dedupeKey: `review_${sample.id}_verdict`,
          });
        }
      } catch (error) {
        logger.warn({ error, sampleId: id }, "Failed to create timeline event for review verdict (non-blocking)");
      }
    }

    // Transform to DTO
    const dto = toReviewSampleDTO(updated, null, null, null, null);

    return reply.send(dto);
  } catch (error) {
    logger.error({ error, sampleId: id }, "Failed to set review verdict");
    return reply.status(500).send({
      error: "Failed to set review verdict",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Register review routes
 */
export function reviewRoutes(fastify: FastifyInstance) {
  fastify.get("/api/review/samples", { preHandler: [requireAuth] }, listReviewSamplesHandler);
  fastify.get("/api/review/samples/:id", { preHandler: [requireAuth] }, getReviewSampleHandler);
  fastify.post("/api/review/samples/:id/verdict", { preHandler: [requireAuth] }, setReviewVerdictHandler);
}

