/**
 * Follow-up Reminder Worker
 * Runs every 5 minutes to create FOLLOW_UP tasks for conversations with due follow-ups
 */

import { Worker } from "bullmq";
import pino from "pino";
import { prisma } from "../db/prisma.ts";
import { TaskType, TaskStatus, TaskApprovalStatus } from "@prisma/client";
import type { ContactProgressData } from "../../shared/types/progress.ts";

const log = pino({ name: "followUpReminderWorker" });

/**
 * Check for conversations with due follow-ups and create tasks
 */
async function processFollowUpReminders() {
  const now = new Date();
  log.info({ timestamp: now.toISOString() }, "Starting follow-up reminder check");

  try {
    // Find conversations with followUpAt <= now and progressData.followUpAt set
    const conversations = await prisma.conversation.findMany({
      where: {
        progressData: {
          not: null,
        },
      },
      include: {
        contact: true,
        agency: true,
      },
    });

    let createdCount = 0;
    let skippedCount = 0;

    for (const conversation of conversations) {
      const progressData = conversation.progressData as ContactProgressData | null;
      if (!progressData?.followUpAt) {
        continue;
      }

      const followUpAt = new Date(progressData.followUpAt);
      if (followUpAt > now) {
        continue; // Not due yet
      }

      // Check if there's already an OPEN FOLLOW_UP task for this conversation
      const existingTask = await prisma.task.findFirst({
        where: {
          agencyId: conversation.agencyId,
          type: TaskType.FOLLOW_UP,
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
      });

      if (existingTask) {
        skippedCount++;
        log.debug(
          {
            conversationId: conversation.id,
            existingTaskId: existingTask.id,
          },
          "Skipping: OPEN FOLLOW_UP task already exists"
        );
        continue;
      }

      // Get the last message from this conversation for context
      const lastMessage = await prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
        },
        orderBy: {
          createdAt: "desc",
        },
        select: {
          id: true,
          text: true,
        },
      });

      // Get candidate info if available
      const candidate = await prisma.candidate.findFirst({
        where: {
          agencyId: conversation.agencyId,
          phone: conversation.contact.phone,
        },
        select: {
          name: true,
          desiredRole: true,
        },
      });

      // Build suggested message based on progress data
      const suggestedMessage = progressData.nextAction
        ? `Hi${candidate?.name ? ` ${candidate.name.split(" ")[0]}` : ""}, ${progressData.nextAction}`
        : `Hi${candidate?.name ? ` ${candidate.name.split(" ")[0]}` : ""}, just checking in. How are things going?`;

      // Create FOLLOW_UP task
      await prisma.task.create({
        data: {
          agencyId: conversation.agencyId,
          type: TaskType.FOLLOW_UP,
          status: TaskStatus.OPEN,
          approvalStatus: conversation.agency.messagingMode === "AUTOPILOT" 
            ? TaskApprovalStatus.NOT_REQUIRED 
            : TaskApprovalStatus.PENDING,
          relatedMessageId: lastMessage?.id || null,
          dueAt: followUpAt,
          isSystemGenerated: true,
          payload: {
            conversationId: conversation.id,
            followUpAt: progressData.followUpAt,
            reason: progressData.nextAction || "Follow-up reminder",
            suggestedMessage,
            candidateName: candidate?.name || null,
            desiredRole: candidate?.desiredRole || null,
          },
          proposedAction: {
            actionType: "SEND_MESSAGE",
            suggestedMessage,
            reasoning: `Follow-up reminder based on progress data. Original follow-up date: ${progressData.followUpAt}`,
            riskLevel: "LOW",
          },
        },
      });

      createdCount++;
      log.info(
        {
          conversationId: conversation.id,
          followUpAt: progressData.followUpAt,
          agencyId: conversation.agencyId,
        },
        "Created FOLLOW_UP reminder task"
      );
    }

    log.info(
      {
        checked: conversations.length,
        created: createdCount,
        skipped: skippedCount,
      },
      "Follow-up reminder check completed"
    );
  } catch (error) {
    log.error({ error }, "Failed to process follow-up reminders");
    throw error;
  }
}

/**
 * Start the follow-up reminder worker
 * Runs every 5 minutes
 */
export function startFollowUpReminderWorker() {
  log.info("Starting follow-up reminder worker (runs every 5 minutes)");

  // Run immediately on startup
  processFollowUpReminders().catch((error) => {
    log.error({ error }, "Error in initial follow-up reminder check");
  });

  // Then run every 5 minutes
  const interval = setInterval(() => {
    processFollowUpReminders().catch((error) => {
      log.error({ error }, "Error in follow-up reminder check");
    });
  }, 5 * 60 * 1000); // 5 minutes

  // Cleanup on process exit
  process.on("SIGTERM", () => {
    clearInterval(interval);
    log.info("Follow-up reminder worker stopped");
  });

  process.on("SIGINT", () => {
    clearInterval(interval);
    log.info("Follow-up reminder worker stopped");
  });
}

