import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db/prisma.ts";
import { TaskStatus, TaskApprovalStatus, TaskType, PlacementStatus, MessageDirection, MessageChannel, MessageDeliveryStatus, MessageSenderRole, ContactType } from "@prisma/client";
import { enqueueApprovedTask } from "../queues/approvedTasksQueue.ts";
import { enqueueCscsAutoVerify } from "../queues/cscsAutoVerifyQueue.ts";
import { requireAuth } from "../middleware/auth.ts";
import { requireAgencyId } from "../utils/agencyContext.ts";
import { scopeWhere, findFirstOr404, verifyOwnership } from "../db/tenantScope.ts";
import { notFound } from "../utils/httpErrors.ts";
import { extractFirstMediaUrl } from "../services/twilioMedia.ts";
import type { CscsVerificationPayload } from "../../shared/types/cscs.ts";
import { getFallbackReplyForApproval } from "../services/fallbackReplyGenerator.ts";
import twilio from "twilio";
import { env } from "../config/env.ts";
import { createTimelineEvent } from "../services/timelineService.ts";
import { applyProgressStateMachine } from "../services/progress/stateMachine.ts";
import type { CandidateSnapshot, TaskFlags, PlacementStatus } from "../services/progress/stateMachineTypes.ts";
import { computeEditMetrics, wasEdited, capText, generateEditSummary } from "../utils/editMetrics.ts";
import { sendWhatsAppMessage } from "../services/whatsappSender.ts";

interface TaskParams {
  taskId: string;
}

interface ApproveTaskBody {
  messageOverride?: string; // Optional message text to override the suggested message
}

interface RejectTaskBody {
  reason?: string;
}

interface CreateCscsVerificationBody {
  candidateId: string;
  jobId: string;
  // Option A: get image from message
  sourceMessageId?: string;
  // Option B: operator upload URL
  imageUrl?: string;
}

interface VerifyCscsBody {
  extracted: {
    holderName?: string;
    cardType?: string;
    expiryDate?: string; // ISO or yyyy-mm-dd
    cardNumber?: string;
  };
  checks: {
    nameMatchOk: boolean;
    expiryValidOk: boolean;
    requiredLevelOk: boolean;
  };
}

// Removed getAgencyId() - use requireAgencyId(request) from agencyContext instead

/**
 * Approve a task
 * Requires authenticated operator (operatorId from session)
 *
 * Example curl command:
 * curl -X POST http://localhost:3001/api/tasks/{taskId}/approve \
 *   -H "Content-Type: application/json" \
 *   -H "Cookie: <session-cookie>"
 */
export async function approveTaskHandler(
  request: FastifyRequest<{
    Params: TaskParams;
    Body: ApproveTaskBody;
  }>,
  reply: FastifyReply
) {
  const { taskId } = request.params;
  const logger = request.log;
  // Get operatorId from session (set by auth middleware)
  const operatorId = (request as any).operatorId;

  // Get agencyId for tenant scoping
  const agencyId = await requireAgencyId(request);

  // Fetch task with agency scoping (use findFirst since id is globally unique but not tenant-scoped in unique constraint)
  const task = await prisma.task.findFirst({
    where: scopeWhere(agencyId, { id: taskId }),
  });

  if (!operatorId) {
    logger.warn({ taskId, action: "approve" }, "No operatorId in session");
    return reply.status(401).send({ error: "Authentication required" });
  }

  if (!task) {
    return notFound(reply, "Not found");
  }

  // Allow APPROVAL_REQUIRED and CSCS_VERIFICATION tasks to be approved
  if (task.type !== TaskType.APPROVAL_REQUIRED && task.type !== TaskType.CSCS_VERIFICATION) {
    logger.warn(
      { taskId, action: "approve", operatorId, taskType: task.type },
      "Cannot approve task that does not require approval"
    );
    return reply.status(400).send({
      error: "Task does not require approval",
      taskType: task.type,
      expectedTypes: [TaskType.APPROVAL_REQUIRED, TaskType.CSCS_VERIFICATION],
    });
  }

  // Prevent double approval (idempotency check)
  if (task.approvalStatus === TaskApprovalStatus.APPROVED) {
    logger.warn(
      { taskId, action: "approve", operatorId, currentApprovalStatus: task.approvalStatus },
      "Task already approved"
    );
    return reply.status(409).send({
      error: "Task has already been approved",
      currentApprovalStatus: task.approvalStatus,
      approvedByOperatorId: (task as any).approvedByOperatorId,
      approvedAt: task.approvedAt,
    });
  }

  // Prevent approving a task that was already rejected
  if (task.approvalStatus === TaskApprovalStatus.REJECTED) {
    logger.warn(
      { taskId, action: "approve", operatorId, currentApprovalStatus: task.approvalStatus },
      "Cannot approve task that was already rejected"
    );
    return reply.status(400).send({
      error: "Task has already been rejected and cannot be approved",
      currentApprovalStatus: task.approvalStatus,
    });
  }

  // Validate task.status === OPEN
  if (task.status !== TaskStatus.OPEN) {
    logger.warn(
      { taskId, action: "approve", operatorId, currentStatus: task.status },
      "Task is not OPEN"
    );
    return reply.status(400).send({
      error: "Task is not OPEN",
      currentStatus: task.status,
    });
  }

  // Validate task.approvalStatus === PENDING
  if (task.approvalStatus !== TaskApprovalStatus.PENDING) {
    logger.warn(
      { taskId, action: "approve", operatorId, currentApprovalStatus: task.approvalStatus },
      "Task is not pending approval"
    );
    return reply.status(400).send({
      error: "Task is not pending approval",
      currentApprovalStatus: task.approvalStatus,
    });
  }

  // Extract messageOverride from request body if present
  const { messageOverride } = request.body || {};
  
  // Prepare payload update
  const currentPayload = (task.payload as any) || {};
  let updateData: any = {
    approvalStatus: TaskApprovalStatus.APPROVED,
    approvedByOperatorId: operatorId,
    approvedAt: new Date(),
  };

  // For APPROVAL_REQUIRED tasks, resolve the final message text to send
  if (task.type === TaskType.APPROVAL_REQUIRED) {
    // Step 1: Resolve proposed message (AI-suggested, before operator edits)
    const proposedAction = task.proposedAction as any;
    let proposedMessageText: string = "";
    
    if (proposedAction?.suggestedMessage && typeof proposedAction.suggestedMessage === "string") {
      proposedMessageText = proposedAction.suggestedMessage;
    } else if (currentPayload?.pendingReplyText && typeof currentPayload.pendingReplyText === "string") {
      proposedMessageText = currentPayload.pendingReplyText;
    } else {
      // If no proposed message found, we'll use the final message as proposed (no edit)
      // This handles edge cases where proposedAction might be missing
      proposedMessageText = "";
    }

    // Step 2: Resolve final message (priority: messageOverride > suggestedMessage > fallback)
    let approvedMessageText: string;

    // Priority 1: messageOverride from request body
    if (messageOverride && typeof messageOverride === "string" && messageOverride.trim() !== "") {
      approvedMessageText = messageOverride.trim();
      logger.info(
        {
          taskId,
          operatorId,
          source: "messageOverride",
          messageLength: approvedMessageText.length,
        },
        "Using messageOverride from request body"
      );
    } else if (proposedMessageText) {
      // Priority 2: Use proposed message (no override)
      approvedMessageText = proposedMessageText;
      logger.info(
        {
          taskId,
          operatorId,
          source: "proposedMessage",
          messageLength: approvedMessageText.length,
        },
        "Using proposed message (no override)"
      );
    } else {
      // Priority 3: Fallback generator
      // Fetch related message and candidate info for fallback
      let relatedMessage: any = null;
      if (task.relatedMessageId) {
        try {
          relatedMessage = await prisma.message.findFirst({
            where: scopeWhere(agencyId, { id: task.relatedMessageId }),
            include: {
              contact: true,
            },
          });
        } catch (error) {
          logger.warn({ taskId, error }, "Failed to fetch related message for fallback");
        }
      }

      const inboundText = relatedMessage?.text || currentPayload.lastMessageText || "";
      const intent = currentPayload.intent || "UNKNOWN";
      
      // Try to get candidate info for personalization
      let candidateName: string | null = null;
      let desiredRole: string | null = null;
      
      if (relatedMessage?.contact) {
        candidateName = relatedMessage.contact.name;
        
        // Try to find candidate by phone
        try {
          const candidate = await prisma.candidate.findUnique({
            where: {
              agencyId_phone: {
                agencyId: task.agencyId,
                phone: relatedMessage.contact.phone,
              },
            },
            select: {
              name: true,
              desiredRole: true,
            },
          });
          
          if (candidate) {
            candidateName = candidate.name || candidateName;
            desiredRole = candidate.desiredRole || null;
          }
        } catch (error) {
          // Ignore errors - fallback will work without candidate info
          logger.debug({ taskId, error }, "Could not fetch candidate info for fallback");
        }
      }

      approvedMessageText = getFallbackReplyForApproval({
        intent,
        inboundText,
        candidateName,
        desiredRole,
      });

      // If we used fallback and had no proposed message, set proposed = final (no edit)
      if (!proposedMessageText) {
        proposedMessageText = approvedMessageText;
      }

      logger.info(
        {
          taskId,
          operatorId,
          source: "fallbackGenerator",
          intent,
          messageLength: approvedMessageText.length,
        },
        "Using fallback generator for approved message"
      );
    }

    // Step 3: Compute edit metrics
    const editWasMade = wasEdited(proposedMessageText, approvedMessageText);
    const editMetrics = computeEditMetrics(proposedMessageText, approvedMessageText);
    const editSummary = editWasMade ? generateEditSummary(editMetrics) : "No changes";

    // Step 4: Cap texts at 2000 chars for storage
    const cappedProposed = capText(proposedMessageText, 2000);
    const cappedFinal = capText(approvedMessageText, 2000);

    // Step 5: Store audit data in payload
    updateData.payload = {
      ...currentPayload,
      // Audit fields
      proposedMessageText: cappedProposed,
      approvedMessageText: cappedFinal,
      wasEdited: editWasMade,
      editMetrics,
      editSummary,
      // Backward compatibility
      sentText: cappedFinal,
    };
    
    // Set status to APPROVED for APPROVAL_REQUIRED tasks
    updateData.status = TaskStatus.APPROVED;
  }

  // Handle CSCS_VERIFICATION tasks specially
  if (task.type === TaskType.CSCS_VERIFICATION) {
    try {
      // Parse payload as CscsVerificationPayload
      const cscsPayload = currentPayload as CscsVerificationPayload;
      
      if (!cscsPayload.candidate || !cscsPayload.job || !cscsPayload.cscs) {
        logger.warn(
          { taskId, action: "approve", operatorId },
          "CSCS verification task payload is invalid"
        );
        return reply.status(400).send({
          error: "Invalid CSCS verification payload",
        });
      }

      // Create or upsert Placement
      const placement = await prisma.placement.upsert({
        where: {
          jobId_candidateId: {
            jobId: cscsPayload.job.jobId,
            candidateId: cscsPayload.candidate.candidateId,
          },
        },
        create: {
          agencyId: task.agencyId,
          jobId: cscsPayload.job.jobId,
          candidateId: cscsPayload.candidate.candidateId,
          status: PlacementStatus.CONFIRMED,
          startDate: cscsPayload.job.startDate ? new Date(cscsPayload.job.startDate) : null,
        },
        update: {
          status: PlacementStatus.CONFIRMED,
          startDate: cscsPayload.job.startDate ? new Date(cscsPayload.job.startDate) : undefined,
        },
      });

      logger.info(
        {
          taskId,
          placementId: placement.id,
          candidateId: cscsPayload.candidate.candidateId,
          jobId: cscsPayload.job.jobId,
          operatorId,
        },
        "Placement created/updated for CSCS verification approval"
      );

      // Optionally send WhatsApp confirmation message
      try {
        const candidate = await prisma.candidate.findUnique({
          where: { id: cscsPayload.candidate.candidateId },
        });

        if (candidate) {
          // Find or create contact for the candidate
          let contact = await prisma.contact.findUnique({
            where: {
              agencyId_phone: {
                agencyId: task.agencyId,
                phone: candidate.phone,
              },
            },
          });

          if (!contact) {
            contact = await prisma.contact.create({
              data: {
                agencyId: task.agencyId,
                phone: candidate.phone,
                name: candidate.name || null,
                type: ContactType.CANDIDATE,
              },
            });
          }

          // Find or create conversation
          let conversation = await prisma.conversation.findFirst({
            where: {
              agencyId: task.agencyId,
              contactId: contact.id,
            },
          });

          if (!conversation) {
            conversation = await prisma.conversation.create({
              data: {
                agencyId: task.agencyId,
                contactId: contact.id,
              },
            });
          }

          // Build confirmation message
          const jobTitle = cscsPayload.job.title;
          const location = cscsPayload.job.city || cscsPayload.job.postcode || "the site";
          const startDate = cscsPayload.job.startDate
            ? new Date(cscsPayload.job.startDate).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })
            : "TBD";

          const confirmationMessage = `All confirmed ✅ You're booked on ${jobTitle} in ${location}. Start ${startDate}. Any issues let me know.`;

          // Send WhatsApp message
          const twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
          const normalizedTo = candidate.phone.startsWith("whatsapp:")
            ? candidate.phone
            : `whatsapp:${candidate.phone}`;
          const normalizedFrom = env.TWILIO_WHATSAPP_NUMBER.startsWith("whatsapp:")
            ? env.TWILIO_WHATSAPP_NUMBER
            : `whatsapp:${env.TWILIO_WHATSAPP_NUMBER}`;

          const twilioMessage = await sendWhatsAppMessage(twilioClient, {
            from: normalizedFrom,
            to: normalizedTo,
            body: confirmationMessage,
            statusCallback: env.WEBHOOK_BASE_URL
              ? `${env.WEBHOOK_BASE_URL}/webhooks/whatsapp/status`
              : undefined,
          });

          // Persist message to database
          await prisma.message.create({
            data: {
              agencyId: task.agencyId,
              contactId: contact.id,
              conversationId: conversation.id,
              direction: MessageDirection.OUTBOUND,
              channel: MessageChannel.WHATSAPP,
              senderRole: MessageSenderRole.OPERATOR,
              text: confirmationMessage,
              providerMessageId: twilioMessage.sid,
              deliveryStatus: MessageDeliveryStatus.SENT,
              rawPayload: {
                twilioSid: twilioMessage.sid,
                from: normalizedFrom,
                to: normalizedTo,
              } as any,
            },
          });

          logger.info(
            {
              taskId,
              placementId: placement.id,
              candidateId: cscsPayload.candidate.candidateId,
              messageSid: twilioMessage.sid,
              operatorId,
            },
            "Placement confirmation message sent"
          );
        }
      } catch (messageError) {
        // Log error but don't fail the approval
        logger.error(
          {
            error: messageError,
            taskId,
            candidateId: cscsPayload.candidate.candidateId,
            operatorId,
          },
          "Failed to send placement confirmation message, but placement was created"
        );
      }

      // Update payload with placement ID
      updateData.payload = {
        ...currentPayload,
        placementId: placement.id,
      };

      // For CSCS_VERIFICATION, set status to DONE (not APPROVED)
      updateData.status = TaskStatus.DONE;
    } catch (error) {
      logger.error(
        {
          error,
          taskId,
          operatorId,
        },
        "Failed to process CSCS verification approval"
      );
      return reply.status(500).send({
        error: "Failed to process CSCS verification approval",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Update task
  let updated;
  try {
    // Verify ownership before update (task.id is globally unique, not tenant-scoped in unique constraint)
    await verifyOwnership(prisma.task, agencyId, taskId);
    
    updated = await prisma.task.update({
      where: { id: taskId },
      data: updateData,
      include: {
        relatedMessage: {
          include: {
            contact: true,
            conversation: true,
          },
        },
      },
    });
  } catch (error: any) {
    // Handle Prisma foreign key constraint errors gracefully
    if (error.code === "P2003") {
      logger.error(
        { taskId, operatorId, error: error.meta },
        "Foreign key constraint failed - operator not found"
      );
      return reply.status(400).send({
        error: "Invalid operator",
        details: "The operator ID does not exist",
      });
    }
    throw error;
  }

  // Enqueue approved task for processing
  // Only enqueue if:
  // - approvalStatus transitions from PENDING → APPROVED (already validated above)
  // - task.status is APPROVED (not DONE, which is used for CSCS_VERIFICATION)
  // - task.type is APPROVAL_REQUIRED (not CSCS_VERIFICATION, which is handled above)
  if (
    updated.approvalStatus === TaskApprovalStatus.APPROVED &&
    updated.status === TaskStatus.APPROVED &&
    updated.type === TaskType.APPROVAL_REQUIRED
  ) {
    try {
      await enqueueApprovedTask(taskId);
      // Structured logging: task approved
      logger.info(
        {
          taskId,
          messageId: task.relatedMessage?.id || null,
          conversationId: task.relatedMessage?.conversationId || null,
          operatorId,
          previousStatus: task.status,
        },
        "Task approved"
      );
    } catch (error) {
      // Log error but don't fail the approval - task is already approved
      logger.error(
        {
          error,
          taskId,
          messageId: task.relatedMessage?.id || null,
          conversationId: task.relatedMessage?.conversationId || null,
          operatorId,
        },
        "Task approved but failed to enqueue for processing"
      );
    }
  }

  // Create TASK_APPROVED timeline event
  try {
    const relatedMessage = task.relatedMessage;
    if (relatedMessage) {
      const payload = updated.payload as any;
      const wasEditedFlag = payload?.wasEdited || false;
      const editSummary = payload?.editSummary || "No changes";
      const editMetrics = payload?.editMetrics || null;
      
      // Build summary with edit info
      let summary = "Task approved";
      if (wasEditedFlag && editSummary) {
        summary = `Task approved (${editSummary})`;
      }
      
      await createTimelineEvent({
        agencyId: updated.agencyId,
        conversationId: relatedMessage.conversationId,
        contactId: relatedMessage.contactId,
        candidateId: updated.candidateId || null,
        type: updated.type === TaskType.CSCS_VERIFICATION ? "CSCS_APPROVED" : "TASK_APPROVED",
        actorRole: "OPERATOR",
        actorOperatorId: operatorId,
        summary,
        data: {
          taskId: updated.id,
          taskType: updated.type,
          wasEdited: wasEditedFlag,
          editSummary,
          editMetrics: editMetrics ? {
            charDiffRatio: editMetrics.charDiffRatio,
            wordDiffCount: editMetrics.wordDiffCount,
            wasShortened: editMetrics.wasShortened,
            wasExpanded: editMetrics.wasExpanded,
          } : null,
          deliveryStatus: payload?.deliveryStatus || null,
        },
        dedupeKey: `task_${updated.id}_approved`,
      });
    }
  } catch (error) {
    logger.warn({ taskId, error }, "Failed to create TASK_APPROVED timeline event (non-blocking)");
  }

  // Apply progress state machine after task approval (non-blocking)
  try {
    const relatedMessage = task.relatedMessage;
    if (relatedMessage && relatedMessage.conversationId) {
      // Get candidate snapshot
      let candidateSnapshot: CandidateSnapshot | null = null;
      if (relatedMessage.contact) {
        const candidate = await prisma.candidate.findUnique({
          where: {
            agencyId_phone: {
              agencyId: updated.agencyId,
              phone: relatedMessage.contact.phone,
            },
          },
          select: {
            phone: true,
            name: true,
            desiredRole: true,
            location: true,
            availabilityNotes: true,
            salaryMin: true,
            salaryMax: true,
            skills: true,
            yearsExperience: true,
          },
        });
        if (candidate) {
          candidateSnapshot = {
            phone: candidate.phone,
            name: candidate.name,
            desiredRole: candidate.desiredRole,
            location: candidate.location,
            availability: candidate.availabilityNotes,
            salaryMin: candidate.salaryMin,
            salaryMax: candidate.salaryMax,
            skills: candidate.skills || [],
            yearsExperience: candidate.yearsExperience,
          };
        }
      }

      // Check for remaining pending tasks
      const pendingTasks = await prisma.task.findMany({
        where: {
          agencyId: updated.agencyId,
          approvalStatus: "PENDING",
          status: "OPEN",
          OR: [
            {
              relatedMessage: {
                conversationId: relatedMessage.conversationId,
              },
            },
            {
              payload: {
                path: ["conversationId"],
                equals: relatedMessage.conversationId,
              },
            },
          ],
        },
        select: { type: true },
      });

      const cscsTasks = await prisma.task.findMany({
        where: {
          agencyId: updated.agencyId,
          type: "CSCS_VERIFICATION",
          status: "OPEN",
          OR: [
            {
              relatedMessage: {
                conversationId: relatedMessage.conversationId,
              },
            },
            {
              payload: {
                path: ["conversationId"],
                equals: relatedMessage.conversationId,
              },
            },
          ],
        },
        select: { id: true },
      });

      const followUpTasks = await prisma.task.findMany({
        where: {
          agencyId: updated.agencyId,
          type: "FOLLOW_UP",
          status: "OPEN",
          OR: [
            {
              relatedMessage: {
                conversationId: relatedMessage.conversationId,
              },
            },
            {
              payload: {
                path: ["conversationId"],
                equals: relatedMessage.conversationId,
              },
            },
          ],
        },
        select: { id: true },
      });

      const tasks: TaskFlags = {
        hasPendingApproval: pendingTasks.length > 0,
        hasOpenCscsTask: cscsTasks.length > 0,
        hasOpenFollowUpTask: followUpTasks.length > 0,
        hasOpenTasks: pendingTasks.length > 0 || cscsTasks.length > 0 || followUpTasks.length > 0,
      };

      // Get matched jobs count
      let matchedJobsCount = 0;
      if (candidateSnapshot) {
        try {
          const candidate = await prisma.candidate.findUnique({
            where: {
              agencyId_phone: {
                agencyId: updated.agencyId,
                phone: candidateSnapshot.phone,
              },
            },
            select: { id: true },
          });
          if (candidate) {
            const jobMatches = await prisma.jobCandidateMatch.findMany({
              where: {
                candidateId: candidate.id,
                job: {
                  status: { in: ["ACTIVE", "URGENT"] },
                },
              },
              select: { id: true },
            });
            matchedJobsCount = jobMatches.length;
          }
        } catch (error) {
          logger.debug({ conversationId: relatedMessage.conversationId, error }, "Failed to get matched jobs count (non-blocking)");
        }
      }

      // Check placement status
      let placement: PlacementStatus | null = null;
      if (candidateSnapshot) {
        try {
          const candidate = await prisma.candidate.findUnique({
            where: {
              agencyId_phone: {
                agencyId: updated.agencyId,
                phone: candidateSnapshot.phone,
              },
            },
            select: { id: true },
          });
          if (candidate) {
            const activePlacement = await prisma.placement.findFirst({
              where: {
                candidateId: candidate.id,
                status: { in: ["CONFIRMED", "ACTIVE"] },
              },
              select: {
                status: true,
                startDate: true,
              },
              orderBy: { createdAt: "desc" },
            });
            if (activePlacement) {
              placement = {
                hasConfirmedPlacement: true,
                placementStartDate: activePlacement.startDate?.toISOString() || null,
              };
            }
          }
        } catch (error) {
          logger.debug({ conversationId: relatedMessage.conversationId, error }, "Failed to get placement status (non-blocking)");
        }
      }

      // Get conversation for last activity (use findFirst with agency scoping)
      const conversation = await prisma.conversation.findFirst({
        where: scopeWhere(agencyId, { id: relatedMessage.conversationId }),
        select: {
          lastMessageAt: true,
          contact: {
            select: {
              type: true,
            },
          },
        },
      });

      // Apply progress state machine
      await applyProgressStateMachine({
        conversationId: relatedMessage.conversationId,
        agencyId: updated.agencyId,
        context: {
          lastActivityAt: conversation?.lastMessageAt || new Date(),
          lastInboundMessageAt: conversation?.lastMessageAt || null,
          candidate: candidateSnapshot,
          tasks,
          placement,
          lastIntent: null, // Not available in approve context
          matchedJobsCount,
          contactType: conversation?.contact?.type || null,
        },
      });
    }
  } catch (error) {
    logger.warn({ taskId, error }, "Failed to apply progress state machine after approval (non-blocking)");
  }

  // Return DTO instead of raw Prisma model
  const taskWithRelations = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      relatedMessage: {
        include: {
          contact: true,
          conversation: true,
        },
      },
    },
  });

  if (!taskWithRelations) {
    return reply.status(200).send(updated);
  }

  const { toTaskListItemDTO } = await import("../dto/transformers.js");
  const dto = toTaskListItemDTO(taskWithRelations as any);

  return reply.status(200).send(dto);
}

/**
 * Reject a task
 *
 * Example curl command:
 * curl -X POST http://localhost:3000/api/tasks/{taskId}/reject \
 *   -H "Content-Type: application/json" \
 *   -d '{"reason": "Not suitable for this role"}'
 */
export async function rejectTaskHandler(
  request: FastifyRequest<{
    Params: TaskParams;
    Body: RejectTaskBody;
  }>,
  reply: FastifyReply
) {
  const { taskId } = request.params;
  // Accept both 'reason' and 'rejectionReason' for backward compatibility
  const body = request.body as { reason?: string; rejectionReason?: string };
  const reason = body.rejectionReason ?? body.reason ?? null;
  const logger = request.log;
  // Get operatorId from session (set by auth middleware)
  const operatorId = (request as any).operatorId;

  // Get agencyId for tenant scoping
  const agencyId = await requireAgencyId(request);

  // Fetch task with agency scoping (use findFirst since id is globally unique but not tenant-scoped in unique constraint)
  const task = await prisma.task.findFirst({
    where: scopeWhere(agencyId, { id: taskId }),
  });

  if (!operatorId) {
    logger.warn({ taskId, action: "reject" }, "No operatorId in session");
    return reply.status(401).send({ error: "Authentication required" });
  }

  if (!task) {
    return notFound(reply, "Not found");
  }

  // If task already DONE/FAILED, return 409 (idempotency check)
  if (task.status === TaskStatus.DONE || task.status === TaskStatus.FAILED) {
    logger.warn(
      { taskId, action: "reject", operatorId, currentStatus: task.status },
      "Task is already DONE or FAILED"
    );
    return reply.status(409).send({
      error: "Task is already DONE or FAILED and cannot be rejected",
      currentStatus: task.status,
    });
  }

  // If task approvalStatus is not PENDING, return error
  if (task.approvalStatus !== TaskApprovalStatus.PENDING) {
    // If already rejected, return 409 (idempotency)
    if (task.approvalStatus === TaskApprovalStatus.REJECTED) {
      logger.warn(
        { taskId, action: "reject", operatorId, currentApprovalStatus: task.approvalStatus },
        "Task already rejected"
      );
      return reply.status(409).send({
        error: "Task has already been rejected",
        currentApprovalStatus: task.approvalStatus,
        rejectedAt: task.rejectedAt,
      });
    }
    logger.warn(
      { taskId, action: "reject", operatorId, currentApprovalStatus: task.approvalStatus },
      "Task is not pending approval"
    );
    return reply.status(400).send({
      error: "Task is not pending approval",
      currentApprovalStatus: task.approvalStatus,
    });
  }

  // Handle CSCS_VERIFICATION tasks specially
  if (task.type === TaskType.CSCS_VERIFICATION) {
    // Require rejectionReason for CSCS_VERIFICATION tasks
    // If missing, try to derive from task payload issues
    let finalReason = reason;
    
    if (!finalReason || typeof finalReason !== "string" || finalReason.trim().length === 0) {
      // Try to derive from payload issues
      const payload = task.payload as any;
      if (payload?.cscs?.checks?.issues && Array.isArray(payload.cscs.checks.issues) && payload.cscs.checks.issues.length > 0) {
        finalReason = `CSCS verification failed: ${payload.cscs.checks.issues.join("; ")}`;
        logger.info(
          { taskId, action: "reject", operatorId, taskType: task.type, derivedReason: finalReason },
          "Derived rejection reason from CSCS verification issues"
        );
      } else {
        // Safe default fallback
        finalReason = "CSCS verification failed";
        logger.info(
          { taskId, action: "reject", operatorId, taskType: task.type },
          "Using default rejection reason for CSCS verification"
        );
      }
    }

    try {
      // Parse payload to get candidate information
      const cscsPayload = (task.payload as any) as CscsVerificationPayload;
      
      if (cscsPayload?.candidate?.candidateId) {
        // Optionally send WhatsApp message asking for new card
        try {
          const candidate = await prisma.candidate.findUnique({
            where: { id: cscsPayload.candidate.candidateId },
          });

          if (candidate) {
            // Find or create contact for the candidate
            let contact = await prisma.contact.findUnique({
              where: {
                agencyId_phone: {
                  agencyId: task.agencyId,
                  phone: candidate.phone,
                },
              },
            });

            if (!contact) {
              contact = await prisma.contact.create({
                data: {
                  agencyId: task.agencyId,
                  phone: candidate.phone,
                  name: candidate.name || null,
                  type: ContactType.CANDIDATE,
                },
              });
            }

            // Find or create conversation
            let conversation = await prisma.conversation.findFirst({
              where: {
                agencyId: task.agencyId,
                contactId: contact.id,
              },
            });

            if (!conversation) {
              conversation = await prisma.conversation.create({
                data: {
                  agencyId: task.agencyId,
                  contactId: contact.id,
                },
              });
            }

            // Build rejection message
            const rejectionMessage = "Quick one — we can't confirm this yet. Your CSCS needs checking. Can you send a clear photo of the front of your CSCS card?";

            // Send WhatsApp message
            const twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
            const normalizedTo = candidate.phone.startsWith("whatsapp:")
              ? candidate.phone
              : `whatsapp:${candidate.phone}`;
            const normalizedFrom = env.TWILIO_WHATSAPP_NUMBER.startsWith("whatsapp:")
              ? env.TWILIO_WHATSAPP_NUMBER
              : `whatsapp:${env.TWILIO_WHATSAPP_NUMBER}`;

            const twilioMessage = await sendWhatsAppMessage(twilioClient, {
              from: normalizedFrom,
              to: normalizedTo,
              body: rejectionMessage,
              statusCallback: env.WEBHOOK_BASE_URL
                ? `${env.WEBHOOK_BASE_URL}/webhooks/whatsapp/status`
                : undefined,
            });

            // Persist message to database
            await prisma.message.create({
              data: {
                agencyId: task.agencyId,
                contactId: contact.id,
                conversationId: conversation.id,
                direction: MessageDirection.OUTBOUND,
                channel: MessageChannel.WHATSAPP,
                senderRole: MessageSenderRole.OPERATOR,
                text: rejectionMessage,
                providerMessageId: twilioMessage.sid,
                deliveryStatus: MessageDeliveryStatus.SENT,
                rawPayload: {
                  twilioSid: twilioMessage.sid,
                  from: normalizedFrom,
                  to: normalizedTo,
                } as any,
              },
            });

            logger.info(
              {
                taskId,
                candidateId: cscsPayload.candidate.candidateId,
                messageSid: twilioMessage.sid,
                operatorId,
              },
              "CSCS rejection message sent"
            );
          }
        } catch (messageError) {
          // Log error but don't fail the rejection
          logger.error(
            {
              error: messageError,
              taskId,
              candidateId: cscsPayload.candidate.candidateId,
              operatorId,
            },
            "Failed to send CSCS rejection message, but task was rejected"
          );
        }
      }
    } catch (error) {
      logger.error(
        {
          error,
          taskId,
          operatorId,
        },
        "Failed to process CSCS verification rejection"
      );
      // Continue with rejection even if message sending fails
    }

    // Update task: set approvalStatus=REJECTED, status=REJECTED, rejectedAt, rejectionReason
    // Verify ownership before update
    await verifyOwnership(prisma.task, agencyId, taskId);
    
    const updated = await prisma.task.update({
      where: { id: taskId },
      data: {
        approvalStatus: TaskApprovalStatus.REJECTED,
        status: TaskStatus.REJECTED,
        rejectedAt: new Date(),
        rejectionReason: finalReason.trim(),
      },
      include: {
        relatedMessage: {
          include: {
            contact: true,
            conversation: true,
          },
        },
      },
    });

    logger.info(
      {
        taskId,
        action: "reject",
        operatorId,
        taskType: task.type,
        previousStatus: task.status,
        previousApprovalStatus: task.approvalStatus,
        rejectionReason: finalReason,
      },
      "CSCS verification task rejected"
    );

    // Create CSCS_REJECTED timeline event
    try {
      const relatedMessage = updated.relatedMessage;
      if (relatedMessage) {
        const rejectionSnippet = finalReason && finalReason.length > 100 ? finalReason.substring(0, 100) + "..." : finalReason;
        await createTimelineEvent({
          agencyId: updated.agencyId,
          conversationId: relatedMessage.conversationId,
          contactId: relatedMessage.contactId,
          candidateId: updated.candidateId || null,
          type: "CSCS_REJECTED",
          actorRole: "OPERATOR",
          actorOperatorId: operatorId,
          summary: "CSCS verification rejected",
          data: {
            taskId: updated.id,
            taskType: updated.type,
            rejectionReason: rejectionSnippet,
          },
          dedupeKey: `task_${updated.id}_rejected`,
        });
      }
    } catch (error) {
      logger.warn({ taskId, error }, "Failed to create CSCS_REJECTED timeline event (non-blocking)");
    }

    // Return DTO instead of raw Prisma model (use findFirst with agency scoping)
    const taskWithRelations = await prisma.task.findFirst({
      where: scopeWhere(agencyId, { id: taskId }),
      include: {
        relatedMessage: {
          include: {
            contact: true,
            conversation: true,
          },
        },
      },
    });

    if (!taskWithRelations) {
      return reply.status(200).send(updated);
    }

    const { toTaskListItemDTO } = await import("../dto/transformers.js");
    const dto = toTaskListItemDTO(taskWithRelations as any);

    return reply.status(200).send(dto);
  }

  // For other task types, use existing behavior
  // Verify ownership before update
  await verifyOwnership(prisma.task, agencyId, taskId);
  
  // Update task: set approvalStatus=REJECTED, status=DONE, rejectedAt, rejectionReason
  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      approvalStatus: TaskApprovalStatus.REJECTED,
      status: TaskStatus.DONE,
      rejectedAt: new Date(),
      rejectionReason: reason || null,
    },
    include: {
      relatedMessage: {
        include: {
          contact: true,
          conversation: true,
        },
      },
    },
  });

  logger.info(
    {
      taskId,
      action: "reject",
      operatorId,
      previousStatus: task.status,
      previousApprovalStatus: task.approvalStatus,
      rejectionReason: reason,
    },
    "Task rejected"
  );

  // Create TASK_REJECTED timeline event
  try {
    const relatedMessage = updated.relatedMessage;
    if (relatedMessage) {
      const rejectionSnippet = reason && reason.length > 100 ? reason.substring(0, 100) + "..." : reason;
      await createTimelineEvent({
        agencyId: updated.agencyId,
        conversationId: relatedMessage.conversationId,
        contactId: relatedMessage.contactId,
        candidateId: updated.candidateId || null,
        type: "TASK_REJECTED",
        actorRole: "OPERATOR",
        actorOperatorId: operatorId,
        summary: "Task rejected",
        data: {
          taskId: updated.id,
          taskType: updated.type,
          rejectionReason: rejectionSnippet,
        },
        dedupeKey: `task_${updated.id}_rejected`,
      });
    }
  } catch (error) {
    logger.warn({ taskId, error }, "Failed to create TASK_REJECTED timeline event (non-blocking)");
  }

  // Return DTO instead of raw Prisma model (use findFirst with agency scoping)
  const taskWithRelations = await prisma.task.findFirst({
    where: scopeWhere(agencyId, { id: taskId }),
    include: {
      relatedMessage: {
        include: {
          contact: true,
          conversation: true,
        },
      },
    },
  });

  if (!taskWithRelations) {
    return reply.status(200).send(updated);
  }

  const { toTaskListItemDTO } = await import("../dto/transformers.js");
  const dto = toTaskListItemDTO(taskWithRelations as any);

  return reply.status(200).send(dto);
}

/**
 * Create a CSCS verification task
 * Requires authenticated operator (operatorId from session)
 * 
 * Request body supports either:
 * A) { candidateId, jobId, sourceMessageId } - get image from message
 * B) { candidateId, jobId, imageUrl } - operator upload URL
 */
export async function createCscsVerificationHandler(
  request: FastifyRequest<{
    Body: CreateCscsVerificationBody;
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const operatorId = (request as any).operatorId;

  if (!operatorId) {
    logger.warn({ action: "createCscsVerification" }, "No operatorId in session");
    return reply.status(401).send({ error: "Authentication required" });
  }

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);
    const { candidateId, jobId, sourceMessageId, imageUrl } = request.body;

    // Validate required fields
    if (!candidateId || typeof candidateId !== "string") {
      return reply.status(400).send({ error: "candidateId is required and must be a string" });
    }

    if (!jobId || typeof jobId !== "string") {
      return reply.status(400).send({ error: "jobId is required and must be a string" });
    }

    // Validate that either sourceMessageId or imageUrl is provided
    if (!sourceMessageId && !imageUrl) {
      return reply.status(400).send({
        error: "Either sourceMessageId or imageUrl must be provided",
      });
    }

    // If both provided, prefer sourceMessageId (ignore imageUrl)
    const useSourceMessage = !!sourceMessageId;

    // Load candidate and verify agencyId matches
    const candidate = await prisma.candidate.findFirst({
      where: {
        id: candidateId,
        agencyId,
      },
    });

    if (!candidate) {
      return notFound(reply, "Not found");
    }

    // Load job and verify agencyId matches
    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        agencyId,
      },
    });

    if (!job) {
      return notFound(reply, "Not found");
    }

    // Resolve imageUrl
    let resolvedImageUrl: string;
    let resolvedSource: "WHATSAPP" | "OPERATOR_UPLOAD";
    let relatedMessageId: string | null = null;

    if (useSourceMessage && sourceMessageId) {
      // Option A: Extract from message (preferred if both provided)
      const message = await prisma.message.findFirst({
        where: {
          id: sourceMessageId,
          agencyId,
        },
      });

        if (!message) {
          return notFound(reply, "Not found");
        }

      const extractedUrl = extractFirstMediaUrl(message.rawPayload);
      if (!extractedUrl) {
        return reply.status(400).send({
          error: "Selected message has no media",
          messageId: sourceMessageId,
        });
      }

      resolvedImageUrl = extractedUrl;
      resolvedSource = "WHATSAPP";
      relatedMessageId = sourceMessageId;
    } else if (imageUrl) {
      // Option B: Use provided imageUrl
      if (typeof imageUrl !== "string" || imageUrl.trim().length === 0) {
        return reply.status(400).send({
          error: "imageUrl must be a non-empty string",
        });
      }

      const trimmedUrl = imageUrl.trim();
      
      // Basic validation: must start with http
      if (!trimmedUrl.startsWith("http://") && !trimmedUrl.startsWith("https://")) {
        return reply.status(400).send({
          error: "imageUrl must start with http:// or https://",
        });
      }

      resolvedImageUrl = trimmedUrl;
      resolvedSource = "OPERATOR_UPLOAD";
    } else {
      // This should not happen due to earlier validation, but handle it defensively
      return reply.status(400).send({
        error: "Either sourceMessageId or imageUrl must be provided",
      });
    }

    // Compute margin fields
    const marginPerHour =
      job.chargeRate !== null && job.payRate !== null
        ? job.chargeRate - job.payRate
        : null;

    const weeklyMargin =
      marginPerHour !== null &&
      job.hoursPerDay !== null &&
      job.daysPerWeek !== null
        ? marginPerHour * job.hoursPerDay * job.daysPerWeek
        : null;

    const projectMargin =
      weeklyMargin !== null && job.durationWeeks !== null
        ? weeklyMargin * job.durationWeeks
        : null;

    // Build payload
    const payload: CscsVerificationPayload = {
      candidate: {
        candidateId: candidate.id,
        name: candidate.name || undefined,
        phone: candidate.phone,
        desiredRole: candidate.desiredRole || undefined,
        location: candidate.location || undefined,
        availabilityNotes: candidate.availabilityNotes || undefined,
      },
      job: {
        jobId: job.id,
        title: job.title,
        status: job.status,
        clientName: job.clientName || undefined,
        siteName: job.siteName || undefined,
        addressLine1: job.addressLine1 || undefined,
        city: job.city || undefined,
        postcode: job.postcode || undefined,
        startDate: job.startDate?.toISOString() || undefined,
        durationWeeks: job.durationWeeks || undefined,
        payRate: job.payRate || undefined,
        chargeRate: job.chargeRate || undefined,
        currency: job.currency || undefined,
        marginPerHour: marginPerHour || undefined,
        weeklyMargin: weeklyMargin || undefined,
        projectMargin: projectMargin || undefined,
      },
      cscs: {
        imageUrl: resolvedImageUrl,
        source: resolvedSource,
        uploadedAt: new Date().toISOString(),
        checks: {
          overall: "UNKNOWN",
          issues: [],
        },
      },
    };

    // Create task
    const task = await prisma.task.create({
      data: {
        agencyId,
        type: TaskType.CSCS_VERIFICATION,
        status: TaskStatus.OPEN,
        approvalStatus: TaskApprovalStatus.PENDING,
        candidateId: candidate.id,
        relatedMessageId,
        payload: payload as any,
      },
      include: {
        relatedMessage: {
          include: {
            contact: true,
            conversation: true,
          },
        },
      },
    });

    logger.info(
      {
        taskId: task.id,
        type: task.type,
        status: task.status,
        approvalStatus: task.approvalStatus,
        candidateId,
        jobId,
        sourceMessageId,
        hasImageUrl: !!imageUrl,
        hasRelatedMessage: !!relatedMessageId,
        agencyId,
        action: "createCscsVerification",
        operatorId,
        createdAt: task.createdAt.toISOString(),
      },
      "CSCS verification task created"
    );

    // Enqueue auto verification job
    try {
      await enqueueCscsAutoVerify(task.id);
      logger.info({ taskId: task.id }, "Enqueued CSCS auto verify");
    } catch (error) {
      // Log error but don't fail task creation
      logger.warn(
        { error, taskId: task.id },
        "Failed to enqueue CSCS auto verification job (task created successfully)"
      );
    }

    // Return created task id + summary
    return reply.status(201).send({
      id: task.id,
      summary: `CSCS verification for ${candidate.name || candidate.phone} - ${job.title}`,
    });
  } catch (error) {
    logger.error(
      {
        error,
        action: "createCscsVerification",
        operatorId,
      },
      "Failed to create CSCS verification task"
    );

    if (error instanceof Error) {
      return reply.status(500).send({ error: error.message });
    }

    return reply.status(500).send({ error: "Internal server error" });
  }
}

/**
 * POST /api/tasks/:taskId/cscs/verify
 * Save CSCS verification data from operator review
 */
export async function verifyCscsHandler(
  request: FastifyRequest<{
    Params: TaskParams;
    Body: VerifyCscsBody;
  }>,
  reply: FastifyReply
) {
  const { taskId } = request.params;
  const logger = request.log;
  const operatorId = (request as any).operatorId;

  if (!operatorId) {
    logger.warn({ taskId, action: "verifyCscs" }, "No operatorId in session");
    return reply.status(401).send({ error: "Authentication required" });
  }

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);
    const { extracted, checks } = request.body;

    logger.info(
      {
        taskId,
        agencyId,
        action: "verifyCscs",
        operatorId,
        hasExtracted: !!extracted,
        hasChecks: !!checks,
      },
      "CSCS verification request received"
    );

    // Load task and verify it's a CSCS_VERIFICATION task
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        agencyId,
      },
    });

    if (!task) {
    return notFound(reply, "Not found");
  }

    logger.info(
      {
        taskId,
        taskType: task.type,
        taskStatus: task.status,
        approvalStatus: task.approvalStatus,
        action: "verifyCscs",
      },
      "Task found, verifying type"
    );

    if (task.type !== TaskType.CSCS_VERIFICATION) {
      logger.warn({ taskId, taskType: task.type, action: "verifyCscs" }, "Task is not a CSCS_VERIFICATION task");
      return reply.status(400).send({ error: "Task is not a CSCS verification task" });
    }

    // Read existing payload
    const payload = (task.payload || {}) as any;
    if (!payload.cscs) {
      payload.cscs = {};
    }

    // Set extracted data
    payload.cscs.extracted = {
      holderName: extracted.holderName || undefined,
      cardType: extracted.cardType || undefined,
      expiryDate: extracted.expiryDate || undefined,
      cardNumber: extracted.cardNumber || undefined,
    };

    // Compute issues array
    const issues: string[] = [];
    if (!checks.nameMatchOk) {
      issues.push("Name on card does not match candidate");
    }
    if (!checks.expiryValidOk) {
      issues.push("Card expiry is not valid");
    }
    if (!checks.requiredLevelOk) {
      issues.push("Card level does not meet job requirement");
    }

    // Determine overall status
    // If any required check is missing, keep as UNKNOWN
    // Otherwise, VALID if all checks pass, INVALID if any fail
    let overall: "VALID" | "INVALID" | "UNKNOWN" = "UNKNOWN";
    if (checks.nameMatchOk !== undefined && checks.expiryValidOk !== undefined && checks.requiredLevelOk !== undefined) {
      overall = (checks.nameMatchOk && checks.expiryValidOk && checks.requiredLevelOk)
        ? "VALID"
        : "INVALID";
    }

    // Set checks data
    payload.cscs.checks = {
      nameMatch: {
        ok: checks.nameMatchOk,
        value: extracted.holderName || "",
      },
      expiryValid: {
        ok: checks.expiryValidOk,
        value: extracted.expiryDate || "",
      },
      requiredLevel: {
        ok: checks.requiredLevelOk,
        value: extracted.cardType || "",
      },
      overall,
      issues,
    };

    // Verify ownership before update
    await verifyOwnership(prisma.task, agencyId, taskId);
    
    // Update task payload in Prisma
    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: {
        payload: payload as any,
      },
    });

    logger.info(
      {
        taskId,
        overall,
        issuesCount: issues.length,
        action: "verifyCscs",
        operatorId,
      },
      "CSCS verification data saved"
    );

    // Apply progress state machine after CSCS verification save (non-blocking)
    try {
      const taskWithMessage = await prisma.task.findFirst({
        where: scopeWhere(agencyId, { id: taskId }),
        include: {
          relatedMessage: {
            include: {
              contact: true,
              conversation: true,
            },
          },
        },
      });

      if (taskWithMessage?.relatedMessage?.conversationId) {
        const relatedMessage = taskWithMessage.relatedMessage;
        
        // Get candidate snapshot
        let candidateSnapshot: CandidateSnapshot | null = null;
        if (relatedMessage.contact) {
          const candidate = await prisma.candidate.findUnique({
            where: {
              agencyId_phone: {
                agencyId: taskWithMessage.agencyId,
                phone: relatedMessage.contact.phone,
              },
            },
            select: {
              phone: true,
              name: true,
              desiredRole: true,
              location: true,
              availabilityNotes: true,
              salaryMin: true,
              salaryMax: true,
              skills: true,
              yearsExperience: true,
            },
          });
          if (candidate) {
            candidateSnapshot = {
              phone: candidate.phone,
              name: candidate.name,
              desiredRole: candidate.desiredRole,
              location: candidate.location,
              availability: candidate.availabilityNotes,
              salaryMin: candidate.salaryMin,
              salaryMax: candidate.salaryMax,
              skills: candidate.skills || [],
              yearsExperience: candidate.yearsExperience,
            };
          }
        }

        // Check for tasks (CSCS task is still open if overall is UNKNOWN or INVALID)
        const pendingTasks = await prisma.task.findMany({
          where: {
            agencyId: taskWithMessage.agencyId,
            approvalStatus: "PENDING",
            status: "OPEN",
            OR: [
              {
                relatedMessage: {
                  conversationId: relatedMessage.conversationId,
                },
              },
              {
                payload: {
                  path: ["conversationId"],
                  equals: relatedMessage.conversationId,
                },
              },
            ],
          },
          select: { type: true },
        });

        const cscsTasks = await prisma.task.findMany({
          where: {
            agencyId: taskWithMessage.agencyId,
            type: "CSCS_VERIFICATION",
            status: "OPEN",
            OR: [
              {
                relatedMessage: {
                  conversationId: relatedMessage.conversationId,
                },
              },
              {
                payload: {
                  path: ["conversationId"],
                  equals: relatedMessage.conversationId,
                },
              },
            ],
          },
          select: { id: true },
        });

        const followUpTasks = await prisma.task.findMany({
          where: {
            agencyId: taskWithMessage.agencyId,
            type: "FOLLOW_UP",
            status: "OPEN",
            OR: [
              {
                relatedMessage: {
                  conversationId: relatedMessage.conversationId,
                },
              },
              {
                payload: {
                  path: ["conversationId"],
                  equals: relatedMessage.conversationId,
                },
              },
            ],
          },
          select: { id: true },
        });

        const tasks: TaskFlags = {
          hasPendingApproval: pendingTasks.length > 0,
          hasOpenCscsTask: cscsTasks.length > 0,
          hasOpenFollowUpTask: followUpTasks.length > 0,
          hasOpenTasks: pendingTasks.length > 0 || cscsTasks.length > 0 || followUpTasks.length > 0,
        };

        // Get matched jobs count
        let matchedJobsCount = 0;
        if (candidateSnapshot) {
          try {
            const candidate = await prisma.candidate.findUnique({
              where: {
                agencyId_phone: {
                  agencyId: taskWithMessage.agencyId,
                  phone: candidateSnapshot.phone,
                },
              },
              select: { id: true },
            });
            if (candidate) {
              const jobMatches = await prisma.jobCandidateMatch.findMany({
                where: {
                  candidateId: candidate.id,
                  job: {
                    status: { in: ["ACTIVE", "URGENT"] },
                  },
                },
                select: { id: true },
              });
              matchedJobsCount = jobMatches.length;
            }
          } catch (error) {
            logger.debug({ conversationId: relatedMessage.conversationId, error }, "Failed to get matched jobs count (non-blocking)");
          }
        }

        // Check placement status
        let placement: PlacementStatus | null = null;
        if (candidateSnapshot) {
          try {
            const candidate = await prisma.candidate.findUnique({
              where: {
                agencyId_phone: {
                  agencyId: taskWithMessage.agencyId,
                  phone: candidateSnapshot.phone,
                },
              },
              select: { id: true },
            });
            if (candidate) {
              const activePlacement = await prisma.placement.findFirst({
                where: {
                  candidateId: candidate.id,
                  status: { in: ["CONFIRMED", "ACTIVE"] },
                },
                select: {
                  status: true,
                  startDate: true,
                },
                orderBy: { createdAt: "desc" },
              });
              if (activePlacement) {
                placement = {
                  hasConfirmedPlacement: true,
                  placementStartDate: activePlacement.startDate?.toISOString() || null,
                };
              }
            }
          } catch (error) {
            logger.debug({ conversationId: relatedMessage.conversationId, error }, "Failed to get placement status (non-blocking)");
          }
        }

        // Get conversation for last activity
        const conversation = await prisma.conversation.findUnique({
          where: { id: relatedMessage.conversationId },
          select: {
            lastMessageAt: true,
            contact: {
              select: {
                type: true,
              },
            },
          },
        });

        // Apply progress state machine
        await applyProgressStateMachine({
          conversationId: relatedMessage.conversationId,
          agencyId: taskWithMessage.agencyId,
          context: {
            lastActivityAt: conversation?.lastMessageAt || new Date(),
            lastInboundMessageAt: conversation?.lastMessageAt || null,
            candidate: candidateSnapshot,
            tasks,
            placement,
            lastIntent: null,
            matchedJobsCount,
            contactType: conversation?.contact?.type || null,
          },
        });
      }
    } catch (error) {
      logger.warn({ taskId, error }, "Failed to apply progress state machine after CSCS verification save (non-blocking)");
    }

    // Return updated payload
    return reply.status(200).send({
      payload: updatedTask.payload,
    });
  } catch (error) {
    logger.error(
      {
        error,
        taskId,
        action: "verifyCscs",
        operatorId,
      },
      "Failed to verify CSCS"
    );

    if (error instanceof Error) {
      return reply.status(500).send({ error: error.message });
    }

    return reply.status(500).send({ error: "Internal server error" });
  }
}

/**
 * Register task routes
 * CRITICAL: requireAuth hook is added INSIDE this plugin scope
 * to ensure it has access to the same session context as the routes
 */
export async function taskRoutes(fastify: FastifyInstance) {
  // Add auth middleware INSIDE this plugin scope
  fastify.addHook("onRequest", requireAuth);
  
  fastify.post("/:taskId/approve", approveTaskHandler);
  fastify.post("/:taskId/reject", rejectTaskHandler);
  fastify.post("/cscs-verification/create", createCscsVerificationHandler);
  fastify.post("/:taskId/cscs/verify", verifyCscsHandler);
}

