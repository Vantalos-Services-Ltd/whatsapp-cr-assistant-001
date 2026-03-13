/**
 * Opportunity types for revenue optimization
 */
export type OpportunityType =
  | "UNDERFILLED_URGENT_JOB"
  | "DORMANT_CANDIDATES_MATCH_URGENT_JOB"
  | "FOLLOW_UP_AFTER_OFFER"
  | "DAY1_AFTERCARE_CHECKIN";

/**
 * Recommended action for an opportunity
 */
export interface RecommendedAction {
  taskType: "OUTREACH" | "FOLLOW_UP";
  count: number; // Number of tasks to create
  description: string;
}

/**
 * Opportunity model
 */
export interface Opportunity {
  id: string; // Stable deterministic hash
  type: OpportunityType;
  title: string; // Short title
  priority: number; // 0-100 score
  reasons: string[]; // Max 3 bullets
  recommendedAction: RecommendedAction;
  relatedEntities: {
    jobId?: string;
    candidateIds?: string[];
    conversationIds?: string[];
  };
  expiresAt: Date;
  createdAt: Date;
}

