import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  upsertPipelineItem,
  validateStageTransition,
} from '.ts';
import { JobPipelineStage, NoShowReason } from "@prisma/client";

// Mock Prisma - must be defined inline in vi.mock factory
vi.mock("../db/prisma.js", () => ({
  prisma: {
    agency: {
      findUnique: vi.fn(),
    },
    job: {
      findUnique: vi.fn(),
    },
    candidate: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    jobPipelineItem: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    contact: {
      findUnique: vi.fn(),
    },
    conversation: {
      findFirst: vi.fn(),
    },
    task: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    jobCandidateMatch: {
      findMany: vi.fn(),
    },
    placement: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from '.ts';
const mockPrisma = prisma as any;

// Mock timeline service
vi.mock("./timelineService.js", () => ({
  createTimelineEvent: vi.fn().mockResolvedValue({ id: "timeline-1" }),
}));

// Mock progress state machine
vi.mock("./progress/stateMachine.js", () => ({
  applyProgressStateMachine: vi.fn().mockResolvedValue({
    changed: false,
    stage: "LOOKING_FOR_WORK",
    reason: "No change",
  }),
}));

describe("jobPipelineService", () => {
  const agencyId = "agency-1";
  const jobId = "job-1";
  const candidateId = "candidate-1";
  const operatorId = "operator-1";

  const mockAgency = { id: agencyId };
  const mockJob = {
    id: jobId,
    agencyId,
    title: "Bricklayer - Maidstone",
    city: "Maidstone",
    siteName: "Site A",
    payRate: 18.5,
    currency: "GBP",
    startDate: new Date("2024-02-01"),
  };
  const mockCandidate = {
    id: candidateId,
    agencyId,
    phone: "+447700900123",
    name: "John Doe",
    desiredRole: "Bricklayer",
    location: "Maidstone",
    skills: [],
    availabilityNotes: "Available immediately",
    salaryMin: 18,
    salaryMax: 20,
    yearsExperience: 5,
    rawProfile: {},
    currency: "GBP",
  };
  const mockContact = { id: "contact-1" };
  const mockConversation = { id: "conv-1", lastMessageAt: new Date() };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks
    mockPrisma.agency.findUnique.mockResolvedValue(mockAgency);
    mockPrisma.job.findUnique.mockResolvedValue(mockJob);
    mockPrisma.candidate.findUnique.mockResolvedValue(mockCandidate);
    mockPrisma.contact.findUnique.mockResolvedValue(mockContact);
    mockPrisma.conversation.findFirst.mockResolvedValue(mockConversation);
    mockPrisma.task.findFirst.mockResolvedValue(null); // No existing tasks
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.jobCandidateMatch.findMany.mockResolvedValue([]);
    mockPrisma.placement.findFirst.mockResolvedValue(null);
  });

  describe("validateStageTransition", () => {
    it("allows SHORTLISTED -> OFFER_SENT", () => {
      expect(() => {
        validateStageTransition("SHORTLISTED", "OFFER_SENT", {
          notes: "Interested",
        });
      }).not.toThrow();
    });

    it("allows SHORTLISTED -> DROPPED", () => {
      expect(() => {
        validateStageTransition("SHORTLISTED", "DROPPED", {});
      }).not.toThrow();
    });

    it("allows OFFER_SENT -> START_CONFIRMED with startDate", () => {
      expect(() => {
        validateStageTransition("OFFER_SENT", "START_CONFIRMED", {
          startDate: new Date(),
        });
      }).not.toThrow();
    });

    it("rejects OFFER_SENT -> START_CONFIRMED without startDate", () => {
      expect(() => {
        validateStageTransition("OFFER_SENT", "START_CONFIRMED", {});
      }).toThrow("startDate is required");
    });

    it("allows OFFER_SENT -> NO_SHOW with noShowReason", () => {
      expect(() => {
        validateStageTransition("OFFER_SENT", "NO_SHOW", {
          noShowReason: NoShowReason.DID_NOT_TURN_UP,
        });
      }).not.toThrow();
    });

    it("rejects OFFER_SENT -> NO_SHOW without noShowReason", () => {
      expect(() => {
        validateStageTransition("OFFER_SENT", "NO_SHOW", {});
      }).toThrow("noShowReason is required");
    });

    it("rejects invalid transition SHORTLISTED -> START_CONFIRMED", () => {
      expect(() => {
        validateStageTransition("SHORTLISTED", "START_CONFIRMED", {
          startDate: new Date(),
        });
      }).toThrow("Invalid stage transition");
    });

    it("rejects transition from DROPPED (terminal)", () => {
      expect(() => {
        validateStageTransition("DROPPED", "SHORTLISTED", {});
      }).toThrow("Cannot transition from DROPPED");
    });

    it("rejects NO_SHOW -> OFFER_SENT (cannot go back)", () => {
      expect(() => {
        validateStageTransition("NO_SHOW", "OFFER_SENT", {});
      }).toThrow("Cannot transition from NO_SHOW");
    });
  });

  describe("upsertPipelineItem - unique constraint", () => {
    it("creates new pipeline item when none exists", async () => {
      mockPrisma.jobPipelineItem.findUnique.mockResolvedValue(null);
      mockPrisma.jobPipelineItem.upsert.mockResolvedValue({
        id: "pipeline-1",
        agencyId,
        jobId,
        candidateId,
        stage: "SHORTLISTED",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await upsertPipelineItem({
        agencyId,
        jobId,
        candidateId,
        stage: "SHORTLISTED",
        updates: {},
        operatorId,
      });

      expect(result.created).toBe(true);
      expect(mockPrisma.jobPipelineItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            stage: "SHORTLISTED",
          }),
        })
      );
    });

    it("updates existing pipeline item (same unique key)", async () => {
      const existing = {
        id: "pipeline-1",
        agencyId,
        jobId,
        candidateId,
        stage: "SHORTLISTED",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.jobPipelineItem.findUnique.mockResolvedValue(existing);
      mockPrisma.jobPipelineItem.upsert.mockResolvedValue({
        ...existing,
        stage: "OFFER_SENT",
        updatedAt: new Date(),
      });

      const result = await upsertPipelineItem({
        agencyId,
        jobId,
        candidateId,
        stage: "OFFER_SENT",
        updates: { notes: "Updated" },
        operatorId,
      });

      expect(result.created).toBe(false);
      expect(mockPrisma.jobPipelineItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            agencyId_jobId_candidateId: {
              agencyId,
              jobId,
              candidateId,
            },
          },
          update: expect.objectContaining({
            stage: "OFFER_SENT",
          }),
        })
      );
    });
  });

  describe("upsertPipelineItem - OUTREACH task creation", () => {
    it("creates OUTREACH task when moving to OFFER_SENT", async () => {
      const existing = {
        id: "pipeline-1",
        agencyId,
        jobId,
        candidateId,
        stage: "SHORTLISTED",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.jobPipelineItem.findUnique.mockResolvedValue(existing);
      mockPrisma.jobPipelineItem.upsert.mockResolvedValue({
        ...existing,
        stage: "OFFER_SENT",
        updatedAt: new Date(),
      });
      mockPrisma.task.findFirst.mockResolvedValue(null); // No existing task
      mockPrisma.task.create.mockResolvedValue({
        id: "task-1",
        type: "OUTREACH",
        status: "OPEN",
      });

      await upsertPipelineItem({
        agencyId,
        jobId,
        candidateId,
        stage: "OFFER_SENT",
        updates: { notes: "Interested" },
        operatorId,
      });

      // Verify OUTREACH task was created
      expect(mockPrisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "OUTREACH",
            status: "OPEN",
            approvalStatus: "PENDING",
            candidateId,
            payload: expect.objectContaining({
              jobId,
              candidateId,
              pipelineStage: "OFFER_SENT",
            }),
          }),
        })
      );
    });

    it("does not create duplicate OUTREACH task if one exists", async () => {
      const existing = {
        id: "pipeline-1",
        agencyId,
        jobId,
        candidateId,
        stage: "SHORTLISTED",
        notes: "Interested",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.jobPipelineItem.findUnique.mockResolvedValue(existing);
      mockPrisma.jobPipelineItem.upsert.mockResolvedValue({
        ...existing,
        stage: "OFFER_SENT",
        updatedAt: new Date(),
      });
      // Existing OUTREACH task found - mock findMany to return tasks with matching payload
      mockPrisma.task.findMany.mockResolvedValue([
        {
          id: "existing-task-1",
          type: "OUTREACH",
          status: "OPEN",
          payload: { jobId, candidateId },
        },
      ]);

      await upsertPipelineItem({
        agencyId,
        jobId,
        candidateId,
        stage: "OFFER_SENT",
        updates: { notes: "Interested" },
        operatorId,
      });

      // Verify task.create was NOT called
      expect(mockPrisma.task.create).not.toHaveBeenCalled();
    });

    it("creates OUTREACH task only once per job/candidate", async () => {
      const existing = {
        id: "pipeline-1",
        agencyId,
        jobId,
        candidateId,
        stage: "SHORTLISTED",
        notes: "Interested",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.jobPipelineItem.findUnique.mockResolvedValue(existing);
      mockPrisma.jobPipelineItem.upsert.mockResolvedValue({
        ...existing,
        stage: "OFFER_SENT",
        updatedAt: new Date(),
      });
      mockPrisma.task.findMany.mockResolvedValue([]); // No existing tasks
      mockPrisma.task.create.mockResolvedValue({
        id: "task-1",
        type: "OUTREACH",
      });

      // First call
      await upsertPipelineItem({
        agencyId,
        jobId,
        candidateId,
        stage: "OFFER_SENT",
        updates: { notes: "Interested" },
        operatorId,
      });

      // Second call (should not create another task)
      mockPrisma.task.findMany.mockResolvedValue([
        {
          id: "task-1",
          type: "OUTREACH",
          status: "OPEN",
          payload: { jobId, candidateId },
        },
      ]);

      await upsertPipelineItem({
        agencyId,
        jobId,
        candidateId,
        stage: "OFFER_SENT",
        updates: { notes: "Interested" },
        operatorId,
      });

      // Task.create should only be called once
      expect(mockPrisma.task.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("upsertPipelineItem - FOLLOW_UP task creation", () => {
    it("creates FOLLOW_UP task when moving to START_CONFIRMED", async () => {
      const existing = {
        id: "pipeline-1",
        agencyId,
        jobId,
        candidateId,
        stage: "OFFER_SENT",
        startDate: new Date("2024-02-01"),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.jobPipelineItem.findUnique.mockResolvedValue(existing);
      mockPrisma.jobPipelineItem.upsert.mockResolvedValue({
        ...existing,
        stage: "START_CONFIRMED",
        updatedAt: new Date(),
      });
      mockPrisma.task.findFirst.mockResolvedValue(null);
      mockPrisma.task.create.mockResolvedValue({
        id: "task-1",
        type: "FOLLOW_UP",
        dueAt: new Date(),
      });

      await upsertPipelineItem({
        agencyId,
        jobId,
        candidateId,
        stage: "START_CONFIRMED",
        updates: { startDate: new Date("2024-02-01") },
        operatorId,
      });

      // Verify FOLLOW_UP task was created
      expect(mockPrisma.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "FOLLOW_UP",
            status: "OPEN",
            isSystemGenerated: true,
            dueAt: expect.any(Date),
            payload: expect.objectContaining({
              jobId,
              candidateId,
              pipelineStage: "START_CONFIRMED",
            }),
          }),
        })
      );
    });

    it("does not create duplicate FOLLOW_UP task if one exists", async () => {
      const existing = {
        id: "pipeline-1",
        agencyId,
        jobId,
        candidateId,
        stage: "OFFER_SENT",
        startDate: new Date("2024-02-01"),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.jobPipelineItem.findUnique.mockResolvedValue(existing);
      mockPrisma.jobPipelineItem.upsert.mockResolvedValue({
        ...existing,
        stage: "START_CONFIRMED",
        updatedAt: new Date(),
      });
      // Existing FOLLOW_UP task found - mock findMany to return tasks with matching payload
      mockPrisma.task.findMany.mockResolvedValue([
        {
          id: "existing-task-1",
          type: "FOLLOW_UP",
          status: "OPEN",
          payload: { jobId, candidateId },
        },
      ]);

      await upsertPipelineItem({
        agencyId,
        jobId,
        candidateId,
        stage: "START_CONFIRMED",
        updates: { startDate: new Date("2024-02-01") },
        operatorId,
      });

      // Verify task.create was NOT called
      expect(mockPrisma.task.create).not.toHaveBeenCalled();
    });

    it("creates FOLLOW_UP task only once per job/candidate", async () => {
      const existing = {
        id: "pipeline-1",
        agencyId,
        jobId,
        candidateId,
        stage: "OFFER_SENT",
        startDate: new Date("2024-02-01"),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.jobPipelineItem.findUnique.mockResolvedValue(existing);
      mockPrisma.jobPipelineItem.upsert.mockResolvedValue({
        ...existing,
        stage: "START_CONFIRMED",
        updatedAt: new Date(),
      });
      mockPrisma.task.findMany.mockResolvedValue([]); // No existing tasks
      mockPrisma.task.create.mockResolvedValue({
        id: "task-1",
        type: "FOLLOW_UP",
      });

      // First call
      await upsertPipelineItem({
        agencyId,
        jobId,
        candidateId,
        stage: "START_CONFIRMED",
        updates: { startDate: new Date("2024-02-01") },
        operatorId,
      });

      // Second call (should not create another task)
      mockPrisma.task.findMany.mockResolvedValue([
        {
          id: "task-1",
          type: "FOLLOW_UP",
          status: "OPEN",
          payload: { jobId, candidateId },
        },
      ]);

      await upsertPipelineItem({
        agencyId,
        jobId,
        candidateId,
        stage: "START_CONFIRMED",
        updates: { startDate: new Date("2024-02-01") },
        operatorId,
      });

      // Task.create should only be called once
      expect(mockPrisma.task.create).toHaveBeenCalledTimes(1);
    });
  });
});

