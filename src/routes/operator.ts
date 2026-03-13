/**
 * Operator API routes
 * Returns DTOs (not Prisma models) for the operator dashboard
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db/prisma.ts";
import { TaskStatus, TaskApprovalStatus, TaskType, MessageDirection, MessageSenderRole } from "@prisma/client";
import { requireAuth } from "../middleware/auth.ts";
import { requireAgencyId } from "../utils/agencyContext.ts";
import { scopeWhere, findFirstOr404, verifyOwnership } from "../db/tenantScope.ts";
import { notFound, NotFoundError } from "../utils/httpErrors.ts";
import { serializeError } from "../utils/errors.ts";
import {
  toTaskListItemDTO,
  toMessageDTO,
  toConversationDTO,
  toTimelineEventDTO,
} from "../dto/transformers.ts";
import { getConversationTimeline } from "../services/timelineService.ts";
import { estimateTaskPriority } from "../services/taskPriority.ts";
import type {
  TaskListItemDTO,
  ConversationDTO,
  ConversationListItemDTO,
  MessageDTO,
} from "../dto/operator.ts";

interface QueryParams {
  bucket?: "pending" | "completed" | "failed" | "reminders";
  limit?: string;
  offset?: string;
  status?: string;
  approvalStatus?: string;
}

/**
 * Helper to throw 404 error if value is null/undefined
 */
function notFoundIfNull<T>(value: T | null | undefined, message?: string): T {
  if (value == null) {
    throw new NotFoundError(message || "Not Found");
  }
  return value;
}

/**
 * GET /api/tasks?bucket=pending|completed|failed
 * List tasks for operator inbox with bucket filtering
 */

export async function listTasksHandler(
  request: FastifyRequest<{
    Querystring: QueryParams;
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const bucket = request.query.bucket;
  const limit = Math.min(parseInt(request.query.limit || "50", 10), 100);
  const offset = parseInt(request.query.offset || "0", 10);

  try {
    // Get agencyId for filtering (tenant-scoped)
    const agencyId = await requireAgencyId(request);
    
    const where: any = scopeWhere(agencyId, {});

    // Apply bucket-based filtering
    if (bucket === "pending") {
      // Pending = ONLY tasks that require approval AND are pending AND are from INBOUND messages
      // This ensures inbox only shows actionable approval tasks from user messages, not AI replies
      // Include APPROVAL_REQUIRED, CSCS_VERIFICATION, OUTREACH, and FOLLOW_UP tasks
      where.approvalStatus = TaskApprovalStatus.PENDING;
      where.status = TaskStatus.OPEN;
      // Use OR to handle different task types with different message requirements
      where.OR = [
        {
          // APPROVAL_REQUIRED tasks must have HUMAN INBOUND messages
          type: TaskType.APPROVAL_REQUIRED,
          relatedMessage: {
            direction: MessageDirection.INBOUND,
            senderRole: MessageSenderRole.HUMAN,
          },
        },
        {
          // CSCS_VERIFICATION tasks may or may not have relatedMessage
          type: TaskType.CSCS_VERIFICATION,
        },
        {
          // OUTREACH tasks (from opportunities) may or may not have relatedMessage
          type: TaskType.OUTREACH,
        },
        {
          // FOLLOW_UP tasks (from opportunities or messages) may or may not have relatedMessage
          type: TaskType.FOLLOW_UP,
        },
      ];
    } else if (bucket === "completed") {
      // Completed = status APPROVED (approved tasks)
      where.status = TaskStatus.APPROVED;
    } else if (bucket === "failed") {
      // Failed = approvalStatus REJECTED OR status REJECTED (rejected tasks)
      // CSCS_VERIFICATION tasks set both, but we check both to be safe
      where.OR = [
        { approvalStatus: TaskApprovalStatus.REJECTED },
        { status: TaskStatus.REJECTED },
      ];
    } else if (bucket === "reminders") {
      // Reminders = FOLLOW_UP tasks with dueAt <= now, status OPEN
      where.type = TaskType.FOLLOW_UP;
      where.status = TaskStatus.OPEN;
      where.dueAt = {
        lte: new Date(), // dueAt <= now
      };
    } else {
      // Legacy support: allow status and approvalStatus filters
      if (request.query.status) {
        where.status = request.query.status;
      }
      if (request.query.approvalStatus) {
        where.approvalStatus = request.query.approvalStatus;
      }
    }

    // Determine sort order based on bucket
    // Note: For pending bucket, we'll sort in-memory by priority after fetching
    // For completed/failed, we also sort in-memory by priority
    // For reminders, sort by dueAt (earliest first)
    let orderBy: any = 
      bucket === "reminders" 
        ? { dueAt: "asc" } 
        : { createdAt: "desc" };

    const tasks = await prisma.task.findMany({
      where,
      include: {
        relatedMessage: {
          include: {
            contact: true,
            conversation: true,
          },
        },
      },
      orderBy,
      take: bucket === "completed" || bucket === "failed" || bucket === "reminders" ? 1000 : limit, // Fetch more for in-memory sort
      skip: bucket === "completed" || bucket === "failed" || bucket === "reminders" ? 0 : offset,
    });

    // Fetch candidates for tasks that have candidateId (either from relatedMessage or task.candidateId)
    const candidateIdsFromMessages = tasks
      .map((task) => (task.relatedMessage as any)?.candidateId)
      .filter((id): id is string => Boolean(id));
    const candidateIdsFromTasks = tasks
      .map((task) => task.candidateId)
      .filter((id): id is string => Boolean(id));
    const allCandidateIds = Array.from(new Set([...candidateIdsFromMessages, ...candidateIdsFromTasks]));
    
    const candidatesMap = new Map<string, { name: string | null; phone: string; desiredRole: string | null }>();
    if (allCandidateIds.length > 0) {
      const candidates = await prisma.candidate.findMany({
        where: scopeWhere(agencyId, { id: { in: allCandidateIds } }),
        select: { id: true, name: true, phone: true, desiredRole: true },
      });
      candidates.forEach((c) => {
        candidatesMap.set(c.id, { name: c.name, phone: c.phone, desiredRole: c.desiredRole });
      });
    }

    // Attach candidate data to tasks for transformer
    // For opportunity tasks (OUTREACH/FOLLOW_UP), candidate may be on task.candidateId, not relatedMessage
    const tasksWithCandidates = tasks.map((task) => {
      const message = task.relatedMessage as any;
      const taskCandidateId = task.candidateId;
      
      // Check if candidate is in message
      if (message?.candidateId && candidatesMap.has(message.candidateId)) {
        return {
          ...task,
          relatedMessage: message
            ? {
                ...message,
                candidate: candidatesMap.get(message.candidateId),
              }
            : null,
        };
      }
      
      // For opportunity tasks, candidate may be on task.candidateId
      if (taskCandidateId && candidatesMap.has(taskCandidateId)) {
        return {
          ...task,
          relatedMessage: message
            ? {
                ...message,
                candidate: candidatesMap.get(taskCandidateId),
              }
            : null,
          _candidate: candidatesMap.get(taskCandidateId), // Store candidate separately for transformer
        };
      }
      
      return task;
    });

    // Compute priority for each task
    const tasksWithPriority = tasksWithCandidates.map((task) => {
      const priority = estimateTaskPriority(task);
      return {
        ...task,
        _priority: priority, // Store priority temporarily for sorting
      };
    });

    // For pending bucket: Additional filtering to ensure only HUMAN INBOUND messages
    // This prevents AI-generated messages from appearing in inbox
    // Exceptions: CSCS_VERIFICATION, OUTREACH, and FOLLOW_UP tasks may be created without relatedMessage
    let filteredTasksWithPriority = tasksWithPriority;
    if (bucket === "pending") {
      filteredTasksWithPriority = tasksWithPriority.filter((task) => {
        // CSCS_VERIFICATION, OUTREACH, and FOLLOW_UP tasks are always included
        // (may be created without relatedMessage, e.g., from opportunities)
        if (
          task.type === TaskType.CSCS_VERIFICATION ||
          task.type === TaskType.OUTREACH ||
          task.type === TaskType.FOLLOW_UP
        ) {
          return true;
        }
        // For APPROVAL_REQUIRED tasks, only include tasks with related HUMAN INBOUND messages
        return (
          task.relatedMessage &&
          task.relatedMessage.direction === MessageDirection.INBOUND &&
          (task.relatedMessage as any).senderRole === MessageSenderRole.HUMAN
        );
      });
      
      logger.info(
        {
          totalTasks: tasksWithPriority.length,
          filteredTasks: filteredTasksWithPriority.length,
          bucket,
          cscsTasks: tasksWithPriority.filter(t => t.type === TaskType.CSCS_VERIFICATION).length,
          outreachTasks: tasksWithPriority.filter(t => t.type === TaskType.OUTREACH).length,
          followUpTasks: tasksWithPriority.filter(t => t.type === TaskType.FOLLOW_UP).length,
        },
        "Filtered inbox tasks to only HUMAN INBOUND messages (CSCS_VERIFICATION, OUTREACH, FOLLOW_UP always included)"
      );
    }

    // Sort all buckets by priority score first, then by date
    // For pending: sort by createdAt (newest first) as tiebreaker
    // For completed: sort by approvedAt (newest first) as tiebreaker
    // For failed: sort by rejectedAt (newest first) as tiebreaker
    // For reminders: sort by dueAt (earliest first) - already sorted by DB, but ensure consistency
    filteredTasksWithPriority.sort((a, b) => {
      if (bucket === "reminders") {
        // For reminders, sort by dueAt (earliest first)
        const aDue = a.dueAt || a.createdAt;
        const bDue = b.dueAt || b.createdAt;
        return aDue.getTime() - bDue.getTime(); // asc
      }
      
      // Sort by priority score (highest first)
      const aScore = a._priority?.priorityScore ?? 0;
      const bScore = b._priority?.priorityScore ?? 0;
      if (aScore !== bScore) {
        return bScore - aScore; // desc
      }
      // If tie, sort by date (newest first)
      let aDate: Date;
      let bDate: Date;
      if (bucket === "completed") {
        aDate = a.approvedAt || a.createdAt;
        bDate = b.approvedAt || b.createdAt;
      } else if (bucket === "failed") {
        aDate = a.rejectedAt || a.createdAt;
        bDate = b.rejectedAt || b.createdAt;
      } else {
        // pending
        aDate = a.createdAt;
        bDate = b.createdAt;
      }
      return bDate.getTime() - aDate.getTime(); // desc
    });

    // Apply pagination after sorting
    const paginatedTasks = filteredTasksWithPriority.slice(offset, offset + limit);
    
    // Convert to DTOs and attach priority
    const dtos: TaskListItemDTO[] = paginatedTasks.map((task) => {
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
        bucket,
        limit,
        offset,
      },
      "Listed tasks for operator inbox"
    );

    // Return TaskListItemDTO[] directly (not wrapped)
    return reply.status(200).send(dtos);
  } catch (error) {
    logger.error({ error, bucket }, "Failed to list tasks");
    return reply.status(500).send({ error: "Failed to list tasks" });
  }
}

/**
 * GET /api/conversations/:conversationId
 * Get conversation with messages (ordered ascending by createdAt)
 */
export async function getConversationHandler(
  request: FastifyRequest<{
    Params: { conversationId: string };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const { conversationId } = request.params;

  try {
    // Validate UUID format (return 400 if invalid)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(conversationId)) {
      logger.warn({ conversationId }, "Invalid UUID format for conversationId");
      return reply.status(400).send({ error: "Invalid conversation ID format" });
    }

    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    // TEMP logging as requested
    logger.info({ conversationId, agencyId }, "[TEMP] getConversationHandler - params and agencyId");

    // Use findFirst with agencyId (Conversation.id is globally unique, not tenant-scoped in unique constraint)
    const conversation = await prisma.conversation.findFirst({
      where: scopeWhere(agencyId, { id: conversationId }),
      include: {
        contact: true,
        messages: {
          // Show all messages (HUMAN, AI, OPERATOR) in conversation thread
          // AI messages should render inline inside the human conversation thread
          orderBy: {
            createdAt: "asc", // Ascending order as required
          },
        },
      },
    });

    // Return 404 if conversation not found or not in tenant scope
    if (!conversation) {
      logger.info({ conversationId, agencyId }, "Conversation not found or not accessible");
      return reply.status(404).send({ error: "Conversation not found" });
    }

    // Safely extract contact phone (required field, use empty string if missing)
    const contactPhone = conversation.contact?.phone || "";
    const cleanPhone = contactPhone.replace(/^whatsapp:/i, "") || "";
    
    // Look up candidate for participantDisplayName (only if we have a phone)
    let participantDisplayName: string = "Unknown Contact";
    if (cleanPhone) {
      // Build OR conditions for candidate lookup
      const phoneConditions = [];
      if (contactPhone) {
        phoneConditions.push({ phone: contactPhone });
      }
      if (cleanPhone && cleanPhone !== contactPhone) {
        phoneConditions.push({ phone: cleanPhone });
      }
      
      if (phoneConditions.length > 0) {
        try {
    const candidate = await prisma.candidate.findFirst({
      where: {
              agencyId: conversation.contact?.agencyId || agencyId,
              OR: phoneConditions,
      },
      select: {
        name: true,
        desiredRole: true,
      },
    });

    // Build display name: "Name - Trade" or phone fallback
    if (candidate?.name) {
      if (candidate.desiredRole) {
        participantDisplayName = `${candidate.name} - ${candidate.desiredRole}`;
      } else {
        participantDisplayName = candidate.name;
      }
    } else {
      // Fallback to formatted phone (remove whatsapp: prefix)
      participantDisplayName = cleanPhone;
    }
        } catch (candidateError) {
          // If candidate lookup fails, use phone as fallback
          logger.warn({ error: candidateError, conversationId }, "Failed to lookup candidate, using phone as display name");
          participantDisplayName = cleanPhone;
        }
      } else {
        participantDisplayName = cleanPhone;
      }
    }

    // Build DTO with all required fields matching shared/dto/operator.ts
    const dto: ConversationDTO = {
      conversationId: conversation.id,
      participantPhone: cleanPhone, // Required: string (not null), cleaned phone without whatsapp: prefix
      participantDisplayName, // Required: string
      updatedAt: conversation.lastMessageAt.toISOString(), // Required: ISO string
      state: (conversation.state as any) || "ACTIVE",
      pausedReason: conversation.pausedReason || null,
      messages: (conversation.messages || []).map(toMessageDTO),
      // Optional fields
      progressStage: conversation.progressStage || undefined,
      progressUpdatedAt: conversation.progressUpdatedAt?.toISOString() || undefined,
      progressData: (conversation.progressData as any) || undefined,
      memoryPack: (conversation.memoryPack as any) || undefined,
      memoryUpdatedAt: conversation.memoryUpdatedAt?.toISOString() || undefined,
    };

    logger.info({ conversationId, messageCount: dto.messages.length }, "Retrieved conversation");

    return reply.status(200).send(dto);
  } catch (error) {
    // TEMP logging as requested
    logger.error({ 
      error, 
      conversationId, 
      errorStack: error instanceof Error ? error.stack : String(error),
      errorMessage: error instanceof Error ? error.message : String(error)
    }, "[TEMP] getConversationHandler - caught error with full stack");

    // Handle NotFoundError (conversation not found) with 404
    if (error instanceof NotFoundError) {
      return reply.status(404).send({ error: error.message });
    }
    
    // Log and return 500 for unexpected errors
    logger.error({ error, conversationId }, "Failed to get conversation");
    return reply.status(500).send({ error: "Failed to get conversation" });
  }
}

/**
 * GET /api/conversations/:conversationId/pending-approval
 * Get the newest pending approval task for a conversation
 */
export async function getPendingApprovalHandler(
  request: FastifyRequest<{
    Params: { conversationId: string };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const { conversationId } = request.params;
  const operatorId = (request as any).operatorId;

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    // Verify conversation exists and belongs to agency (use findFirst for tenant scoping)
    const conversation = await prisma.conversation.findFirst({
      where: scopeWhere(agencyId, { id: conversationId }),
      select: { agencyId: true },
    });

    notFoundIfNull(conversation, "Conversation not found");

    // Find newest pending approval task
    // Try payload.conversationId first (preferred), then fallback to relatedMessage.conversationId
    // For PostgreSQL JSON queries, we need to use Prisma's JSON filtering
    const tasks = await prisma.task.findMany({
      where: {
        agencyId,
        type: TaskType.APPROVAL_REQUIRED,
        approvalStatus: TaskApprovalStatus.PENDING,
        status: TaskStatus.OPEN,
        OR: [
          {
            // Preferred: check payload.conversationId using JSON path
            // PostgreSQL JSONB path query: payload->>'conversationId'
            payload: {
              path: ["conversationId"],
              equals: conversationId,
            } as any,
          },
          {
            // Fallback: check relatedMessage.conversationId
            relatedMessage: {
              conversationId,
            },
          },
        ],
      },
      include: {
        relatedMessage: {
          select: {
            id: true,
            text: true,
            createdAt: true,
            conversationId: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 10, // Fetch more to filter by payload in memory if needed
    });

    // Filter by payload.conversationId if Prisma JSON query didn't work
    // and sort by createdAt to get newest
    // Defensive: handle cases where payload might not have conversationId
    const filteredTasks = tasks
      .filter((task) => {
        const payload = task.payload as any;
        const payloadConversationId = payload?.conversationId;
        const messageConversationId = task.relatedMessage?.conversationId;
        return payloadConversationId === conversationId || messageConversationId === conversationId;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    if (filteredTasks.length === 0) {
      return reply.status(200).send({ task: null });
    }

    const task = filteredTasks[0];

    // Build relatedMessage DTO if present
    const relatedMessage = task.relatedMessage
      ? {
          id: task.relatedMessage.id,
          text: task.relatedMessage.text,
          createdAt: task.relatedMessage.createdAt.toISOString(),
          conversationId: task.relatedMessage.conversationId,
        }
      : null;

    // Return DTO wrapped in { task: ... }
    return reply.status(200).send({
      task: {
        id: task.id,
        type: task.type,
        status: task.status,
        approvalStatus: task.approvalStatus,
        proposedAction: task.proposedAction,
        payload: task.payload,
        relatedMessageId: task.relatedMessageId,
        relatedMessage,
        candidateId: task.candidateId,
        createdAt: task.createdAt.toISOString(),
      },
    });
  } catch (error) {
    // Handle NotFoundError (conversation not found) with 404
    if (error instanceof NotFoundError) {
      return reply.status(404).send({ error: error.message });
    }
    
    // Log the real error with full details
    logger.error(
      { 
        error: serializeError(error), 
        conversationId,
        operatorId 
      }, 
      "Failed to get pending approval"
    );
    
    // Return 500 for unexpected errors
    return reply.status(500).send({ error: "Failed to get pending approval" });
  }
}

/**
 * GET /api/conversations/:conversationId/timeline?limit=25&cursor=...
 * Get timeline events for a conversation with pagination
 */
export async function getConversationTimelineHandler(
  request: FastifyRequest<{
    Params: { conversationId: string };
    Querystring: { limit?: string; cursor?: string };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const { conversationId } = request.params;
  const limitParam = request.query.limit;
  const cursor = request.query.cursor || null;

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    // Validate limit (max 100)
    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : 25;
    if (limit < 1) {
      return reply.status(400).send({ error: "Limit must be at least 1" });
    }

    // Verify conversation exists and belongs to agency (use findFirst for tenant scoping)
    const conversation = await prisma.conversation.findFirst({
      where: scopeWhere(agencyId, { id: conversationId }),
      select: { id: true, agencyId: true },
    });

    // Return 404 if conversation not found or not in tenant scope
    if (!conversation) {
      logger.info({ conversationId, agencyId }, "Conversation not found or not accessible for timeline");
      return reply.status(404).send({ error: "Conversation not found" });
    }

    // Fetch timeline events (will return empty array if no events exist)
    const result = await getConversationTimeline(agencyId, conversationId, cursor, limit);

    logger.info(
      {
        conversationId,
        eventCount: result.events.length,
        hasMore: result.hasMore,
        hasNextCursor: !!result.nextCursor,
      },
      "Fetched conversation timeline"
    );

    // Always return 200 with items array (empty if no events)
    return reply.status(200).send({
      items: result.events,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    // Handle NotFoundError specifically (shouldn't happen here since we check above, but defensive)
    if (error instanceof NotFoundError) {
      return reply.status(404).send({ error: error.message });
    }
    
    // Log and return 500 for unexpected errors
    logger.error({ error, conversationId }, "Failed to fetch conversation timeline");
    return reply.status(500).send({ error: "Failed to fetch conversation timeline" });
  }
}

/**
 * GET /api/conversations?limit=50
 * List conversations (lightweight)
 */
export async function listConversationsHandler(
  request: FastifyRequest<{
    Querystring: { limit?: string };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const limit = Math.min(parseInt(request.query.limit || "50", 10), 100);

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    // Conversations must be keyed ONLY by HUMAN contact
    // Filter to only show conversations with HUMAN messages
    const conversations = await prisma.conversation.findMany({
      where: scopeWhere(agencyId, {
        messages: {
          some: {
            senderRole: MessageSenderRole.HUMAN, // Only conversations with HUMAN messages
          },
        },
      }),
      include: {
        contact: true,
        messages: {
          where: {
            senderRole: MessageSenderRole.HUMAN, // Only show HUMAN messages in snippet
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 1, // Get only the last HUMAN message for snippet
        },
      },
      orderBy: {
        lastMessageAt: "desc",
      },
      take: limit,
    });

    // Build phone -> candidate map for efficient lookup
    // Collect all unique phones (with and without whatsapp: prefix)
    const allPhones = new Set<string>();
    conversations.forEach((conv) => {
      const phone = conv.contact.phone;
      allPhones.add(phone);
      allPhones.add(phone.replace(/^whatsapp:/i, ""));
    });

    // Bulk fetch all candidates matching any of these phones (already scoped by agencyId)
    const candidates = await prisma.candidate.findMany({
      where: scopeWhere(agencyId, {
        phone: {
          in: Array.from(allPhones),
        },
      }),
      select: {
        phone: true,
        name: true,
        desiredRole: true,
      },
    });

    // Build phone -> candidate map (handle both with/without whatsapp: prefix)
    const candidateMap = new Map<string, { name: string | null; desiredRole: string | null }>();
    candidates.forEach((candidate) => {
      candidateMap.set(candidate.phone, { name: candidate.name, desiredRole: candidate.desiredRole });
      // Also map without whatsapp: prefix if it exists
      const cleanPhone = candidate.phone.replace(/^whatsapp:/i, "");
      if (cleanPhone !== candidate.phone) {
        candidateMap.set(cleanPhone, { name: candidate.name, desiredRole: candidate.desiredRole });
      }
    });

    // Build DTOs with participantDisplayName
    const dtos: ConversationListItemDTO[] = conversations.map((conv) => {
      const lastMessage = conv.messages[0];
      const lastMessageSnippet = lastMessage
        ? lastMessage.text.length > 100
          ? lastMessage.text.substring(0, 100) + "..."
          : lastMessage.text
        : null;

      // Look up candidate from map
      const contactPhone = conv.contact.phone;
      const cleanPhone = contactPhone.replace(/^whatsapp:/i, "");
      const candidate = candidateMap.get(contactPhone) || candidateMap.get(cleanPhone);

      // Build display name: "Name - Trade" or phone fallback
      let participantDisplayName: string;
      if (candidate?.name) {
        if (candidate.desiredRole) {
          participantDisplayName = `${candidate.name} - ${candidate.desiredRole}`;
        } else {
          participantDisplayName = candidate.name;
        }
      } else {
        // Fallback to formatted phone (remove whatsapp: prefix)
        participantDisplayName = cleanPhone;
      }

      // Extract progress and memory data
      const progressData = (conv as any).progressData as any;
      const memoryPack = (conv as any).memoryPack as any;
      
      // Get nextAction from progressData or memoryPack
      const nextAction = progressData?.nextAction || memoryPack?.nextAction || null;
      
      // Get followUpAt from progressData
      const followUpAt = progressData?.followUpAt || null;
      
      // Get memory summary
      const memorySummary = memoryPack?.summary || null;

      return {
        conversationId: conv.id,
        participantPhone: conv.contact.phone,
        participantDisplayName,
        updatedAt: conv.lastMessageAt,
        state: (conv as any).state || "ACTIVE",
        pausedReason: (conv as any).pausedReason || null,
        lastMessageSnippet,
        // Contact Progress (lightweight)
        progressStage: (conv as any).progressStage || undefined,
        nextAction: nextAction || undefined,
        followUpAt: followUpAt || undefined,
        memorySummary: memorySummary || undefined,
      };
    });

    logger.info(
      {
        count: dtos.length,
        limit,
      },
      "Listed conversations"
    );

    return reply.status(200).send(dtos);
  } catch (error) {
    logger.error({ error }, "Failed to list conversations");
    return reply.status(500).send({ error: "Failed to list conversations" });
  }
}

/**
 * GET /api/operator/messages
 * List messages (with optional filters)
 */
export async function listMessagesHandler(
  request: FastifyRequest<{
    Querystring: QueryParams & {
      conversationId?: string;
      direction?: string;
    };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const limit = Math.min(parseInt(request.query.limit || "50", 10), 100);
  const offset = parseInt(request.query.offset || "0", 10);
  const conversationId = request.query.conversationId;
  const direction = request.query.direction;

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    const where: any = {};
    if (conversationId) {
      where.conversationId = conversationId;
    }
    if (direction) {
      where.direction = direction;
    }

    const messages = await prisma.message.findMany({
      where: scopeWhere(agencyId, where),
      include: {
        relatedTasks: {
          take: 1, // Get first related task if exists
          select: {
            id: true,
            type: true,
            status: true,
          },
        },
        contact: {
          select: {
            id: true,
            phone: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit,
      skip: offset,
    });

    const dtos: MessageDTO[] = messages.map(toMessageDTO);

    logger.info(
      {
        count: dtos.length,
        limit,
        offset,
        conversationId,
        direction,
      },
      "Listed messages for operator"
    );

    return reply.status(200).send({
      messages: dtos,
      pagination: {
        limit,
        offset,
        total: dtos.length,
      },
    });
  } catch (error) {
    logger.error({ error }, "Failed to list messages");
    return reply.status(500).send({ error: "Failed to list messages" });
  }
}

/**
 * Register operator routes
 * CRITICAL: requireAuth hook is added INSIDE this plugin scope
 * to ensure it has access to the same session context as the routes
 */
export async function operatorRoutes(fastify: FastifyInstance) {
  // Add auth middleware INSIDE this plugin scope
  fastify.addHook("onRequest", requireAuth);
  
  fastify.get("/tasks", listTasksHandler);
  fastify.get("/conversations/:conversationId", getConversationHandler);
  fastify.get("/messages", listMessagesHandler);
}

/**
 * Register inbox routes (separate from operator routes for different prefix)
 * CRITICAL: requireAuth hook is added INSIDE this plugin scope
 * to ensure it has access to the same session context as the routes
 */
export async function inboxRoutes(fastify: FastifyInstance) {
  // Add auth middleware INSIDE this plugin scope
  fastify.addHook("onRequest", requireAuth);
  
  fastify.get("/tasks", listTasksHandler);
  fastify.get("/conversations", listConversationsHandler);
  fastify.get("/conversations/:conversationId", getConversationHandler);
  fastify.get("/conversations/:conversationId/timeline", getConversationTimelineHandler);
  fastify.get("/conversations/:conversationId/pending-approval", { preHandler: [requireAuth] }, getPendingApprovalHandler);
}

