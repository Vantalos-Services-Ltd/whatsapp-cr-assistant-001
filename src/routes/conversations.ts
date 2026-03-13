/**
 * Conversation routes
 * API endpoints for conversation management
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../middleware/auth.ts";
import { requireAgencyId } from "../utils/agencyContext.ts";
import { PrismaClient, TaskType, TaskStatus } from "@prisma/client";
import { scopeWhere } from "../db/tenantScope.ts";
import { createFollowUpTaskForQuestion } from "../services/continuity/followUpTaskCreator.ts";
import { getPlaybook } from "../services/playbook/playbookService.ts";
import { createTimelineEvent } from "../services/timelineService.ts";
import type { OpenQuestionKey } from "../../shared/types/memoryPack.ts";
import { sanitizeMemoryPack } from "../../shared/types/memoryPack.ts";

const prisma = new PrismaClient();

export async function conversationRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", requireAuth);

  /**
   * POST /api/conversations/:id/followup/open-question
   * Create a follow-up task for an open question
   * Body: { openQuestionKey: string }
   */
  fastify.post<{ Params: { id: string }; Body: { openQuestionKey: OpenQuestionKey } }>(
    "/:id/followup/open-question",
    async (request: FastifyRequest<{ Params: { id: string }; Body: { openQuestionKey: OpenQuestionKey } }>, reply: FastifyReply) => {
      const logger = request.log;
      const operatorId = (request as any).operatorId;

      try {
        const agencyId = await requireAgencyId(request);
        const conversationId = request.params.id;
        const { openQuestionKey } = request.body;

        // Validate conversation exists and is agency-scoped
        const conversation = await prisma.conversation.findFirst({
          where: scopeWhere(agencyId, { id: conversationId }),
          include: {
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        });

        if (!conversation) {
          return reply.status(404).send({ error: "Conversation not found" });
        }

        // Get memory pack and find the open question
        const memoryPack = conversation.memoryPack
          ? sanitizeMemoryPack(conversation.memoryPack)
          : null;

        if (!memoryPack?.structuredOpenQuestions) {
          return reply.status(400).send({ error: "No open questions found" });
        }

        const question = memoryPack.structuredOpenQuestions.find((q) => q.key === openQuestionKey && q.status === "OPEN");

        if (!question) {
          return reply.status(400).send({ error: `Open question with key ${openQuestionKey} not found or already resolved` });
        }

        // Get playbook for message template
        const playbook = await getPlaybook(agencyId);

        // Create follow-up task
        const result = await createFollowUpTaskForQuestion(
          agencyId,
          conversationId,
          question,
          playbook,
          new Date()
        );

        if (!result.created) {
          return reply.status(400).send({
            error: "Failed to create follow-up task",
            reason: result.reason || "Unknown error",
          });
        }

        logger.info(
          {
            conversationId,
            openQuestionKey,
            taskId: result.taskId,
            operatorId,
          },
          "Follow-up task created manually by operator"
        );

        return reply.status(200).send({
          taskId: result.taskId,
          message: "Follow-up task created successfully",
        });
      } catch (error) {
        logger.error({ error }, "Failed to create follow-up task");
        return reply.status(500).send({ error: "Failed to create follow-up task" });
      }
    }
  );
}

