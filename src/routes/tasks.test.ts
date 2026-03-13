/**
 * Tests for task approval handler (governance payload fields)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { approveTaskHandler } from '.ts';
import { prisma } from '.ts';
import { TaskType, TaskStatus, TaskApprovalStatus } from "@prisma/client";
import type { FastifyRequest, FastifyReply } from "fastify";

// Mock Prisma
vi.mock("../db/prisma.js", () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    message: {
      findUnique: vi.fn(),
    },
    candidate: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock queues
vi.mock("../queues/approvedTasksQueue.js", () => ({
  enqueueApprovedTask: vi.fn(),
}));

// Mock timeline service
vi.mock("../services/timelineService.js", () => ({
  createTimelineEvent: vi.fn(),
}));

// Mock progress state machine
vi.mock("../services/progress/stateMachine.js", () => ({
  applyProgressStateMachine: vi.fn(),
}));

// Mock fallback generator
vi.mock("../services/fallbackReplyGenerator.js", () => ({
  getFallbackReplyForApproval: vi.fn(() => "Fallback message"),
}));

describe("approveTaskHandler - Governance Payload Fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockRequest = {
    params: { taskId: "task-1" },
    body: {},
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  } as unknown as FastifyRequest<{
    Params: { taskId: string };
    Body: { messageOverride?: string };
  }>;

  const mockReply = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
  } as unknown as FastifyReply;

  it("should write payload fields correctly when no edits (proposedText = approvedText, wasEdited false)", async () => {
    const proposedMessage = "Hello, how can I help you?";
    const task = {
      id: "task-1",
      agencyId: "agency-1",
      type: TaskType.APPROVAL_REQUIRED,
      status: TaskStatus.OPEN,
      approvalStatus: TaskApprovalStatus.PENDING,
      relatedMessageId: "msg-1",
      proposedAction: {
        suggestedMessage: proposedMessage,
      },
      payload: {
        pendingReplyText: proposedMessage,
      },
    };

    vi.mocked(prisma.task.findUnique).mockResolvedValue(task as any);
    (mockRequest as any).operatorId = "operator-1";

    const updatedTask = {
      ...task,
      approvalStatus: TaskApprovalStatus.APPROVED,
      approvedByOperatorId: "operator-1",
      approvedAt: new Date(),
      payload: {
        ...task.payload,
        proposedMessageText: proposedMessage,
        approvedMessageText: proposedMessage,
        wasEdited: false,
        editMetrics: {
          charDiffRatio: 0,
          wordDiffCount: 0,
          wasShortened: false,
          wasExpanded: false,
        },
        editSummary: "No changes",
        sentText: proposedMessage,
      },
    };

    vi.mocked(prisma.task.update).mockResolvedValue(updatedTask as any);
    vi.mocked(prisma.message.findUnique).mockResolvedValue(null);

    await approveTaskHandler(mockRequest, mockReply);

    expect(prisma.task.update).toHaveBeenCalled();
    const updateCall = vi.mocked(prisma.task.update).mock.calls[0][0];
    const payload = updateCall.data.payload as any;

    expect(payload.proposedMessageText).toBe(proposedMessage);
    expect(payload.approvedMessageText).toBe(proposedMessage);
    expect(payload.wasEdited).toBe(false);
    expect(payload.editMetrics.charDiffRatio).toBe(0);
    expect(payload.editMetrics.wordDiffCount).toBe(0);
    expect(payload.editSummary).toBe("No changes");
  });

  it("should write payload fields correctly when edited (wasEdited true, metrics non-zero)", async () => {
    const proposedMessage = "Hello, how can I help you today?";
    const editedMessage = "Hi there! What do you need?";
    const task = {
      id: "task-1",
      agencyId: "agency-1",
      type: TaskType.APPROVAL_REQUIRED,
      status: TaskStatus.OPEN,
      approvalStatus: TaskApprovalStatus.PENDING,
      relatedMessageId: "msg-1",
      proposedAction: {
        suggestedMessage: proposedMessage,
      },
      payload: {
        pendingReplyText: proposedMessage,
      },
    };

    vi.mocked(prisma.task.findUnique).mockResolvedValue(task as any);
    (mockRequest as any).operatorId = "operator-1";
    mockRequest.body = { messageOverride: editedMessage };

    const updatedTask = {
      ...task,
      approvalStatus: TaskApprovalStatus.APPROVED,
      approvedByOperatorId: "operator-1",
      approvedAt: new Date(),
      payload: {
        ...task.payload,
        proposedMessageText: proposedMessage,
        approvedMessageText: editedMessage,
        wasEdited: true,
        editMetrics: {
          charDiffRatio: expect.any(Number),
          wordDiffCount: expect.any(Number),
          wasShortened: expect.any(Boolean),
          wasExpanded: expect.any(Boolean),
        },
        editSummary: expect.any(String),
        sentText: editedMessage,
      },
    };

    vi.mocked(prisma.task.update).mockResolvedValue(updatedTask as any);
    vi.mocked(prisma.message.findUnique).mockResolvedValue(null);

    await approveTaskHandler(mockRequest, mockReply);

    expect(prisma.task.update).toHaveBeenCalled();
    const updateCall = vi.mocked(prisma.task.update).mock.calls[0][0];
    const payload = updateCall.data.payload as any;

    expect(payload.proposedMessageText).toBe(proposedMessage);
    expect(payload.approvedMessageText).toBe(editedMessage);
    expect(payload.wasEdited).toBe(true);
    expect(payload.editMetrics.charDiffRatio).toBeGreaterThan(0);
    expect(payload.editMetrics.wordDiffCount).toBeGreaterThan(0);
    expect(payload.editSummary).not.toBe("No changes");
  });

  it("should cap texts at 2000 characters", async () => {
    const longProposed = "A".repeat(3000);
    const longEdited = "B".repeat(3000);
    const task = {
      id: "task-1",
      agencyId: "agency-1",
      type: TaskType.APPROVAL_REQUIRED,
      status: TaskStatus.OPEN,
      approvalStatus: TaskApprovalStatus.PENDING,
      relatedMessageId: null,
      proposedAction: {
        suggestedMessage: longProposed,
      },
      payload: {},
    };

    vi.mocked(prisma.task.findUnique).mockResolvedValue(task as any);
    (mockRequest as any).operatorId = "operator-1";
    mockRequest.body = { messageOverride: longEdited };

    vi.mocked(prisma.task.update).mockResolvedValue(task as any);

    await approveTaskHandler(mockRequest, mockReply);

    const updateCall = vi.mocked(prisma.task.update).mock.calls[0][0];
    const payload = updateCall.data.payload as any;

    expect(payload.proposedMessageText.length).toBe(2000);
    expect(payload.approvedMessageText.length).toBe(2000);
  });
});

