/**
 * Tests for review sampling service
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createReviewSamplesForDay } from '.ts';
import { prisma } from '.ts';
import { TaskType, TaskStatus, TaskApprovalStatus, SampledReason } from "@prisma/client";

// Mock Prisma
vi.mock("../db/prisma.js", () => ({
  prisma: {
    task: {
      findMany: vi.fn(),
    },
    messageReviewSample: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe("reviewSamplingService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const agencyId = "agency-1";
  const dateRange = {
    start: new Date("2024-01-01T00:00:00Z"),
    end: new Date("2024-01-02T00:00:00Z"),
  };

  it("should create samples and dedupe on rerun", async () => {
    // Mock approved tasks
    const approvedTasks = [
      {
        id: "task-1",
        agencyId,
        type: TaskType.APPROVAL_REQUIRED,
        approvedAt: new Date("2024-01-01T10:00:00Z"),
        payload: {
          approvedMessageText: "Final message 1",
          proposedMessageText: "Proposed message 1",
          wasEdited: true,
          editMetrics: {
            charDiffRatio: 0.1,
            wordDiffCount: 2,
            wasShortened: false,
            wasExpanded: true,
          },
        },
        relatedMessage: {
          conversationId: "conv-1",
        },
        candidateId: "candidate-1",
      },
      {
        id: "task-2",
        agencyId,
        type: TaskType.APPROVAL_REQUIRED,
        approvedAt: new Date("2024-01-01T11:00:00Z"),
        payload: {
          approvedMessageText: "Final message 2",
          proposedMessageText: "Proposed message 2",
          wasEdited: false,
          editMetrics: {
            charDiffRatio: 0,
            wordDiffCount: 0,
            wasShortened: false,
            wasExpanded: false,
          },
        },
        relatedMessage: {
          conversationId: "conv-2",
        },
        candidateId: null,
      },
    ];

    vi.mocked(prisma.task.findMany).mockResolvedValue(approvedTasks as any);

    // First run: no existing samples
    vi.mocked(prisma.messageReviewSample.findUnique)
      .mockResolvedValueOnce(null) // task-1
      .mockResolvedValueOnce(null); // task-2

    const createdSamples = [
      {
        id: "sample-1",
        agencyId,
        taskId: "task-1",
        sampledReason: SampledReason.EDITED,
      },
      {
        id: "sample-2",
        agencyId,
        taskId: "task-2",
        sampledReason: SampledReason.RANDOM,
      },
    ];

    vi.mocked(prisma.messageReviewSample.create)
      .mockResolvedValueOnce(createdSamples[0] as any)
      .mockResolvedValueOnce(createdSamples[1] as any);

    const result1 = await createReviewSamplesForDay(agencyId, dateRange);

    expect(result1.totalCreated).toBe(2);
    expect(result1.editedCount).toBe(1);
    expect(result1.randomCount).toBe(1);
    expect(prisma.messageReviewSample.create).toHaveBeenCalledTimes(2);

    // Second run: samples already exist (dedupe)
    vi.clearAllMocks();
    vi.mocked(prisma.task.findMany).mockResolvedValue(approvedTasks as any);
    
    // The service checks for existing samples in the loop, so we need to mock it for each task
    vi.mocked(prisma.messageReviewSample.findUnique)
      .mockResolvedValueOnce(createdSamples[0] as any) // task-1 exists
      .mockResolvedValueOnce(createdSamples[1] as any); // task-2 exists

    const result2 = await createReviewSamplesForDay(agencyId, dateRange);

    // When samples exist, they are skipped in the categorization phase (before adding to buckets)
    // So they don't get added to editedTasks/randomTasks arrays, resulting in 0 created
    expect(result2.totalCreated).toBe(0);
    expect(result2.editedCount).toBe(0);
    expect(result2.randomCount).toBe(0);
    expect(prisma.messageReviewSample.create).not.toHaveBeenCalled();
  });

  it("should categorize tasks into correct buckets", async () => {
    const approvedTasks = [
      // Edited task
      {
        id: "task-edited",
        agencyId,
        type: TaskType.APPROVAL_REQUIRED,
        approvedAt: new Date("2024-01-01T10:00:00Z"),
        payload: {
          approvedMessageText: "Final",
          proposedMessageText: "Proposed",
          wasEdited: true,
          editMetrics: {},
        },
        relatedMessage: { conversationId: "conv-1" },
        candidateId: null,
      },
      // High-risk task
      {
        id: "task-high-risk",
        agencyId,
        type: TaskType.APPROVAL_REQUIRED,
        approvedAt: new Date("2024-01-01T11:00:00Z"),
        proposedAction: {
          riskLevel: "HIGH",
        },
        payload: {
          approvedMessageText: "Final",
          proposedMessageText: "Proposed",
          wasEdited: false,
          editMetrics: {},
        },
        relatedMessage: { conversationId: "conv-2" },
        candidateId: null,
      },
      // Random task
      {
        id: "task-random",
        agencyId,
        type: TaskType.APPROVAL_REQUIRED,
        approvedAt: new Date("2024-01-01T12:00:00Z"),
        payload: {
          approvedMessageText: "Final",
          proposedMessageText: "Proposed",
          wasEdited: false,
          editMetrics: {},
        },
        relatedMessage: { conversationId: "conv-3" },
        candidateId: null,
      },
    ];

    vi.mocked(prisma.task.findMany).mockResolvedValue(approvedTasks as any);
    vi.mocked(prisma.messageReviewSample.findUnique).mockResolvedValue(null);

    vi.mocked(prisma.messageReviewSample.create)
      .mockResolvedValueOnce({ id: "sample-1" } as any)
      .mockResolvedValueOnce({ id: "sample-2" } as any)
      .mockResolvedValueOnce({ id: "sample-3" } as any);

    const result = await createReviewSamplesForDay(agencyId, dateRange);

    expect(result.editedCount).toBe(1);
    expect(result.highRiskCount).toBe(1);
    expect(result.randomCount).toBe(1);
    expect(result.totalCreated).toBe(3);

    // Verify sampled reasons
    const createCalls = vi.mocked(prisma.messageReviewSample.create).mock.calls;
    expect(createCalls[0][0].data.sampledReason).toBe(SampledReason.EDITED);
    expect(createCalls[1][0].data.sampledReason).toBe(SampledReason.HIGH_RISK);
    expect(createCalls[2][0].data.sampledReason).toBe(SampledReason.RANDOM);
  });

  it("should handle unique constraint violations gracefully", async () => {
    const approvedTasks = [
      {
        id: "task-1",
        agencyId,
        type: TaskType.APPROVAL_REQUIRED,
        approvedAt: new Date("2024-01-01T10:00:00Z"),
        payload: {
          approvedMessageText: "Final",
          proposedMessageText: "Proposed",
          wasEdited: true,
          editMetrics: {},
        },
        relatedMessage: { conversationId: "conv-1" },
        candidateId: null,
      },
    ];

    vi.mocked(prisma.task.findMany).mockResolvedValue(approvedTasks as any);
    vi.mocked(prisma.messageReviewSample.findUnique).mockResolvedValue(null);

    // Simulate unique constraint violation (P2002)
    const uniqueError = new Error("Unique constraint violation");
    (uniqueError as any).code = "P2002";
    vi.mocked(prisma.messageReviewSample.create).mockRejectedValue(uniqueError);

    const result = await createReviewSamplesForDay(agencyId, dateRange);

    expect(result.totalCreated).toBe(0);
    expect(result.totalSkipped).toBe(1);
  });
});

