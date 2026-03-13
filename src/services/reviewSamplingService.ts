/**
 * Review Sampling Service
 * 
 * Creates MessageReviewSample rows for quality control and governance.
 * Samples tasks that were approved and sent messages in the last 24 hours.
 */

import pino from "pino";
import { prisma } from "../db/prisma.ts";
import { TaskType, TaskStatus, TaskApprovalStatus, SampledReason } from "@prisma/client";

const log = pino({ name: "reviewSamplingService" });

export interface SamplingConfig {
  editedTasksLimit: number; // N1: Sample up to N1 edited tasks
  highRiskTasksLimit: number; // N2: Sample up to N2 high-risk tasks
  randomTasksLimit: number; // N3: Sample up to N3 random tasks
}

const DEFAULT_CONFIG: SamplingConfig = {
  editedTasksLimit: 30,
  highRiskTasksLimit: 10,
  randomTasksLimit: 10,
};

/**
 * Determine if a task is high risk
 */
function isHighRiskTask(task: any): boolean {
  // High risk: APPROVAL_REQUIRED with riskLevel HIGH
  if (task.type === TaskType.APPROVAL_REQUIRED) {
    const proposedAction = task.proposedAction as any;
    if (proposedAction?.riskLevel === "HIGH") {
      return true;
    }
  }

  // High risk: ESCALATION tasks
  if (task.type === TaskType.ESCALATION) {
    return true;
  }

  return false;
}

/**
 * Create review samples for a given date range
 */
export async function createReviewSamplesForDay(
  agencyId: string,
  dateRange: { start: Date; end: Date },
  config: SamplingConfig = DEFAULT_CONFIG
): Promise<{
  editedCount: number;
  highRiskCount: number;
  randomCount: number;
  totalCreated: number;
  totalSkipped: number;
}> {
  log.info(
    {
      agencyId,
      start: dateRange.start.toISOString(),
      end: dateRange.end.toISOString(),
      config,
    },
    "Starting review sampling for date range"
  );

  // Query tasks approved in the date range that sent a message
  // Note: We'll filter in memory for approvedMessageText since Prisma JSONB queries are limited
  const approvedTasksRaw = await prisma.task.findMany({
    where: {
      agencyId,
      approvalStatus: TaskApprovalStatus.APPROVED,
      approvedAt: {
        gte: dateRange.start,
        lte: dateRange.end,
      },
    },
    include: {
      relatedMessage: {
        include: {
          conversation: {
            include: {
              contact: true,
            },
          },
        },
      },
    },
    orderBy: {
      approvedAt: "desc",
    },
  });

  // Filter to only tasks that have approvedMessageText (meaning a message was sent)
  const approvedTasks = approvedTasksRaw.filter((task) => {
    const payload = task.payload as any;
    return payload?.approvedMessageText && typeof payload.approvedMessageText === "string";
  });

  log.info(
    {
      agencyId,
      totalApprovedTasks: approvedTasks.length,
      totalFound: approvedTasksRaw.length,
    },
    "Found approved tasks in date range"
  );

  // Separate tasks into buckets
  const editedTasks: typeof approvedTasks = [];
  const highRiskTasks: typeof approvedTasks = [];
  const randomTasks: typeof approvedTasks = [];

  for (const task of approvedTasks) {
    const payload = task.payload as any;
    const wasEdited = payload?.wasEdited === true;

    // Check if already sampled (idempotency)
    const existingSample = await prisma.messageReviewSample.findUnique({
      where: {
        agencyId_taskId: {
          agencyId: task.agencyId,
          taskId: task.id,
        },
      },
    });

    if (existingSample) {
      continue; // Skip if already sampled
    }

    // Must have both proposed and final text
    if (!payload?.proposedMessageText || !payload?.approvedMessageText) {
      continue; // Skip if missing required fields
    }

    if (wasEdited) {
      editedTasks.push(task);
    } else if (isHighRiskTask(task)) {
      highRiskTasks.push(task);
    } else {
      randomTasks.push(task);
    }
  }

  log.info(
    {
      agencyId,
      editedTasks: editedTasks.length,
      highRiskTasks: highRiskTasks.length,
      randomTasks: randomTasks.length,
    },
    "Categorized tasks into sampling buckets"
  );

  // Sample from each bucket
  const sampledEdited = editedTasks.slice(0, config.editedTasksLimit);
  const sampledHighRisk = highRiskTasks.slice(0, config.highRiskTasksLimit);
  const sampledRandom = randomTasks.slice(0, config.randomTasksLimit);

  // Create review samples
  let editedCount = 0;
  let highRiskCount = 0;
  let randomCount = 0;
  let totalSkipped = 0;

  // Process edited tasks
  for (const task of sampledEdited) {
    try {
      const payload = task.payload as any;
      const relatedMessage = task.relatedMessage;

      await prisma.messageReviewSample.create({
        data: {
          agencyId: task.agencyId,
          taskId: task.id,
          conversationId: relatedMessage?.conversationId || null,
          candidateId: task.candidateId || null,
          jobId: (payload as any)?.jobId || null,
          sampledReason: SampledReason.EDITED,
          proposedText: payload.proposedMessageText || "",
          finalText: payload.approvedMessageText || "",
          editMetrics: payload.editMetrics || {},
        },
      });

      editedCount++;
    } catch (error: any) {
      // Handle unique constraint violation (idempotency)
      if (error.code === "P2002") {
        totalSkipped++;
        log.debug({ taskId: task.id }, "Sample already exists, skipping");
      } else {
        log.error({ taskId: task.id, error }, "Failed to create review sample for edited task");
      }
    }
  }

  // Process high-risk tasks
  for (const task of sampledHighRisk) {
    try {
      const payload = task.payload as any;
      const relatedMessage = task.relatedMessage;

      await prisma.messageReviewSample.create({
        data: {
          agencyId: task.agencyId,
          taskId: task.id,
          conversationId: relatedMessage?.conversationId || null,
          candidateId: task.candidateId || null,
          jobId: (payload as any)?.jobId || null,
          sampledReason: SampledReason.HIGH_RISK,
          proposedText: payload.proposedMessageText || "",
          finalText: payload.approvedMessageText || "",
          editMetrics: payload.editMetrics || {},
        },
      });

      highRiskCount++;
    } catch (error: any) {
      if (error.code === "P2002") {
        totalSkipped++;
        log.debug({ taskId: task.id }, "Sample already exists, skipping");
      } else {
        log.error({ taskId: task.id, error }, "Failed to create review sample for high-risk task");
      }
    }
  }

  // Process random tasks
  for (const task of sampledRandom) {
    try {
      const payload = task.payload as any;
      const relatedMessage = task.relatedMessage;

      await prisma.messageReviewSample.create({
        data: {
          agencyId: task.agencyId,
          taskId: task.id,
          conversationId: relatedMessage?.conversationId || null,
          candidateId: task.candidateId || null,
          jobId: (payload as any)?.jobId || null,
          sampledReason: SampledReason.RANDOM,
          proposedText: payload.proposedMessageText || "",
          finalText: payload.approvedMessageText || "",
          editMetrics: payload.editMetrics || {},
        },
      });

      randomCount++;
    } catch (error: any) {
      if (error.code === "P2002") {
        totalSkipped++;
        log.debug({ taskId: task.id }, "Sample already exists, skipping");
      } else {
        log.error({ taskId: task.id, error }, "Failed to create review sample for random task");
      }
    }
  }

  const totalCreated = editedCount + highRiskCount + randomCount;

  log.info(
    {
      agencyId,
      editedCount,
      highRiskCount,
      randomCount,
      totalCreated,
      totalSkipped,
    },
    "Review sampling completed"
  );

  return {
    editedCount,
    highRiskCount,
    randomCount,
    totalCreated,
    totalSkipped,
  };
}

