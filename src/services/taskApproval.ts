import { TaskApprovalStatus } from "@prisma/client";

/**
 * Determine whether a Task requires human approval before downstream actions.
 *
 * NOTE: This is intentionally conservative and deterministic.
 * We map known "high-risk" or "locked" categories to PENDING so a recruiter/admin
 * can approve (or reject) the proposed action later.
 */
export function determineApprovalStatus(intent: string): TaskApprovalStatus {
  const normalized = intent.trim().toUpperCase();

  // Not required: safe to proceed with internal workflow without explicit approval.
  if (["UNKNOWN", "FOLLOW_UP", "UNSUBSCRIBE"].includes(normalized)) {
    return TaskApprovalStatus.NOT_REQUIRED;
  }

  // Pending: requires approval before we ever take an action (e.g., sending messages later).
  if (["APPLY", "CV_RECEIVED", "INTERESTED"].includes(normalized)) {
    return TaskApprovalStatus.PENDING;
  }

  // Locked category (still PENDING): salary/offer/rejection content is sensitive and must be approved.
  if (["SALARY", "OFFER", "REJECTION"].includes(normalized)) {
    return TaskApprovalStatus.PENDING;
  }

  // Default-safe behavior: no approval required unless explicitly categorized.
  return TaskApprovalStatus.NOT_REQUIRED;
}


