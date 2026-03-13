/**
 * Timeline Event Types
 * Shared types for timeline events across backend and frontend
 */

/**
 * Timeline event type enum (mirrors Prisma TimelineEventType)
 */
export type TimelineEventType =
  | "INBOUND_MESSAGE_RECEIVED"
  | "AI_SUGGESTION_CREATED"
  | "TASK_CREATED"
  | "TASK_APPROVED"
  | "TASK_REJECTED"
  | "PROGRESS_STAGE_CHANGED"
  | "MEMORY_PACK_UPDATED"
  | "CSCS_AUTO_VERIFIED"
  | "CSCS_APPROVED"
  | "CSCS_REJECTED"
  | "OUTREACH_SENT"
  | "FOLLOW_UP_CREATED"
  | "JOB_PIPELINE_UPDATED"
  | "JOB_PIPELINE_REMOVED"
  | "OUTREACH_TASK_CREATED"
  | "START_FOLLOWUP_CREATED"
  | "REVIEW_VERDICT_SET"
  | "REPLAY_INBOUND_STARTED"
  | "REPLAY_INBOUND_FINISHED"
  | "MEDIA_RECEIVED"
  | "VOICE_TRANSCRIBED"
  | "MEDIA_LINKED_TO_TASK"
  | "OPPORTUNITY_TASK_CREATED"
  | "SETTINGS_PLAYBOOK_UPDATED"
  | "OPEN_QUESTION_ADDED"
  | "OPEN_QUESTION_RESOLVED"
  | "OPEN_QUESTION_FOLLOWUP_CREATED";

/**
 * Timeline actor role enum (mirrors Prisma TimelineActorRole)
 */
export type TimelineActorRole = "SYSTEM" | "AI" | "OPERATOR";

/**
 * Timeline event data structure (safe JSON, no secrets)
 */
export interface TimelineEventData {
  // Task-related data
  taskId?: string;
  taskType?: string;
  taskStatus?: string;
  
  // Message-related data
  messageId?: string;
  messageDirection?: string;
  messageSnippet?: string; // First 100 chars only
  
  // Progress-related data
  previousStage?: string;
  newStage?: string;
  nextAction?: string;
  
  // Memory pack related data
  memoryPackVersion?: number;
  
  // CSCS related data
  cscsStatus?: string;
  cscsIssues?: string[];
  
  // Outreach related data
  outreachType?: string;
  outreachTarget?: string;
  
  // Follow-up related data
  followUpAt?: string; // ISO date
  followUpReason?: string;
  
  // Generic metadata
  [key: string]: unknown;
}

