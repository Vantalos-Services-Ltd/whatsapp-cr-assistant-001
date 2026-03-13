/**
 * Tests for agency context resolution
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FastifyRequest } from "fastify";

// Mock Prisma before importing the module under test
vi.mock("../db/prisma.js", () => {
  const mockFindFirst = vi.fn();
  return {
    prisma: {
      agency: {
        findFirst: mockFindFirst,
      },
    },
  };
});

// Import after mock
import { getAgencyIdFromRequest, requireAgencyId, getAgencyIdForWebhook } from '.ts';
import { prisma } from '.ts';

describe("agencyContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock implementation
    (prisma.agency.findFirst as any).mockReset();
  });

  describe("getAgencyIdFromRequest", () => {
    it("should return cached agencyId from request context", async () => {
      const mockRequest = {
        session: {},
      } as unknown as FastifyRequest;

      // Set cache
      (mockRequest as any).__agencyId__ = "cached-agency-id";

      const result = await getAgencyIdFromRequest(mockRequest);

      expect(result).toBe("cached-agency-id");
      expect(prisma.agency.findFirst).not.toHaveBeenCalled();
    });

    it("should use session agencyId if present", async () => {
      const mockRequest = {
        session: {
          agencyId: "session-agency-id",
        },
      } as unknown as FastifyRequest;

      const result = await getAgencyIdFromRequest(mockRequest);

      expect(result).toBe("session-agency-id");
      expect(prisma.agency.findFirst).not.toHaveBeenCalled();
      
      // Should be cached
      expect((mockRequest as any).__agencyId__).toBe("session-agency-id");
    });

    it("should fallback to first agency in DB when session has no agencyId", async () => {
      const mockRequest = {
        session: {},
      } as unknown as FastifyRequest;

      (prisma.agency.findFirst as any).mockResolvedValue({
        id: "first-agency-id",
      });

      const result = await getAgencyIdFromRequest(mockRequest);

      expect(result).toBe("first-agency-id");
      expect(prisma.agency.findFirst).toHaveBeenCalledWith({
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      
      // Should be cached
      expect((mockRequest as any).__agencyId__).toBe("first-agency-id");
    });

    it("should throw error if no agency found in DB", async () => {
      const mockRequest = {
        session: {},
      } as unknown as FastifyRequest;

      (prisma.agency.findFirst as any).mockResolvedValue(null);

      await expect(getAgencyIdFromRequest(mockRequest)).rejects.toThrow(
        "No agency found. Please seed an agency first."
      );
    });

    it("should only query DB once per request (caching)", async () => {
      const mockRequest = {
        session: {},
      } as unknown as FastifyRequest;

      (prisma.agency.findFirst as any).mockResolvedValue({
        id: "first-agency-id",
      });

      // Call twice
      const result1 = await getAgencyIdFromRequest(mockRequest);
      const result2 = await getAgencyIdFromRequest(mockRequest);

      expect(result1).toBe("first-agency-id");
      expect(result2).toBe("first-agency-id");
      // Should only query once
      expect(prisma.agency.findFirst).toHaveBeenCalledTimes(1);
    });

    it("should ignore invalid session agencyId types", async () => {
      const mockRequest = {
        session: {
          agencyId: 123, // Invalid type
        },
      } as unknown as FastifyRequest;

      (prisma.agency.findFirst as any).mockResolvedValue({
        id: "first-agency-id",
      });

      const result = await getAgencyIdFromRequest(mockRequest);

      // Should fallback to DB
      expect(result).toBe("first-agency-id");
      expect(prisma.agency.findFirst).toHaveBeenCalled();
    });
  });

  describe("requireAgencyId", () => {
    it("should return agencyId when available", async () => {
      const mockRequest = {
        session: {},
      } as unknown as FastifyRequest;

      (prisma.agency.findFirst as any).mockResolvedValue({
        id: "required-agency-id",
      });

      const result = await requireAgencyId(mockRequest);

      expect(result).toBe("required-agency-id");
    });

    it("should throw controlled error when no agency found", async () => {
      const mockRequest = {
        session: {},
      } as unknown as FastifyRequest;

      (prisma.agency.findFirst as any).mockResolvedValue(null);

      await expect(requireAgencyId(mockRequest)).rejects.toThrow(
        "Failed to resolve agency"
      );
    });
  });

  describe("getAgencyIdForWebhook", () => {
    it("should return first agency from DB", async () => {
      (prisma.agency.findFirst as any).mockResolvedValue({
        id: "webhook-agency-id",
      });

      const result = await getAgencyIdForWebhook();

      expect(result).toBe("webhook-agency-id");
      expect(prisma.agency.findFirst).toHaveBeenCalledWith({
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
    });

    it("should throw error if no agency found", async () => {
      (prisma.agency.findFirst as any).mockResolvedValue(null);

      await expect(getAgencyIdForWebhook()).rejects.toThrow(
        "No agency found. Please seed an agency first."
      );
    });
  });
});
