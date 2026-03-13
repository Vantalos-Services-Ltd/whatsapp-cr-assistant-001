/**
 * Contacts API routes
 * Returns unique contacts derived from messages
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db/prisma.ts";
import { TaskType, TaskStatus, TaskApprovalStatus } from "@prisma/client";

interface ContactsQueryParams {
  limit?: string;
  offset?: string;
}

/**
 * Contact DTO for operator UI
 * Matches shared/dto/operator.ts ContactDTO
 */
interface ContactDTO {
  id: string;
  phone: string;
  name: string | null;
  candidateName?: string | null;
  desiredRole?: string | null;
  lastSeenAt?: string | null;
  lastConversationId?: string | null;
  lastMessageSnippet?: string | null;
  conversationState?: string | null;
  hasPendingApproval?: boolean;
  // Contact Progress (lightweight)
  progressStage?: string;
  progressUpdatedAt?: string; // ISO date string
  memorySummary?: string | null; // From memoryPack.summary
  followUpAt?: string | null; // ISO date string from progressData.followUpAt
  waitingForOperator?: boolean; // From progressData.flags.waitingForOperator
}

/**
 * GET /api/contacts
 * List all contacts with message statistics
 */
export async function listContactsHandler(
  request: FastifyRequest<{
    Querystring: ContactsQueryParams;
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const limit = Math.min(parseInt(request.query.limit || "50", 10), 100);
  const offset = parseInt(request.query.offset || "0", 10);

  try {
    // Get default agency
    const agency = await prisma.agency.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    if (!agency) {
      return reply.status(200).send({
        contacts: [],
      });
    }

    // Get contacts with conversations
    const contacts = await prisma.contact.findMany({
      where: {
        agencyId: agency.id,
      },
      select: {
        id: true,
        phone: true,
        name: true,
        createdAt: true,
        messages: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
          select: {
            createdAt: true,
          },
        },
        conversations: {
          orderBy: {
            lastMessageAt: "desc",
          },
          take: 1,
          select: {
            id: true,
            state: true,
            lastMessageAt: true,
            progressStage: true,
            progressUpdatedAt: true,
            progressData: true,
            memoryPack: true,
            messages: {
              orderBy: {
                createdAt: "desc",
              },
              take: 1,
              select: {
                text: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit,
      skip: offset,
    });

    // Build phone -> candidate map for efficient lookup (defensive)
    const allPhones = new Set<string>();
    contacts.forEach((contact) => {
      if (contact.phone) {
        allPhones.add(contact.phone);
        // Also add without whatsapp: prefix if it exists
        const cleanPhone = contact.phone.replace(/^whatsapp:/i, "");
        if (cleanPhone !== contact.phone) {
          allPhones.add(cleanPhone);
        }
      }
    });

    // Try to fetch candidates, but don't fail if it errors
    let candidateMap = new Map<string, { name: string | null; desiredRole: string | null }>();
    try {
      if (allPhones.size > 0) {
        const candidates = await prisma.candidate.findMany({
          where: {
            agencyId: agency.id,
            phone: {
              in: Array.from(allPhones),
            },
          },
          select: {
            phone: true,
            name: true,
            desiredRole: true,
          },
        });

        // Build phone -> candidate map (handle both with/without whatsapp: prefix)
        candidates.forEach((candidate) => {
          if (candidate.phone) {
            candidateMap.set(candidate.phone, {
              name: candidate.name || null,
              desiredRole: candidate.desiredRole || null,
            });
            // Also map without whatsapp: prefix if it exists
            const cleanPhone = candidate.phone.replace(/^whatsapp:/i, "");
            if (cleanPhone !== candidate.phone) {
              candidateMap.set(cleanPhone, {
                name: candidate.name || null,
                desiredRole: candidate.desiredRole || null,
              });
            }
          }
        });
      }
    } catch (candidateErr) {
      // Log but don't fail - continue without candidate data
      logger.warn({ err: candidateErr }, "Failed to fetch candidates for contacts, continuing without candidate data");
    }

    // Get all conversation IDs to check for pending approval tasks
    const conversationIds = new Set<string>();
    contacts.forEach((contact) => {
      contact.conversations.forEach((conv) => {
        conversationIds.add(conv.id);
      });
    });

    // Fetch pending approval tasks for these conversations
    let pendingApprovalConversationIds = new Set<string>();
    try {
      if (conversationIds.size > 0) {
        // Fetch all pending approval tasks and filter in memory
        // (Prisma JSON path queries are limited, so we fetch and filter)
        const pendingTasks = await prisma.task.findMany({
          where: {
            agencyId: agency.id,
            type: TaskType.APPROVAL_REQUIRED,
            approvalStatus: TaskApprovalStatus.PENDING,
            status: TaskStatus.OPEN,
            OR: [
              {
                // Check relatedMessage.conversationId (this works with Prisma)
                relatedMessage: {
                  conversationId: {
                    in: Array.from(conversationIds),
                  },
                },
              },
            ],
          },
          select: {
            id: true,
            payload: true,
            relatedMessage: {
              select: {
                conversationId: true,
              },
            },
          },
          take: 1000, // Reasonable limit
        });

        // Extract conversation IDs from tasks (check both payload and relatedMessage)
        pendingTasks.forEach((task) => {
          const payload = task.payload as any;
          const payloadConversationId = payload?.conversationId;
          const messageConversationId = task.relatedMessage?.conversationId;
          
          // Check payload.conversationId (filtered in memory since Prisma JSON queries are limited)
          if (payloadConversationId && conversationIds.has(payloadConversationId)) {
            pendingApprovalConversationIds.add(payloadConversationId);
          }
          // Check relatedMessage.conversationId
          if (messageConversationId && conversationIds.has(messageConversationId)) {
            pendingApprovalConversationIds.add(messageConversationId);
          }
        });
      }
    } catch (taskErr) {
      // Log but don't fail - continue without task data
      logger.warn({ err: taskErr }, "Failed to fetch pending approval tasks, continuing without task data");
    }

    // Map contacts to DTOs (defensive)
    const dtos: ContactDTO[] = contacts.map((contact) => {
      // Safely get last message time
      const lastMessage = contact.messages?.[0];
      const lastSeenAt = lastMessage?.createdAt ? lastMessage.createdAt.toISOString() : null;

      // Get last conversation data
      const lastConversation = contact.conversations?.[0];
      const lastConversationId = lastConversation?.id || null;
      const conversationState = lastConversation?.state || null;
      
      // Get last message snippet (truncate to 100 chars)
      let lastMessageSnippet: string | null = null;
      if (lastConversation?.messages?.[0]?.text) {
        const text = lastConversation.messages[0].text;
        lastMessageSnippet = text.length > 100 ? text.substring(0, 100) + "..." : text;
      }
      
      // Check if has pending approval
      const hasPendingApproval = lastConversationId 
        ? pendingApprovalConversationIds.has(lastConversationId)
        : false;
      
      // Extract progress and memory data
      const progressData = lastConversation?.progressData as any;
      const memoryPack = lastConversation?.memoryPack as any;
      const progressStage = lastConversation?.progressStage || undefined;
      const progressUpdatedAt = lastConversation?.progressUpdatedAt?.toISOString() || undefined;
      const memorySummary = memoryPack?.summary || undefined;
      const followUpAt = progressData?.followUpAt || undefined;
      const waitingForOperator = progressData?.flags?.waitingForOperator || false;

      // Look up candidate from map (defensive)
      let candidateName: string | null = null;
      let desiredRole: string | null = null;

      if (contact.phone) {
        const contactPhone = contact.phone;
        const cleanPhone = contactPhone.replace(/^whatsapp:/i, "");
        const candidate = candidateMap.get(contactPhone) || candidateMap.get(cleanPhone);
        if (candidate) {
          candidateName = candidate.name;
          desiredRole = candidate.desiredRole;
        }
      }

      return {
        id: contact.id,
        phone: contact.phone || "",
        name: contact.name || null,
        candidateName: candidateName || undefined,
        desiredRole: desiredRole || undefined,
        lastSeenAt: lastSeenAt || undefined,
        lastConversationId: lastConversationId || undefined,
        lastMessageSnippet: lastMessageSnippet || undefined,
        conversationState: conversationState || undefined,
        hasPendingApproval: hasPendingApproval || undefined,
        // Contact Progress (lightweight)
        progressStage: progressStage || undefined,
        progressUpdatedAt: progressUpdatedAt || undefined,
        memorySummary: memorySummary || undefined,
        followUpAt: followUpAt || undefined,
        waitingForOperator: waitingForOperator || undefined,
      };
    });

    logger.info(
      {
        count: dtos.length,
        limit,
        offset,
      },
      "Listed contacts"
    );

    return reply.status(200).send({
      contacts: dtos,
    });
  } catch (err) {
    logger.error({ err }, "Failed to list contacts");
    return reply.status(500).send({ error: "Failed to list contacts" });
  }
}

/**
 * Register contacts routes
 */
export async function contactsRoutes(fastify: FastifyInstance) {
  fastify.get("/", listContactsHandler);
}

