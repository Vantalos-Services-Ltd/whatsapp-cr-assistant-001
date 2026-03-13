/**
 * Stuck Task Detection Service
 * 
 * Detects tasks that are stuck in approval workflow and need operator attention.
 * 
 * A task is "stuck" when:
 * - Task is OPEN
 * - Task requires approval (APPROVAL_REQUIRED type or approvalStatus PENDING)
 * - It has existed longer than threshold (default 20 minutes)
 * - Conversation is paused for approval or should be paused
 */

import pino from "pino";
import { prisma } from "../db/prisma.ts";
import { scopeWhere } from "../db/tenantScope.ts";
import { TaskType, TaskStatus, TaskApprovalStatus, ConversationState } from "@prisma/client";

const log = pino({ name: "stuckTaskDetection" });

/**
 * Default threshold for stuck task detection (20 minutes)
 */
const DEFAULT_STUCK_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes

export interface StuckTask {
  id: string;
  type: TaskType;
  status: TaskStatus;
  approvalStatus: TaskApprovalStatus;
  createdAt: Date;
  stuckAt: Date | null; // Note: Field doesn't exist in DB schema, always null
  lastTouchedAt: Date | null; // Note: Field doesn't exist in DB schema, always null
  relatedMessageId: string | null;
  candidateId: string | null;
  conversationId: string | null;
  conversationState: ConversationState | null;
  reason: string;
  ageMinutes: number;
}

export interface StuckTaskReason {
  reason: string;
  details?: string;
}

/**
 * Determine why a task is stuck
 */
function getStuckReason(task: {
  createdAt: Date;
  stuckAt: Date | null;
  proposedAction: any;
  payload: any;
  approvalStatus: TaskApprovalStatus;
  type: TaskType;
}): StuckTaskReason {
  const ageMinutes = Math.floor((Date.now() - task.createdAt.getTime()) / (60 * 1000));
  
  // Check for missing suggested message
  const proposedAction = task.proposedAction as any;
  const payload = task.payload as any;
  const hasSuggestedMessage = 
    proposedAction?.suggestedMessage ||
    payload?.proposedAction?.suggestedMessage ||
    payload?.pendingReplyText;

  if (!hasSuggestedMessage) {
    return {
      reason: "Missing suggested message",
      details: "Task created but no suggested message was generated",
    };
  }

  // Check for missing approval payload
  if (!proposedAction && !payload?.proposedAction) {
    return {
      reason: "Missing approval payload",
      details: "Task has no proposedAction or payload.proposedAction",
    };
  }

  // Default: age-based reason
  return {
    reason: `Stuck for ${ageMinutes} minutes`,
    details: `Task has been pending approval for ${ageMinutes} minutes`,
  };
}

/**
 * Detect stuck tasks for an agency
 * 
 * @param agencyId Agency ID to check
 * @param thresholdMs Optional threshold in milliseconds (default: 20 minutes)
 * @returns Array of stuck tasks with reasons
 */
export async function detectStuckTasks(
  agencyId: string,
  thresholdMs: number = DEFAULT_STUCK_THRESHOLD_MS
): Promise<StuckTask[]> {
  log.info({ agencyId, thresholdMs }, "Detecting stuck tasks");

  const thresholdDate = new Date(Date.now() - thresholdMs);

  // Find tasks that match stuck criteria:
  // - OPEN status
  // - APPROVAL_REQUIRED type OR approvalStatus PENDING
  // - Created before threshold
  const stuckTasks = await prisma.task.findMany({
    where: scopeWhere(agencyId, {
      status: TaskStatus.OPEN,
      OR: [
        { type: TaskType.APPROVAL_REQUIRED },
        { approvalStatus: TaskApprovalStatus.PENDING },
      ],
      createdAt: {
        lt: thresholdDate,
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

  // Filter and enrich with conversation state
  const enriched: StuckTask[] = [];
  
  for (const task of stuckTasks) {
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

    const ageMinutes = Math.floor((Date.now() - task.createdAt.getTime()) / (60 * 1000));
    const reason = getStuckReason(task);

    enriched.push({
      id: task.id,
      type: task.type,
      status: task.status,
      approvalStatus: task.approvalStatus,
      createdAt: task.createdAt,
      stuckAt: null, // Field doesn't exist in schema
      lastTouchedAt: null, // Field doesn't exist in schema
      relatedMessageId: task.relatedMessageId,
      candidateId: task.candidateId,
      conversationId,
      conversationState,
      reason: reason.reason,
      ageMinutes,
    });
  }

  // Note: stuckAt field doesn't exist in schema, so we skip database updates
  // Tasks are identified as stuck but not persisted to DB
  log.info(
    { agencyId, count: enriched.length },
    "Detected stuck tasks (not persisted - stuckAt field doesn't exist)"
  );

  log.info(
    { agencyId, stuckCount: enriched.length },
    "Stuck task detection completed"
  );

  return enriched;
}

/**
 * Get count of stuck tasks for an agency
 */
export async function getStuckTaskCount(
  agencyId: string,
  thresholdMs: number = DEFAULT_STUCK_THRESHOLD_MS
): Promise<number> {
  const stuckTasks = await detectStuckTasks(agencyId, thresholdMs);
  return stuckTasks.length;
}

