"use client";

import type { ToastVariant, NextAction } from "./ToastProvider";

/**
 * Toast preset helper functions for standardized messages
 */

export interface ToastPreset {
  variant: ToastVariant;
  title: string;
  confirmation?: string;
  outcome?: string;
  nextAction?: string | NextAction;
}

/**
 * Toast for when a task is approved and message is sent
 * @param candidateName - Name of the candidate
 * @param remainingCount - Number of remaining pending tasks
 * @param onNavigate - Optional callback for navigation (e.g., to Inbox/Tasks)
 */
export function toastTaskApproved(
  candidateName: string,
  remainingCount: number,
  onNavigate?: () => void
): ToastPreset {
  return {
    variant: "success",
    title: `Message sent to ${candidateName}`,
    confirmation: "✓ Confirmation: Action completed successfully",
    outcome: "📋 Outcome: Task moved to completed queue",
    nextAction: {
      label: `→ Next: Review next task (${remainingCount} remaining)`,
      onClick: onNavigate,
    },
  };
}

/**
 * Toast for when a task is rejected
 * @param remainingCount - Number of remaining pending tasks
 * @param onNavigate - Optional callback for navigation (e.g., to Inbox/Tasks)
 */
export function toastTaskRejected(
  remainingCount: number,
  onNavigate?: () => void
): ToastPreset {
  return {
    variant: "info",
    title: "Task rejected",
    confirmation: "✓ Confirmation: Message discarded",
    outcome: "📋 Outcome: Rejected task moved to review queue",
    nextAction: {
      label: `→ Next: Review next task (${remainingCount} remaining)`,
      onClick: onNavigate,
    },
  };
}

/**
 * Toast for when an action fails
 * @param message - Error message to display
 * @param onRetry - Optional retry callback function
 */
export function toastActionFailed(
  message: string,
  onRetry?: () => void
): ToastPreset {
  return {
    variant: "error",
    title: "Action failed",
    confirmation: "✗ Confirmation: Could not complete action",
    outcome: `📋 Outcome: ${message}`,
    nextAction: onRetry
      ? {
          label: "→ Next: Retry sending",
          onClick: onRetry,
        }
      : "→ Next: Retry or contact candidate by phone",
  };
}

/**
 * Toast for when a follow-up is needed with a candidate
 * @param candidateName - Name of the candidate
 */
export function toastFollowUpNeeded(candidateName: string): ToastPreset {
  return {
    variant: "warning",
    title: `Follow-up needed with ${candidateName}`,
    confirmation: "✓ Confirmation: Follow-up task created",
    outcome: "📋 Outcome: Candidate requires additional contact",
    nextAction: "→ Next: Review follow-up task",
  };
}

/**
 * Toast for when a placement is confirmed
 * @param candidateName - Name of the candidate
 * @param clientName - Name of the client/company
 */
export function toastPlacementConfirmed(
  candidateName: string,
  clientName: string
): ToastPreset {
  return {
    variant: "success",
    title: `Placement confirmed: ${candidateName}`,
    confirmation: "✓ Confirmation: Placement successfully confirmed",
    outcome: `📋 Outcome: ${candidateName} placed with ${clientName}`,
    nextAction: "→ Next: Review placement details",
  };
}

