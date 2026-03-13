/**
 * Contact Progress tracking types
 * Shared between frontend and backend
 */

/**
 * Contact progress stages
 */
export type ContactProgressStage =
  | "NEW"
  | "PROFILE_INCOMPLETE"
  | "LOOKING_FOR_WORK"
  | "MATCHED_TO_JOBS"
  | "DOCS_NEEDED"
  | "CSCS_VERIFICATION"
  | "READY_TO_PLACE"
  | "PLACED"
  | "AFTERCARE"
  | "DORMANT"
  | "CLOSED";

/**
 * Contact progress metadata
 */
export interface ContactProgressData {
  /** Fields that are missing from the candidate profile */
  missingFields: string[];
  
  /** Next action to take (e.g., "Request CSCS card photo", "Schedule interview") */
  nextAction: string | null;
  
  /** ISO timestamp for when to follow up */
  followUpAt: string | null;
  
  /** Last decision made about this contact */
  lastDecision: {
    at: string; // ISO timestamp
    by: string; // Operator ID or "SYSTEM"
    reason: string;
  } | null;
  
  /** Optional flags */
  flags?: {
    /** Waiting for operator action */
    waitingForOperator?: boolean;
    /** High priority contact */
    highPriority?: boolean;
  };
  
  /** Confidence score (0-100) for the current stage assessment */
  confidence?: number;
}

