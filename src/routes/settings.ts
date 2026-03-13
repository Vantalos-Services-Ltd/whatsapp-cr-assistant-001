/**
 * Settings API routes
 * Handles agency settings including playbook configuration
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireAgencyId, requireOperatorId } from "../utils/agencyContext.ts";
import { getPlaybook, updatePlaybook, validatePlaybookUpdate } from "../services/playbook/playbookService.ts";
import { createTimelineEvent } from "../services/timelineService.ts";
import { prisma } from "../db/prisma.ts";
import type { PlaybookDTO } from "../dto/operator.ts";

/**
 * GET /api/settings/playbook
 * Returns the playbook for the agency
 */
export async function getPlaybookHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const logger = request.log;

  try {
    const agencyId = await requireAgencyId(request);
    const playbook = await getPlaybook(agencyId);

    const dto: PlaybookDTO = {
      toneStyle: playbook.toneStyle,
      maxQuestionsPerMessage: playbook.maxQuestionsPerMessage,
      greetingStyle: playbook.greetingStyle,
      forbiddenPhrases: playbook.forbiddenPhrases,
      requiredChecks: playbook.requiredChecks,
      escalationRules: playbook.escalationRules,
      signatureStyle: playbook.signatureStyle,
      updatedAt: playbook.updatedAt.toISOString(),
      createdAt: playbook.createdAt.toISOString(),
    };

    logger.info({ agencyId }, "Playbook retrieved");

    return reply.status(200).send(dto);
  } catch (error) {
    logger.error({ error }, "Failed to get playbook");
    return reply.status(500).send({ error: "Failed to get playbook" });
  }
}

/**
 * POST /api/settings/playbook
 * Updates the playbook for the agency
 */
export async function updatePlaybookHandler(
  request: FastifyRequest<{
    Body: Partial<PlaybookDTO>;
  }>,
  reply: FastifyReply
) {
  const logger = request.log;

  try {
    const agencyId = await requireAgencyId(request);
    const operatorId = await requireOperatorId(request);
    const update = request.body;

    // Validate update
    const validation = validatePlaybookUpdate(update);
    if (!validation.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: validation.error,
      });
    }

    // Update playbook
    const playbook = await updatePlaybook(agencyId, validation.data!);

    // Create timeline event
    // Get a conversation ID for the timeline event (use first conversation or skip if none)
    const firstConversation = await prisma.conversation.findFirst({
      where: { agencyId },
      select: { id: true, contactId: true },
      orderBy: { createdAt: "asc" },
    });

    if (firstConversation) {
      await createTimelineEvent({
        agencyId,
        conversationId: firstConversation.id,
        contactId: firstConversation.contactId,
        candidateId: null,
        type: "SETTINGS_PLAYBOOK_UPDATED",
        actorRole: "OPERATOR",
        actorOperatorId: operatorId,
        summary: "Playbook updated",
        data: {
          forbiddenPhrasesCount: playbook.forbiddenPhrases.length,
          maxQuestionsPerMessage: playbook.maxQuestionsPerMessage,
          greetingStyle: playbook.greetingStyle,
          signatureStyle: playbook.signatureStyle,
        },
        dedupeKey: `playbook_updated_${agencyId}_${Date.now()}`,
      });
    }

    const dto: PlaybookDTO = {
      toneStyle: playbook.toneStyle,
      maxQuestionsPerMessage: playbook.maxQuestionsPerMessage,
      greetingStyle: playbook.greetingStyle,
      forbiddenPhrases: playbook.forbiddenPhrases,
      requiredChecks: playbook.requiredChecks,
      escalationRules: playbook.escalationRules,
      signatureStyle: playbook.signatureStyle,
      updatedAt: playbook.updatedAt.toISOString(),
      createdAt: playbook.createdAt.toISOString(),
    };

    logger.info({ agencyId, operatorId }, "Playbook updated");

    return reply.status(200).send(dto);
  } catch (error) {
    logger.error({ error }, "Failed to update playbook");
    if (error instanceof Error && error.message.includes("Validation")) {
      return reply.status(400).send({ error: error.message });
    }
    return reply.status(500).send({ error: "Failed to update playbook" });
  }
}

/**
 * Register settings routes
 */
export async function settingsRoutes(fastify: FastifyInstance) {
  fastify.get("/playbook", getPlaybookHandler);
  fastify.post("/playbook", updatePlaybookHandler);
}

