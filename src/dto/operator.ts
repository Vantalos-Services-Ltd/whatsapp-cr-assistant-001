/**
 * Data Transfer Objects (DTOs) for Operator UI
 * These types define the exact shape of data returned to the frontend.
 * Do not expose Prisma models directly.
 */

import type {
  TaskType,
  TaskStatus,
  TaskApprovalStatus,
  MessageDirection,
  MessageDeliveryStatus,
  ConversationState,
  JobPipelineStage,
  NoShowReason,
  DroppedReason,
  ReviewVerdict,
  SampledReason,
} from "@prisma/client";

/**
 * Explainability DTO (safe subset for frontend)
 */
export interface ExplainabilityDTO {
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  rationale: string[];
  usedFacts: string[];
  uncertainty: string | null;
  missingInfo: string[];
  alternatives: Array<{
    action: string;
    reason: string;
  }>;
  confidence?: number;
  generatedBy: "AI" | "RULES";
  generatedAt: string;
}

/**
 * Task list item for operator dashboard
 */
export interface TaskListItemDTO {
  taskId: string;
  type: TaskType;
  approvalStatus: TaskApprovalStatus;
  status: TaskStatus;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | null;
  createdAt: Date;
  conversationId: string | null;
  senderPhone: string | null;
  summary: string | null;
  suggestedMessage: string | null;
  approvalReason?: string | null; // Why approval was required
  proposedAction?: {
    explainability: ExplainabilityDTO | null;
    riskLevel: "LOW" | "MEDIUM" | "HIGH" | null;
    usedFactsSnapshot: string[] | null;
  } | null;
}

/**
 * Media item metadata
 */
export interface MessageMediaDTO {
  sid: string; // Media SID from Twilio
  url: string; // Media URL
  contentType: string; // MIME type (e.g., "audio/ogg", "image/jpeg", "application/pdf")
  kind: "image" | "audio" | "document"; // Media type
  sizeBytes?: number | null; // File size in bytes
  durationSeconds?: number | null; // Duration for audio/video (seconds)
  receivedAt: string; // ISO date string
}

/**
 * Transcript metadata
 */
export interface MessageTranscriptDTO {
  text: string; // Transcribed text
  provider: string; // Transcription provider (e.g., "twilio", "openai")
  createdAt: string; // ISO date string
  confidence?: number | null; // Confidence score 0-1
  language?: string | null; // Detected language code (e.g., "en-GB")
}

/**
 * Message metadata (media and transcript)
 */
export interface MessageMetadataDTO {
  media?: MessageMediaDTO[] | null; // Array of media items
  transcript?: MessageTranscriptDTO | null; // Transcript for voice notes
  textForAI?: string | null; // Text to use for AI processing (transcript if exists, else body)
}

/**
 * Message data for operator UI
 */
export interface MessageDTO {
  messageId: string;
  direction: MessageDirection;
  body: string;
  displayText: string; // Computed: body if exists, transcript if voice note, attachment labels if only media
  createdAt: Date;
  deliveryStatus?: MessageDeliveryStatus; // Only for OUTBOUND messages
  failureReason?: string | null; // Only for OUTBOUND messages with FAILED status
  linkedTaskId?: string | null; // Task ID if message created a task
  contactPhone?: string | null; // Contact phone number
  contactName?: string | null; // Contact name if known
  metadata?: MessageMetadataDTO | null; // Media and transcript metadata
}

/**
 * Conversation with messages for operator UI
 */
export interface ConversationDTO {
  conversationId: string;
  participantPhone: string;
  updatedAt: Date;
  state: ConversationState;
  pausedReason: string | null;
  messages: MessageDTO[];
}

/**
 * Lightweight conversation list item
 */
export interface ConversationListItemDTO {
  conversationId: string;
  participantPhone: string;
  updatedAt: Date;
  state: ConversationState;
  pausedReason: string | null;
  lastMessageSnippet: string | null;
}

/**
 * Candidate detail for operator UI
 */
export interface CandidateDetailDTO {
  candidateId: string;
  phone: string;
  name: string | null;
  location: string | null;
  desiredRole: string | null;
  skills: string[];
  yearsExperience: number | null;
  salary: {
    min: number | null;
    max: number | null;
    currency: string | null;
  } | null;
  availabilityNotes: string | null;
  lastSeenAt: Date;
  lastContactedAt: Date | null;
  recentMessages: Array<{
    messageId: string;
    direction: MessageDirection;
    text: string;
    createdAt: Date;
  }>;
}

/**
 * Timeline event for operator UI
 */
export interface TimelineEventDTO {
  eventId: string;
  type: "INBOUND_MESSAGE_RECEIVED" | "AI_SUGGESTION_CREATED" | "TASK_CREATED" | "TASK_APPROVED" | "TASK_REJECTED" | "PROGRESS_STAGE_CHANGED" | "MEMORY_PACK_UPDATED" | "CSCS_AUTO_VERIFIED" | "CSCS_APPROVED" | "CSCS_REJECTED" | "OUTREACH_SENT" | "FOLLOW_UP_CREATED" | "JOB_PIPELINE_UPDATED" | "JOB_PIPELINE_REMOVED" | "OUTREACH_TASK_CREATED" | "START_FOLLOWUP_CREATED" | "REVIEW_VERDICT_SET";
  actorRole: "SYSTEM" | "AI" | "OPERATOR";
  actorName: string | null; // Operator name if OPERATOR, "System" if SYSTEM, "AI" if AI
  operatorId: string | null; // Only present if actorRole is OPERATOR
  summary: string;
  data: Record<string, unknown> | null; // Safe JSON, no secrets
  createdAt: string; // ISO date string
  conversationId: string;
  contactId: string;
  candidateId: string | null;
}

/**
 * Pipeline item for job pipeline UI
 */
export interface PipelineItemDTO {
  id: string;
  jobId: string;
  candidateId: string;
  stage: JobPipelineStage;
  notes: string | null;
  startDate: string | null; // ISO date string
  payRate: number | null;
  shiftInfo: string | null;
  noShowReason: NoShowReason | null;
  droppedReason: DroppedReason | null;
  updatedByOperatorId: string | null;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  // Enriched fields
  candidate: {
    name: string | null;
    desiredRole: string | null;
    location: string | null;
    availabilityNotes: string | null;
    phone: string;
  };
  matchScore: number | null;
  matchTier: string | null;
  conversation: {
    progressStage: string | null;
    memorySummary: string | null; // Extracted from memoryPack.summary
    lastActivityAt: string | null; // ISO date string
  } | null;
}

/**
 * Review sample for quality control UI
 */
export interface ReviewSampleDTO {
  id: string;
  taskId: string;
  conversationId: string | null;
  candidateId: string | null;
  jobId: string | null;
  createdAt: string; // ISO date string
  sampledReason: SampledReason;
  proposedText: string;
  finalText: string;
  editMetrics: {
    charDiffRatio: number;
    wordDiffCount: number;
    wasShortened: boolean;
    wasExpanded: boolean;
  };
  verdict: ReviewVerdict | null;
  reviewedAt: string | null; // ISO date string
  reviewedByOperatorId: string | null;
  notes: string | null;
  // Enriched fields (for detail view)
  task?: {
    type: TaskType;
    createdAt: string;
  };
  candidate?: {
    name: string | null;
    desiredRole: string | null;
    phone: string;
  };
  job?: {
    title: string;
    city: string | null;
  };
  conversationSnippet?: Array<{
    messageId: string;
    direction: MessageDirection;
    text: string;
    createdAt: string;
  }>;
}

/**
 * Playbook DTO for operator UI
 */
export interface PlaybookDTO {
  toneStyle: string;
  maxQuestionsPerMessage: number;
  greetingStyle: "SHORT" | "NONE" | "NORMAL";
  forbiddenPhrases: string[];
  requiredChecks: {
    confirmLocation?: boolean;
    confirmAvailability?: boolean;
    confirmTickets?: boolean;
  };
  escalationRules: {
    unknownIntentAlwaysApproval?: boolean;
    salaryTalkRequiresApproval?: boolean;
  };
  signatureStyle: "NONE" | "NAME" | "AGENCY";
  updatedAt: string; // ISO date string
  createdAt: string; // ISO date string
}
