/**
 * All Tasks API routes
 * Shows ALL tasks regardless of approval status (separate from Inbox)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db/prisma.ts";
import { TaskStatus, TaskApprovalStatus, TaskType, ConversationState } from "@prisma/client";
import { toTaskListItemDTO } from "../dto/transformers.ts";
import { enrichTasksWithCandidates } from "../dto/enrichTasks.ts";
import type { TaskListItemDTO } from "../dto/operator.ts";
import { estimateTaskPriority } from "../services/taskPriority.ts";
import { requireAgencyId } from "../utils/agencyContext.ts";
import { scopeWhere } from "../db/tenantScope.ts";
import { detectStuckTasks } from "../services/stuckTaskDetection.ts";

interface TasksQueryParams {
  filter?: "pending" | "approved" | "failed" | "all";
  limit?: string;
  offset?: string;
}

/**
 * GET /api/tasks/all
 * List ALL tasks with optional filters
 * This is separate from /api/tasks (Inbox) which only shows approval-required tasks
 */
export async function listAllTasksHandler(
  request: FastifyRequest<{
    Querystring: TasksQueryParams;
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const filter = request.query.filter || "all";
  const limit = Math.min(parseInt(request.query.limit || "50", 10), 100);
  const offset = parseInt(request.query.offset || "0", 10);

  try {
    const agencyId = await requireAgencyId(request);

    // Scope to the caller's agency. This query was previously unscoped.
    const where: any = { agencyId };

    // Apply filter
    if (filter === "pending") {
      where.status = TaskStatus.OPEN;
      where.approvalStatus = TaskApprovalStatus.PENDING;
      // All task types that can require a human decision. CSCS_VERIFICATION
      // and ESCALATION were previously omitted, so this "all tasks" view showed
      // fewer rows than the Inbox.
      where.type = { in: [TaskType.APPROVAL_REQUIRED, TaskType.CSCS_VERIFICATION, TaskType.ESCALATION, TaskType.OUTREACH] };
    } else if (filter === "approved") {
      where.status = TaskStatus.APPROVED;
      // Show approved tasks that were actionable
      where.type = { in: [TaskType.APPROVAL_REQUIRED, TaskType.FOLLOW_UP, TaskType.OUTREACH, TaskType.CSCS_VERIFICATION, TaskType.ESCALATION] };
    } else if (filter === "failed") {
      where.status = TaskStatus.FAILED;
      // Show failed tasks that were actionable
      where.type = { in: [TaskType.APPROVAL_REQUIRED, TaskType.FOLLOW_UP, TaskType.OUTREACH, TaskType.CSCS_VERIFICATION, TaskType.ESCALATION] };
    } else if (filter === "all") {
      // "all" shows only actionable tasks (exclude informational/logging tasks)
      where.type = { in: [TaskType.APPROVAL_REQUIRED, TaskType.FOLLOW_UP, TaskType.OUTREACH, TaskType.CSCS_VERIFICATION, TaskType.ESCALATION] };
    }

    const tasks = await prisma.task.findMany({
      where,
      include: {
        relatedMessage: {
          include: {
            contact: true,
            conversation: {
              select: {
                id: true,
                state: true,
                pausedReason: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 1000, // Fetch more for in-memory sorting
      skip: 0,
    });

    // Attach candidate details so names render the same way as the Inbox.
    const enrichedTasks = await enrichTasksWithCandidates(agencyId, tasks as any[]);

    // Compute priority for each task
    const tasksWithPriority = enrichedTasks.map((task: any) => {
      const priority = estimateTaskPriority(task);
      return {
        ...task,
        _priority: priority, // Store priority temporarily for sorting
      };
    });

    // Sort by priority score (highest first), then by createdAt (newest first)
    tasksWithPriority.sort((a, b) => {
      // Sort by priority score (highest first)
      const aScore = a._priority?.priorityScore ?? 0;
      const bScore = b._priority?.priorityScore ?? 0;
      if (aScore !== bScore) {
        return bScore - aScore; // desc
      }
      // If tie, sort by createdAt (newest first)
      return b.createdAt.getTime() - a.createdAt.getTime(); // desc
    });

    // Apply pagination after sorting
    const paginatedTasks = tasksWithPriority.slice(offset, offset + limit);

    // Filter out tasks with null relatedMessage if needed, and transform safely
    const dtos: TaskListItemDTO[] = paginatedTasks
      .filter((task) => {
        // Only filter if we're expecting a relatedMessage (for display purposes)
        // Tasks without relatedMessage are still valid (e.g., OUTREACH tasks)
        return true;
      })
      .map((task) => {
        const dto = toTaskListItemDTO(task as any);
        // Attach priority to DTO
        if (task._priority) {
          dto.priority = {
            score: task._priority.priorityScore,
            label: task._priority.priorityLabel,
            marginPerHour: task._priority.marginPerHour,
            expectedHours: task._priority.expectedHours,
          };
        }
        return dto;
      });

    logger.info(
      {
        count: dtos.length,
        filter,
        limit,
        offset,
      },
      "Listed all tasks"
    );

    return reply.status(200).send({
      tasks: dtos,
      pagination: {
        limit,
        offset,
        total: dtos.length,
      },
    });
  } catch (error) {
    logger.error({ error, filter }, "Failed to list all tasks");
    return reply.status(500).send({ error: "Failed to list tasks" });
  }
}

/**
 * GET /api/tasks/stuck
 * List stuck tasks ordered by stuckAt desc then createdAt desc
 * Returns: taskId, taskType, conversationId, contact name, createdAt, stuckAt, reason, proposed message preview, priority
 */
export async function listStuckTasksHandler(
  request: FastifyRequest<{
    Querystring: {
      limit?: string;
    };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;

  try {
    const agencyId = await requireAgencyId(request);
    const limit = Math.min(parseInt(request.query.limit || "50", 10), 100);

    // Get threshold from env or use default (20 minutes)
    const thresholdMinutes = process.env.STUCK_TASK_THRESHOLD_MINUTES
      ? parseInt(process.env.STUCK_TASK_THRESHOLD_MINUTES, 10)
      : 20;
    const thresholdMs = thresholdMinutes * 60 * 1000;

    // Detect stuck tasks
    const stuckTasks = await detectStuckTasks(agencyId, thresholdMs);

    // Sort by createdAt desc (stuckAt field doesn't exist in schema)
    stuckTasks.sort((a, b) => {
      // Sort by createdAt (newest first)
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    // Apply limit
    const limitedTasks = stuckTasks.slice(0, limit);

    // Fetch full task data with relations for DTO transformation
    const taskIds = limitedTasks.map((t) => t.id);
    const tasks = await prisma.task.findMany({
      where: scopeWhere(agencyId, {
        id: { in: taskIds },
      }),
      include: {
        relatedMessage: {
          include: {
            contact: {
              select: {
                name: true,
              },
            },
            conversation: {
              select: {
                id: true,
                state: true,
              },
            },
          },
        },
      },
    });

    // Create a map for quick lookup
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    // Build response with stuck task info
    const stuckTaskDTOs = limitedTasks.map((stuckTask) => {
      const task = taskMap.get(stuckTask.id);
      if (!task) return null;

      // Extract proposed message preview
      const proposedAction = task.proposedAction as any;
      const payload = task.payload as any;
      const proposedMessagePreview =
        proposedAction?.suggestedMessage ||
        payload?.proposedAction?.suggestedMessage ||
        payload?.pendingReplyText ||
        null;

      // Compute priority
      const priority = estimateTaskPriority(task);

      return {
        taskId: task.id,
        taskType: task.type,
        conversationId: stuckTask.conversationId,
        contactName: task.relatedMessage?.contact?.name || null,
        createdAt: task.createdAt.toISOString(),
        stuckAt: null, // Field doesn't exist in schema
        reason: stuckTask.reason,
        proposedMessagePreview: proposedMessagePreview
          ? (proposedMessagePreview.length > 100
              ? proposedMessagePreview.substring(0, 97) + "..."
              : proposedMessagePreview)
          : null,
        priority: priority
          ? {
              score: priority.priorityScore,
              label: priority.priorityLabel,
              marginPerHour: priority.marginPerHour,
              expectedHours: priority.expectedHours,
            }
          : null,
        ageMinutes: stuckTask.ageMinutes,
      };
    }).filter((dto) => dto !== null);

    logger.info(
      { agencyId, count: stuckTaskDTOs.length, limit },
      "Listed stuck tasks"
    );

    return reply.status(200).send({
      tasks: stuckTaskDTOs,
      count: stuckTaskDTOs.length,
      total: stuckTasks.length,
    });
  } catch (error) {
    logger.error({ error }, "Failed to list stuck tasks");
    return reply.status(500).send({ error: "Failed to list stuck tasks" });
  }
}

/**
 * Register all tasks routes
 */
export async function allTasksRoutes(fastify: FastifyInstance) {
  fastify.get("/all", listAllTasksHandler);
  fastify.get("/stuck", listStuckTasksHandler);
}

