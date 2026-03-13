/**
 * Progress State Machine Types
 * Deterministic state machine for conversation progress tracking
 */

import type { ContactProgressStage } from "../../../shared/types/progress.ts";

/**
 * Progress stage type (reuse shared type)
 */
export type ProgressStage = ContactProgressStage;

/**
 * All possible progress stages (stable set)
 */
export const PROGRESS_STAGES = {
  NEW: "NEW",
  PROFILE_INCOMPLETE: "PROFILE_INCOMPLETE",
  LOOKING_FOR_WORK: "LOOKING_FOR_WORK",
  MATCHED_TO_JOBS: "MATCHED_TO_JOBS",
  DOCS_NEEDED: "DOCS_NEEDED",
  CSCS_VERIFICATION: "CSCS_VERIFICATION",
  READY_TO_PLACE: "READY_TO_PLACE",
  PLACED: "PLACED",
  AFTERCARE: "AFTERCARE",
  DORMANT: "DORMANT",
  CLOSED: "CLOSED",
} as const;

/**
 * Candidate snapshot fields used for state computation
 */
export interface CandidateSnapshot {
  desiredRole: string | null;
  location: string | null;
  skills: string[] | null;
  availability: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  yearsExperience: number | null;
  phone: string;
  name: string | null;
}

/**
 * Task status flags
 */
export interface TaskFlags {
  hasPendingApproval: boolean;
  hasOpenCscsTask: boolean;
  hasOpenFollowUpTask: boolean;
  hasOpenTasks: boolean;
}

/**
 * Placement status
 */
export interface PlacementStatus {
  hasConfirmedPlacement: boolean;
  placementStartDate: string | null; // ISO date
}

/**
 * Context for progress state machine computation
 */
export interface ProgressMachineContext {
  // Current state
  currentStage: ProgressStage;
  currentProgressData: {
    missingFields?: string[];
    nextAction?: string | null;
    followUpAt?: string | null;
    flags?: {
      waitingForOperator?: boolean;
      needsFollowUp?: boolean;
      highPriority?: boolean;
    };
    lastStageReason?: string;
    lastStageChangedAt?: string;
  } | null;

  // Conversation metadata
  conversationId: string;
  lastActivityAt: Date | string; // ISO string or Date
  lastInboundMessageAt: Date | string | null; // ISO string or Date or null

  // Candidate snapshot
  candidate: CandidateSnapshot | null;

  // Task flags
  tasks: TaskFlags;

  // Placement status
  placement: PlacementStatus | null;

  // Intent classification
  lastIntent: string | null; // "LOOKING_FOR_WORK", "AVAILABILITY_UPDATE", "UNKNOWN", etc.

  // Job matches
  matchedJobsCount: number;

  // Contact type (if available)
  contactType?: string | null;
}

/**
 * Result of state machine computation
 */
export interface ProgressStateResult {
  stage: ProgressStage;
  reason: string; // Human-readable reason for stage/change
  progressDataPatch: {
    missingFields: string[];
    nextAction: string | null;
    followUpAt: string | null; // ISO date string
    flags: {
      waitingForOperator: boolean;
      needsFollowUp: boolean;
      highPriority: boolean;
    };
    lastStageReason: string;
    lastStageChangedAt: string; // ISO date string
  };
}

/**
 * Normalize missing fields array
 * Removes duplicates, trims, filters empty strings
 */
export function normalizeMissingFields(fields: (string | null | undefined)[]): string[] {
  return Array.from(
    new Set(
      fields
        .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
        .map((f) => f.trim())
    )
  ).sort();
}

/**
 * Compute follow-up date for dormancy
 * Returns ISO date string or null
 */
export function computeDormancyFollowUpAt(lastActivityAt: Date | string): string | null {
  const lastActivity = typeof lastActivityAt === "string" ? new Date(lastActivityAt) : lastActivityAt;
  if (isNaN(lastActivity.getTime())) {
    return null;
  }

  const now = new Date();
  const daysSinceActivity = Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));

  // If dormant (>30 days), suggest follow-up in 7 days
  if (daysSinceActivity > 30) {
    const followUpDate = new Date(now);
    followUpDate.setDate(followUpDate.getDate() + 7);
    return followUpDate.toISOString();
  }

  return null;
}

/**
 * Convert date to ISO string safely
 */
export function safeIsoString(date: Date | string | null | undefined): string {
  if (!date) {
    return new Date().toISOString();
  }
  if (typeof date === "string") {
    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) {
      return new Date().toISOString();
    }
    return parsed.toISOString();
  }
  return date.toISOString();
}

/**
 * Clamp number between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Get default value if null/undefined
 */
export function defaultValue<T>(value: T | null | undefined, defaultValue: T): T {
  return value ?? defaultValue;
}

/**
 * Check if date is older than N days
 */
export function isOlderThanDays(date: Date | string | null, days: number): boolean {
  if (!date) {
    return true; // Treat null as very old
  }
  const dateObj = typeof date === "string" ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) {
    return true;
  }
  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= days;
}

/**
 * Check if date is within last N days
 */
export function isWithinLastDays(date: Date | string | null, days: number): boolean {
  if (!date) {
    return false;
  }
  const dateObj = typeof date === "string" ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) {
    return false;
  }
  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= days;
}

