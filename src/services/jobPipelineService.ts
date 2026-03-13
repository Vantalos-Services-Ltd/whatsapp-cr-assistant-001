/**
 * Job Pipeline Service
 * 
 * Single entry point for managing job pipeline items.
 * Handles CRUD operations, validation, and timeline events.
 */

import pino from "pino";
import { prisma } from "../db/prisma.ts";
import { JobPipelineStage, NoShowReason, DroppedReason, TaskType, TaskStatus, TaskApprovalStatus } from "@prisma/client";
import { createTimelineEvent } from "./timelineService.ts";
import { applyProgressStateMachine } from "./progress/stateMachine.ts";
import { mergeNonNull } from "../../shared/types/memoryPack.ts";

const log = pino({ name: "jobPipelineService" });

/**
 * Validate stage transition according to rules
 * 
 * Rules:
 * - SHORTLISTED can go to OFFER_SENT or DROPPED
 * - OFFER_SENT can go to START_CONFIRMED, NO_SHOW, DROPPED
 * - START_CONFIRMED can go to NO_SHOW, DROPPED
 * - NO_SHOW can go to DROPPED (optional) but never back
 * - DROPPED is terminal
 * 
 * Validation requirements:
 * - Transition to START_CONFIRMED requires startDate
 * - Transition to OFFER_SENT requires either notes OR confirmedInterest flag
 * - Transition to NO_SHOW requires noShowReason
 */
export function validateStageTransition(
  fromStage: JobPipelineStage | null,
  toStage: JobPipelineStage,
  updates: PipelineItemUpdate
): void {
  // If creating new item (fromStage is null), allow any initial stage
  if (fromStage === null) {
    // Validate requirements for initial stage
    if (toStage === "START_CONFIRMED" && !updates.startDate) {
      throw new Error("startDate is required when creating pipeline item with stage START_CONFIRMED");
    }
    if (toStage === "OFFER_SENT" && !updates.notes && !updates.confirmedInterest) {
      throw new Error("notes or confirmedInterest is required when creating pipeline item with stage OFFER_SENT");
    }
    if (toStage === "NO_SHOW" && !updates.noShowReason) {
      throw new Error("noShowReason is required when creating pipeline item with stage NO_SHOW");
    }
    return;
  }

  // DROPPED is terminal - cannot transition from it
  if (fromStage === "DROPPED") {
    throw new Error("Cannot transition from DROPPED stage (terminal state)");
  }

  // NO_SHOW can only go to DROPPED, never back
  if (fromStage === "NO_SHOW" && toStage !== "DROPPED") {
    throw new Error("Cannot transition from NO_SHOW to any stage except DROPPED");
  }

  // Validate allowed transitions
  const allowedTransitions: Record<JobPipelineStage, JobPipelineStage[]> = {
    SHORTLISTED: ["OFFER_SENT", "DROPPED"],
    OFFER_SENT: ["START_CONFIRMED", "NO_SHOW", "DROPPED"],
    START_CONFIRMED: ["NO_SHOW", "DROPPED"],
    NO_SHOW: ["DROPPED"],
    DROPPED: [], // Terminal, no transitions allowed
  };

  const allowed = allowedTransitions[fromStage] || [];
  if (!allowed.includes(toStage)) {
    throw new Error(
      `Invalid stage transition: ${fromStage} → ${toStage}. Allowed transitions from ${fromStage}: ${allowed.join(", ")}`
    );
  }

  // Validate requirements for specific transitions
  if (toStage === "START_CONFIRMED" && !updates.startDate) {
    throw new Error("startDate is required when transitioning to START_CONFIRMED");
  }

  if (toStage === "OFFER_SENT" && !updates.notes && !updates.confirmedInterest) {
    throw new Error("notes or confirmedInterest is required when transitioning to OFFER_SENT");
  }

  if (toStage === "NO_SHOW" && !updates.noShowReason) {
    throw new Error("noShowReason is required when transitioning to NO_SHOW");
  }
}

export interface PipelineItemUpdate {
  stage?: JobPipelineStage;
  notes?: string | null;
  startDate?: Date | string | null;
  payRate?: number | null;
  shiftInfo?: string | null;
  noShowReason?: NoShowReason | null;
  droppedReason?: DroppedReason | null;
  data?: any;
  confirmedInterest?: boolean; // Flag to indicate candidate confirmed interest
}

export interface UpsertPipelineItemInput {
  agencyId: string;
  jobId: string;
  candidateId: string;
  stage: JobPipelineStage;
  updates?: PipelineItemUpdate;
  operatorId?: string | null;
}

export interface PipelineItemEnriched {
  id: string;
  agencyId: string;
  jobId: string;
  candidateId: string;
  stage: JobPipelineStage;
  notes: string | null;
  startDate: Date | null;
  payRate: number | null;
  shiftInfo: string | null;
  noShowReason: NoShowReason | null;
  droppedReason: DroppedReason | null;
  updatedByOperatorId: string | null;
  data: any;
  createdAt: Date;
  updatedAt: Date;
  // Enriched fields
  candidate: {
    name: string | null;
    desiredRole: string | null;
    location: string | null;
    availabilityNotes: string | null;
    phone: string;
  };
  matchScore: number | null;
  matchTier: string | null;
  conversation: {
    progressStage: string | null;
    progressData: any;
    memoryPack: any;
    lastMessageAt: Date | null;
  } | null;
}

/**
 * Upsert a pipeline item (create or update)
 * 
 * If item exists, updates stage and fields.
 * If not exists, creates it.
 * 
 * Validates stage transitions (see Step C for full validation).
 * Sets updatedByOperatorId.
 * Emits timeline event.
 */
export async function upsertPipelineItem(
  input: UpsertPipelineItemInput
): Promise<{ id: string; created: boolean }> {
  const { agencyId, jobId, candidateId, stage, updates = {}, operatorId } = input;
  
  // Extract createOutreachTask flag from updates.data if present
  const createOutreachTask = (updates.data as any)?.createOutreachTask !== false; // Default true

  log.info(
    {
      agencyId,
      jobId,
      candidateId,
      stage,
      operatorId,
    },
    "Upserting pipeline item"
  );

  // Validate agency, job, and candidate exist and belong to agency
  // Fetch full job details for task creation
  const [agency, job, candidate] = await Promise.all([
    prisma.agency.findUnique({ where: { id: agencyId } }),
    prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        agencyId: true,
        title: true,
        city: true,
        siteName: true,
        payRate: true,
        currency: true,
        startDate: true,
      },
    }),
    prisma.candidate.findUnique({
      where: { id: candidateId },
      select: {
        id: true,
        agencyId: true,
        phone: true,
        name: true,
        desiredRole: true,
        location: true,
        skills: true,
        availabilityNotes: true,
        salaryMin: true,
        salaryMax: true,
        yearsExperience: true,
        rawProfile: true,
        currency: true,
      },
    }),
  ]);

  if (!agency) {
    throw new Error(`Agency not found: ${agencyId}`);
  }

  if (!job || job.agencyId !== agencyId) {
    throw new Error(`Job not found or does not belong to agency: ${jobId}`);
  }

  if (!candidate || candidate.agencyId !== agencyId) {
    throw new Error(`Candidate not found or does not belong to agency: ${candidateId}`);
  }

  // Check if item already exists
  const existing = await prisma.jobPipelineItem.findUnique({
    where: {
      agencyId_jobId_candidateId: {
        agencyId,
        jobId,
        candidateId,
      },
    },
  });

  const isNew = !existing;
  const previousStage = existing?.stage || null;

  // Validate stage transition (Step C: guardrails)
  if (!isNew && previousStage !== stage) {
    validateStageTransition(previousStage, stage, updates);
  }

  // Prepare update data
  const updateData: any = {
    stage,
    updatedByOperatorId: operatorId || null,
    updatedAt: new Date(),
  };

  // Apply updates if provided
  if (updates.notes !== undefined) {
    updateData.notes = updates.notes;
  }
  if (updates.startDate !== undefined) {
    updateData.startDate = updates.startDate ? new Date(updates.startDate) : null;
  }
  if (updates.payRate !== undefined) {
    updateData.payRate = updates.payRate;
  }
  if (updates.shiftInfo !== undefined) {
    updateData.shiftInfo = updates.shiftInfo;
  }
  if (updates.noShowReason !== undefined) {
    updateData.noShowReason = updates.noShowReason;
  }
  if (updates.droppedReason !== undefined) {
    updateData.droppedReason = updates.droppedReason;
  }
  if (updates.data !== undefined) {
    updateData.data = updates.data;
  }

  // Upsert the item
  const item = await prisma.jobPipelineItem.upsert({
    where: {
      agencyId_jobId_candidateId: {
        agencyId,
        jobId,
        candidateId,
      },
    },
    create: {
      agencyId,
      jobId,
      candidateId,
      stage,
      notes: updates.notes || null,
      startDate: updates.startDate ? new Date(updates.startDate) : null,
      payRate: updates.payRate || null,
      shiftInfo: updates.shiftInfo || null,
      noShowReason: updates.noShowReason || null,
      droppedReason: updates.droppedReason || null,
      updatedByOperatorId: operatorId || null,
      data: updates.data || null,
    },
    update: updateData,
  });

  log.info(
    {
      itemId: item.id,
      created: isNew,
      previousStage,
      newStage: stage,
      agencyId,
      jobId,
      candidateId,
    },
    "Pipeline item upserted"
  );

  // Step E: Workflow automation - Create tasks when stages change
  const stageChanged = !isNew && previousStage !== stage;
  
  if (stageChanged) {
    // Extract createOutreachTask flag from updates.data if present
    const createOutreachTask = (updates.data as any)?.createOutreachTask !== false; // Default true
    
    // Transition to OFFER_SENT: Create OUTREACH task (if createOutreachTask is true)
    if (stage === "OFFER_SENT" && previousStage !== "OFFER_SENT" && createOutreachTask) {
      await createOutreachTaskForPipeline({
        agencyId,
        jobId,
        candidateId,
        job,
        candidate,
        pipelineItem: item,
        operatorId,
      });
    }

    // Transition to START_CONFIRMED: Create FOLLOW_UP task
    if (stage === "START_CONFIRMED" && previousStage !== "START_CONFIRMED") {
      await createFollowUpTaskForPipeline({
        agencyId,
        jobId,
        candidateId,
        job,
        candidate,
        pipelineItem: item,
        operatorId,
      });
    }
  }

  // Create timeline event
  // Note: Timeline events require conversationId and contactId, but pipeline items
  // may exist without conversations. We'll try to find them, but if not found,
  // we'll skip the timeline event (non-blocking).
  try {
    // Get contact for timeline event (if exists)
    const contact = await prisma.contact.findUnique({
      where: {
        agencyId_phone: {
          agencyId,
          phone: candidate.phone,
        },
      },
      select: {
        id: true,
      },
    });

    if (!contact) {
      log.debug(
        { agencyId, jobId, candidateId, phone: candidate.phone },
        "No contact found for pipeline timeline event, skipping"
      );
    } else {
      // Get most recent conversation for this contact
      const conversation = await prisma.conversation.findFirst({
        where: {
          agencyId,
          contactId: contact.id,
        },
        select: {
          id: true,
        },
        orderBy: {
          lastMessageAt: "desc",
        },
      });

      if (!conversation) {
        log.debug(
          { agencyId, jobId, candidateId, contactId: contact.id },
          "No conversation found for pipeline timeline event, skipping"
        );
      } else {
        const candidateName = candidate.name || "Candidate";
        const summary = isNew
          ? `Added to pipeline: ${stage} for ${candidateName}`
          : `Pipeline moved to ${stage} for ${candidateName}`;

        await createTimelineEvent({
          agencyId,
          conversationId: conversation.id,
          contactId: contact.id,
          candidateId,
          type: "JOB_PIPELINE_UPDATED",
          actorRole: operatorId ? "OPERATOR" : "SYSTEM",
          actorOperatorId: operatorId || null,
          summary,
          data: {
            jobId,
            candidateId,
            stage,
            previousStage,
            startDate: item.startDate?.toISOString() || null,
            payRate: item.payRate || null,
            isNew,
          },
          dedupeKey: `pipeline_${agencyId}_${jobId}_${candidateId}_${item.updatedAt.toISOString()}`,
        });
      }
    }
  } catch (error) {
    log.warn(
      { agencyId, jobId, candidateId, error },
      "Failed to create JOB_PIPELINE_UPDATED timeline event (non-blocking)"
    );
  }

  // Step G: Progress State Machine integration
  // Apply progress state machine after pipeline update
  try {
    await applyProgressStateMachineForPipeline({
      agencyId,
      jobId,
      candidateId,
      candidate,
      pipelineStage: stage,
      pipelineItem: item,
      job,
    });
  } catch (error) {
    log.warn(
      { agencyId, jobId, candidateId, error },
      "Failed to apply progress state machine after pipeline update (non-blocking)"
    );
  }

  return {
    id: item.id,
    created: isNew,
  };
}

/**
 * List pipeline items for a job with enriched data
 * 
 * Returns enriched pipeline items with:
 * - Candidate summary (name, trade, location, availability)
 * - Job match score if exists
 * - Conversation progressStage, progressData, memoryPack summary, lastActivityAt
 * 
 * Uses efficient batch queries to avoid N+1.
 */
export async function listJobPipeline(
  agencyId: string,
  jobId: string
): Promise<PipelineItemEnriched[]> {
  log.info({ agencyId, jobId }, "Listing job pipeline");

  // Validate job exists and belongs to agency
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { agencyId: true },
  });

  if (!job || job.agencyId !== agencyId) {
    throw new Error(`Job not found or does not belong to agency: ${jobId}`);
  }

  // Fetch all pipeline items for this job
  const pipelineItems = await prisma.jobPipelineItem.findMany({
    where: {
      agencyId,
      jobId,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  if (pipelineItems.length === 0) {
    return [];
  }

  // Batch fetch candidates
  const candidateIds = pipelineItems.map((item) => item.candidateId);
  const candidates = await prisma.candidate.findMany({
    where: {
      id: { in: candidateIds },
      agencyId,
    },
    select: {
      id: true,
      name: true,
      desiredRole: true,
      location: true,
      availabilityNotes: true,
      phone: true,
    },
  });

  const candidateMap = new Map(candidates.map((c) => [c.id, c]));

  // Batch fetch job matches
  const jobMatches = await prisma.jobCandidateMatch.findMany({
    where: {
      agencyId,
      jobId,
      candidateId: { in: candidateIds },
    },
    select: {
      candidateId: true,
      score: true,
      tier: true,
    },
  });

  const matchMap = new Map(
    jobMatches.map((m) => [
      m.candidateId,
      { score: m.score, tier: m.tier },
    ])
  );

  // Batch fetch contacts by phone
  const candidatePhones = candidates.map((c) => c.phone);
  const contacts = await prisma.contact.findMany({
    where: {
      agencyId,
      phone: { in: candidatePhones },
    },
    select: {
      id: true,
      phone: true,
    },
  });

  const phoneToContactId = new Map(contacts.map((c) => [c.phone, c.id]));

  // Batch fetch conversations
  const contactIds = Array.from(phoneToContactId.values());
  const conversations = await prisma.conversation.findMany({
    where: {
      agencyId,
      contactId: { in: contactIds },
    },
    select: {
      id: true,
      contactId: true,
      progressStage: true,
      progressData: true,
      memoryPack: true,
      lastMessageAt: true,
    },
    orderBy: {
      lastMessageAt: "desc",
    },
  });

  // Group conversations by contactId (get most recent per contact)
  const conversationMap = new Map<string, typeof conversations[0]>();
  for (const conv of conversations) {
    if (!conversationMap.has(conv.contactId)) {
      conversationMap.set(conv.contactId, conv);
    }
  }

  // Build enriched results
  const enriched: PipelineItemEnriched[] = pipelineItems.map((item) => {
    const candidate = candidateMap.get(item.candidateId);
    const match = matchMap.get(item.candidateId);
    const contactId = candidate ? phoneToContactId.get(candidate.phone) : null;
    const conversation = contactId ? conversationMap.get(contactId) : null;

    return {
      id: item.id,
      agencyId: item.agencyId,
      jobId: item.jobId,
      candidateId: item.candidateId,
      stage: item.stage,
      notes: item.notes,
      startDate: item.startDate,
      payRate: item.payRate,
      shiftInfo: item.shiftInfo,
      noShowReason: item.noShowReason,
      droppedReason: item.droppedReason,
      updatedByOperatorId: item.updatedByOperatorId,
      data: item.data,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      candidate: candidate
        ? {
            name: candidate.name,
            desiredRole: candidate.desiredRole,
            location: candidate.location,
            availabilityNotes: candidate.availabilityNotes,
            phone: candidate.phone,
          }
        : {
            name: null,
            desiredRole: null,
            location: null,
            availabilityNotes: null,
            phone: "",
          },
      matchScore: match?.score || null,
      matchTier: match?.tier || null,
      conversation: conversation
        ? {
            progressStage: conversation.progressStage,
            progressData: conversation.progressData,
            memoryPack: conversation.memoryPack,
            lastMessageAt: conversation.lastMessageAt,
          }
        : null,
    };
  });

  return enriched;
}

/**
 * Remove a pipeline item
 * 
 * Deletes the item and emits a timeline event.
 */
export async function removePipelineItem(
  agencyId: string,
  jobId: string,
  candidateId: string,
  operatorId?: string | null
): Promise<void> {
  log.info({ agencyId, jobId, candidateId, operatorId }, "Removing pipeline item");

  // Validate item exists and belongs to agency
  const item = await prisma.jobPipelineItem.findUnique({
    where: {
      agencyId_jobId_candidateId: {
        agencyId,
        jobId,
        candidateId,
      },
    },
    include: {
      candidate: {
        select: {
          phone: true,
        },
      },
    },
  });

  if (!item) {
    throw new Error(
      `Pipeline item not found: jobId=${jobId}, candidateId=${candidateId}`
    );
  }

  if (item.agencyId !== agencyId) {
    throw new Error("Pipeline item does not belong to agency");
  }

  // Delete the item
  await prisma.jobPipelineItem.delete({
    where: {
      agencyId_jobId_candidateId: {
        agencyId,
        jobId,
        candidateId,
      },
    },
  });

  log.info(
    { agencyId, jobId, candidateId, stage: item.stage },
    "Pipeline item removed"
  );

  // Create timeline event
  // Note: Timeline events require conversationId and contactId, but pipeline items
  // may exist without conversations. We'll try to find them, but if not found,
  // we'll skip the timeline event (non-blocking).
  try {
    // Get contact for timeline event (if exists)
    const contact = await prisma.contact.findUnique({
      where: {
        agencyId_phone: {
          agencyId,
          phone: item.candidate.phone,
        },
      },
      select: {
        id: true,
      },
    });

    if (!contact) {
      log.debug(
        { agencyId, jobId, candidateId, phone: item.candidate.phone },
        "No contact found for pipeline removal timeline event, skipping"
      );
    } else {
      // Get most recent conversation for this contact
      const conversation = await prisma.conversation.findFirst({
        where: {
          agencyId,
          contactId: contact.id,
        },
        select: {
          id: true,
        },
        orderBy: {
          lastMessageAt: "desc",
        },
      });

      if (!conversation) {
        log.debug(
          { agencyId, jobId, candidateId, contactId: contact.id },
          "No conversation found for pipeline removal timeline event, skipping"
        );
      } else {
        const candidate = await prisma.candidate.findUnique({
          where: { id: candidateId },
          select: { name: true },
        });
        const candidateName = candidate?.name || "Candidate";
        
        await createTimelineEvent({
          agencyId,
          conversationId: conversation.id,
          contactId: contact.id,
          candidateId,
          type: "JOB_PIPELINE_REMOVED",
          actorRole: operatorId ? "OPERATOR" : "SYSTEM",
          actorOperatorId: operatorId || null,
          summary: `Removed ${candidateName} from pipeline (was ${item.stage})`,
          data: {
            jobId,
            candidateId,
            previousStage: item.stage,
            removed: true,
          },
          dedupeKey: `pipeline_remove_${agencyId}_${jobId}_${candidateId}_${new Date().toISOString()}`,
        });
      }
    }
  } catch (error) {
    log.warn(
      { agencyId, jobId, candidateId, error },
      "Failed to create JOB_PIPELINE_UPDATED timeline event for removal (non-blocking)"
    );
  }
}

/**
 * Helper: Build suggested message for OUTREACH task with job details
 */
function buildOutreachMessage(job: any, pipelineItem: any): string {
  const parts: string[] = [];
  
  // Role/title
  if (job.title) {
    parts.push(job.title);
  }
  
  // Location
  if (job.city || job.siteName) {
    const location = job.siteName || job.city;
    parts.push(`in ${location}`);
  }
  
  // Pay rate
  if (pipelineItem.payRate || job.payRate) {
    const rate = pipelineItem.payRate || job.payRate;
    const currency = job.currency || "GBP";
    const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : "";
    parts.push(`${symbol}${rate}/hr`);
  }
  
  // Start date
  if (pipelineItem.startDate) {
    const date = new Date(pipelineItem.startDate);
    const dateStr = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    parts.push(`starting ${dateStr}`);
  } else if (job.startDate) {
    const date = new Date(job.startDate);
    const dateStr = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    parts.push(`starting ${dateStr}`);
  }
  
  // Build message
  if (parts.length > 0) {
    return `Hi, we have a ${parts.join(", ")} position available. Are you interested?`;
  }
  
  return "Hi, we have a position available. Are you interested?";
}

/**
 * Helper: Create OUTREACH task when pipeline moves to OFFER_SENT
 */
async function createOutreachTaskForPipeline(input: {
  agencyId: string;
  jobId: string;
  candidateId: string;
  job: any;
  candidate: any;
  pipelineItem: any;
  operatorId?: string | null;
}): Promise<void> {
  const { agencyId, jobId, candidateId, job, candidate, pipelineItem, operatorId } = input;

  try {
    // Check if open OUTREACH task already exists for this job/candidate
    // Query by checking payload JSON field (Prisma doesn't support path queries directly)
    const existingTasks = await prisma.task.findMany({
      where: {
        agencyId,
        candidateId,
        type: TaskType.OUTREACH,
        status: TaskStatus.OPEN,
      },
    });

    // Filter by payload.jobId in memory (Prisma JSON filtering is limited)
    const existingTask = existingTasks.find((t) => {
      const payload = t.payload as any;
      return payload?.jobId === jobId;
    });

    if (existingTask) {
      log.debug(
        { jobId, candidateId, existingTaskId: existingTask.id },
        "Open OUTREACH task already exists, skipping creation"
      );
      return;
    }

    // Find contact and conversation for timeline event
    const contact = await prisma.contact.findUnique({
      where: {
        agencyId_phone: {
          agencyId,
          phone: candidate.phone,
        },
      },
      select: {
        id: true,
      },
    });

    if (!contact) {
      log.warn(
        { jobId, candidateId, phone: candidate.phone },
        "No contact found for OUTREACH task creation, skipping"
      );
      return;
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        agencyId,
        contactId: contact.id,
      },
      select: {
        id: true,
      },
      orderBy: {
        lastMessageAt: "desc",
      },
    });

    if (!conversation) {
      log.warn(
        { jobId, candidateId, contactId: contact.id },
        "No conversation found for OUTREACH task creation, skipping"
      );
      return;
    }

    // Build suggested message with job details
    const suggestedMessage = buildOutreachMessage(job, pipelineItem);

    // Create OUTREACH task (requires approval)
    const task = await prisma.task.create({
      data: {
        agencyId,
        type: TaskType.OUTREACH,
        status: TaskStatus.OPEN,
        approvalStatus: TaskApprovalStatus.PENDING, // Always requires approval
        candidateId,
        relatedMessageId: null,
        proposedAction: {
          actionType: "SEND_MESSAGE",
          suggestedMessage,
          reasoning: "Pipeline item moved to OFFER_SENT",
          riskLevel: "MEDIUM",
        },
        payload: {
          jobId,
          candidateId,
          pipelineStage: "OFFER_SENT",
          suggestedMessage,
        },
      },
    });

    log.info(
      { taskId: task.id, jobId, candidateId },
      "Created OUTREACH task for pipeline transition to OFFER_SENT"
    );

    // Create timeline event: OUTREACH_TASK_CREATED
    try {
      await createTimelineEvent({
        agencyId,
        conversationId: conversation.id,
        contactId: contact.id,
        candidateId,
        type: "OUTREACH_TASK_CREATED",
        actorRole: operatorId ? "OPERATOR" : "SYSTEM",
        actorOperatorId: operatorId || null,
        summary: `Outreach task created for ${job.title || "job"}`,
        data: {
          taskId: task.id,
          jobId,
          candidateId,
          pipelineStage: "OFFER_SENT",
        },
        dedupeKey: `outreach_task_${agencyId}_${jobId}_${candidateId}_OFFER_SENT`,
      });
    } catch (error) {
      log.warn(
        { jobId, candidateId, taskId: task.id, error },
        "Failed to create OUTREACH_TASK_CREATED timeline event (non-blocking)"
      );
    }
  } catch (error) {
    log.error(
      { jobId, candidateId, error },
      "Failed to create OUTREACH task for pipeline transition (non-blocking)"
    );
    // Don't throw - this is non-blocking automation
  }
}

/**
 * Helper: Create FOLLOW_UP task when pipeline moves to START_CONFIRMED
 */
async function createFollowUpTaskForPipeline(input: {
  agencyId: string;
  jobId: string;
  candidateId: string;
  job: any;
  candidate: any;
  pipelineItem: any;
  operatorId?: string | null;
}): Promise<void> {
  const { agencyId, jobId, candidateId, job, candidate, pipelineItem, operatorId } = input;

  try {
    // Check if open FOLLOW_UP task already exists for this job/candidate
    // Query by checking payload JSON field (Prisma doesn't support path queries directly)
    const existingTasks = await prisma.task.findMany({
      where: {
        agencyId,
        candidateId,
        type: TaskType.FOLLOW_UP,
        status: TaskStatus.OPEN,
      },
    });

    // Filter by payload.jobId in memory (Prisma JSON filtering is limited)
    const existingTask = existingTasks.find((t) => {
      const payload = t.payload as any;
      return payload?.jobId === jobId;
    });

    if (existingTask) {
      log.debug(
        { jobId, candidateId, existingTaskId: existingTask.id },
        "Open FOLLOW_UP task already exists, skipping creation"
      );
      return;
    }

    // Find contact and conversation for timeline event
    const contact = await prisma.contact.findUnique({
      where: {
        agencyId_phone: {
          agencyId,
          phone: candidate.phone,
        },
      },
      select: {
        id: true,
      },
    });

    if (!contact) {
      log.warn(
        { jobId, candidateId, phone: candidate.phone },
        "No contact found for FOLLOW_UP task creation, skipping"
      );
      return;
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        agencyId,
        contactId: contact.id,
      },
      select: {
        id: true,
      },
      orderBy: {
        lastMessageAt: "desc",
      },
    });

    if (!conversation) {
      log.warn(
        { jobId, candidateId, contactId: contact.id },
        "No conversation found for FOLLOW_UP task creation, skipping"
      );
      return;
    }

    // Calculate dueAt: next day morning (9 AM)
    const dueAt = new Date();
    dueAt.setDate(dueAt.getDate() + 1);
    dueAt.setHours(9, 0, 0, 0);

    // Build suggested message with site name
    const siteName = job.siteName || job.city || "the site";
    const suggestedMessage = `Morning mate, all good for today at ${siteName}?`;

    // Create FOLLOW_UP task
    const task = await prisma.task.create({
      data: {
        agencyId,
        type: TaskType.FOLLOW_UP,
        status: TaskStatus.OPEN,
        approvalStatus: TaskApprovalStatus.NOT_REQUIRED, // Follow-ups typically don't require approval
        candidateId,
        relatedMessageId: null,
        dueAt,
        isSystemGenerated: true,
        proposedAction: {
          actionType: "SEND_MESSAGE",
          suggestedMessage,
          reasoning: "Pipeline item moved to START_CONFIRMED - day 1 check-in",
          riskLevel: "LOW",
        },
        payload: {
          jobId,
          candidateId,
          pipelineStage: "START_CONFIRMED",
          suggestedMessage,
          dueAt: dueAt.toISOString(),
        },
      },
    });

    log.info(
      { taskId: task.id, jobId, candidateId, dueAt },
      "Created FOLLOW_UP task for pipeline transition to START_CONFIRMED"
    );

    // Create timeline event: START_FOLLOWUP_CREATED
    try {
      await createTimelineEvent({
        agencyId,
        conversationId: conversation.id,
        contactId: contact.id,
        candidateId,
        type: "START_FOLLOWUP_CREATED",
        actorRole: operatorId ? "OPERATOR" : "SYSTEM",
        actorOperatorId: operatorId || null,
        summary: `Follow-up task created for day 1 check-in`,
        data: {
          taskId: task.id,
          jobId,
          candidateId,
          pipelineStage: "START_CONFIRMED",
          dueAt: dueAt.toISOString(),
        },
        dedupeKey: `start_followup_task_${agencyId}_${jobId}_${candidateId}_START_CONFIRMED`,
      });
    } catch (error) {
      log.warn(
        { jobId, candidateId, taskId: task.id, error },
        "Failed to create START_FOLLOWUP_CREATED timeline event (non-blocking)"
      );
    }
  } catch (error) {
    log.error(
      { jobId, candidateId, error },
      "Failed to create FOLLOW_UP task for pipeline transition (non-blocking)"
    );
    // Don't throw - this is non-blocking automation
  }
}

/**
 * Helper: Apply Progress State Machine after pipeline update
 * Step G: Integrate pipeline stages with progress tracking
 */
async function applyProgressStateMachineForPipeline(input: {
  agencyId: string;
  jobId: string;
  candidateId: string;
  candidate: any;
  pipelineStage: JobPipelineStage;
  pipelineItem: any;
  job: any;
}): Promise<void> {
  const { agencyId, jobId, candidateId, candidate, pipelineStage, pipelineItem, job } = input;

  try {
    // Find conversation for this candidate
    const contact = await prisma.contact.findUnique({
      where: {
        agencyId_phone: {
          agencyId,
          phone: candidate.phone,
        },
      },
      select: {
        id: true,
        type: true,
      },
    });

    if (!contact) {
      // No contact found - store job info in candidate memoryPack
      log.debug(
        { agencyId, candidateId, jobId },
        "No contact found, storing lastJobDiscussed in candidate memoryPack"
      );
      
      const existingMemoryPack = (candidate.rawProfile as any)?.memoryPack || {};
      const updatedMemoryPack = {
        ...existingMemoryPack,
        lastJobDiscussed: {
          jobId,
          jobTitle: job.title,
          stage: pipelineStage,
          updatedAt: new Date().toISOString(),
        },
      };

      await prisma.candidate.update({
        where: { id: candidateId },
        data: {
          rawProfile: {
            ...(candidate.rawProfile as any),
            memoryPack: updatedMemoryPack,
          },
        },
      });

      return;
    }

    // Find most recent conversation
    const conversation = await prisma.conversation.findFirst({
      where: {
        agencyId,
        contactId: contact.id,
      },
      select: {
        id: true,
        lastMessageAt: true,
        progressStage: true,
        progressData: true,
      },
      orderBy: {
        lastMessageAt: "desc",
      },
    });

    if (!conversation) {
      // No conversation found - store job info in candidate memoryPack
      log.debug(
        { agencyId, candidateId, jobId, contactId: contact.id },
        "No conversation found, storing lastJobDiscussed in candidate memoryPack"
      );
      
      const existingMemoryPack = (candidate.rawProfile as any)?.memoryPack || {};
      const updatedMemoryPack = {
        ...existingMemoryPack,
        lastJobDiscussed: {
          jobId,
          jobTitle: job.title,
          stage: pipelineStage,
          updatedAt: new Date().toISOString(),
        },
      };

      await prisma.candidate.update({
        where: { id: candidateId },
        data: {
          rawProfile: {
            ...(candidate.rawProfile as any),
            memoryPack: updatedMemoryPack,
          },
        },
      });

      return;
    }

    // Get tasks for this conversation/candidate
    const tasks = await prisma.task.findMany({
      where: {
        agencyId,
        candidateId,
        status: TaskStatus.OPEN,
      },
      select: {
        type: true,
        approvalStatus: true,
      },
    });

    const hasPendingApproval = tasks.some(
      (t) => t.approvalStatus === TaskApprovalStatus.PENDING
    );
    const hasOpenCscsTask = tasks.some((t) => t.type === TaskType.CSCS_VERIFICATION);
    const hasOpenFollowUpTask = tasks.some((t) => t.type === TaskType.FOLLOW_UP);
    const hasOpenTasks = tasks.length > 0;

    // Get job matches count
    const jobMatches = await prisma.jobCandidateMatch.findMany({
      where: {
        agencyId,
        candidateId,
      },
      select: {
        jobId: true,
      },
    });
    const matchedJobsCount = jobMatches.length;

    // Get placement status for this specific job
    const placement = await prisma.placement.findFirst({
      where: {
        agencyId,
        candidateId,
        jobId,
        status: "CONFIRMED",
      },
      select: {
        startDate: true,
        status: true,
      },
    });

    const hasConfirmedPlacement = placement?.status === "CONFIRMED";
    const placementStartDate = placement?.startDate?.toISOString() || null;

    // Build candidate snapshot
    const candidateSnapshot = {
      phone: candidate.phone,
      name: candidate.name,
      desiredRole: candidate.desiredRole,
      location: candidate.location,
      skills: candidate.skills || [],
      availability: candidate.availabilityNotes,
      salaryMin: candidate.salaryMin,
      salaryMax: candidate.salaryMax,
      yearsExperience: candidate.yearsExperience,
    };

    // Determine last intent based on pipeline stage
    // Pipeline stages indicate interest/engagement, so we can infer intent
    let lastIntent: string | null = null;
    if (pipelineStage === "SHORTLISTED" || pipelineStage === "OFFER_SENT") {
      lastIntent = "LOOKING_FOR_WORK"; // Candidate is engaged with jobs
    } else if (pipelineStage === "START_CONFIRMED") {
      lastIntent = "AVAILABILITY_UPDATE"; // Candidate confirmed start
    }

    // Apply progress state machine
    await applyProgressStateMachine({
      conversationId: conversation.id,
      agencyId,
      context: {
        lastActivityAt: conversation.lastMessageAt || new Date(),
        lastInboundMessageAt: conversation.lastMessageAt || null,
        candidate: candidateSnapshot,
        tasks: {
          hasPendingApproval,
          hasOpenCscsTask,
          hasOpenFollowUpTask,
          hasOpenTasks,
        },
        placement: hasConfirmedPlacement
          ? {
              hasConfirmedPlacement: true,
              placementStartDate,
            }
          : null,
        lastIntent,
        matchedJobsCount,
        contactType: contact.type,
      },
    });

    log.info(
      {
        conversationId: conversation.id,
        candidateId,
        jobId,
        pipelineStage,
        previousProgressStage: conversation.progressStage,
      },
      "Applied progress state machine after pipeline update"
    );
  } catch (error) {
    log.error(
      { agencyId, jobId, candidateId, error },
      "Failed to apply progress state machine for pipeline update"
    );
    // Don't throw - this is non-blocking
  }
}
