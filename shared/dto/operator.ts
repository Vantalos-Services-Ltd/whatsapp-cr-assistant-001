/**
 * Data Transfer Objects (DTOs) for Operator UI
 * Shared types that can be imported by both backend and frontend
 */

import type { TimelineEventType, TimelineActorRole, TimelineEventData } from "../types/timeline.js";

/**
 * Task list item for operator dashboard
 */
/**
 * Explainability data for task suggestions
 */
export interface ExplainabilityDTO {
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  rationale: string[];
  usedFacts: string[];
  uncertainty: string | null;
  missingInfo: string[];
  alternatives: Array<{ action: string; reason: string }>;
  confidence?: number;
  generatedBy: "AI" | "RULES";
  generatedAt: string;
}

export interface TaskListItemDTO {
  taskId: string;
  type: "APPROVAL_REQUIRED" | "FOLLOW_UP" | "ESCALATION" | "OUTREACH" | "CSCS_VERIFICATION";
  approvalStatus: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";
  status: "OPEN" | "APPROVED" | "REJECTED" | "DONE" | "FAILED";
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | null;
  createdAt: string; // ISO date string
  conversationId: string | null;
  senderPhone: string | null;
  senderName: string | null; // Contact or Candidate name if available (deprecated, use displayName)
  displayName: string; // "Name - Trade" or phone fallback
  trade?: string | null; // Candidate.desiredRole if available
  phone: string; // Formatted phone (without whatsapp: prefix)
  summary: string | null;
  suggestedMessage: string | null;
  approvalReason?: string | null; // Why approval was required
  payload?: any; // Full task payload (included for CSCS_VERIFICATION and other task types that need it)
  priority?: {
    score: number;
    label: string | null;
    marginPerHour: number | null;
    expectedHours: number | null;
  };
  // Explainability fields
  proposedAction?: {
    explainability?: ExplainabilityDTO | null;
    riskLevel?: "LOW" | "MEDIUM" | "HIGH" | null;
    usedFactsSnapshot?: string[] | null;
  } | null;
}

/**
 * Message data for operator UI
 */
export interface MessageDTO {
  messageId: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  createdAt: string; // ISO date string
  deliveryStatus?: "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED"; // Only for OUTBOUND
  failureReason?: string | null; // Only for OUTBOUND messages with FAILED status
  linkedTaskId?: string | null; // Task ID if message created a task
  contactPhone?: string | null; // Contact phone number
  contactName?: string | null; // Contact name if known
}

/**
 * Contact data for operator UI
 */
export interface ContactDTO {
  id: string;
  phone: string;
  name: string | null;
  candidateName?: string | null;
  desiredRole?: string | null;
  lastSeenAt?: string | null;
  lastConversationId?: string | null;
  lastMessageSnippet?: string | null;
  conversationState?: string | null;
  hasPendingApproval?: boolean;
  // Contact Progress (lightweight)
  progressStage?: string;
  progressUpdatedAt?: string; // ISO date string
  memorySummary?: string | null; // From memoryPack.summary
  followUpAt?: string | null; // ISO date string from progressData.followUpAt
  waitingForOperator?: boolean; // From progressData.flags.waitingForOperator
}

/**
 * Conversation state enum
 */
export type ConversationState = "ACTIVE" | "PAUSED_FOR_APPROVAL" | "PAUSED" | "CLOSED";

/**
 * Conversation with messages for operator UI
 */
export interface ConversationDTO {
  conversationId: string;
  participantPhone: string;
  participantDisplayName: string; // "Name - Trade" or phone fallback
  updatedAt: string; // ISO date string
  state: ConversationState;
  pausedReason: string | null;
  messages: MessageDTO[];
  // Contact Progress tracking
  progressStage?: string;
  progressUpdatedAt?: string; // ISO date string
  progressData?: any; // ContactProgressData
  // Memory Pack
  memoryPack?: any; // MemoryPack
  memoryUpdatedAt?: string; // ISO date string
}

/**
 * Lightweight conversation list item
 */
export interface ConversationListItemDTO {
  conversationId: string;
  participantPhone: string;
  participantDisplayName: string; // "Name - Trade" or phone fallback
  updatedAt: string; // ISO date string
  state: ConversationState;
  pausedReason: string | null;
  lastMessageSnippet: string | null;
  // Contact Progress (lightweight)
  progressStage?: string;
  nextAction?: string | null; // From progressData.nextAction or memoryPack.nextAction
  followUpAt?: string | null; // ISO date string from progressData.followUpAt
  memorySummary?: string | null; // From memoryPack.summary
}

