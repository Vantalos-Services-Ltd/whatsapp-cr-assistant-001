/**
 * Tests for review verdict endpoint
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { setReviewVerdictHandler } from '.ts';
import { prisma } from '.ts';
import { ReviewVerdict } from "@prisma/client";
import type { FastifyRequest, FastifyReply } from "fastify";

// Mock Prisma
vi.mock("../db/prisma.js", () => ({
  prisma: {
    agency: {
      findFirst: vi.fn(),
    },
    messageReviewSample: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    conversation: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock timeline service
vi.mock("../services/timelineService.js", () => ({
  createTimelineEvent: vi.fn(),
}));

// Mock transformers
vi.mock("../dto/transformers.js", () => ({
  toReviewSampleDTO: (sample: any) => ({
    id: sample.id,
    verdict: sample.verdict,
    reviewedAt: sample.reviewedAt?.toISOString() || null,
    reviewedByOperatorId: sample.reviewedByOperatorId,
    notes: sample.notes,
  }),
}));

describe("setReviewVerdictHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockRequest = {
    params: { id: "sample-1" },
    body: {
      verdict: ReviewVerdict.GOOD,
      notes: "Looks good",
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  } as unknown as FastifyRequest<{
    Params: { id: string };
    Body: { verdict: ReviewVerdict; notes?: string };
  }>;

  const mockReply = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn(),
  } as unknown as FastifyReply;

  it("should update sample and set reviewedAt", async () => {
    const agencyId = "agency-1";
    const operatorId = "operator-1";
    const sampleId = "sample-1";

    const existingSample = {
      id: sampleId,
      agencyId,
      taskId: "task-1",
      conversationId: "conv-1",
      verdict: null,
      reviewedAt: null,
      reviewedByOperatorId: null,
      notes: null,
    };

    vi.mocked(prisma.agency.findFirst).mockResolvedValue({
      id: agencyId,
    } as any);

    vi.mocked(prisma.messageReviewSample.findUnique).mockResolvedValue(
      existingSample as any
    );

    const updatedSample = {
      ...existingSample,
      verdict: ReviewVerdict.GOOD,
      reviewedAt: new Date(),
      reviewedByOperatorId: operatorId,
      notes: "Looks good",
    };

    vi.mocked(prisma.messageReviewSample.update).mockResolvedValue(
      updatedSample as any
    );

    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({
      id: "conv-1",
      contactId: "contact-1",
    } as any);

    (mockRequest as any).operatorId = operatorId;

    await setReviewVerdictHandler(mockRequest, mockReply);

    expect(prisma.messageReviewSample.update).toHaveBeenCalledWith({
      where: { id: sampleId },
      data: {
        verdict: ReviewVerdict.GOOD,
        notes: "Looks good",
        reviewedAt: expect.any(Date),
        reviewedByOperatorId: operatorId,
      },
    });

    expect(mockReply.send).toHaveBeenCalled();
    const response = (mockReply.send as any).mock.calls[0][0];
    expect(response.verdict).toBe(ReviewVerdict.GOOD);
    expect(response.reviewedAt).toBeTruthy();
    expect(response.reviewedByOperatorId).toBe(operatorId);
  });

  it("should handle optional notes", async () => {
    const agencyId = "agency-1";
    const operatorId = "operator-1";
    const sampleId = "sample-1";

    const existingSample = {
      id: sampleId,
      agencyId,
      taskId: "task-1",
      conversationId: null,
      verdict: null,
      reviewedAt: null,
      reviewedByOperatorId: null,
      notes: null,
    };

    vi.mocked(prisma.agency.findFirst).mockResolvedValue({
      id: agencyId,
    } as any);

    vi.mocked(prisma.messageReviewSample.findUnique).mockResolvedValue(
      existingSample as any
    );

    const updatedSample = {
      ...existingSample,
      verdict: ReviewVerdict.NEEDS_IMPROVEMENT,
      reviewedAt: new Date(),
      reviewedByOperatorId: operatorId,
      notes: null,
    };

    vi.mocked(prisma.messageReviewSample.update).mockResolvedValue(
      updatedSample as any
    );

    (mockRequest as any).operatorId = operatorId;
    mockRequest.body = {
      verdict: ReviewVerdict.NEEDS_IMPROVEMENT,
    };

    await setReviewVerdictHandler(mockRequest, mockReply);

    expect(prisma.messageReviewSample.update).toHaveBeenCalledWith({
      where: { id: sampleId },
      data: {
        verdict: ReviewVerdict.NEEDS_IMPROVEMENT,
        notes: null,
        reviewedAt: expect.any(Date),
        reviewedByOperatorId: operatorId,
      },
    });
  });
});

