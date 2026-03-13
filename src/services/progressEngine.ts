/**
 * Deterministic Progress Rules Engine
 * Provides guardrails for progress stage transitions based on known fields and state
 */

import type { ContactProgressStage, ContactProgressData } from "../../shared/types/progress.ts";

/**
 * Candidate snapshot (read-only for context)
 */
export type CandidateSnapshot = {
  name: string | null;
  desiredRole: string | null;
  location: string | null;
  availability: string | null;
  salary: {
    min: number | null;
    max: number | null;
    currency: string | null;
  } | null;
  skills: string[];
  yearsExperience: number | null;
};

/**
 * Input for progress engine
 */
export type ProgressEngineInput = {
  currentStage: ContactProgressStage;
  candidateSnapshot: CandidateSnapshot | null;
  lastIntent: string | null; // From intent classification
  hasPendingApproval: boolean;
  hasOpenTasks: {
    types: string[]; // Task types that are OPEN
  };
  lastActivityAt: Date | null; // Last message timestamp
  matchedJobsCount?: number; // Number of matched jobs
  placementConfirmed?: boolean; // Whether placement is confirmed
};

/**
 * Output from progress engine
 */
export type ProgressEngineOutput = {
  stage: ContactProgressStage;
  progressDataPatch: Partial<ContactProgressData>;
};

/**
 * Determine progress stage and data based on deterministic rules
 * 
 * Rules priority (checked in order):
 * 1. If hasPendingApproval -> flags.waitingForOperator = true (but keep stage from AI suggestion)
 * 2. If placement confirmed -> PLACED
 * 3. If CSCS verification task open -> CSCS_VERIFICATION
 * 4. If no activity >30 days -> DORMANT
 * 5. If candidate missing desiredRole or location -> PROFILE_INCOMPLETE
 * 6. If jobs matched >0 -> MATCHED_TO_JOBS
 * 7. If looking for work intent -> LOOKING_FOR_WORK
 * 8. Otherwise keep current stage (or use AI suggestion)
 */
export function determineProgressStage(
  input: ProgressEngineInput,
  aiSuggestedStage?: ContactProgressStage
): ProgressEngineOutput {
  const {
    currentStage,
    candidateSnapshot,
    lastIntent,
    hasPendingApproval,
    hasOpenTasks,
    lastActivityAt,
    matchedJobsCount = 0,
    placementConfirmed = false,
  } = input;

  const progressDataPatch: Partial<ContactProgressData> = {};
  let finalStage: ContactProgressStage = aiSuggestedStage || currentStage;

  // Rule 1: If hasPendingApproval -> set waitingForOperator flag (but keep stage)
  if (hasPendingApproval) {
    progressDataPatch.flags = {
      ...progressDataPatch.flags,
      waitingForOperator: true,
    };
  }

  // Rule 2: If placement confirmed -> PLACED
  if (placementConfirmed) {
    finalStage = "PLACED";
    progressDataPatch.nextAction = null; // No action needed for placed candidates
    progressDataPatch.followUpAt = null;
  }
  // Rule 3: If CSCS verification task open -> CSCS_VERIFICATION
  else if (hasOpenTasks.types.includes("CSCS_VERIFICATION")) {
    finalStage = "CSCS_VERIFICATION";
    progressDataPatch.missingFields = ["CSCS card verification"];
    progressDataPatch.nextAction = "Complete CSCS card verification";
  }
  // Rule 4: If no activity >30 days -> DORMANT
  else if (lastActivityAt) {
    const daysSinceActivity = (Date.now() - lastActivityAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceActivity > 30) {
      finalStage = "DORMANT";
      progressDataPatch.nextAction = "Re-engage candidate";
    }
  }
  // Rule 5: If candidate missing desiredRole or location -> PROFILE_INCOMPLETE
  else if (!candidateSnapshot?.desiredRole || !candidateSnapshot?.location) {
    finalStage = "PROFILE_INCOMPLETE";
    const missingFields: string[] = [];
    if (!candidateSnapshot?.desiredRole) {
      missingFields.push("desiredRole");
    }
    if (!candidateSnapshot?.location) {
      missingFields.push("location");
    }
    progressDataPatch.missingFields = missingFields;
    progressDataPatch.nextAction = "Collect missing profile information";
  }
  // Rule 6: If jobs matched >0 -> MATCHED_TO_JOBS
  else if (matchedJobsCount > 0) {
    finalStage = "MATCHED_TO_JOBS";
    progressDataPatch.nextAction = "Present job matches to candidate";
  }
  // Rule 7: If looking for work intent -> LOOKING_FOR_WORK
  else if (lastIntent === "LOOKING_FOR_WORK") {
    finalStage = "LOOKING_FOR_WORK";
    progressDataPatch.nextAction = "Find suitable job matches";
  }
  // Rule 8: Otherwise keep current stage (or use AI suggestion)
  // (finalStage already set above)

  // Set high priority flag for certain stages
  if (["CSCS_VERIFICATION", "READY_TO_PLACE", "MATCHED_TO_JOBS"].includes(finalStage)) {
    progressDataPatch.flags = {
      ...progressDataPatch.flags,
      highPriority: true,
    };
  }

  return {
    stage: finalStage,
    progressDataPatch,
  };
}

