/**
 * Follow Up Task Creator
 * Creates FOLLOW_UP tasks for unanswered open questions
 * Runs opportunistically in inboundWorker or as a periodic worker
 */

import pino from "pino";
import { TaskType, TaskStatus, ConversationState } from "@prisma/client";
import { scopeWhere } from "../../db/tenantScope.ts";
import { createTimelineEvent } from "../timelineService.ts";
import { buildPromptTextForKey } from "./openQuestionRules.ts";
import type { OpenQuestion, OpenQuestionKey } from "../../../shared/types/memoryPack.ts";
import type { AgencyPlaybook } from "../../shared/playbook.ts";

const log = pino({ name: "followUpTaskCreator" });
import { prisma } from "../../db/prisma.ts";

/**
 * Generate dedupe key for follow-up task
 * Format: conversationId_openQuestionKey_YYYY-MM-DD
 */
function generateDedupeKey(conversationId: string, openQuestionKey: OpenQuestionKey, now: Date): string {
  const dateBucket = now.toISOString().split("T")[0]; // YYYY-MM-DD
  return `${conversationId}_${openQuestionKey}_${dateBucket}`;
}

/**
 * Build suggested follow-up message template
 */
function buildFollowUpMessageTemplate(
  question: OpenQuestion,
  playbook?: AgencyPlaybook
): string {
  // Use the original prompt text as base, but make it a gentle reminder
  const basePrompt = question.promptText;
  
  // Add gentle reminder prefix if not already present
  if (basePrompt.toLowerCase().includes("remind") || basePrompt.toLowerCase().includes("when you get")) {
    return basePrompt;
  }
  
  // Build reminder message
  const greeting = playbook
    ? (playbook.greetingStyle === "NONE" ? "" : playbook.greetingStyle === "SHORT" ? "Hey, " : "Hi, ")
    : "Hi, ";
  
  return `${greeting}Just a quick reminder: ${basePrompt}`;
}

/**
 * Check if we should create a follow-up task for an open question
 * 
 * Rules:
 * - Question must be OPEN for more than 24h
 * - lastRemindedAt must be null or older than 24h
 * - Conversation must not be CLOSED
 * - Must not exceed max 3 follow-ups per conversation per week
 */
export async function shouldCreateFollowUpTask(
  agencyId: string,
  conversationId: string,
  question: OpenQuestion,
  now: Date = new Date()
): Promise<{ should: boolean; reason?: string }> {
  // Check if question is OPEN
  if (question.status !== "OPEN") {
    return { should: false, reason: "Question is not OPEN" };
  }

  // Check if question has been OPEN for more than 24h
  const askedAt = new Date(question.askedAt);
  const hoursSinceAsked = (now.getTime() - askedAt.getTime()) / (1000 * 60 * 60);
  if (hoursSinceAsked < 24) {
    return { should: false, reason: "Question asked less than 24h ago" };
  }

  // Check lastRemindedAt
  if (question.lastRemindedAt) {
    const lastReminded = new Date(question.lastRemindedAt);
    const hoursSinceReminded = (now.getTime() - lastReminded.getTime()) / (1000 * 60 * 60);
    if (hoursSinceReminded < 24) {
      return { should: false, reason: "Question reminded less than 24h ago" };
    }
  }

  // Check conversation state
  const conversation = await prisma.conversation.findFirst({
    where: scopeWhere(agencyId, { id: conversationId }),
    select: { state: true },
  });

  if (conversation?.state === ConversationState.CLOSED) {
    return { should: false, reason: "Conversation is CLOSED" };
  }

  // Check max 3 follow-ups per conversation per week
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recentFollowUps = await prisma.task.count({
    where: scopeWhere(agencyId, {
      type: TaskType.FOLLOW_UP,
      status: TaskStatus.OPEN,
      relatedMessage: {
        conversationId,
      },
      createdAt: {
        gte: weekAgo,
      },
      payload: {
        path: ["openQuestionKey"],
        equals: question.key,
      },
    }),
  });

  if (recentFollowUps >= 3) {
    return { should: false, reason: "Max 3 follow-ups per week reached" };
  }

  // Check for existing follow-up task with same dedupe key (same day)
  const dedupeKey = generateDedupeKey(conversationId, question.key, now);
  const existingTask = await prisma.task.findFirst({
    where: scopeWhere(agencyId, {
      type: TaskType.FOLLOW_UP,
      status: TaskStatus.OPEN,
      relatedMessage: {
        conversationId,
      },
      payload: {
        path: ["dedupeKey"],
        equals: dedupeKey,
      },
    }),
  });

  if (existingTask) {
    return { should: false, reason: "Follow-up task already exists for today" };
  }

  return { should: true };
}

/**
 * Create a follow-up task for an open question
 */
export async function createFollowUpTaskForQuestion(
  agencyId: string,
  conversationId: string,
  question: OpenQuestion,
  playbook?: AgencyPlaybook,
  now: Date = new Date()
): Promise<{ taskId: string | null; created: boolean; reason?: string }> {
  // Check if we should create the task
  const shouldCreate = await shouldCreateFollowUpTask(agencyId, conversationId, question, now);
  if (!shouldCreate.should) {
    return { taskId: null, created: false, reason: shouldCreate.reason };
  }

  try {
    // Get conversation to find related message
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
      return { taskId: null, created: false, reason: "Conversation not found" };
    }

    const lastMessage = conversation.messages[0];
    const dedupeKey = generateDedupeKey(conversationId, question.key, now);
    const suggestedMessage = buildFollowUpMessageTemplate(question, playbook);

    // Create follow-up task
    const task = await prisma.task.create({
      data: {
        agencyId,
        type: TaskType.FOLLOW_UP,
        status: TaskStatus.OPEN,
        approvalStatus: "NOT_REQUIRED", // Follow-ups typically don't need approval
        relatedMessageId: lastMessage?.id || null,
        payload: {
          conversationId,
          openQuestionKey: question.key,
          questionId: question.id,
          suggestedMessage,
          dedupeKey,
          promptText: question.promptText,
          askedAt: question.askedAt,
        } as any,
        dueAt: new Date(now.getTime() + 2 * 60 * 60 * 1000), // Due in 2 hours
        isSystemGenerated: true,
      },
    });

    // Create timeline event
    try {
      const candidateId = await prisma.candidate.findFirst({
        where: scopeWhere(agencyId, {
          lastConversationId: conversationId,
        }),
        select: { id: true },
      });

      await createTimelineEvent({
        agencyId,
        conversationId,
        contactId: conversation.contactId,
        candidateId: candidateId?.id || null,
        type: "OPEN_QUESTION_FOLLOWUP_CREATED",
        actorRole: "SYSTEM",
        summary: `Follow-up task created for: ${question.key}`,
        data: {
          openQuestionKey: question.key,
          questionId: question.id,
          taskId: task.id,
          suggestedMessage: suggestedMessage.substring(0, 100), // Max 100 chars
        },
        dedupeKey: `${conversationId}_${question.key}_followup_${now.getTime()}`,
      });
    } catch (error) {
      log.warn({ conversationId, questionKey: question.key, error }, "Failed to create OPEN_QUESTION_FOLLOWUP_CREATED timeline event (non-blocking)");
    }

    log.info(
      {
        taskId: task.id,
        conversationId,
        openQuestionKey: question.key,
        questionId: question.id,
      },
      "Follow-up task created for open question"
    );

    return { taskId: task.id, created: true };
  } catch (error) {
    log.error(
      {
        conversationId,
        questionKey: question.key,
        error,
      },
      "Failed to create follow-up task"
    );
    return { taskId: null, created: false, reason: error instanceof Error ? error.message : "Unknown error" };
  }
}

/**
 * Process stale open questions for a conversation
 * Creates follow-up tasks for questions that meet the criteria
 */
export async function processStaleOpenQuestions(
  agencyId: string,
  conversationId: string,
  openQuestions: OpenQuestion[],
  playbook?: AgencyPlaybook,
  now: Date = new Date()
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  for (const question of openQuestions) {
    const result = await createFollowUpTaskForQuestion(agencyId, conversationId, question, playbook, now);
    if (result.created) {
      created++;
    } else {
      skipped++;
      log.debug(
        {
          conversationId,
          questionKey: question.key,
          reason: result.reason,
        },
        "Skipped creating follow-up task"
      );
    }
  }

  return { created, skipped };
}

