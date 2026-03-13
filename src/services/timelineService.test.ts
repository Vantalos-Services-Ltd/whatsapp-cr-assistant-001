/**
 * Unit tests for timeline service
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createTimelineEvent,
  createTimelineEventsBatch,
  getConversationTimeline,
  type CreateTimelineEventInput,
} from '.ts';
import { prisma } from '.ts';

// Mock Prisma
vi.mock("../db/prisma.js", () => ({
  prisma: {
    timelineEvent: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

// Mock transformer
vi.mock("../dto/transformers.js", () => ({
  toTimelineEventDTO: (event: any) => ({
    eventId: event.id,
    type: event.type,
    actorRole: event.actorRole,
    actorName: event.actorRole === "OPERATOR" ? "operator@test.com" : event.actorRole === "SYSTEM" ? "System" : "AI",
    operatorId: event.actorOperatorId || null,
    summary: event.summary,
    data: event.data,
    createdAt: event.createdAt.toISOString(),
    conversationId: event.conversationId,
    contactId: event.contactId,
    candidateId: event.candidateId || null,
  }),
}));

describe("TimelineService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createTimelineEvent", () => {
    const baseInput: CreateTimelineEventInput = {
      agencyId: "agency-1",
      conversationId: "conv-1",
      contactId: "contact-1",
      type: "INBOUND_MESSAGE_RECEIVED",
      actorRole: "SYSTEM",
      summary: "Test summary",
    };

    it("should create a timeline event successfully", async () => {
      const mockEvent = {
        id: "event-1",
        ...baseInput,
        candidateId: null,
        actorOperatorId: null,
        data: null,
        dedupeKey: null,
        createdAt: new Date(),
        operator: null,
      };

      vi.mocked(prisma.timelineEvent.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.timelineEvent.create).mockResolvedValue(mockEvent as any);

      const result = await createTimelineEvent(baseInput);

      expect(result.wasDuplicate).toBe(false);
      expect(result.event.eventId).toBe("event-1");
      expect(prisma.timelineEvent.create).toHaveBeenCalledWith({
        data: {
          agencyId: baseInput.agencyId,
          conversationId: baseInput.conversationId,
          contactId: baseInput.contactId,
          candidateId: null,
          type: baseInput.type,
          actorRole: baseInput.actorRole,
          actorOperatorId: null,
          summary: "Test summary",
          data: null,
          dedupeKey: null,
        },
        include: {
          operator: true,
        },
      });
    });

    it("should return existing event when dedupeKey matches", async () => {
      const existingEvent = {
        id: "event-existing",
        ...baseInput,
        candidateId: null,
        actorOperatorId: null,
        data: null,
        dedupeKey: "dedupe-1",
        createdAt: new Date(),
        operator: null,
      };

      vi.mocked(prisma.timelineEvent.findFirst).mockResolvedValue(existingEvent as any);

      const result = await createTimelineEvent({
        ...baseInput,
        dedupeKey: "dedupe-1",
      });

      expect(result.wasDuplicate).toBe(true);
      expect(result.event.eventId).toBe("event-existing");
      expect(prisma.timelineEvent.create).not.toHaveBeenCalled();
    });

    it("should handle race condition when dedupeKey conflicts", async () => {
      const existingEvent = {
        id: "event-existing",
        ...baseInput,
        candidateId: null,
        actorOperatorId: null,
        data: null,
        dedupeKey: "dedupe-1",
        createdAt: new Date(),
        operator: null,
      };

      vi.mocked(prisma.timelineEvent.findFirst)
        .mockResolvedValueOnce(null) // First check
        .mockResolvedValueOnce(existingEvent as any); // After conflict

      vi.mocked(prisma.timelineEvent.create).mockRejectedValue({
        code: "P2002",
        message: "Unique constraint violation",
      });

      const result = await createTimelineEvent({
        ...baseInput,
        dedupeKey: "dedupe-1",
      });

      expect(result.wasDuplicate).toBe(true);
      expect(result.event.eventId).toBe("event-existing");
    });

    it("should trim and cap summary to 200 characters", async () => {
      const longSummary = "a".repeat(250);
      const mockEvent = {
        id: "event-1",
        ...baseInput,
        summary: longSummary.substring(0, 197) + "...",
        candidateId: null,
        actorOperatorId: null,
        data: null,
        dedupeKey: null,
        createdAt: new Date(),
        operator: null,
      };

      vi.mocked(prisma.timelineEvent.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.timelineEvent.create).mockResolvedValue(mockEvent as any);

      await createTimelineEvent({
        ...baseInput,
        summary: longSummary,
      });

      expect(prisma.timelineEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            summary: expect.stringMatching(/^.{197}\.\.\.$/),
          }),
        })
      );
    });

    it("should sanitize data to remove secrets", async () => {
      const mockEvent = {
        id: "event-1",
        ...baseInput,
        candidateId: null,
        actorOperatorId: null,
        data: { taskId: "task-1", apiKey: undefined },
        dedupeKey: null,
        createdAt: new Date(),
        operator: null,
      };

      vi.mocked(prisma.timelineEvent.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.timelineEvent.create).mockResolvedValue(mockEvent as any);

      await createTimelineEvent({
        ...baseInput,
        data: {
          taskId: "task-1",
          apiKey: "secret-key",
          prompt: "system prompt",
        },
      });

      const createCall = vi.mocked(prisma.timelineEvent.create).mock.calls[0]?.[0] as any;
      expect(createCall.data.data).not.toHaveProperty("apiKey");
      expect(createCall.data.data).not.toHaveProperty("prompt");
      expect(createCall.data.data).toHaveProperty("taskId", "task-1");
    });
  });

  describe("createTimelineEventsBatch", () => {
    const baseInput: CreateTimelineEventInput = {
      agencyId: "agency-1",
      conversationId: "conv-1",
      contactId: "contact-1",
      type: "INBOUND_MESSAGE_RECEIVED",
      actorRole: "SYSTEM",
      summary: "Test summary",
    };

    it("should create multiple events without dedupeKey in batch", async () => {
      const mockEvents = [
        {
          id: "event-1",
          ...baseInput,
          candidateId: null,
          actorOperatorId: null,
          data: null,
          dedupeKey: null,
          createdAt: new Date(),
          operator: null,
        },
        {
          id: "event-2",
          ...baseInput,
          conversationId: "conv-2",
          candidateId: null,
          actorOperatorId: null,
          data: null,
          dedupeKey: null,
          createdAt: new Date(),
          operator: null,
        },
      ];

      vi.mocked(prisma.timelineEvent.createMany).mockResolvedValue({ count: 2 } as any);
      vi.mocked(prisma.timelineEvent.findMany).mockResolvedValue(mockEvents as any);

      const results = await createTimelineEventsBatch([
        baseInput,
        { ...baseInput, conversationId: "conv-2" },
      ]);

      expect(results).toHaveLength(2);
      expect(prisma.timelineEvent.createMany).toHaveBeenCalled();
    });

    it("should handle events with dedupeKey individually", async () => {
      const existingEvent = {
        id: "event-existing",
        ...baseInput,
        dedupeKey: "dedupe-1",
        candidateId: null,
        actorOperatorId: null,
        data: null,
        createdAt: new Date(),
        operator: null,
      };

      vi.mocked(prisma.timelineEvent.findFirst).mockResolvedValue(existingEvent as any);

      const results = await createTimelineEventsBatch([
        { ...baseInput, dedupeKey: "dedupe-1" },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0]!.wasDuplicate).toBe(true);
      expect(prisma.timelineEvent.createMany).not.toHaveBeenCalled();
    });

    it("should not crash entire batch if one event fails", async () => {
      const mockEvent = {
        id: "event-1",
        ...baseInput,
        candidateId: null,
        actorOperatorId: null,
        data: null,
        dedupeKey: null,
        createdAt: new Date(),
        operator: null,
      };

      vi.mocked(prisma.timelineEvent.findFirst)
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error("Database error"));

      vi.mocked(prisma.timelineEvent.create)
        .mockResolvedValueOnce(mockEvent as any)
        .mockRejectedValueOnce(new Error("Database error"));

      const results = await createTimelineEventsBatch([
        { ...baseInput, dedupeKey: "dedupe-1" },
        { ...baseInput, dedupeKey: "dedupe-2" },
      ]);

      // Should have at least one successful result
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getConversationTimeline", () => {
    const mockEvents = [
      {
        id: "event-3",
        agencyId: "agency-1",
        conversationId: "conv-1",
        contactId: "contact-1",
        candidateId: null,
        type: "TASK_CREATED" as const,
        actorRole: "SYSTEM" as const,
        actorOperatorId: null,
        summary: "Event 3",
        data: null,
        dedupeKey: null,
        createdAt: new Date("2024-01-03T12:00:00Z"),
        operator: null,
      },
      {
        id: "event-2",
        agencyId: "agency-1",
        conversationId: "conv-1",
        contactId: "contact-1",
        candidateId: null,
        type: "TASK_APPROVED" as const,
        actorRole: "OPERATOR" as const,
        actorOperatorId: "op-1",
        summary: "Event 2",
        data: null,
        dedupeKey: null,
        createdAt: new Date("2024-01-02T12:00:00Z"),
        operator: { id: "op-1", email: "operator@test.com", passwordHash: "hash", createdAt: new Date() },
      },
      {
        id: "event-1",
        agencyId: "agency-1",
        conversationId: "conv-1",
        contactId: "contact-1",
        candidateId: null,
        type: "INBOUND_MESSAGE_RECEIVED" as const,
        actorRole: "SYSTEM" as const,
        actorOperatorId: null,
        summary: "Event 1",
        data: null,
        dedupeKey: null,
        createdAt: new Date("2024-01-01T12:00:00Z"),
        operator: null,
      },
    ];

    it("should return events in descending order by createdAt", async () => {
      vi.mocked(prisma.timelineEvent.findMany).mockResolvedValue(mockEvents as any);

      const result = await getConversationTimeline("agency-1", "conv-1", null, 25);

      expect(result.events).toHaveLength(3);
      expect(result.events[0]!.eventId).toBe("event-3");
      expect(result.events[1]!.eventId).toBe("event-2");
      expect(result.events[2]!.eventId).toBe("event-1");

      expect(prisma.timelineEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { createdAt: "desc" },
            { id: "desc" },
          ],
        })
      );
    });

    it("should respect limit parameter", async () => {
      vi.mocked(prisma.timelineEvent.findMany).mockResolvedValue(mockEvents.slice(0, 2) as any);

      const result = await getConversationTimeline("agency-1", "conv-1", null, 2);

      expect(result.events).toHaveLength(2);
      expect(prisma.timelineEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 3, // limit + 1 to check for more
        })
      );
    });

    it("should return nextCursor when hasMore is true", async () => {
      const eventsWithMore = [...mockEvents, {
        id: "event-4",
        agencyId: "agency-1",
        conversationId: "conv-1",
        contactId: "contact-1",
        candidateId: null,
        type: "TASK_REJECTED" as const,
        actorRole: "OPERATOR" as const,
        actorOperatorId: "op-1",
        summary: "Event 4",
        data: null,
        dedupeKey: null,
        createdAt: new Date("2024-01-04T12:00:00Z"),
        operator: null,
      }];

      vi.mocked(prisma.timelineEvent.findMany).mockResolvedValue(eventsWithMore as any);

      const result = await getConversationTimeline("agency-1", "conv-1", null, 2);

      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).not.toBeNull();
      expect(result.events).toHaveLength(2);
    });

    it("should use cursor for pagination", async () => {
      const cursor = Buffer.from(
        JSON.stringify({ createdAt: "2024-01-02T12:00:00.000Z", id: "event-2" })
      ).toString("base64url");

      vi.mocked(prisma.timelineEvent.findMany).mockResolvedValue([mockEvents[2]!] as any);

      await getConversationTimeline("agency-1", "conv-1", cursor, 25);

      expect(prisma.timelineEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                createdAt: expect.objectContaining({
                  lt: new Date("2024-01-02T12:00:00.000Z"),
                }),
              }),
            ]),
          }),
        })
      );
    });

    it("should return empty array when no events exist", async () => {
      vi.mocked(prisma.timelineEvent.findMany).mockResolvedValue([]);

      const result = await getConversationTimeline("agency-1", "conv-1", null, 25);

      expect(result.events).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
      expect(result.hasMore).toBe(false);
    });
  });
});

