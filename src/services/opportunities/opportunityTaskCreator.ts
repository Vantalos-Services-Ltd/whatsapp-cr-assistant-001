/**
 * Service to create tasks from opportunities
 */

import pino from "pino";
import { PrismaClient, TaskType, TaskStatus, TaskApprovalStatus } from "@prisma/client";
import { scopeWhere } from "../../db/tenantScope.ts";
import { createTimelineEvent } from "../timelineService.ts";
import { getOpportunities } from "./opportunityEngine.ts";
import { getTemplateForType, buildTemplateContext } from "./opportunityTemplates.ts";
import type { Opportunity } from "./types.ts";

const log = pino({ name: "opportunityTaskCreator" });
const prisma = new PrismaClient();

/**
 * Create tasks for an opportunity
 */
export async function createTasksForOpportunity(input: {
  agencyId: string;
  opportunityKey: string;
  operatorId?: string;
  limit?: number;
  dryRun?: boolean;
}): Promise<{
  createdCount: number;
  skippedCount: number;
  taskIds: string[];
  wouldCreateCount?: number;
}> {
  const { agencyId, opportunityKey, operatorId, limit = 10, dryRun = false } = input;
  const maxLimit = 25; // Safety cap
  const actualLimit = Math.min(limit, maxLimit);

  try {
    // Recompute opportunities to find matching one (don't trust client)
    const now = new Date();
    const opportunities = await getOpportunities({ agencyId, now });
    const opportunity = opportunities.find((opp) => opp.id === opportunityKey);

    if (!opportunity) {
      log.warn({ agencyId, opportunityKey }, "Opportunity not found");
      return { createdCount: 0, skippedCount: 0, taskIds: [] };
    }

    if (dryRun) {
      // Count how many would be created (excluding already created)
      const candidateIds = opportunity.relatedEntities.candidateIds || [];
      const limitedCandidates = candidateIds.slice(0, actualLimit);

      // Check which ones already have action logs
      const existingLogs = await prisma.opportunityActionLog.findMany({
        where: scopeWhere(agencyId, {
          opportunityKey,
          relatedCandidateId: { in: limitedCandidates },
          status: "CREATED",
        }),
        select: { relatedCandidateId: true },
      });

      const existingCandidateIds = new Set(existingLogs.map((log) => log.relatedCandidateId).filter(Boolean));
      const wouldCreate = limitedCandidates.filter((id) => !existingCandidateIds.has(id));

      return {
        createdCount: 0,
        skippedCount: 0,
        taskIds: [],
        wouldCreateCount: wouldCreate.length,
      };
    }

    // Get candidate and job data for templates
    const candidateIds = opportunity.relatedEntities.candidateIds || [];
    const limitedCandidates = candidateIds.slice(0, actualLimit);
    const jobId = opportunity.relatedEntities.jobId;

    // Load candidates and job in batch
    const [candidates, job] = await Promise.all([
      prisma.candidate.findMany({
        where: scopeWhere(agencyId, {
          id: { in: limitedCandidates },
        }),
        select: {
          id: true,
          name: true,
          phone: true,
          lastConversationId: true,
        },
      }),
      jobId
        ? prisma.job.findUnique({
            where: { id: jobId },
            select: {
              id: true,
              title: true,
              city: true,
              siteName: true,
              payRate: true,
              currency: true,
              startDate: true,
            },
          })
        : null,
    ]);

    // Get conversations for candidates
    const conversationIds = candidates
      .map((c) => c.lastConversationId)
      .filter(Boolean) as string[];
    const conversations = conversationIds.length > 0
      ? await prisma.conversation.findMany({
          where: scopeWhere(agencyId, {
            id: { in: conversationIds },
          }),
          select: {
            id: true,
            contactId: true,
          },
        })
      : [];

    const conversationMap = new Map(conversations.map((c) => [c.id, c]));

    // Get template function
    const templateFn = getTemplateForType(opportunity.type);

    // Check existing action logs to avoid duplicates
    const existingLogs = await prisma.opportunityActionLog.findMany({
      where: scopeWhere(agencyId, {
        opportunityKey,
        relatedCandidateId: { in: limitedCandidates },
        status: "CREATED",
      }),
      select: { relatedCandidateId: true },
    });

    const existingCandidateIds = new Set(existingLogs.map((log) => log.relatedCandidateId).filter(Boolean));

    let createdCount = 0;
    let skippedCount = 0;
    const taskIds: string[] = [];

    // Create tasks for each candidate
    for (const candidate of candidates) {
      if (existingCandidateIds.has(candidate.id)) {
        skippedCount++;
        continue;
      }

      try {
        // Build template context
        const context = buildTemplateContext({
          candidateName: candidate.name,
          jobTitle: job?.title || undefined,
          jobCity: job?.city || undefined,
          jobSiteName: job?.siteName || undefined,
          jobPayRate: job?.payRate || undefined,
          jobCurrency: job?.currency || undefined,
          jobStartDate: job?.startDate || undefined,
        });

        const suggestedMessage = templateFn(context);
        const conversation = candidate.lastConversationId
          ? conversationMap.get(candidate.lastConversationId)
          : null;

        // Create task
        const task = await prisma.task.create({
          data: {
            agencyId,
            type: opportunity.recommendedAction.taskType === "OUTREACH" ? TaskType.OUTREACH : TaskType.FOLLOW_UP,
            status: TaskStatus.OPEN,
            approvalStatus: TaskApprovalStatus.PENDING,
            candidateId: candidate.id,
            payload: {
              opportunityKey,
              opportunityType: opportunity.type,
              reasons: opportunity.reasons,
              suggestedMessage,
              jobId: jobId || undefined,
              candidateId: candidate.id,
              conversationId: conversation?.id || undefined,
            } as any,
          },
        });

        // Create action log
        await prisma.opportunityActionLog.create({
          data: {
            agencyId,
            opportunityKey,
            opportunityType: opportunity.type,
            relatedJobId: jobId || null,
            relatedCandidateId: candidate.id,
            createdByOperatorId: operatorId || null,
            taskId: task.id,
            status: "CREATED",
          },
        });

        // Create timeline event
        await createTimelineEvent({
          agencyId,
          conversationId: conversation?.id || "",
          contactId: conversation?.contactId || "",
          candidateId: candidate.id,
          type: "OPPORTUNITY_TASK_CREATED" as any,
          actorRole: operatorId ? "OPERATOR" : "SYSTEM",
          actorOperatorId: operatorId || undefined,
          summary: `Task created from ${opportunity.type} opportunity`,
          data: {
            taskId: task.id,
            opportunityKey,
            opportunityType: opportunity.type,
            taskType: opportunity.recommendedAction.taskType,
          },
          dedupeKey: `opportunity_task_${task.id}`,
        });

        createdCount++;
        taskIds.push(task.id);
      } catch (error) {
        log.error(
          { agencyId, opportunityKey, candidateId: candidate.id, error },
          "Failed to create task for candidate"
        );

        // Create failed action log
        try {
          await prisma.opportunityActionLog.create({
            data: {
              agencyId,
              opportunityKey,
              opportunityType: opportunity.type,
              relatedJobId: jobId || null,
              relatedCandidateId: candidate.id,
              createdByOperatorId: operatorId || null,
              status: "FAILED",
            },
          });
        } catch (logError) {
          log.error({ error: logError }, "Failed to create failed action log");
        }

        skippedCount++;
      }
    }

    log.info(
      { agencyId, opportunityKey, createdCount, skippedCount },
      "Created tasks from opportunity"
    );

    return { createdCount, skippedCount, taskIds };
  } catch (error) {
    log.error({ agencyId, opportunityKey, error }, "Failed to create tasks from opportunity");
    throw error;
  }
}

