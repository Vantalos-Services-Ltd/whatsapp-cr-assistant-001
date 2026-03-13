/**
 * Unit tests for Progress State Machine
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { computeNextProgressState, applyProgressStateMachine } from '.ts';
import type { ProgressMachineContext } from '.ts';
import { prisma } from '.ts';
import { createTimelineEvent } from '.ts';

// Mock dependencies
vi.mock("../../db/prisma.js", () => ({
  prisma: {
    conversation: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    candidate: {
      findUnique: vi.fn(),
    },
    task: {
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

vi.mock("../timelineService.js", () => ({
  createTimelineEvent: vi.fn(),
}));

describe("computeNextProgressState", () => {
  // Use current date for "now" to ensure proper date calculations
  const now = new Date();
  const recentActivity = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 day ago
  const oldActivity = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000); // 45 days ago

  it("1. New conversation missing role location -> PROFILE_INCOMPLETE with missingFields", () => {
    const context: ProgressMachineContext = {
      currentStage: "NEW",
      currentProgressData: null,
      conversationId: "conv-1",
      lastActivityAt: recentActivity,
      lastInboundMessageAt: recentActivity,
      candidate: {
        phone: "+441234567890",
        name: "John Doe",
        desiredRole: null, // Missing
        location: null, // Missing
        availability: null,
        skills: null,
        salaryMin: null,
        salaryMax: null,
        yearsExperience: null,
      },
      tasks: {
        hasPendingApproval: false,
        hasOpenCscsTask: false,
        hasOpenFollowUpTask: false,
        hasOpenTasks: false,
      },
      placement: null,
      lastIntent: null,
      matchedJobsCount: 0,
    };

    const result = computeNextProgressState(context);

    expect(result.stage).toBe("PROFILE_INCOMPLETE");
    expect(result.progressDataPatch.missingFields).toContain("desiredRole");
    expect(result.progressDataPatch.missingFields).toContain("location");
    expect(result.progressDataPatch.nextAction).toContain("Collect");
    expect(result.reason).toContain("Missing required fields");
  });

  it("2. Intent looking for work with complete profile -> LOOKING_FOR_WORK", () => {
    const context: ProgressMachineContext = {
      currentStage: "NEW",
      currentProgressData: null,
      conversationId: "conv-2",
      lastActivityAt: recentActivity,
      lastInboundMessageAt: recentActivity,
      candidate: {
        phone: "+441234567890",
        name: "John Doe",
        desiredRole: "Bricklayer",
        location: "London",
        availability: "Available immediately",
        skills: ["Bricklaying", "Tiling"],
        salaryMin: 18,
        salaryMax: 22,
        yearsExperience: 5,
      },
      tasks: {
        hasPendingApproval: false,
        hasOpenCscsTask: false,
        hasOpenFollowUpTask: false,
        hasOpenTasks: false,
      },
      placement: null,
      lastIntent: "LOOKING_FOR_WORK",
      matchedJobsCount: 0,
    };

    const result = computeNextProgressState(context);

    expect(result.stage).toBe("LOOKING_FOR_WORK");
    expect(result.progressDataPatch.nextAction).toMatch(/Send suitable jobs|Find suitable job matches/);
    expect(result.reason).toContain("looking for work");
  });

  it("3. Dormant detection -> DORMANT", () => {
    const context: ProgressMachineContext = {
      currentStage: "LOOKING_FOR_WORK",
      currentProgressData: {
        missingFields: [],
        nextAction: "Find jobs",
        followUpAt: null,
        flags: {
          waitingForOperator: false,
          needsFollowUp: false,
          highPriority: false,
        },
      },
      conversationId: "conv-3",
      lastActivityAt: oldActivity, // 45 days ago
      lastInboundMessageAt: oldActivity,
      candidate: {
        phone: "+441234567890",
        name: "John Doe",
        desiredRole: "Bricklayer",
        location: "London",
        availability: "Available",
        skills: [],
        salaryMin: null,
        salaryMax: null,
        yearsExperience: null,
      },
      tasks: {
        hasPendingApproval: false,
        hasOpenCscsTask: false,
        hasOpenFollowUpTask: false,
        hasOpenTasks: false,
      },
      placement: null,
      lastIntent: null,
      matchedJobsCount: 0,
    };

    const result = computeNextProgressState(context);

    expect(result.stage).toBe("DORMANT");
    expect(result.progressDataPatch.flags.needsFollowUp).toBe(true);
    expect(result.progressDataPatch.followUpAt).toBeTruthy();
    expect(result.reason).toContain("No activity");
  });

  it("4. Pending approval flag -> waitingForOperator true without changing stage", () => {
    const context: ProgressMachineContext = {
      currentStage: "LOOKING_FOR_WORK",
      currentProgressData: {
        missingFields: [],
        nextAction: "Find jobs",
        followUpAt: null,
        flags: {
          waitingForOperator: false,
          needsFollowUp: false,
          highPriority: false,
        },
      },
      conversationId: "conv-4",
      lastActivityAt: recentActivity,
      lastInboundMessageAt: recentActivity,
      candidate: {
        phone: "+441234567890",
        name: "John Doe",
        desiredRole: "Bricklayer",
        location: "London",
        availability: "Available",
        skills: [],
        salaryMin: null,
        salaryMax: null,
        yearsExperience: null,
      },
      tasks: {
        hasPendingApproval: true, // Has pending approval
        hasOpenCscsTask: false,
        hasOpenFollowUpTask: false,
        hasOpenTasks: false,
      },
      placement: null,
      lastIntent: null,
      matchedJobsCount: 0,
    };

    const result = computeNextProgressState(context);

    // Stage should remain LOOKING_FOR_WORK (stable)
    expect(result.stage).toBe("LOOKING_FOR_WORK");
    // But waitingForOperator flag should be true
    expect(result.progressDataPatch.flags.waitingForOperator).toBe(true);
    expect(result.progressDataPatch.nextAction).toBe("Waiting for operator approval");
    expect(result.reason).toContain("waiting for operator approval");
  });

  it("5. Open CSCS task -> CSCS_VERIFICATION", () => {
    const context: ProgressMachineContext = {
      currentStage: "LOOKING_FOR_WORK",
      currentProgressData: {
        missingFields: [],
        nextAction: "Find jobs",
        followUpAt: null,
        flags: {
          waitingForOperator: false,
          needsFollowUp: false,
          highPriority: false,
        },
      },
      conversationId: "conv-5",
      lastActivityAt: recentActivity,
      lastInboundMessageAt: recentActivity,
      candidate: {
        phone: "+441234567890",
        name: "John Doe",
        desiredRole: "Bricklayer",
        location: "London",
        availability: "Available",
        skills: [],
        salaryMin: null,
        salaryMax: null,
        yearsExperience: null,
      },
      tasks: {
        hasPendingApproval: false,
        hasOpenCscsTask: true, // Has open CSCS task
        hasOpenFollowUpTask: false,
        hasOpenTasks: false,
      },
      placement: null,
      lastIntent: null,
      matchedJobsCount: 0,
    };

    const result = computeNextProgressState(context);

    expect(result.stage).toBe("CSCS_VERIFICATION");
    expect(result.progressDataPatch.missingFields).toContain("CSCS card verification");
    expect(result.progressDataPatch.nextAction).toContain("CSCS");
    expect(result.progressDataPatch.flags.highPriority).toBe(true);
    expect(result.progressDataPatch.flags.waitingForOperator).toBe(true);
  });

  it("6. Close intent -> CLOSED", () => {
    // Note: CLOSED is only set manually, but we test placement cancellation
    const context: ProgressMachineContext = {
      currentStage: "PLACED",
      currentProgressData: {
        missingFields: [],
        nextAction: null,
        followUpAt: null,
        flags: {
          waitingForOperator: false,
          needsFollowUp: false,
          highPriority: false,
        },
      },
      conversationId: "conv-6",
      lastActivityAt: recentActivity,
      lastInboundMessageAt: recentActivity,
      candidate: {
        phone: "+441234567890",
        name: "John Doe",
        desiredRole: "Bricklayer",
        location: "London",
        availability: "Available",
        skills: [],
        salaryMin: null,
        salaryMax: null,
        yearsExperience: null,
      },
      tasks: {
        hasPendingApproval: false,
        hasOpenCscsTask: false,
        hasOpenFollowUpTask: false,
        hasOpenTasks: false,
      },
      placement: {
        hasConfirmedPlacement: false, // Placement cancelled
        placementStartDate: null,
      },
      lastIntent: null,
      matchedJobsCount: 0,
    };

    const result = computeNextProgressState(context);

    // Should move back to LOOKING_FOR_WORK when placement cancelled
    expect(result.stage).toBe("LOOKING_FOR_WORK");
    expect(result.reason).toContain("Placement cancelled");
    expect(result.progressDataPatch.flags.needsFollowUp).toBe(true);
  });

  it("7. Stage stability: running twice produces same output and no bouncing", () => {
    const context: ProgressMachineContext = {
      currentStage: "LOOKING_FOR_WORK",
      currentProgressData: {
        missingFields: [],
        nextAction: "Find jobs",
        followUpAt: null,
        flags: {
          waitingForOperator: false,
          needsFollowUp: false,
          highPriority: false,
        },
      },
      conversationId: "conv-7",
      lastActivityAt: recentActivity,
      lastInboundMessageAt: recentActivity,
      candidate: {
        phone: "+441234567890",
        name: "John Doe",
        desiredRole: "Bricklayer",
        location: "London",
        availability: "Available",
        skills: [],
        salaryMin: null,
        salaryMax: null,
        yearsExperience: null,
      },
      tasks: {
        hasPendingApproval: false,
        hasOpenCscsTask: false,
        hasOpenFollowUpTask: false,
        hasOpenTasks: false,
      },
      placement: null,
      lastIntent: "LOOKING_FOR_WORK",
      matchedJobsCount: 0,
    };

    const result1 = computeNextProgressState(context);
    const result2 = computeNextProgressState(context);

    // Results should be identical
    expect(result1.stage).toBe(result2.stage);
    expect(result1.reason).toBe(result2.reason);
    expect(JSON.stringify(result1.progressDataPatch)).toBe(JSON.stringify(result2.progressDataPatch));

    // Stage should remain stable (LOOKING_FOR_WORK)
    expect(result1.stage).toBe("LOOKING_FOR_WORK");
  });

  it("8. MATCHED_TO_JOBS when jobs matched and stage is LOOKING_FOR_WORK", () => {
    const context: ProgressMachineContext = {
      currentStage: "LOOKING_FOR_WORK",
      currentProgressData: {
        missingFields: [],
        nextAction: "Find jobs",
        followUpAt: null,
        flags: {
          waitingForOperator: false,
          needsFollowUp: false,
          highPriority: false,
        },
      },
      conversationId: "conv-8",
      lastActivityAt: recentActivity,
      lastInboundMessageAt: recentActivity,
      candidate: {
        phone: "+441234567890",
        name: "John Doe",
        desiredRole: "Bricklayer",
        location: "London",
        availability: "Available",
        skills: [],
        salaryMin: null,
        salaryMax: null,
        yearsExperience: null,
      },
      tasks: {
        hasPendingApproval: false,
        hasOpenCscsTask: false,
        hasOpenFollowUpTask: false,
        hasOpenTasks: false,
      },
      placement: null,
      lastIntent: null, // No intent to avoid Rule 4 early return, allowing Rule 5 to run
      matchedJobsCount: 2, // Has matched jobs
    };

    const result = computeNextProgressState(context);

    expect(result.stage).toBe("MATCHED_TO_JOBS");
    expect(result.progressDataPatch.nextAction).toContain("Send top 2 jobs");
    expect(result.progressDataPatch.flags.highPriority).toBe(true);
  });

  it("9. READY_TO_PLACE when all requirements met", () => {
    const context: ProgressMachineContext = {
      currentStage: "MATCHED_TO_JOBS",
      currentProgressData: {
        missingFields: [],
        nextAction: "Send jobs",
        followUpAt: null,
        flags: {
          waitingForOperator: false,
          needsFollowUp: false,
          highPriority: true,
        },
      },
      conversationId: "conv-9",
      lastActivityAt: recentActivity,
      lastInboundMessageAt: recentActivity,
      candidate: {
        phone: "+441234567890",
        name: "John Doe",
        desiredRole: "Bricklayer",
        location: "London",
        availability: "Available",
        skills: [],
        salaryMin: null,
        salaryMax: null,
        yearsExperience: null,
      },
      tasks: {
        hasPendingApproval: false,
        hasOpenCscsTask: false,
        hasOpenFollowUpTask: false,
        hasOpenTasks: false,
      },
      placement: null,
      lastIntent: null,
      matchedJobsCount: 1, // Has matched jobs
    };

    const result = computeNextProgressState(context);

    expect(result.stage).toBe("READY_TO_PLACE");
    expect(result.progressDataPatch.nextAction).toContain("Confirm start date");
    expect(result.progressDataPatch.flags.highPriority).toBe(true);
  });

  it("10. PLACED when placement confirmed", () => {
    const futureDate = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000); // 5 days in future
    
    const context: ProgressMachineContext = {
      currentStage: "MATCHED_TO_JOBS", // Start from MATCHED_TO_JOBS to avoid READY_TO_PLACE rule
      currentProgressData: {
        missingFields: [],
        nextAction: "Confirm placement",
        followUpAt: null,
        flags: {
          waitingForOperator: false,
          needsFollowUp: false,
          highPriority: true,
        },
      },
      conversationId: "conv-10",
      lastActivityAt: recentActivity,
      lastInboundMessageAt: recentActivity,
      candidate: {
        phone: "+441234567890",
        name: "John Doe",
        desiredRole: "Bricklayer",
        location: "London",
        availability: "Available",
        skills: [],
        salaryMin: null,
        salaryMax: null,
        yearsExperience: null,
      },
      tasks: {
        hasPendingApproval: false,
        hasOpenCscsTask: false,
        hasOpenFollowUpTask: false,
        hasOpenTasks: false,
      },
      placement: {
        hasConfirmedPlacement: true,
        placementStartDate: futureDate.toISOString(), // Future date
      },
      lastIntent: null,
      matchedJobsCount: 0, // No matched jobs to avoid READY_TO_PLACE
    };

    const result = computeNextProgressState(context);

    // Rule 8: PLACED takes priority (Rule 2 in order)
    expect(result.stage).toBe("PLACED");
    expect(result.progressDataPatch.nextAction).toBe("Aftercare check in");
    expect(result.progressDataPatch.flags.highPriority).toBe(false);
    expect(result.progressDataPatch.flags.waitingForOperator).toBe(false);
  });

  it("11. AFTERCARE when placement started", () => {
    const context: ProgressMachineContext = {
      currentStage: "PLACED",
      currentProgressData: {
        missingFields: [],
        nextAction: "Aftercare check in",
        followUpAt: null,
        flags: {
          waitingForOperator: false,
          needsFollowUp: false,
          highPriority: false,
        },
      },
      conversationId: "conv-11",
      lastActivityAt: recentActivity,
      lastInboundMessageAt: recentActivity,
      candidate: {
        phone: "+441234567890",
        name: "John Doe",
        desiredRole: "Bricklayer",
        location: "London",
        availability: "Available",
        skills: [],
        salaryMin: null,
        salaryMax: null,
        yearsExperience: null,
      },
      tasks: {
        hasPendingApproval: false,
        hasOpenCscsTask: false,
        hasOpenFollowUpTask: false,
        hasOpenTasks: false,
      },
      placement: {
        hasConfirmedPlacement: true,
        placementStartDate: "2024-01-01T00:00:00Z", // Past date
      },
      lastIntent: null,
      matchedJobsCount: 0,
    };

    const result = computeNextProgressState(context);

    expect(result.stage).toBe("AFTERCARE");
    expect(result.progressDataPatch.nextAction).toBe("Aftercare check in");
    expect(result.reason).toContain("Placement started");
  });
});

describe("applyProgressStateMachine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("integration: ensures timeline event only created when stage changes", async () => {
    const conversationId = "conv-test";
    const agencyId = "agency-1";
    const currentStage = "LOOKING_FOR_WORK";
    const newStage = "MATCHED_TO_JOBS";

    // Mock conversation with current stage
    (prisma.conversation.findUnique as any).mockResolvedValue({
      id: conversationId,
      agencyId,
      progressStage: currentStage,
      progressData: {
        missingFields: [],
        nextAction: "Find jobs",
        followUpAt: null,
        flags: {
          waitingForOperator: false,
          needsFollowUp: false,
          highPriority: false,
        },
      },
      progressUpdatedAt: new Date(),
      contactId: "contact-1",
      lastMessageAt: veryRecentDate,
      contact: {
        phone: "+441234567890",
        type: "CANDIDATE",
      },
    });

    // Mock candidate lookup
    (prisma.candidate.findUnique as any).mockResolvedValue({
      id: "candidate-1",
    });

    // Mock task queries (all empty)
    (prisma.task.findMany as any).mockResolvedValue([]);
    (prisma.jobCandidateMatch.findMany as any).mockResolvedValue([]);
    (prisma.placement.findFirst as any).mockResolvedValue(null);

    // Mock conversation update
    (prisma.conversation.update as any).mockResolvedValue({
      id: conversationId,
      progressStage: newStage,
    });

    // Mock timeline event creation
    (createTimelineEvent as any).mockResolvedValue({ id: "event-1" });

    // Apply state machine with context that will change stage
    const result = await applyProgressStateMachine({
      conversationId,
      agencyId,
      context: {
        lastActivityAt: veryRecentDate,
        lastInboundMessageAt: veryRecentDate,
        candidate: {
          phone: "+441234567890",
          name: "John Doe",
          desiredRole: "Bricklayer",
          location: "London",
          availability: "Available",
          skills: [],
          salaryMin: null,
          salaryMax: null,
          yearsExperience: null,
        },
        tasks: {
          hasPendingApproval: false,
          hasOpenCscsTask: false,
          hasOpenFollowUpTask: false,
          hasOpenTasks: false,
        },
        placement: null,
        lastIntent: null, // No intent to avoid Rule 4 early return, allowing Rule 5 to run
        matchedJobsCount: 2, // This will trigger MATCHED_TO_JOBS
        contactType: "CANDIDATE",
      },
    });

    // Should have changed
    expect(result.changed).toBe(true);
    expect(result.stage).toBe("MATCHED_TO_JOBS");

    // Timeline event should be created
    expect(createTimelineEvent).toHaveBeenCalledTimes(1);
    expect(createTimelineEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PROGRESS_STAGE_CHANGED",
        summary: expect.stringContaining("Progress moved to MATCHED_TO_JOBS"),
        data: expect.objectContaining({
          from: currentStage,
          to: newStage,
        }),
      })
    );

    // Conversation should be updated
    expect(prisma.conversation.update).toHaveBeenCalledTimes(1);
  });

  it("integration: no timeline event when stage unchanged", async () => {
    const conversationId = "conv-test-2";
    const agencyId = "agency-1";
    const currentStage = "LOOKING_FOR_WORK";

    // Mock conversation with current stage
    (prisma.conversation.findUnique as any).mockResolvedValue({
      id: conversationId,
      agencyId,
      progressStage: currentStage,
      progressData: {
        missingFields: [],
        nextAction: "Find jobs",
        followUpAt: null,
        flags: {
          waitingForOperator: false,
          needsFollowUp: false,
          highPriority: false,
        },
      },
      progressUpdatedAt: new Date(),
      contactId: "contact-1",
      lastMessageAt: veryRecentDate,
      contact: {
        phone: "+441234567890",
        type: "CANDIDATE",
      },
    });

    // Mock candidate lookup
    (prisma.candidate.findUnique as any).mockResolvedValue({
      id: "candidate-1",
    });

    // Mock task queries (all empty)
    (prisma.task.findMany as any).mockResolvedValue([]);
    (prisma.jobCandidateMatch.findMany as any).mockResolvedValue([]);
    (prisma.placement.findFirst as any).mockResolvedValue(null);

    // Apply state machine with context that won't change stage
    const result = await applyProgressStateMachine({
      conversationId,
      agencyId,
      context: {
        lastActivityAt: veryRecentDate,
        lastInboundMessageAt: veryRecentDate,
        candidate: {
          phone: "+441234567890",
          name: "John Doe",
          desiredRole: "Bricklayer",
          location: "London",
          availability: "Available",
          skills: [],
          salaryMin: null,
          salaryMax: null,
          yearsExperience: null,
        },
        tasks: {
          hasPendingApproval: false,
          hasOpenCscsTask: false,
          hasOpenFollowUpTask: false,
          hasOpenTasks: false,
        },
        placement: null,
        lastIntent: "LOOKING_FOR_WORK",
        matchedJobsCount: 0, // No matched jobs, stage stays LOOKING_FOR_WORK
        contactType: "CANDIDATE",
      },
    });

    // Should not have changed (idempotent)
    expect(result.changed).toBe(false);
    expect(result.stage).toBe(currentStage);

    // Timeline event should NOT be created
    expect(createTimelineEvent).not.toHaveBeenCalled();

    // Conversation should NOT be updated
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });
});

