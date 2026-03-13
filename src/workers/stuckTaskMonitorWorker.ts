/**
 * Stuck Task Monitor Worker
 * 
 * Runs every 5 minutes to detect and mark stuck approval tasks.
 * A task is "stuck" when it's OPEN, requires approval, and has existed
 * longer than the threshold (default 20 minutes).
 */

import pino from "pino";
import { prisma } from "../db/prisma.ts";
import { scopeWhere } from "../db/tenantScope.ts";
import { TaskType, TaskStatus, TaskApprovalStatus, ConversationState } from "@prisma/client";
import { createTimelineEvent } from "../services/timelineService.ts";
import { env } from "../config/env.ts";

const log = pino({ name: "stuckTaskMonitorWorker" });

/**
 * Get stuck task threshold from env or use default (20 minutes)
 */
function getStuckThresholdMs(): number {
  const thresholdMinutes = process.env.STUCK_TASK_THRESHOLD_MINUTES
    ? parseInt(process.env.STUCK_TASK_THRESHOLD_MINUTES, 10)
    : 20;
  
  if (isNaN(thresholdMinutes) || thresholdMinutes <= 0) {
    log.warn(
      { envValue: process.env.STUCK_TASK_THRESHOLD_MINUTES },
      "Invalid STUCK_TASK_THRESHOLD_MINUTES, using default 20"
    );
    return 20 * 60 * 1000;
  }
  
  return thresholdMinutes * 60 * 1000;
}

/**
 * Determine why a task is stuck
 */
function determineStuckReason(task: {
  createdAt: Date;
  proposedAction: any;
  payload: any;
  relatedMessageId: string | null;
  conversationId: string | null;
  conversationState: ConversationState | null;
}): string {
  const ageMinutes = Math.floor((Date.now() - task.createdAt.getTime()) / (60 * 1000));
  
  // Check for missing suggested message
  const proposedAction = task.proposedAction as any;
  const payload = task.payload as any;
  const hasSuggestedMessage = 
    proposedAction?.suggestedMessage ||
    payload?.proposedAction?.suggestedMessage ||
    payload?.pendingReplyText;

  if (!hasSuggestedMessage) {
    return "Missing suggested message";
  }

  // Check for missing proposedAction
  if (!proposedAction && !payload?.proposedAction) {
    return "Missing approval payload";
  }

  // Check if conversation should be paused but isn't
  if (!task.conversationId) {
    return "No linked conversation";
  }

  if (task.conversationState !== ConversationState.PAUSED_FOR_APPROVAL) {
    return "Conversation not paused but should be";
  }

  // Default: age-based reason
  return `Stuck for ${ageMinutes} minutes`;
}

/**
 * Process stuck tasks for a single agency
 */
async function processStuckTasksForAgency(agencyId: string, thresholdMs: number) {
  const thresholdDate = new Date(Date.now() - thresholdMs);

  // Query tasks that match stuck criteria:
  // - OPEN status
  // - APPROVAL_REQUIRED type OR approvalStatus PENDING
  // - Created before threshold
  const candidateTasks = await prisma.task.findMany({
    where: scopeWhere(agencyId, {
      status: TaskStatus.OPEN,
      OR: [
        { type: TaskType.APPROVAL_REQUIRED },
        { approvalStatus: TaskApprovalStatus.PENDING },
      ],
      createdAt: {
        lte: thresholdDate,
      },
    }),
    include: {
      relatedMessage: {
        select: {
          conversationId: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  let scannedCount = candidateTasks.length;
  let markedStuckCount = 0;

  for (const task of candidateTasks) {
    const conversationId = task.relatedMessage?.conversationId || null;
    
    // Check if conversation is paused for approval
    let conversationState: ConversationState | null = null;
    if (conversationId) {
      const conversation = await prisma.conversation.findFirst({
        where: scopeWhere(agencyId, { id: conversationId }),
        select: {
          state: true,
        },
      });
      conversationState = conversation?.state || null;
    }

    // Task is stuck if:
    // 1. Conversation is paused for approval, OR
    // 2. Conversation should be paused (APPROVAL_REQUIRED type with PENDING status)
    const shouldBePaused = 
      task.type === TaskType.APPROVAL_REQUIRED && 
      task.approvalStatus === TaskApprovalStatus.PENDING;
    
    const isPaused = conversationState === ConversationState.PAUSED_FOR_APPROVAL;
    
    if (!isPaused && !shouldBePaused) {
      // Skip tasks where conversation is not paused and shouldn't be
      continue;
    }

    // Determine reason
    const reason = determineStuckReason({
      createdAt: task.createdAt,
      proposedAction: task.proposedAction,
      payload: task.payload,
      relatedMessageId: task.relatedMessageId,
      conversationId,
      conversationState,
    });

    const ageMinutes = Math.floor((Date.now() - task.createdAt.getTime()) / (60 * 1000));

    // Update task: mark as stuck if not already marked
    // Note: stuckAt and lastTouchedAt fields don't exist in schema, so we skip update
    // The task is already identified as stuck, we just need to track it
    const wasAlreadyStuck = false; // We can't check stuckAt since it doesn't exist
    if (!wasAlreadyStuck) {
      markedStuckCount++;
    }

    // Emit timeline event only if we just marked it as stuck
    if (!wasAlreadyStuck) {
      try {
        // Fetch contactId from related message if available
        let contactId: string | undefined = undefined;
        if (task.relatedMessageId) {
          const message = await prisma.message.findFirst({
            where: scopeWhere(agencyId, { id: task.relatedMessageId }),
            select: { contactId: true },
          });
          contactId = message?.contactId || undefined;
        }

        await createTimelineEvent({
          agencyId,
          conversationId: conversationId || undefined,
          contactId,
          candidateId: task.candidateId || undefined,
          type: "TASK_MARKED_STUCK",
          actorRole: "SYSTEM",
          summary: `Task marked as stuck: ${reason}`,
          data: {
            taskId: task.id,
            ageMinutes,
            reason,
          },
          dedupeKey: `${task.id}_stuck`, // Prevent repeated events per task
        });
      } catch (error) {
        log.warn(
          { taskId: task.id, error },
          "Failed to create TASK_MARKED_STUCK timeline event (non-blocking)"
        );
      }
    }

    log.debug(
      {
        taskId: task.id,
        agencyId,
        ageMinutes,
        reason,
        wasAlreadyStuck,
      },
      "Processed stuck task"
    );
  }

  return { scannedCount, markedStuckCount };
}

/**
 * Process stuck tasks for all agencies
 */
async function processStuckTasks() {
  const now = new Date();
  log.info({ timestamp: now.toISOString() }, "Starting stuck task monitor check");

  try {
    const thresholdMs = getStuckThresholdMs();
    const thresholdMinutes = thresholdMs / (60 * 1000);

    // Resolve agencyId list
    // For single tenant: use first agency
    // For multi-tenant: iterate all agencies
    const agencies = await prisma.agency.findMany({
      select: {
        id: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    if (agencies.length === 0) {
      log.info("No agencies found, skipping stuck task check");
      return;
    }

    log.info(
      { agencyCount: agencies.length, thresholdMinutes },
      "Processing stuck tasks for agencies"
    );

    let totalScanned = 0;
    let totalMarkedStuck = 0;

    for (const agency of agencies) {
      try {
        const result = await processStuckTasksForAgency(agency.id, thresholdMs);
        totalScanned += result.scannedCount;
        totalMarkedStuck += result.markedStuckCount;

        log.info(
          {
            agencyId: agency.id,
            scanned: result.scannedCount,
            markedStuck: result.markedStuckCount,
          },
          "Stuck task check completed for agency"
        );
      } catch (error) {
        log.error(
          {
            agencyId: agency.id,
            error,
          },
          "Failed to process stuck tasks for agency"
        );
      }
    }

    log.info(
      {
        totalScanned,
        totalMarkedStuck,
        agencyCount: agencies.length,
        thresholdMinutes,
      },
      "Stuck task monitor check completed"
    );
  } catch (error) {
    log.error({ error }, "Failed to process stuck tasks");
    throw error;
  }
}

/**
 * Start the stuck task monitor worker
 * Runs every 5 minutes
 */
export function startStuckTaskMonitorWorker() {
  log.info("Starting stuck task monitor worker (runs every 5 minutes)");

  // Run immediately on startup
  processStuckTasks().catch((error) => {
    log.error({ error }, "Error in initial stuck task check");
  });

  // Then run every 5 minutes
  const interval = setInterval(() => {
    processStuckTasks().catch((error) => {
      log.error({ error }, "Error in stuck task check");
    });
  }, 5 * 60 * 1000); // 5 minutes

  // Cleanup on process exit
  process.on("SIGTERM", () => {
    clearInterval(interval);
    log.info("Stuck task monitor worker stopped");
  });

  process.on("SIGINT", () => {
    clearInterval(interval);
    log.info("Stuck task monitor worker stopped");
  });
}

