/**
 * Unit tests for progress engine
 */

import { describe, it, expect } from "vitest";
import { determineProgressStage } from '.ts';
import type { ProgressEngineInput } from '.ts';

describe("ProgressEngine", () => {
  const baseInput: ProgressEngineInput = {
    currentStage: "NEW",
    candidateSnapshot: {
      name: "John Smith",
      desiredRole: "Bricklayer",
      location: "Maidstone",
      availability: "Available immediately",
      salary: { min: 18, max: 22, currency: "GBP" },
      skills: ["Brickwork"],
      yearsExperience: 5,
    },
    lastIntent: null,
    hasPendingApproval: false,
    hasOpenTasks: { types: [] },
    lastActivityAt: new Date(),
    matchedJobsCount: 0,
    placementConfirmed: false,
  };

  describe("Rule 1: Pending Approval", () => {
    it("should set waitingForOperator flag when hasPendingApproval is true", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        hasPendingApproval: true,
        currentStage: "LOOKING_FOR_WORK",
      };

      const result = determineProgressStage(input);

      expect(result.progressDataPatch.flags?.waitingForOperator).toBe(true);
      // Stage should remain unchanged (not forced to PAUSED)
      expect(result.stage).toBe("LOOKING_FOR_WORK");
    });
  });

  describe("Rule 2: Placement Confirmed", () => {
    it("should set stage to PLACED when placementConfirmed is true", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        placementConfirmed: true,
        currentStage: "READY_TO_PLACE",
      };

      const result = determineProgressStage(input);

      expect(result.stage).toBe("PLACED");
      expect(result.progressDataPatch.nextAction).toBeNull();
      expect(result.progressDataPatch.followUpAt).toBeNull();
    });

    it("should override other rules when placementConfirmed is true", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        placementConfirmed: true,
        hasOpenTasks: { types: ["CSCS_VERIFICATION"] },
        matchedJobsCount: 5,
      };

      const result = determineProgressStage(input);

      expect(result.stage).toBe("PLACED");
    });
  });

  describe("Rule 3: CSCS Verification Task", () => {
    it("should set stage to CSCS_VERIFICATION when CSCS task is open", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        hasOpenTasks: { types: ["CSCS_VERIFICATION"] },
        currentStage: "LOOKING_FOR_WORK",
      };

      const result = determineProgressStage(input);

      expect(result.stage).toBe("CSCS_VERIFICATION");
      expect(result.progressDataPatch.missingFields).toContain("CSCS card verification");
      expect(result.progressDataPatch.nextAction).toBe("Complete CSCS card verification");
    });

    it("should not override PLACED stage", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        placementConfirmed: true,
        hasOpenTasks: { types: ["CSCS_VERIFICATION"] },
      };

      const result = determineProgressStage(input);

      expect(result.stage).toBe("PLACED");
    });
  });

  describe("Rule 4: Dormant (no activity >30 days)", () => {
    it("should set stage to DORMANT when last activity >30 days ago", () => {
      const thirtyOneDaysAgo = new Date();
      thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);

      const input: ProgressEngineInput = {
        ...baseInput,
        lastActivityAt: thirtyOneDaysAgo,
        currentStage: "LOOKING_FOR_WORK",
      };

      const result = determineProgressStage(input);

      expect(result.stage).toBe("DORMANT");
      expect(result.progressDataPatch.nextAction).toBe("Re-engage candidate");
    });

    it("should not set DORMANT when activity is recent", () => {
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);

      const input: ProgressEngineInput = {
        ...baseInput,
        lastActivityAt: oneDayAgo,
        currentStage: "LOOKING_FOR_WORK",
      };

      const result = determineProgressStage(input, "LOOKING_FOR_WORK");

      expect(result.stage).toBe("LOOKING_FOR_WORK");
    });

    it("should not override PLACED or CSCS_VERIFICATION", () => {
      const thirtyOneDaysAgo = new Date();
      thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);

      const input1: ProgressEngineInput = {
        ...baseInput,
        placementConfirmed: true,
        lastActivityAt: thirtyOneDaysAgo,
      };

      const result1 = determineProgressStage(input1);
      expect(result1.stage).toBe("PLACED");

      const input2: ProgressEngineInput = {
        ...baseInput,
        hasOpenTasks: { types: ["CSCS_VERIFICATION"] },
        lastActivityAt: thirtyOneDaysAgo,
      };

      const result2 = determineProgressStage(input2);
      expect(result2.stage).toBe("CSCS_VERIFICATION");
    });
  });

  describe("Rule 5: Profile Incomplete", () => {
    it("should set stage to PROFILE_INCOMPLETE when desiredRole is missing", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        candidateSnapshot: {
          ...baseInput.candidateSnapshot!,
          desiredRole: null,
        },
        currentStage: "NEW",
      };

      const result = determineProgressStage(input);

      expect(result.stage).toBe("PROFILE_INCOMPLETE");
      expect(result.progressDataPatch.missingFields).toContain("desiredRole");
      expect(result.progressDataPatch.nextAction).toBe("Collect missing profile information");
    });

    it("should set stage to PROFILE_INCOMPLETE when location is missing", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        candidateSnapshot: {
          ...baseInput.candidateSnapshot!,
          location: null,
        },
        currentStage: "NEW",
      };

      const result = determineProgressStage(input);

      expect(result.stage).toBe("PROFILE_INCOMPLETE");
      expect(result.progressDataPatch.missingFields).toContain("location");
    });

    it("should include both missing fields when both are missing", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        candidateSnapshot: {
          ...baseInput.candidateSnapshot!,
          desiredRole: null,
          location: null,
        },
      };

      const result = determineProgressStage(input);

      expect(result.stage).toBe("PROFILE_INCOMPLETE");
      expect(result.progressDataPatch.missingFields).toContain("desiredRole");
      expect(result.progressDataPatch.missingFields).toContain("location");
    });

    it("should not override higher priority rules", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        candidateSnapshot: {
          ...baseInput.candidateSnapshot!,
          desiredRole: null,
        },
        placementConfirmed: true,
      };

      const result = determineProgressStage(input);

      expect(result.stage).toBe("PLACED");
    });
  });

  describe("Rule 6: Matched Jobs", () => {
    it("should set stage to MATCHED_TO_JOBS when matchedJobsCount > 0", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        matchedJobsCount: 3,
        currentStage: "LOOKING_FOR_WORK",
      };

      const result = determineProgressStage(input);

      expect(result.stage).toBe("MATCHED_TO_JOBS");
      expect(result.progressDataPatch.nextAction).toBe("Present job matches to candidate");
    });

    it("should not override higher priority rules", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        matchedJobsCount: 5,
        placementConfirmed: true,
      };

      const result = determineProgressStage(input);

      expect(result.stage).toBe("PLACED");
    });
  });

  describe("Rule 7: Looking for Work Intent", () => {
    it("should set stage to LOOKING_FOR_WORK when lastIntent is LOOKING_FOR_WORK", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        lastIntent: "LOOKING_FOR_WORK",
        currentStage: "NEW",
      };

      const result = determineProgressStage(input);

      expect(result.stage).toBe("LOOKING_FOR_WORK");
      expect(result.progressDataPatch.nextAction).toBe("Find suitable job matches");
    });

    it("should not override higher priority rules", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        lastIntent: "LOOKING_FOR_WORK",
        matchedJobsCount: 2,
      };

      const result = determineProgressStage(input);

      expect(result.stage).toBe("MATCHED_TO_JOBS");
    });
  });

  describe("Rule 8: Keep Current Stage", () => {
    it("should keep current stage when no rules apply", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        currentStage: "AFTERCARE",
        lastIntent: "AVAILABILITY_UPDATE",
      };

      const result = determineProgressStage(input);

      expect(result.stage).toBe("AFTERCARE");
    });

    it("should use AI suggested stage when provided and no rules apply", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        currentStage: "NEW",
        lastIntent: "AVAILABILITY_UPDATE",
      };

      const result = determineProgressStage(input, "READY_TO_PLACE");

      expect(result.stage).toBe("READY_TO_PLACE");
    });
  });

  describe("High Priority Flags", () => {
    it("should set highPriority flag for CSCS_VERIFICATION", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        hasOpenTasks: { types: ["CSCS_VERIFICATION"] },
      };

      const result = determineProgressStage(input);

      expect(result.progressDataPatch.flags?.highPriority).toBe(true);
    });

    it("should set highPriority flag for READY_TO_PLACE", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        currentStage: "READY_TO_PLACE",
      };

      const result = determineProgressStage(input, "READY_TO_PLACE");

      expect(result.progressDataPatch.flags?.highPriority).toBe(true);
    });

    it("should set highPriority flag for MATCHED_TO_JOBS", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        matchedJobsCount: 2,
      };

      const result = determineProgressStage(input);

      expect(result.progressDataPatch.flags?.highPriority).toBe(true);
    });

    it("should preserve waitingForOperator flag when setting highPriority", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        hasPendingApproval: true,
        matchedJobsCount: 2,
      };

      const result = determineProgressStage(input);

      expect(result.progressDataPatch.flags?.waitingForOperator).toBe(true);
      expect(result.progressDataPatch.flags?.highPriority).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle null candidate snapshot", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        candidateSnapshot: null,
      };

      const result = determineProgressStage(input);

      expect(result.stage).toBe("PROFILE_INCOMPLETE");
      expect(result.progressDataPatch.missingFields).toContain("desiredRole");
      expect(result.progressDataPatch.missingFields).toContain("location");
    });

    it("should handle null lastActivityAt", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        lastActivityAt: null,
      };

      const result = determineProgressStage(input);

      // Should not set DORMANT when lastActivityAt is null
      expect(result.stage).not.toBe("DORMANT");
    });

    it("should handle empty hasOpenTasks", () => {
      const input: ProgressEngineInput = {
        ...baseInput,
        hasOpenTasks: { types: [] },
      };

      const result = determineProgressStage(input);

      expect(result.stage).not.toBe("CSCS_VERIFICATION");
    });
  });
});

