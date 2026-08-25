/**
 * Human-readable labels for internal enums.
 *
 * Internal codes (SEND_MESSAGE, DORMANT_CANDIDATES_MATCH_URGENT_JOB, ...) must
 * never reach the operator console. Everything the UI displays is translated
 * here, at the DTO boundary, so every consumer gets the same wording.
 */

const ACTION_TYPE_LABELS: Record<string, string> = {
  SEND_MESSAGE: "Reply drafted",
  REQUEST_INFO: "Needs more info",
  ESCALATE: "Escalated for review",
  NO_ACTION: "No action needed",
};

const INTENT_LABELS: Record<string, string> = {
  LOOKING_FOR_WORK: "Looking for work",
  AVAILABILITY_UPDATE: "Availability update",
  JOB_QUERY: "Asking about a job",
  FOLLOW_UP: "Following up",
  UNKNOWN: "Unclear",
};

const OPPORTUNITY_LABELS: Record<string, string> = {
  UNDERFILLED_URGENT_JOB: "Urgent job is short-staffed",
  DORMANT_CANDIDATES_MATCH_URGENT_JOB: "Dormant candidate matches urgent job",
  FOLLOW_UP_AFTER_OFFER: "Chase an unanswered offer",
  DAY1_AFTERCARE_CHECKIN: "First-day check-in",
};

const TASK_TYPE_LABELS: Record<string, string> = {
  APPROVAL_REQUIRED: "Reply to approve",
  FOLLOW_UP: "Follow-up",
  ESCALATION: "Escalation",
  OUTREACH: "Outreach",
  CSCS_VERIFICATION: "Card verification",
};

const PROGRESS_STAGE_LABELS: Record<string, string> = {
  NEW: "New",
  PROFILE_INCOMPLETE: "Profile incomplete",
  LOOKING_FOR_WORK: "Looking for work",
  MATCHED_TO_JOBS: "Matched to jobs",
  DOCS_NEEDED: "Documents needed",
  CSCS_VERIFICATION: "Card verification",
  READY_TO_PLACE: "Ready to place",
  PLACED: "Placed",
  AFTERCARE: "Aftercare",
  DORMANT: "Dormant",
  CLOSED: "Closed",
};

/** Last-resort humaniser: SOME_ENUM_VALUE -> "Some enum value" */
export function humanise(code: string): string {
  const words = code.replace(/_/g, " ").toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function lookup(map: Record<string, string>, code: unknown): string | null {
  if (typeof code !== "string" || !code.trim()) return null;
  return map[code] ?? humanise(code);
}

export const labelForActionType = (c: unknown) => lookup(ACTION_TYPE_LABELS, c);
export const labelForIntent = (c: unknown) => lookup(INTENT_LABELS, c);
export const labelForOpportunity = (c: unknown) => lookup(OPPORTUNITY_LABELS, c);
export const labelForTaskType = (c: unknown) => lookup(TASK_TYPE_LABELS, c);
export const labelForProgressStage = (c: unknown) => lookup(PROGRESS_STAGE_LABELS, c);

/**
 * Plain-English sentence for why a task needs a human.
 * Falls back through the several shapes the payload has taken over time.
 */
export function buildApprovalReason(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  // Most specific: an explicit reason written when the task was created.
  if (typeof p.approvalReason === "string" && p.approvalReason.trim()) {
    return p.approvalReason.trim();
  }

  const replyDecision = p.replyDecision as Record<string, unknown> | undefined;
  if (typeof replyDecision?.escalationReason === "string") {
    return String(replyDecision.escalationReason);
  }

  if (typeof p.opportunityType === "string") {
    const reasons = p.reasons;
    if (Array.isArray(reasons) && typeof reasons[0] === "string") return reasons[0];
    return labelForOpportunity(p.opportunityType);
  }

  if (typeof p.reason === "string" && p.reason.trim()) return p.reason.trim();

  return null;
}
