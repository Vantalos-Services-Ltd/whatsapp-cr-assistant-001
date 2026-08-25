import { Worker, type Job } from "bullmq";
import pino from "pino";
import { TaskStatus, TaskApprovalStatus, MessageDirection, ConversationState, MessageDeliveryStatus } from "@prisma/client";
import { connectionOptions } from "../queues/queue.ts";
import { executeProposedAction } from "../services/actionExecutor.ts";
import { enqueueApprovedTask } from "../queues/approvedTasksQueue.ts";
import { suggestActionWithAI } from "../services/aiActionSuggester.ts";

const log = pino({ name: "approvedTaskWorker" });
import { prisma } from "../db/prisma.ts";

type ApprovedTaskJobData = { taskId: string };

const MAX_RETRIES = 3;

/**
 * Calculate exponential backoff delay in milliseconds
 * Retry 1: 5s, Retry 2: 15s, Retry 3: 45s
 */
function calculateBackoffDelay(retryCount: number): number {
  return 5_000 * Math.pow(3, retryCount - 1);
}

async function processApprovedTask(job: Job<ApprovedTaskJobData>) {
  const { taskId } = job.data ?? {};

  if (!taskId) {
    log.warn({ jobId: job.id, jobName: job.name }, "Missing taskId in job data");
    return;
  }

  // Fetch task with related message and contact (if exists)
  // OUTREACH tasks may not have relatedMessage
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      relatedMessage: {
        include: {
          contact: true,
        },
      },
    },
  });

  // Validate: task exists
  if (!task) {
    log.warn({ taskId, jobId: job.id }, "Task not found; skipping");
    return;
  }

  // Validate: approvalStatus === APPROVED
  if (task.approvalStatus !== TaskApprovalStatus.APPROVED) {
    log.warn(
      {
        taskId,
        currentApprovalStatus: task.approvalStatus,
        jobId: job.id,
      },
      "Task approvalStatus is not APPROVED; skipping execution"
    );
    return;
  }

  // Guard 1: Do not process tasks with status DONE or FAILED
  if (task.status === TaskStatus.DONE) {
    log.info(
      {
        taskId,
        currentStatus: task.status,
        retryCount: (task.retryCount as number) || 0,
        jobId: job.id,
      },
      "Task is already DONE; skipping execution"
    );
    return;
  }

  if (task.status === TaskStatus.FAILED) {
    log.warn(
      {
        taskId,
        currentStatus: task.status,
        retryCount: (task.retryCount as number) || 0,
        failureReason: (task as any).failureReason,
        jobId: job.id,
      },
      "Task is already FAILED; skipping execution"
    );
    return;
  }

  // Validate: status === APPROVED
  if (task.status !== TaskStatus.APPROVED) {
    log.warn(
      {
        taskId,
        currentStatus: task.status,
        retryCount: (task.retryCount as number) || 0,
        jobId: job.id,
      },
      "Task status is not APPROVED; skipping execution"
    );
    return;
  }

  // If proposedAction is missing, generate it from task payload or related message
  let proposedAction = task.proposedAction as any;
  
  if (!proposedAction) {
    const taskPayload = task.payload as any;
    const pendingReplyText = taskPayload?.pendingReplyText;
    const intent = taskPayload?.intent || "UNKNOWN";
    const relatedMessage = task.relatedMessage;
    
    if (pendingReplyText && relatedMessage) {
      // Use pending reply text from task payload
      proposedAction = {
        actionType: "SEND_MESSAGE",
        suggestedMessage: pendingReplyText,
        riskLevel: "MEDIUM",
        reasoning: "Using pending reply text from approval task",
      };
      
      // Update task with generated proposedAction
      await prisma.task.update({
        where: { id: taskId },
        data: { proposedAction },
      });
      
      log.info(
        {
          taskId,
          intent,
          messageId: relatedMessage.id,
        },
        "Generated proposedAction from pending reply text"
      );
    } else if (relatedMessage) {
      // Generate AI reply if we have the related message
      try {
        const aiEnabled =
          (process.env.ENABLE_AI_INTENT_CLASSIFIER ?? "").toLowerCase() === "true";
        
        if (aiEnabled) {
          // Get conversation history for context
          const conversation = await prisma.conversation.findUnique({
            where: { id: relatedMessage.conversationId },
            include: {
              messages: {
                orderBy: { createdAt: "desc" },
                take: 10,
                select: {
                  direction: true,
                  text: true,
                  createdAt: true,
                },
              },
            },
          });
          
          const conversationHistory = conversation?.messages
            .reverse()
            .map((msg) => ({
              direction: msg.direction as MessageDirection,
              text: msg.text,
              createdAt: msg.createdAt,
            })) || [];
          
          proposedAction = await suggestActionWithAI({
            intent,
            messageText: relatedMessage.text,
            contactName: relatedMessage.contact.name,
            conversationHistory,
          });
          
          // Update task with generated proposedAction
          await prisma.task.update({
            where: { id: taskId },
            data: { proposedAction },
          });
          
          log.info(
            {
              taskId,
              intent,
              actionType: proposedAction.actionType,
              riskLevel: proposedAction.riskLevel,
            },
            "Generated AI reply for approved task"
          );
        } else {
          log.warn(
            {
              taskId,
              intent,
            },
            "AI disabled and no proposedAction; cannot generate reply"
          );
          return;
        }
      } catch (error) {
        log.error(
          {
            taskId,
            intent,
            error,
          },
          "Failed to generate AI reply for approved task"
        );
        return;
      }
    } else {
      log.warn(
        {
          taskId,
          retryCount: (task.retryCount as number) || 0,
          jobId: job.id,
        },
        "Task has no proposedAction and no relatedMessage; skipping execution"
      );
      return;
    }
  }

  // Guard 2: Ensure idempotency - check if outbound message already exists for this task
  const messageText = proposedAction?.message || proposedAction?.suggestedMessage;
  const candidateId = proposedAction?.candidateId;

  if (messageText) {
    // For OUTREACH tasks, check by candidateId
    if (candidateId) {
      const existingMessage = await prisma.message.findFirst({
        where: {
          candidateId: candidateId,
          direction: MessageDirection.OUTBOUND,
          text: messageText,
          createdAt: {
            gte: task.createdAt,
          },
        },
      });

      if (existingMessage) {
        log.info(
          {
            taskId,
            retryCount: (task.retryCount as number) || 0,
            existingMessageId: existingMessage.id,
            candidateId,
            jobId: job.id,
          },
          "Outbound message already exists for this task; skipping send (idempotency)"
        );

        // Mark task as DONE since message was already sent
        await prisma.task.update({
          where: { id: taskId },
          data: { status: TaskStatus.DONE },
        });

        return;
      }
    } else if (task.relatedMessage?.conversationId) {
      // For regular tasks, check by conversationId
      const existingOutboundMessage = await prisma.message.findFirst({
        where: {
          conversationId: task.relatedMessage.conversationId,
          direction: MessageDirection.OUTBOUND,
          text: messageText,
          createdAt: {
            gte: task.createdAt,
          },
        },
      });

      if (existingOutboundMessage) {
        log.info(
          {
            taskId,
            retryCount: (task.retryCount as number) || 0,
            existingMessageId: existingOutboundMessage.id,
            conversationId: task.relatedMessage.conversationId,
            jobId: job.id,
          },
          "Outbound message already exists for this task; skipping send (idempotency)"
        );

        // Mark task as DONE since message was already sent
        await prisma.task.update({
          where: { id: taskId },
          data: { status: TaskStatus.DONE },
        });

        return;
      }
    }
  }

  const currentRetryCount = (task.retryCount as number) || 0;
  const failureReason = (task as any).failureReason;

  // Structured logging: task execution started
  log.info(
    {
      taskId,
      messageId: task.relatedMessage?.id || null,
      conversationId: task.relatedMessage?.conversationId || null,
      retryCount: currentRetryCount,
      failureReason,
      jobId: job.id,
    },
    "Task execution started"
  );

  // Guard 3: Wrap execution in try/catch with explicit failure handling
  try {
    // Execute proposed action using the action executor service
    const result = await executeProposedAction(task);

    if (!result.success) {
      log.warn(
        {
          taskId,
          retryCount: currentRetryCount,
          actionType: result.actionType,
          jobId: job.id,
        },
        "Action execution returned unsuccessful result"
      );
      return; // Don't mark as DONE for unsuccessful actions
    }

    // Check for outbound messages related to this task (message deliveryStatus is authoritative)
    const proposedAction = task.proposedAction as any;
    const messageText = proposedAction?.message || proposedAction?.suggestedMessage;
    const candidateId = proposedAction?.candidateId;

    if (messageText) {
      let persistedMessage;

      // For OUTREACH tasks, find by candidateId
      if (candidateId) {
        persistedMessage = await prisma.message.findFirst({
          where: {
            candidateId: candidateId,
            direction: MessageDirection.OUTBOUND,
            text: messageText,
            createdAt: {
              gte: task.createdAt,
            },
          },
          orderBy: {
            createdAt: "desc",
          },
        });
      } else if (task.relatedMessage?.conversationId) {
        // For regular tasks, find by conversationId
        persistedMessage = await prisma.message.findFirst({
          where: {
            conversationId: task.relatedMessage.conversationId,
            direction: MessageDirection.OUTBOUND,
            text: messageText,
            createdAt: {
              gte: task.createdAt,
            },
          },
          orderBy: {
            createdAt: "desc",
          },
        });
      }

      if (!persistedMessage) {
        log.warn(
          {
            taskId,
            retryCount: currentRetryCount,
            actionType: result.actionType,
            messageSid: result.messageSid,
            candidateId,
            jobId: job.id,
          },
          "Message not found; task status not updated"
        );
        return; // Don't mark as DONE if message wasn't persisted
      }

      // Message deliveryStatus is authoritative
      if (persistedMessage.deliveryStatus === MessageDeliveryStatus.FAILED) {
          // Twilio send failed: mark task as FAILED
          const failureReason = persistedMessage.failureReason || "Twilio send failed";

          await prisma.task.update({
            where: { id: taskId },
            data: {
              status: TaskStatus.FAILED,
              retryCount: currentRetryCount,
              failureReason: `Message send failed: ${failureReason}`,
              // approvalStatus remains APPROVED
            },
          });

        log.error(
          {
            taskId,
            retryCount: currentRetryCount,
            actionType: result.actionType,
            messageId: persistedMessage.id,
            messageSid: persistedMessage.providerMessageId,
            failureReason,
            candidateId,
            jobId: job.id,
          },
          "Task marked as FAILED due to message send failure"
        );

        return; // Don't mark as DONE, task is now FAILED
      }

        // Twilio send succeeded: Update task status = DONE, approvalStatus remains APPROVED
        // Resume conversation if it was paused
        const taskPayload = task.payload as any;
        const conversationId = taskPayload?.conversationId || task.relatedMessage?.conversationId;

        if (conversationId) {
          await prisma.conversation.update({
            where: { id: conversationId },
            data: {
              state: ConversationState.ACTIVE,
              pausedReason: null,
            },
          });

          log.info(
            {
              taskId,
              conversationId,
              conversationState: ConversationState.ACTIVE,
            },
            "Conversation resumed to ACTIVE after task approval and message send"
          );
        }

        await prisma.task.update({
          where: { id: taskId },
          data: { status: TaskStatus.DONE },
        });

        log.info(
          {
            taskId,
            retryCount: currentRetryCount,
            actionType: result.actionType,
            messageId: persistedMessage.id,
            messageSid: persistedMessage.providerMessageId,
            deliveryStatus: persistedMessage.deliveryStatus,
            candidateId,
            conversationId,
            jobId: job.id,
          },
          "Task completed after successful outbound message send"
        );
    } else {
      // No message to send (e.g., NO_ACTION) - mark as DONE
      await prisma.task.update({
        where: { id: taskId },
        data: { status: TaskStatus.DONE },
      });

      log.info(
        {
          taskId,
          retryCount: currentRetryCount,
          actionType: result.actionType,
          jobId: job.id,
        },
        "Task completed (no message to send)"
      );
    }
  } catch (error) {
    // On failure: handle retry logic with explicit failure handling
    // Task failure does NOT crash worker - all errors are caught and handled

    // Check if a FAILED message was persisted (Twilio send failed but message was saved)
    const proposedAction = task.proposedAction as any;
    const messageText = proposedAction?.message || proposedAction?.suggestedMessage;
    const candidateId = proposedAction?.candidateId;

    if (messageText) {
      let failedMessage;

      // For OUTREACH tasks, find by candidateId
      if (candidateId) {
        failedMessage = await prisma.message.findFirst({
          where: {
            candidateId: candidateId,
            direction: MessageDirection.OUTBOUND,
            text: messageText,
            deliveryStatus: MessageDeliveryStatus.FAILED,
            createdAt: {
              gte: task.createdAt,
            },
          },
          orderBy: {
            createdAt: "desc",
          },
        });
      } else if (task.relatedMessage?.conversationId) {
        // For regular tasks, find by conversationId
        failedMessage = await prisma.message.findFirst({
          where: {
            conversationId: task.relatedMessage.conversationId,
            direction: MessageDirection.OUTBOUND,
            text: messageText,
            deliveryStatus: MessageDeliveryStatus.FAILED,
            createdAt: {
              gte: task.createdAt,
            },
          },
          orderBy: {
            createdAt: "desc",
          },
        });
      }

      if (failedMessage) {
        // Message was persisted as FAILED - mark task as FAILED immediately
        const failureReason = failedMessage.failureReason || "Twilio send failed";

        await prisma.task.update({
          where: { id: taskId },
          data: {
            status: TaskStatus.FAILED,
            retryCount: currentRetryCount,
            failureReason: `Message send failed: ${failureReason}`,
            // approvalStatus remains APPROVED
          },
        });

        log.error(
          {
            taskId,
            retryCount: currentRetryCount,
            messageId: failedMessage.id,
            failureReason,
            candidateId,
            jobId: job.id,
          },
          "Task marked as FAILED due to message send failure (caught in error handler)"
        );

        return; // Don't retry - message failure is final
      }
    }

    // No FAILED message found - proceed with retry logic
    const newRetryCount = currentRetryCount + 1;

    const errorMessage = error instanceof Error ? error.message : String(error);

    log.warn(
      {
        error,
        taskId,
        retryCount: currentRetryCount,
        newRetryCount,
        failureReason: errorMessage,
        jobId: job.id,
      },
      "Task execution failed; attempting retry"
    );

    if (newRetryCount > MAX_RETRIES) {
      // Max retries exceeded: mark task as FAILED
      const finalFailureReason = `Max retries (${MAX_RETRIES}) exceeded: ${errorMessage}`;

      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.FAILED,
          retryCount: newRetryCount,
          failureReason: finalFailureReason,
          // approvalStatus remains APPROVED
        },
      });

      log.error(
        {
          taskId,
          retryCount: newRetryCount,
          failureReason: finalFailureReason,
          jobId: job.id,
        },
        "Task marked as FAILED after max retries exceeded"
      );

      return; // Don't re-throw, task is marked as failed
    }

    // Increment retry count and re-enqueue with exponential backoff
    const backoffDelay = calculateBackoffDelay(newRetryCount);

    await prisma.task.update({
      where: { id: taskId },
      data: {
        retryCount: newRetryCount,
        // approvalStatus remains APPROVED
        // status remains APPROVED (will be updated on success or final failure)
      },
    });

    // Re-enqueue the job with exponential backoff delay
    try {
      await enqueueApprovedTask(taskId, backoffDelay);

      log.info(
        {
          taskId,
          retryCount: newRetryCount,
          backoffDelayMs: backoffDelay,
          failureReason: errorMessage,
          jobId: job.id,
        },
        "Task scheduled for retry with exponential backoff"
      );
    } catch (enqueueError) {
      const enqueueErrorMessage =
        enqueueError instanceof Error
          ? enqueueError.message
          : String(enqueueError);
      const finalFailureReason = `Failed to re-enqueue for retry: ${enqueueErrorMessage}`;

      log.error(
        {
          error: enqueueError,
          taskId,
          retryCount: newRetryCount,
          failureReason: finalFailureReason,
          jobId: job.id,
        },
        "Failed to schedule task retry; marking as FAILED"
      );

      // If we can't re-enqueue, mark as failed
      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.FAILED,
          retryCount: newRetryCount,
          failureReason: finalFailureReason,
        },
      });
    }

    // Don't re-throw - we've handled the retry logic
    return;
  }
}

const worker = new Worker<ApprovedTaskJobData>(
  "approved-tasks",
  async (job) => {
    try {
      await processApprovedTask(job);
    } catch (error) {
      log.error(
        { error, jobId: job.id, taskId: job.data?.taskId },
        "Approved task worker job failed"
      );
      throw error;
    }
  },
  {
    connection: connectionOptions,
    concurrency: 5,
  }
);

log.info("Approved task worker started");

worker.on("completed", (job) => {
  log.debug({ jobId: job.id, taskId: job.data?.taskId }, "Job completed");
});

worker.on("failed", (job, err) => {
  log.warn(
    { jobId: job?.id, taskId: job?.data?.taskId, err },
    "Job failed"
  );
});

worker.on("error", (err) => {
  log.error({ err }, "Worker error");
});

async function shutdown(signal: string) {
  log.info({ signal }, "Shutting down approved task worker...");
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
