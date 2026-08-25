/**
 * Transformers to convert Prisma models to DTOs
 */

import type { Task, Message, Conversation, Contact, TimelineEvent, Operator, MessageReviewSample } from "@prisma/client";
import type { TaskListItemDTO, MessageDTO, ConversationDTO, TimelineEventDTO, PipelineItemDTO, ReviewSampleDTO } from "./operator.ts";
import type { PipelineItemEnriched } from "../services/jobPipelineService.ts";
import { buildDisplayName } from "../lib/displayName.ts";
import {
  labelForActionType,
  labelForIntent,
  labelForOpportunity,
  labelForTaskType,
  buildApprovalReason,
} from "../shared/taskLabels.ts";
import type { MessageDirection } from "@prisma/client";
import { sanitizeExplainability } from "../../shared/types/explainability.ts";

type TaskWithRelations = Task & {
  relatedMessage: (Message & { 
    contact: Contact; 
    conversation: Conversation;
    candidate?: { name: string | null; phone: string; desiredRole: string | null } | null;
  }) | null;
};

type MessageWithContact = Message & {
  contact: Contact;
};

type ConversationWithMessages = Conversation & {
  contact: Contact;
  messages: Message[];
  progressStage?: string;
  progressUpdatedAt?: Date;
  progressData?: any;
  memoryPack?: any;
  memoryUpdatedAt?: Date;
};

type TimelineEventWithRelations = TimelineEvent & {
  operator?: Operator | null;
};

/**
 * Extract risk level from proposedAction JSON or payload.proposedAction
 */
function extractRiskLevel(proposedAction: unknown, payload: unknown): "LOW" | "MEDIUM" | "HIGH" | null {
  // First check: proposedAction.riskLevel (top-level)
  if (proposedAction && typeof proposedAction === "object") {
    const action = proposedAction as Record<string, unknown>;
    const riskLevel = action.riskLevel;
    if (riskLevel === "LOW" || riskLevel === "MEDIUM" || riskLevel === "HIGH") {
      return riskLevel;
    }
  }

  // Second check: payload.proposedAction.riskLevel (nested in payload)
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const payloadProposedAction = p.proposedAction;
    if (payloadProposedAction && typeof payloadProposedAction === "object") {
      const action = payloadProposedAction as Record<string, unknown>;
      const riskLevel = action.riskLevel;
      if (riskLevel === "LOW" || riskLevel === "MEDIUM" || riskLevel === "HIGH") {
        return riskLevel;
      }
    }
  }

  return null;
}

/**
 * Extract suggested message from proposedAction JSON or payload (for opportunity tasks)
 */
function extractSuggestedMessage(proposedAction: unknown, payload?: unknown): string | null {
  // First check: proposedAction.suggestedMessage (top-level)
  if (proposedAction && typeof proposedAction === "object") {
    const action = proposedAction as Record<string, unknown>;
    const suggestedMessage = action.suggestedMessage;
    if (typeof suggestedMessage === "string") {
      return suggestedMessage;
    }
  }

  // Second check: payload.suggestedMessage (for opportunity tasks)
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const suggestedMessage = p.suggestedMessage;
    if (typeof suggestedMessage === "string") {
      return suggestedMessage;
    }
  }

  return null;
}

/**
 * Extract action type from proposedAction JSON
 */
function extractActionType(proposedAction: unknown): string | null {
  if (!proposedAction || typeof proposedAction !== "object") {
    return null;
  }

  const action = proposedAction as Record<string, unknown>;
  const actionType = action.actionType;

  if (typeof actionType === "string") {
    return actionType;
  }

  return null;
}

/**
 * Extract summary from task payload and proposedAction
 * Derives from proposedAction.actionType + short intent
 * For opportunity tasks, uses opportunityType and reasons
 */
function extractSummary(
  payload: unknown,
  proposedAction: unknown
): string | null {
  // Check if this is an opportunity task (has opportunityType in payload)
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const opportunityType = p.opportunityType;
    if (typeof opportunityType === "string") {
      // For opportunity tasks, use the first reason or opportunity type
      const reasons = p.reasons;
      if (Array.isArray(reasons) && reasons.length > 0 && typeof reasons[0] === "string") {
        return reasons[0];
      }
      return labelForOpportunity(opportunityType);
    }
  }

  // Translate internal codes into wording an operator can read.
  const actionType = labelForActionType(extractActionType(proposedAction));
  const intent = labelForIntent(extractIntent(payload));

  if (actionType && intent) {
    return `${actionType} — ${intent.toLowerCase()}`;
  }

  if (actionType) {
    return actionType;
  }

  if (intent) {
    return intent;
  }

  return null;
}

/**
 * Extract approval reason from task payload
 * Returns why approval was required (escalation reason, low confidence, etc.)
 * For opportunity tasks, returns opportunity reasons
 */
/**
 * Avoid printing the same sentence twice in one row. Opportunity tasks derived
 * their summary and their approval reason from the same source, so the list
 * rendered the identical phrase as both title and subtitle.
 */
function dedupeSummary(
  summary: string | null,
  approvalReason: string | null,
  taskType: string
): string | null {
  if (summary && approvalReason && summary.trim() === approvalReason.trim()) {
    return labelForTaskType(taskType);
  }
  return summary;
}

function extractApprovalReason(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  // Prefer an explicit approvalReason written at task-creation time. This was
  // previously never read, so operators saw no reason on most tasks.
  const explicit = buildApprovalReason(payload);
  if (explicit) return explicit;

  const p = payload as Record<string, unknown>;
  
  // Check if this is an opportunity task (has opportunityType in payload)
  const opportunityType = p.opportunityType;
  if (typeof opportunityType === "string") {
    // For opportunity tasks, return the opportunity type and first reason
    const reasons = p.reasons;
    if (Array.isArray(reasons) && reasons.length > 0 && typeof reasons[0] === "string") {
      return reasons[0];
    }
    return opportunityType.replace(/_/g, " ");
  }

  const replyDecision = p.replyDecision as Record<string, unknown> | undefined;

  if (replyDecision?.escalationReason) {
    return String(replyDecision.escalationReason);
  }

  if (replyDecision?.reason) {
    const reason = String(replyDecision.reason);
    if (reason === "escalation_trigger") {
      return String(replyDecision.escalationReason || "Requires approval");
    }
    if (reason === "low_confidence") {
      return "AI was unsure — needs a human check";
    }
    if (reason === "approval_only_mode") {
      return "Agency policy: every reply needs approval";
    }
    if (reason === "hybrid_requires_approval") {
      return "Agency policy: this reply needs approval";
    }
  }

  return null;
}

/**
 * Extract intent from task payload JSON
 */
function extractIntent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const p = payload as Record<string, unknown>;
  const intent = p.intent;

  if (typeof intent === "string") {
    return intent;
  }

  return null;
}

/**
 * Extract explainability from proposedAction or payload
 * Returns safe explainability DTO or null
 * Uses sanitizeExplainability from shared types for consistent validation
 */
function extractExplainability(proposedAction: unknown, payload: unknown): any | null {
  // First check: proposedAction.explainability (top-level)
  if (proposedAction && typeof proposedAction === "object") {
    const action = proposedAction as Record<string, unknown>;
    if (action.explainability) {
      try {
        const sanitized = sanitizeExplainability(action.explainability);
        return sanitized;
      } catch (error) {
        // If sanitization fails, return null (don't expose invalid data)
        return null;
      }
    }
  }

  // Second check: payload.proposedAction.explainability (nested in payload)
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    const payloadProposedAction = p.proposedAction;
    if (payloadProposedAction && typeof payloadProposedAction === "object") {
      const action = payloadProposedAction as Record<string, unknown>;
      if (action.explainability) {
        try {
          const sanitized = sanitizeExplainability(action.explainability);
          return sanitized;
        } catch (error) {
          // If sanitization fails, return null (don't expose invalid data)
          return null;
        }
      }
    }
  }

  return null;
}

/**
 * Extract usedFactsSnapshot from payload
 */
function extractUsedFactsSnapshot(payload: unknown): string[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const p = payload as Record<string, unknown>;
  const proposedAction = p.proposedAction;
  if (proposedAction && typeof proposedAction === "object") {
    const action = proposedAction as Record<string, unknown>;
    const usedFactsSnapshot = action.usedFactsSnapshot;
    if (Array.isArray(usedFactsSnapshot)) {
      return usedFactsSnapshot.filter((f): f is string => typeof f === "string").slice(0, 8);
    }
  }
  return null;
}

/**
 * Transform Task with relations to TaskListItemDTO
 */
export function toTaskListItemDTO(task: TaskWithRelations & { _candidate?: { name: string | null; phone: string; desiredRole: string | null } | null }): TaskListItemDTO {
  // Safely access nested properties - relatedMessage may be null for some task types (e.g., OUTREACH)
  const relatedMessage = task.relatedMessage;
  const contact = relatedMessage?.contact;
  // For opportunity tasks, candidate may be stored separately on task._candidate
  const candidate = relatedMessage?.candidate || (task as any)._candidate || null;
  
  // Build display name using consistent helper
  const { displayName, trade, phone } = buildDisplayName({
    candidate: candidate ? {
      name: candidate.name || null,
      desiredRole: candidate.desiredRole || null,
    } : null,
    contact: contact ? {
      name: contact.name || null,
    } : null,
    phone: candidate?.phone || contact?.phone || null,
  });
  
  // Legacy fields for backward compatibility
  let senderName: string | null = null;
  let senderPhone: string | null = null;

  if (candidate?.name) {
    senderName = candidate.name;
    senderPhone = candidate.phone || contact?.phone || null;
  } else if (contact?.name) {
    senderName = contact.name;
    senderPhone = contact?.phone || null;
  } else {
    senderPhone = candidate?.phone || contact?.phone || null;
  }

  // Extract explainability
  const explainability = extractExplainability(task.proposedAction, task.payload);
  const usedFactsSnapshot = extractUsedFactsSnapshot(task.payload);
  const proposedActionRiskLevel = extractRiskLevel(task.proposedAction, task.payload);
  
  return {
    taskId: task.id,
    type: task.type,
    approvalStatus: task.approvalStatus,
    status: task.status,
    riskLevel: proposedActionRiskLevel,
    createdAt: task.createdAt,
    conversationId: relatedMessage?.conversationId || (task.payload && typeof task.payload === "object" ? (task.payload as Record<string, unknown>).conversationId as string | undefined : undefined) || null,
    senderPhone,
    senderName, // Candidate name > Contact name > null (deprecated, use displayName)
    displayName,
    trade,
    phone,
    summary: dedupeSummary(extractSummary(task.payload, task.proposedAction), extractApprovalReason(task.payload), task.type),
    suggestedMessage: extractSuggestedMessage(task.proposedAction, task.payload),
    approvalReason: extractApprovalReason(task.payload),
    payload: task.payload, // Include full payload for task detail views (especially CSCS_VERIFICATION)
    // Explainability fields
    proposedAction: explainability || usedFactsSnapshot || proposedActionRiskLevel ? {
      explainability: explainability || null,
      riskLevel: proposedActionRiskLevel,
      usedFactsSnapshot: usedFactsSnapshot || null,
    } : null,
  };
}

type MessageWithRelations = Message & {
  relatedTasks?: Array<{ id: string; type: string; status: string }>;
  contact?: { id: string; phone: string; name: string | null };
};

/**
 * Compute display text for a message
 * Priority: body if exists > transcript if voice note > attachment labels if only media
 */
function computeDisplayText(message: Message | MessageWithRelations): string {
  const metadata = (message.metadata as any) || {};
  
  // If body exists and is not just a media snippet, use it
  if (message.text && message.text.trim() && !message.text.startsWith("🎤") && !message.text.startsWith("📷") && !message.text.startsWith("📎")) {
    return message.text;
  }
  
  // If transcript exists, show it
  if (metadata.transcript?.text) {
    return metadata.transcript.text;
  }
  
  // If media exists, show attachment labels
  if (metadata.media && Array.isArray(metadata.media) && metadata.media.length > 0) {
    const hasAudio = metadata.media.some((m: any) => m.kind === "audio");
    const hasImage = metadata.media.some((m: any) => m.kind === "image");
    const hasDocument = metadata.media.some((m: any) => m.kind === "document");
    
    if (hasAudio) {
      return "🎤 Audio message";
    }
    if (hasImage) {
      return "📷 Image received";
    }
    if (hasDocument) {
      return "📎 Document received";
    }
    return `📎 ${metadata.media.length} media file${metadata.media.length > 1 ? "s" : ""}`;
  }
  
  // Fallback to body (even if empty)
  return message.text || "";
}

/**
 * Transform Message to MessageDTO
 * Note: Date objects will be serialized to ISO strings by JSON.stringify
 * deliveryStatus and failureReason are only included for OUTBOUND messages
 */
export function toMessageDTO(message: Message | MessageWithRelations): MessageDTO {
  const dto: MessageDTO = {
    messageId: message.id,
    direction: message.direction,
    body: message.text,
    displayText: computeDisplayText(message),
    createdAt: message.createdAt instanceof Date ? message.createdAt.toISOString() : message.createdAt, // ISO string
  };

  // Only include deliveryStatus and failureReason for OUTBOUND messages
  if (message.direction === "OUTBOUND") {
    dto.deliveryStatus = message.deliveryStatus;
    if (message.deliveryStatus === "FAILED" && message.failureReason) {
      dto.failureReason = message.failureReason;
    }
  }

  // Include linked task if exists
  const msgWithRelations = message as MessageWithRelations;
  if (msgWithRelations.relatedTasks && msgWithRelations.relatedTasks.length > 0) {
    dto.linkedTaskId = msgWithRelations.relatedTasks[0].id;
  }

  // Include contact info if available
  if (msgWithRelations.contact) {
    dto.contactPhone = msgWithRelations.contact.phone;
    dto.contactName = msgWithRelations.contact.name;
  }

  // Include metadata if available (media, transcript, textForAI)
  if (message.metadata) {
    const metadata = message.metadata as any;
    dto.metadata = {
      media: metadata.media || null,
      transcript: metadata.transcript || null,
      textForAI: metadata.textForAI || null,
    };
  }

  return dto;
}

/**
 * Transform Conversation with messages to ConversationDTO
 */
export function toConversationDTO(conversation: ConversationWithMessages): ConversationDTO {
  const progressData = conversation.progressData as any;
  const memoryPack = conversation.memoryPack as any;
  
  return {
    conversationId: conversation.id,
    participantPhone: conversation.contact?.phone || null,
    updatedAt: conversation.lastMessageAt,
    state: (conversation as any).state || "ACTIVE",
    pausedReason: (conversation as any).pausedReason || null,
    messages: (conversation.messages || []).map(toMessageDTO),
    // Contact Progress
    progressStage: conversation.progressStage || undefined,
    progressUpdatedAt: conversation.progressUpdatedAt?.toISOString() || undefined,
    progressData: progressData || undefined,
    // Memory Pack
    memoryPack: memoryPack || undefined,
    memoryUpdatedAt: conversation.memoryUpdatedAt?.toISOString() || undefined,
  };
}

/**
 * Transform enriched pipeline item to PipelineItemDTO
 */
export function toPipelineItemDTO(
  item: PipelineItemEnriched
): PipelineItemDTO {
  const memoryPack = item.conversation?.memoryPack as any;
  const memorySummary = memoryPack?.summary || null;

  return {
    id: item.id,
    jobId: item.jobId,
    candidateId: item.candidateId,
    stage: item.stage,
    notes: item.notes,
    startDate: item.startDate?.toISOString() || null,
    payRate: item.payRate,
    shiftInfo: item.shiftInfo,
    noShowReason: item.noShowReason,
    droppedReason: item.droppedReason,
    updatedByOperatorId: item.updatedByOperatorId,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    candidate: item.candidate,
    matchScore: item.matchScore,
    matchTier: item.matchTier || null,
    conversation: item.conversation
      ? {
          progressStage: item.conversation.progressStage,
          memorySummary,
          lastActivityAt: item.conversation.lastMessageAt?.toISOString() || null,
        }
      : null,
  };
}

export function toTimelineEventDTO(
  event: TimelineEventWithRelations
): TimelineEventDTO {
  // Resolve actor name based on actorRole
  let actorName: string | null = null;
  if (event.actorRole === "OPERATOR" && event.operator) {
    // Use operator email as name (or could be enhanced with a name field if added)
    actorName = event.operator.email;
  } else if (event.actorRole === "SYSTEM") {
    actorName = "System";
  } else if (event.actorRole === "AI") {
    actorName = "AI";
  }

  // Sanitize data JSON to ensure no secrets are exposed
  let safeData: any = null;
  if (event.data) {
    const rawData = event.data as Record<string, unknown>;
    safeData = { ...rawData };
    
    // Remove any potentially sensitive fields
    delete safeData.prompt;
    delete safeData.systemPrompt;
    delete safeData.userPrompt;
    delete safeData.openaiResponse;
    delete safeData.apiKey;
    delete safeData.token;
    delete safeData.secret;
    delete safeData.password;
    delete safeData.passwordHash;
    
    // Truncate message snippets if present
    if (typeof safeData.messageSnippet === "string" && safeData.messageSnippet.length > 100) {
      safeData.messageSnippet = safeData.messageSnippet.substring(0, 100) + "...";
    }
    
    // Ensure all string values are safe (max 500 chars)
    Object.keys(safeData).forEach((key) => {
      const value = safeData[key];
      if (typeof value === "string" && value.length > 500) {
        safeData[key] = value.substring(0, 500) + "...";
      }
    });
  }

  return {
    eventId: event.id,
    type: event.type as any,
    actorRole: event.actorRole as any,
    actorName,
    operatorId: event.actorOperatorId || null,
    summary: event.summary,
    data: safeData,
    createdAt: event.createdAt.toISOString(),
    conversationId: event.conversationId,
    contactId: event.contactId,
    candidateId: event.candidateId || null,
  };
}

export function toReviewSampleDTO(
  sample: MessageReviewSample,
  task: { type: string; createdAt: Date } | null,
  candidate: { name: string | null; desiredRole: string | null; phone: string } | null,
  job: { title: string; city: string | null } | null,
  conversationSnippet: Array<{ id: string; direction: MessageDirection; text: string; createdAt: Date }> | null
): ReviewSampleDTO {
  const editMetrics = (sample.editMetrics as any) || {
    charDiffRatio: 0,
    wordDiffCount: 0,
    wasShortened: false,
    wasExpanded: false,
  };

  return {
    id: sample.id,
    taskId: sample.taskId,
    conversationId: sample.conversationId,
    candidateId: sample.candidateId,
    jobId: sample.jobId,
    createdAt: sample.createdAt.toISOString(),
    sampledReason: sample.sampledReason,
    proposedText: sample.proposedText,
    finalText: sample.finalText,
    editMetrics: {
      charDiffRatio: editMetrics.charDiffRatio || 0,
      wordDiffCount: editMetrics.wordDiffCount || 0,
      wasShortened: editMetrics.wasShortened || false,
      wasExpanded: editMetrics.wasExpanded || false,
    },
    verdict: sample.verdict,
    reviewedAt: sample.reviewedAt?.toISOString() || null,
    reviewedByOperatorId: sample.reviewedByOperatorId,
    notes: sample.notes,
    // Enriched fields (optional)
    task: task
      ? {
          type: task.type as any,
          createdAt: task.createdAt.toISOString(),
        }
      : undefined,
    candidate: candidate
      ? {
          name: candidate.name,
          desiredRole: candidate.desiredRole,
          phone: candidate.phone,
        }
      : undefined,
    job: job
      ? {
          title: job.title,
          city: job.city,
        }
      : undefined,
    conversationSnippet: conversationSnippet
      ? conversationSnippet.map((msg) => ({
          messageId: msg.id,
          direction: msg.direction,
          text: msg.text,
          createdAt: msg.createdAt.toISOString(),
        }))
      : undefined,
  };
}

