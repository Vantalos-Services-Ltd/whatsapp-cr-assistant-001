/**
 * Worker for auto-verifying CSCS cards using OpenAI Vision
 */

import { Worker, type Job } from "bullmq";
import pino from "pino";
import { TaskType, TaskStatus } from "@prisma/client";
import { connectionOptions } from "../queues/queue.ts";
import {
  extractCscsDetailsFromImage,
  computeVerificationChecks,
  determineOverallStatus,
} from "../services/cscsAutoVerifier.ts";
import type { CscsVerificationPayload } from "../../shared/types/cscs.ts";
import { createTimelineEvent } from "../services/timelineService.ts";
import { applyProgressStateMachine } from "../services/progress/stateMachine.ts";
import type { CandidateSnapshot, TaskFlags, PlacementStatus } from "../services/progress/stateMachineTypes.ts";

const log = pino({ name: "cscsAutoVerifyWorker" });
import { prisma } from "../db/prisma.ts";

type CscsAutoVerifyJobData = { taskId: string };

/**
 * Process auto verification job
 */
async function processCscsAutoVerify(job: Job<CscsAutoVerifyJobData>) {
  const { taskId } = job.data ?? {};

  if (!taskId) {
    log.warn({ jobId: job.id, jobName: job.name }, "Missing taskId in job data");
    return;
  }

  log.info({ taskId, jobId: job.id }, "Processing CSCS auto verification");

  try {
    // Fetch task
    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      log.warn({ taskId, jobId: job.id }, "Task not found; skipping");
      return;
    }

    log.info(
      {
        taskId,
        taskType: task.type,
        taskStatus: task.status,
        payloadKeys: task.payload ? Object.keys(task.payload as any) : [],
      },
      "Task found, validating"
    );

    // Validate task type
    if (task.type !== TaskType.CSCS_VERIFICATION) {
      log.warn(
        { taskId, taskType: task.type, jobId: job.id },
        "Task is not CSCS_VERIFICATION; skipping"
      );
      return;
    }

    // Validate task status
    if (task.status !== TaskStatus.OPEN) {
      log.warn(
        { taskId, taskStatus: task.status, jobId: job.id },
        "Task is not OPEN; skipping auto verification"
      );
      return;
    }

    // Read payload
    const payload = (task.payload || {}) as any;
    log.info(
      {
        taskId,
        hasPayload: !!payload,
        hasCscs: !!payload.cscs,
        hasImageUrl: !!payload.cscs?.imageUrl,
        imageUrl: payload.cscs?.imageUrl,
      },
      "Checking payload structure"
    );

    if (!payload.cscs || !payload.cscs.imageUrl) {
      log.warn(
        { taskId, hasCscs: !!payload.cscs, hasImageUrl: !!payload.cscs?.imageUrl },
        "Task payload missing CSCS image URL; skipping"
      );
      return;
    }

    // Check if verification already exists (don't overwrite manual verification)
    if (payload.cscs.checks && payload.cscs.checks.overall && payload.cscs.checks.overall !== "UNKNOWN") {
      log.info(
        { taskId, existingOverall: payload.cscs.checks.overall },
        "Verification already exists; skipping auto verification"
      );
      return;
    }

    const imageUrl = payload.cscs.imageUrl;
    log.info({ taskId, imageUrl }, "Resolved image URL for extraction");

    // Fetch candidate if available
    let candidateName: string | null = null;
    if (task.candidateId) {
      try {
        const candidate = await prisma.candidate.findUnique({
          where: { id: task.candidateId },
          select: { name: true },
        });
        candidateName = candidate?.name || null;
      } catch (error) {
        log.warn({ taskId, candidateId: task.candidateId, error }, "Failed to fetch candidate");
      }
    }

    // Extract job requirements if available
    const jobRequirements = payload.job?.requirementsJson || null;

    // Extract CSCS details from image
    log.info({ taskId, imageUrl }, "Extracting CSCS details from image");
    const extracted = await extractCscsDetailsFromImage(imageUrl);

    // Compute verification checks
    const checks = computeVerificationChecks(extracted, candidateName, jobRequirements);

    // Determine overall status
    const overall = determineOverallStatus(checks);

    // Update payload
    payload.cscs.extracted = {
      holderName: extracted.holderName || undefined,
      cardType: extracted.cardType || undefined,
      cardNumber: extracted.cardNumber || undefined,
      expiryDate: extracted.expiryDate || undefined,
    };

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
      issues: checks.issues,
    };

    // Add auto verification metadata
    payload.cscs.autoVerified = true;
    payload.cscs.autoVerifiedAt = new Date().toISOString();

    // Update task
    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: {
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

    // Create CSCS_AUTO_VERIFIED timeline event
    try {
      const relatedMessage = updatedTask.relatedMessage;
      if (relatedMessage) {
        // Mask card number - show only last 4 digits
        const maskedCardNumber = extracted.cardNumber
          ? `****${extracted.cardNumber.slice(-4)}`
          : null;

        await createTimelineEvent({
          agencyId: updatedTask.agencyId,
          conversationId: relatedMessage.conversationId,
          contactId: relatedMessage.contactId,
          candidateId: updatedTask.candidateId || null,
          type: "CSCS_AUTO_VERIFIED",
          actorRole: "AI",
          summary: `CSCS auto-verified: ${overall}${maskedCardNumber ? ` (Card: ${maskedCardNumber})` : ""}`,
          data: {
            overallStatus: overall,
            issues: checks.issues,
            confidence: extracted.cardNumber ? "HIGH" : "MEDIUM", // Simple confidence indicator
          },
          dedupeKey: `task_${taskId}_cscs_auto_verified`,
        });
      }
    } catch (error) {
      log.warn({ taskId, error }, "Failed to create CSCS_AUTO_VERIFIED timeline event (non-blocking)");
    }

    log.info(
      {
        taskId,
        overall,
        issuesCount: checks.issues.length,
        hasExtracted: !!extracted.holderName || !!extracted.cardType,
      },
      "CSCS auto verification completed successfully"
    );

    // Apply progress state machine after auto verification (non-blocking)
    try {
      const relatedMessage = updatedTask.relatedMessage;
      if (relatedMessage && relatedMessage.conversationId) {
        // Get candidate snapshot
        let candidateSnapshot: CandidateSnapshot | null = null;
        if (relatedMessage.contact) {
          const candidate = await prisma.candidate.findUnique({
            where: {
              agencyId_phone: {
                agencyId: updatedTask.agencyId,
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

        // Check for tasks
        const pendingTasks = await prisma.task.findMany({
          where: {
            agencyId: updatedTask.agencyId,
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
            agencyId: updatedTask.agencyId,
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
            agencyId: updatedTask.agencyId,
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
                  agencyId: updatedTask.agencyId,
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
            log.debug({ conversationId: relatedMessage.conversationId, error }, "Failed to get matched jobs count (non-blocking)");
          }
        }

        // Check placement status
        let placement: PlacementStatus | null = null;
        if (candidateSnapshot) {
          try {
            const candidate = await prisma.candidate.findUnique({
              where: {
                agencyId_phone: {
                  agencyId: updatedTask.agencyId,
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
            log.debug({ conversationId: relatedMessage.conversationId, error }, "Failed to get placement status (non-blocking)");
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
          agencyId: updatedTask.agencyId,
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
      log.warn({ taskId, error }, "Failed to apply progress state machine after auto verification (non-blocking)");
    }
  } catch (error) {
    log.error({ error, taskId, jobId: job.id }, "Failed to auto-verify CSCS");

    // On error, set status to UNKNOWN and store error message
    try {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
      });

      if (task && task.type === TaskType.CSCS_VERIFICATION) {
        const payload = (task.payload || {}) as any;
        if (!payload.cscs) {
          payload.cscs = {};
        }

        // Set error state
        if (!payload.cscs.checks) {
          payload.cscs.checks = {
            overall: "UNKNOWN",
            issues: [],
          };
        } else {
          payload.cscs.checks.overall = "UNKNOWN";
        }

        payload.cscs.autoVerifyError =
          error instanceof Error
            ? error.message
            : "Auto verification failed. Please verify manually.";

        await prisma.task.update({
          where: { id: taskId },
          data: {
            payload: payload as any,
          },
        });

        log.info({ taskId }, "Set task to UNKNOWN with error message");
      }
    } catch (updateError) {
      log.error({ error: updateError, taskId }, "Failed to update task with error state");
    }

    // Re-throw to mark job as failed (will retry if attempts remain)
    throw error;
  }
}

/**
 * Create and start the worker (side effect - starts immediately on import)
 */
const worker = new Worker<CscsAutoVerifyJobData>(
  "cscs-auto-verify",
  async (job) => {
    await processCscsAutoVerify(job);
  },
  {
    connection: connectionOptions,
    concurrency: 2, // Process 2 jobs concurrently
  }
);

worker.on("completed", (job) => {
  log.info({ jobId: job.id, taskId: job.data.taskId }, "CSCS auto verification job completed");
});

worker.on("failed", (job, err) => {
  log.error(
    { jobId: job?.id, taskId: job?.data?.taskId, error: err },
    "CSCS auto verification job failed"
  );
});

log.info("CSCS auto verify worker online");

