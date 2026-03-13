/**
 * Timeline Service
 * Single entry point for creating and retrieving timeline events
 */

import pino from "pino";
import { prisma } from "../db/prisma.ts";
import { toTimelineEventDTO } from "../dto/transformers.ts";
import type { TimelineEventDTO } from "../dto/operator.ts";
import type { TimelineEventType, TimelineActorRole, TimelineEventData } from "../../shared/types/timeline.ts";
import { TimelineEventType as PrismaTimelineEventType } from "@prisma/client";

const log = pino({ name: "timelineService" });

/**
 * Valid TimelineEventType values from Prisma enum
 * 
 * CRITICAL: This guard prevents PrismaClientValidationError from breaking message flow.
 * 
 * Why this guard exists:
 * - Prisma validates enum values at runtime, not compile time
 * - If an invalid enum value is passed, Prisma throws PrismaClientValidationError
 * - This error would crash workers and prevent message sending
 * - The guard validates enum values BEFORE calling Prisma, preventing crashes
 * - Invalid values are logged and skipped, allowing message flow to continue
 * 
 * This ensures timeline creation failures NEVER abort:
 * - Message sending
 * - Worker execution
 * - Task creation
 * - Any critical business logic
 */
const VALID_TIMELINE_EVENT_TYPES = new Set(Object.values(PrismaTimelineEventType));

/**
 * Validate that a timeline event type is valid for Prisma
 * Returns true if valid, false otherwise
 * 
 * This function is called BEFORE any Prisma operation to prevent validation errors.
 */
function isValidTimelineEventType(type: string): type is PrismaTimelineEventType {
  return VALID_TIMELINE_EVENT_TYPES.has(type as PrismaTimelineEventType);
}

const MAX_SUMMARY_LENGTH = 200;
const MAX_STRING_VALUE_LENGTH = 500;
const MAX_MESSAGE_SNIPPET_LENGTH = 100;

/**
 * Input for creating a timeline event
 */
export type CreateTimelineEventInput = {
  agencyId: string;
  conversationId: string;
  contactId: string;
  type: TimelineEventType;
  actorRole: TimelineActorRole;
  summary: string;
  actorOperatorId?: string | null;
  candidateId?: string | null;
  data?: TimelineEventData | null;
  dedupeKey?: string | null;
};

/**
 * Result of creating a timeline event
 */
export type CreateTimelineEventResult = {
  event: TimelineEventDTO;
  wasDuplicate: boolean;
};

/**
 * Sanitize data to remove secrets and truncate long values
 */
function sanitizeData(data: TimelineEventData | null | undefined): Record<string, unknown> | null {
  if (!data) {
    return null;
  }

  const sanitized: Record<string, unknown> = { ...data };

  // Remove sensitive fields
  const sensitiveFields = [
    "prompt",
    "systemPrompt",
    "userPrompt",
    "openaiResponse",
    "apiKey",
    "token",
    "secret",
    "password",
    "passwordHash",
    "authToken",
    "accessToken",
    "refreshToken",
  ];

  sensitiveFields.forEach((field) => {
    delete sanitized[field];
  });

  // Truncate message snippets
  if (typeof sanitized.messageSnippet === "string") {
    if (sanitized.messageSnippet.length > MAX_MESSAGE_SNIPPET_LENGTH) {
      sanitized.messageSnippet = sanitized.messageSnippet.substring(0, MAX_MESSAGE_SNIPPET_LENGTH) + "...";
    }
  }

  // Truncate all string values to safe limit
  Object.keys(sanitized).forEach((key) => {
    const value = sanitized[key];
    if (typeof value === "string" && value.length > MAX_STRING_VALUE_LENGTH) {
      sanitized[key] = value.substring(0, MAX_STRING_VALUE_LENGTH) + "...";
    }
  });

  return sanitized;
}

/**
 * Trim and cap summary to max length
 */
function prepareSummary(summary: string): string {
  const trimmed = summary.trim();
  if (trimmed.length <= MAX_SUMMARY_LENGTH) {
    return trimmed;
  }
  // Cap at 197 chars + "..." = 200 total
  return trimmed.substring(0, MAX_SUMMARY_LENGTH - 3) + "...";
}

/**
 * Create a single timeline event with idempotency support
 * 
 * CRITICAL: This function NEVER throws - all errors are caught and logged.
 * Timeline creation failures must never abort message sending or worker execution.
 * 
 * Defensive enum guard: Validates type against Prisma enum before attempting creation.
 * If type is invalid, logs warning and returns a safe fallback result.
 */
export async function createTimelineEvent(
  input: CreateTimelineEventInput
): Promise<CreateTimelineEventResult> {
  const { dedupeKey, agencyId } = input;

  // DEFENSIVE ENUM GUARD: Validate type before Prisma call
  // This prevents PrismaClientValidationError from breaking message flow
  if (!isValidTimelineEventType(input.type)) {
    log.warn(
      {
        invalidType: input.type,
        validTypes: Array.from(VALID_TIMELINE_EVENT_TYPES),
        conversationId: input.conversationId,
        agencyId,
      },
      "Invalid TimelineEventType - skipping timeline creation (non-blocking)"
    );
    // Return a safe fallback result - never throw
    // Callers should handle this gracefully
    return {
      event: {
        id: "",
        type: input.type as any,
        actorRole: input.actorRole,
        summary: input.summary,
        data: input.data || null,
        createdAt: new Date().toISOString(),
        operator: null,
      } as TimelineEventDTO,
      wasDuplicate: false,
    };
  }

  // If dedupeKey is provided, check for existing event first
  if (dedupeKey) {
    try {
      const existing = await prisma.timelineEvent.findFirst({
        where: {
          agencyId,
          dedupeKey,
        },
        include: {
          operator: true,
        },
      });

      if (existing) {
        log.debug({ eventId: existing.id, dedupeKey }, "Timeline event already exists (dedupe)");
        return {
          event: toTimelineEventDTO(existing),
          wasDuplicate: true,
        };
      }
    } catch (error) {
      // Non-blocking: log error but continue with creation attempt
      log.warn({ error, dedupeKey }, "Failed to check for existing timeline event (non-blocking)");
    }
  }

  // Prepare data
  const summary = prepareSummary(input.summary);
  const sanitizedData = sanitizeData(input.data);

  try {
    const created = await prisma.timelineEvent.create({
      data: {
        agencyId: input.agencyId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        candidateId: input.candidateId || null,
        type: input.type as PrismaTimelineEventType, // Type assertion safe after enum guard
        actorRole: input.actorRole,
        actorOperatorId: input.actorOperatorId || null,
        summary,
        data: sanitizedData,
        dedupeKey: dedupeKey || null,
      },
      include: {
        operator: true,
      },
    });

    log.debug({ eventId: created.id, type: created.type }, "Timeline event created");
    return {
      event: toTimelineEventDTO(created),
      wasDuplicate: false,
    };
  } catch (error: any) {
    // Handle unique constraint violation (race condition)
    if (error?.code === "P2002" && dedupeKey) {
      try {
        log.debug({ dedupeKey }, "Unique constraint violation, fetching existing event");
        const existing = await prisma.timelineEvent.findFirst({
          where: {
            agencyId,
            dedupeKey,
          },
          include: {
            operator: true,
          },
        });

        if (existing) {
          return {
            event: toTimelineEventDTO(existing),
            wasDuplicate: true,
          };
        }
      } catch (fetchError) {
        // Non-blocking: log but continue
        log.warn({ error: fetchError, dedupeKey }, "Failed to fetch existing event after unique violation (non-blocking)");
      }
    }

    // CRITICAL: Never throw - log error and return safe fallback
    // Timeline creation failures must never abort message sending or worker execution
    log.error(
      {
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
          code: (error as any).code,
        } : error,
        input: {
          type: input.type,
          conversationId: input.conversationId,
          agencyId,
          summary: input.summary.substring(0, 100), // Truncate for logging
        },
      },
      "Failed to create timeline event - returning safe fallback (non-blocking)"
    );
    
    // Return safe fallback - never throw
    return {
      event: {
        id: "",
        type: input.type as any,
        actorRole: input.actorRole,
        summary: input.summary,
        data: input.data || null,
        createdAt: new Date().toISOString(),
        operator: null,
      } as TimelineEventDTO,
      wasDuplicate: false,
    };
  }
}

/**
 * Create multiple timeline events in batch
 * Handles dedupeKey events individually, uses createMany for others
 */
export async function createTimelineEventsBatch(
  inputs: CreateTimelineEventInput[]
): Promise<CreateTimelineEventResult[]> {
  if (inputs.length === 0) {
    return [];
  }

  // Separate events with and without dedupeKey
  const eventsWithDedupe: CreateTimelineEventInput[] = [];
  const eventsWithoutDedupe: CreateTimelineEventInput[] = [];

  for (const input of inputs) {
    if (input.dedupeKey) {
      eventsWithDedupe.push(input);
    } else {
      eventsWithoutDedupe.push(input);
    }
  }

  const results: CreateTimelineEventResult[] = [];

  // Handle events with dedupeKey individually (they need idempotency checks)
  for (const input of eventsWithDedupe) {
    try {
      const result = await createTimelineEvent(input);
      results.push(result);
    } catch (error) {
      log.error({ error, input }, "Failed to create timeline event with dedupeKey, skipping");
      // Continue with other events - don't crash the whole batch
    }
  }

  // Handle events without dedupeKey in batch using createMany
  if (eventsWithoutDedupe.length > 0) {
    try {
      const dataToCreate = eventsWithoutDedupe.map((input) => ({
        agencyId: input.agencyId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        candidateId: input.candidateId || null,
        type: input.type,
        actorRole: input.actorRole,
        actorOperatorId: input.actorOperatorId || null,
        summary: prepareSummary(input.summary),
        data: sanitizeData(input.data),
        dedupeKey: null,
      }));

      await prisma.timelineEvent.createMany({
        data: dataToCreate,
        skipDuplicates: true, // Skip if any unique constraint violations
      });

      // Fetch created events to return DTOs
      // Note: createMany doesn't return created records, so we fetch by conversationId and createdAt
      const createdEvents = await prisma.timelineEvent.findMany({
        where: {
          agencyId: eventsWithoutDedupe[0]!.agencyId,
          conversationId: {
            in: [...new Set(eventsWithoutDedupe.map((e) => e.conversationId))],
          },
          createdAt: {
            gte: new Date(Date.now() - 5000), // Events created in last 5 seconds
          },
        },
        include: {
          operator: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: eventsWithoutDedupe.length * 2, // Safety margin
      });

      // Match events to inputs (by conversationId, type, and approximate time)
      // This is imperfect but necessary since createMany doesn't return IDs
      for (const input of eventsWithoutDedupe) {
        const matched = createdEvents.find(
          (e) =>
            e.conversationId === input.conversationId &&
            e.type === input.type &&
            e.actorRole === input.actorRole &&
            Math.abs(e.createdAt.getTime() - Date.now()) < 5000
        );

        if (matched) {
          results.push({
            event: toTimelineEventDTO(matched),
            wasDuplicate: false,
          });
        } else {
          // If we can't match, create individually to get the result
          try {
            const result = await createTimelineEvent(input);
            results.push(result);
          } catch (error) {
            log.error({ error, input }, "Failed to create timeline event in batch fallback, skipping");
          }
        }
      }
    } catch (error) {
      log.error({ error }, "Batch create failed, falling back to individual creates");
      // Fallback to individual creates
      for (const input of eventsWithoutDedupe) {
        try {
          const result = await createTimelineEvent(input);
          results.push(result);
        } catch (err) {
          log.error({ error: err, input }, "Failed to create timeline event in batch fallback, skipping");
        }
      }
    }
  }

  return results;
}

/**
 * Cursor for pagination (base64url encoded JSON)
 */
type TimelineCursor = {
  createdAt: string; // ISO date string
  id: string;
};

/**
 * Get timeline events for a conversation with pagination
 */
export async function getConversationTimeline(
  agencyId: string,
  conversationId: string,
  cursor: string | null,
  limit: number = 25
): Promise<{
  events: TimelineEventDTO[];
  nextCursor: string | null;
  hasMore: boolean;
}> {
  // Decode cursor if provided
  let cursorData: TimelineCursor | null = null;
  if (cursor) {
    try {
      const decoded = Buffer.from(cursor, "base64url").toString("utf-8");
      cursorData = JSON.parse(decoded) as TimelineCursor;
    } catch (error) {
      log.warn({ cursor, error }, "Invalid cursor, ignoring");
    }
  }

  // Build where clause
  const where: any = {
    agencyId,
    conversationId,
  };

  // Add cursor-based pagination
  if (cursorData) {
    where.OR = [
      {
        createdAt: {
          lt: new Date(cursorData.createdAt),
        },
      },
      {
        createdAt: new Date(cursorData.createdAt),
        id: {
          lt: cursorData.id,
        },
      },
    ];
  }

  // Fetch limit + 1 to check if there are more
  const take = limit + 1;

  const events = await prisma.timelineEvent.findMany({
    where,
    include: {
      operator: true,
    },
    orderBy: [
      { createdAt: "desc" },
      { id: "desc" },
    ],
    take,
  });

  // Check if there are more events
  const hasMore = events.length > limit;
  const eventsToReturn = hasMore ? events.slice(0, limit) : events;

  // Generate next cursor
  let nextCursor: string | null = null;
  if (hasMore && eventsToReturn.length > 0) {
    const lastEvent = eventsToReturn[eventsToReturn.length - 1]!;
    const cursorPayload: TimelineCursor = {
      createdAt: lastEvent.createdAt.toISOString(),
      id: lastEvent.id,
    };
    nextCursor = Buffer.from(JSON.stringify(cursorPayload), "utf-8").toString("base64url");
  }

  return {
    events: eventsToReturn.map(toTimelineEventDTO),
    nextCursor,
    hasMore,
  };
}
