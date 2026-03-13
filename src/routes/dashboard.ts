/**
 * Dashboard API routes
 * Returns statistics and metrics for the operator dashboard
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db/prisma.ts";
import { TaskStatus, TaskApprovalStatus, MessageSenderRole, MessageDirection, ReviewVerdict } from "@prisma/client";
import { computeEarningsSummary } from "../services/earningsCalculator.ts";
import { getPriorityOpportunities } from "../services/earningsOpportunities.ts";
import { requireAgencyId } from "../utils/agencyContext.ts";
import { detectStuckTasks } from "../services/stuckTaskDetection.ts";
import { getOpportunities } from "../services/opportunities/opportunityEngine.ts";
import { createTasksForOpportunity } from "../services/opportunities/opportunityTaskCreator.ts";
import { scopeWhere } from "../db/tenantScope.ts";

/**
 * GET /api/dashboard/stats
 * Returns dashboard statistics
 */
export async function dashboardStatsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const logger = request.log;

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    // Active Tasks = tasks where status IN ("OPEN", "APPROVED")
    // Note: TaskStatus doesn't have "IN_PROGRESS", so we use OPEN and APPROVED
    const activeTasks = await prisma.task.count({
      where: {
        agencyId,
        status: {
          in: [TaskStatus.OPEN, TaskStatus.APPROVED],
        },
      },
    });

    // Pending Approval = tasks where approvalStatus = PENDING AND status = OPEN
    // AND related to HUMAN messages only (AI messages should never create tasks)
    const pendingApproval = await prisma.task.count({
      where: {
        agencyId,
        approvalStatus: TaskApprovalStatus.PENDING,
        status: TaskStatus.OPEN,
        relatedMessage: {
          senderRole: MessageSenderRole.HUMAN, // Only count tasks from HUMAN messages
        },
      },
    });

    // Stuck Tasks = tasks that are stuck in approval workflow
    // Get threshold from env or use default (20 minutes)
    const thresholdMinutes = process.env.STUCK_TASK_THRESHOLD_MINUTES
      ? parseInt(process.env.STUCK_TASK_THRESHOLD_MINUTES, 10)
      : 20;
    const thresholdMs = thresholdMinutes * 60 * 1000;
    
    const stuckTasksList = await detectStuckTasks(agencyId, thresholdMs);
    const stuckTasks = stuckTasksList.length;
    
    // Calculate oldest stuck age
    const oldestStuckAgeMinutes = stuckTasksList.length > 0
      ? Math.max(...stuckTasksList.map((t) => t.ageMinutes))
      : 0;

    // Messages Today = ONLY HUMAN inbound + OPERATOR outbound
    // AI messages must NOT be counted
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const messagesToday = await prisma.message.count({
      where: {
        agencyId,
        createdAt: {
          gte: today,
          lt: tomorrow,
        },
        OR: [
          // HUMAN inbound messages
          {
            senderRole: MessageSenderRole.HUMAN,
            direction: MessageDirection.INBOUND,
          },
          // OPERATOR outbound messages
          {
            senderRole: MessageSenderRole.OPERATOR,
            direction: MessageDirection.OUTBOUND,
          },
        ],
      },
    });

    // Active Contacts = ONLY HUMAN contacts (contacts with HUMAN messages in last 30 days)
    // AI/OPERATOR messages should NOT count toward active contacts
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const activeContacts = await prisma.contact.count({
      where: {
        agencyId,
        messages: {
          some: {
            senderRole: MessageSenderRole.HUMAN,
            createdAt: {
              gte: thirtyDaysAgo,
            },
          },
        },
      },
    });

    // Quality metrics: approvals edited today
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(tomorrow);
    todayEnd.setHours(0, 0, 0, 0);

    // Get all tasks approved today (filter in memory for approvedMessageText)
    const approvedTasksTodayRaw = await prisma.task.findMany({
      where: {
        agencyId,
        approvalStatus: TaskApprovalStatus.APPROVED,
        approvedAt: {
          gte: todayStart,
          lt: todayEnd,
        },
      },
      select: {
        payload: true,
      },
    });

    // Filter to only tasks that sent a message (have approvedMessageText)
    const approvedTasksToday = approvedTasksTodayRaw.filter((task) => {
      const payload = task.payload as any;
      return payload?.approvedMessageText && typeof payload.approvedMessageText === "string";
    });

    const approvalsToday = approvedTasksToday.length;
    const approvalsEditedToday = approvedTasksToday.filter((task) => {
      const payload = task.payload as any;
      return payload?.wasEdited === true;
    }).length;
    const percentEdited = approvalsToday > 0 
      ? Math.round((approvalsEditedToday / approvalsToday) * 100) 
      : 0;

    // Quality metrics: review verdicts in last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const unsafeReviews7d = await prisma.messageReviewSample.count({
      where: {
        agencyId,
        verdict: ReviewVerdict.UNSAFE,
        reviewedAt: {
          gte: sevenDaysAgo,
        },
      },
    });

    const needsImprovement7d = await prisma.messageReviewSample.count({
      where: {
        agencyId,
        verdict: ReviewVerdict.NEEDS_IMPROVEMENT,
        reviewedAt: {
          gte: sevenDaysAgo,
        },
      },
    });

    const stats = {
      activeTasks,
      pendingApproval,
      stuckTasks,
      oldestStuckAgeMinutes,
      messagesToday,
      activeContacts,
      approvalsEditedToday,
      approvalsToday,
      percentEdited,
      unsafeReviews7d,
      needsImprovement7d,
    };

    logger.info(stats, "Dashboard statistics retrieved");

    return reply.status(200).send(stats);
  } catch (error) {
    logger.error({ error }, "Failed to get dashboard statistics");
    return reply.status(500).send({ error: "Failed to get dashboard statistics" });
  }
}

/**
 * GET /api/dashboard/earnings
 * Returns earnings summary and opportunities for the current operator
 */
export async function dashboardEarningsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const logger = request.log;
  const operatorId = (request as any).operatorId;

  if (!operatorId) {
    return reply.status(401).send({ error: "Authentication required" });
  }

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    // Load EarningsSettings for operator
    const earningsSettings = await prisma.earningsSettings.findUnique({
      where: {
        agencyId_operatorId: {
          agencyId,
          operatorId,
        },
      },
    });

    // If no settings, return not configured
    if (!earningsSettings) {
      return reply.status(200).send({ configured: false });
    }

    // Load MonthlyEarnings for current month
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-12

    const monthlyEarnings = await prisma.monthlyEarnings.findUnique({
      where: {
        agencyId_operatorId_year_month: {
          agencyId,
          operatorId,
          year,
          month,
        },
      },
    });

    // Use revenueTotal from monthly earnings, or 0 if not set
    const revenueTotal = monthlyEarnings?.revenueTotal ?? 0;
    const currency = monthlyEarnings?.currency || earningsSettings.currency || "GBP";

    // Compute earnings summary
    const summary = computeEarningsSummary({
      revenueTotal,
      brackets: earningsSettings.commissionBrackets as any,
      currency,
    });

    // Get priority opportunities
    const opportunities = await getPriorityOpportunities({
      agencyId,
      operatorId,
      limit: 3,
    });

    // Map opportunities to response format (exclude internal fields)
    const opportunitiesDTO = opportunities.map((opp) => ({
      label: opp.label,
      estMonthlyMargin: opp.estMonthlyMargin,
      currency: opp.currency,
      why: opp.why,
      jobId: opp.jobId,
      candidateId: opp.candidateId,
    }));

    const response = {
      revenueTotal: summary.revenueTotal,
      currency: summary.currency,
      currentBracketRatePct: summary.currentBracket.ratePct,
      amountToNextBracket: summary.amountToNextBracket,
      nextBracketRatePct: summary.nextBracket?.ratePct ?? null,
      summaryText: summary.summaryText,
      opportunities: opportunitiesDTO,
    };

    logger.info({ operatorId, revenueTotal, opportunitiesCount: opportunities.length }, "Dashboard earnings retrieved");

    return reply.status(200).send(response);
  } catch (error) {
    logger.error({ error, operatorId }, "Failed to get dashboard earnings");
    return reply.status(500).send({ error: "Failed to get dashboard earnings" });
  }
}

/**
 * GET /api/dashboard/stuck-tasks
 * Returns list of stuck tasks with details
 */
export async function dashboardStuckTasksHandler(
  request: FastifyRequest<{
    Querystring: {
      threshold?: string; // Optional threshold in minutes (default: 20)
    };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    // Parse threshold (default: 20 minutes)
    const thresholdMinutes = request.query.threshold
      ? parseInt(request.query.threshold, 10)
      : 20;
    const thresholdMs = thresholdMinutes * 60 * 1000;

    // Detect stuck tasks
    const stuckTasks = await detectStuckTasks(agencyId, thresholdMs);

    logger.info({ agencyId, stuckCount: stuckTasks.length }, "Retrieved stuck tasks");

    return reply.status(200).send({
      tasks: stuckTasks,
      count: stuckTasks.length,
    });
  } catch (error) {
    logger.error({ error }, "Failed to get stuck tasks");
    return reply.status(500).send({ error: "Failed to get stuck tasks" });
  }
}

/**
 * GET /api/dashboard/opportunities
 * Returns revenue optimization opportunities
 */
export async function dashboardOpportunitiesHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const logger = request.log;

  try {
    const agencyId = await requireAgencyId(request);
    const now = new Date();

    // Get opportunities
    const opportunities = await getOpportunities({ agencyId, now });

    // Get existing action logs to check which are already created
    const opportunityKeys = opportunities.map((opp) => opp.id);
    const existingLogs = opportunityKeys.length > 0
      ? await prisma.opportunityActionLog.findMany({
          where: scopeWhere(agencyId, {
            opportunityKey: { in: opportunityKeys },
            status: "CREATED",
          }),
          select: {
            opportunityKey: true,
            relatedCandidateId: true,
          },
        })
      : [];

    // Group by opportunity key
    const createdMap = new Map<string, Set<string>>();
    for (const log of existingLogs) {
      if (!createdMap.has(log.opportunityKey)) {
        createdMap.set(log.opportunityKey, new Set());
      }
      if (log.relatedCandidateId) {
        createdMap.get(log.opportunityKey)!.add(log.relatedCandidateId);
      }
    }

    // Map to DTOs
    const items = opportunities.map((opp) => {
      const createdCandidates = createdMap.get(opp.id) || new Set();
      const candidateIds = opp.relatedEntities.candidateIds || [];
      const allCreated = candidateIds.length > 0 && candidateIds.every((id) => createdCandidates.has(id));

      return {
        opportunityKey: opp.id,
        type: opp.type,
        title: opp.title,
        priority: opp.priority,
        reasonBullets: opp.reasons,
        recommendedAction: opp.recommendedAction,
        relatedJobId: opp.relatedEntities.jobId || null,
        relatedCandidateIdsCount: candidateIds.length,
        createdAt: opp.createdAt.toISOString(),
        expiresAt: opp.expiresAt.toISOString(),
        alreadyCreated: allCreated,
      };
    });

    logger.info({ agencyId, count: items.length }, "Dashboard opportunities retrieved");

    return reply.status(200).send({ items });
  } catch (error) {
    logger.error({ error }, "Failed to get dashboard opportunities");
    return reply.status(500).send({ error: "Failed to get dashboard opportunities" });
  }
}

/**
 * POST /api/dashboard/opportunities/create
 * Create tasks from an opportunity
 */
export async function dashboardOpportunitiesCreateHandler(
  request: FastifyRequest<{
    Body: {
      opportunityKey: string;
      limit?: number;
      dryRun?: boolean;
    };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const operatorId = (request as any).operatorId;

  try {
    const agencyId = await requireAgencyId(request);
    const { opportunityKey, limit = 10, dryRun = false } = request.body;

    if (!opportunityKey) {
      return reply.status(400).send({ error: "opportunityKey is required" });
    }

    const result = await createTasksForOpportunity({
      agencyId,
      opportunityKey,
      operatorId,
      limit,
      dryRun,
    });

    logger.info(
      { agencyId, opportunityKey, ...result },
      dryRun ? "Dry run: would create tasks" : "Created tasks from opportunity"
    );

    return reply.status(200).send(result);
  } catch (error) {
    logger.error({ error }, "Failed to create tasks from opportunity");
    return reply.status(500).send({ error: "Failed to create tasks from opportunity" });
  }
}

/**
 * Register dashboard routes
 */
export async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.get("/stats", dashboardStatsHandler);
  fastify.get("/earnings", dashboardEarningsHandler);
  fastify.get("/stuck-tasks", dashboardStuckTasksHandler);
  fastify.get("/opportunities", dashboardOpportunitiesHandler);
  fastify.post("/opportunities/create", dashboardOpportunitiesCreateHandler);
}

