/**
 * Tests for agency scoping in operator routes
 * Minimal tests to prove scoping exists
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FastifyRequest, FastifyReply } from "fastify";
import { listTasksHandler, getConversationHandler } from '.ts';
import { requireAgencyId } from '.ts';
import { scopeWhere } from '.ts';

// Mock dependencies
vi.mock("../utils/agencyContext.js", () => ({
  requireAgencyId: vi.fn(),
}));

vi.mock("../db/tenantScope.js", () => ({
  scopeWhere: vi.fn((agencyId, where) => ({ ...where, agencyId })),
}));

vi.mock("../db/prisma.js", () => {
  const mockFindMany = vi.fn();
  const mockFindFirst = vi.fn();
  const mockCandidateFindFirst = vi.fn();
  return {
    prisma: {
      task: {
        findMany: mockFindMany,
      },
      conversation: {
        findFirst: mockFindFirst,
      },
      candidate: {
        findMany: vi.fn(),
        findFirst: mockCandidateFindFirst,
      },
    },
  };
});

vi.mock("../dto/transformers.js", () => ({
  toTaskListItemDTO: vi.fn((task) => ({ id: task.id, type: task.type })),
}));

vi.mock("../services/taskPriority.js", () => ({
  estimateTaskPriority: vi.fn(() => ({ priorityScore: 0, priorityLabel: "LOW" })),
}));

// Import after mocks
import { prisma } from '.ts';

describe("Operator routes - Agency scoping", () => {
  let mockRequest: Partial<FastifyRequest>;
  let mockReply: Partial<FastifyReply>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRequest = {
      query: { bucket: "pending", limit: "10" },
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as any,
    };

    mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    } as any;

    // Default mock: return agencyId
    (requireAgencyId as any).mockResolvedValue("agency-1");
  });

  describe("listTasksHandler", () => {
    it("should include agencyId in where clause when listing tasks", async () => {
      (prisma.task.findMany as any).mockResolvedValue([]);

      await listTasksHandler(
        mockRequest as FastifyRequest,
        mockReply as FastifyReply
      );

      // Verify requireAgencyId was called
      expect(requireAgencyId).toHaveBeenCalledWith(mockRequest);

      // Verify scopeWhere was called with agencyId
      expect(scopeWhere).toHaveBeenCalledWith("agency-1", expect.any(Object));

      // Verify findMany was called with scoped where clause
      expect(prisma.task.findMany).toHaveBeenCalled();
      const callArgs = (prisma.task.findMany as any).mock.calls[0][0];
      expect(callArgs.where).toHaveProperty("agencyId", "agency-1");
    });
  });

  describe("getConversationHandler", () => {
    it("should return 404 when conversation not found (agency mismatch)", async () => {
      const differentAgencyId = "agency-2";
      (requireAgencyId as any).mockResolvedValue(differentAgencyId);
      
      // Mock conversation not found (simulates agency mismatch)
      (prisma.conversation.findFirst as any).mockResolvedValue(null);
      (prisma.candidate.findFirst as any).mockResolvedValue(null);

      mockRequest.params = { conversationId: "conv-1" } as any;

      await getConversationHandler(
        mockRequest as FastifyRequest<{ Params: { conversationId: string } }>,
        mockReply as FastifyReply
      );

      // Verify scopeWhere was called with correct agencyId
      expect(scopeWhere).toHaveBeenCalledWith(
        differentAgencyId,
        expect.objectContaining({ id: "conv-1" })
      );

      // Verify 404 was returned
      expect(mockReply.status).toHaveBeenCalledWith(404);
      expect(mockReply.send).toHaveBeenCalledWith({ error: "Not found" });
    });

    it("should return conversation when agencyId matches", async () => {
      const agencyId = "agency-1";
      (requireAgencyId as any).mockResolvedValue(agencyId);

      const mockConversation = {
        id: "conv-1",
        agencyId,
        contact: { phone: "+1234567890", name: "Test", agencyId },
        messages: [],
      };

      (prisma.conversation.findFirst as any).mockResolvedValue(mockConversation);
      (prisma.candidate.findFirst as any).mockResolvedValue(null);

      mockRequest.params = { conversationId: "conv-1" } as any;

      await getConversationHandler(
        mockRequest as FastifyRequest<{ Params: { conversationId: string } }>,
        mockReply as FastifyReply
      );

      // Verify scopeWhere was called with correct agencyId
      expect(scopeWhere).toHaveBeenCalledWith(
        agencyId,
        expect.objectContaining({ id: "conv-1" })
      );

      // Verify 200 was returned (not 404)
      expect(mockReply.status).toHaveBeenCalledWith(200);
    });
  });
});

