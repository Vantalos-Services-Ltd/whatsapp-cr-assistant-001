/**
 * Reply Strategy Service
 * Determines whether to auto-reply or require approval based on messaging mode and content
 */

import pino from "pino";
import type { InboundIntent } from "../domain/intent.ts";
import type { AgencyPlaybook } from "../shared/playbook.ts";

const log = pino({ name: "replyStrategy" });

export type MessagingMode = "AUTOPILOT" | "HYBRID" | "APPROVAL_ONLY";

export interface ReplyDecision {
  shouldAutoReply: boolean;
  reason: string;
  escalationReason?: string;
  confidence?: "HIGH" | "MEDIUM" | "LOW";
}

/**
 * Check if message content triggers escalation (always requires approval)
 */
export function requiresEscalation(
  intent: InboundIntent,
  messageText: string,
  proposedAction?: { riskLevel?: string; [key: string]: unknown },
  playbook?: AgencyPlaybook
): { requires: boolean; reason?: string } {
  const text = messageText.toLowerCase();

  // Escalation triggers
  const escalationPatterns = [
    // Salary/compensation
    { pattern: /\b(salary|wage|pay|rate|compensation|earn|money|£|€|\$)\b/i, reason: "salary/compensation" },
    // Offer/contract/start date
    { pattern: /\b(offer|contract|agreement|start date|start on|begin|commence)\b/i, reason: "offer/contract/start date" },
    // Rejection/disqualification
    { pattern: /\b(reject|decline|not interested|not suitable|disqualify|unqualified)\b/i, reason: "rejection/disqualification" },
    // Legal/sensitive
    { pattern: /\b(legal|lawsuit|sue|discrimination|harassment|complaint|grievance)\b/i, reason: "legal/sensitive" },
  ];

  for (const { pattern, reason } of escalationPatterns) {
    if (pattern.test(text)) {
      return { requires: true, reason };
    }
  }

  // Check playbook escalation rules
  if (playbook?.escalationRules) {
    if (playbook.escalationRules.unknownIntentAlwaysApproval && intent === "UNKNOWN") {
      return { requires: true, reason: "playbook_rule_unknown_intent_requires_approval" };
    }
    if (playbook.escalationRules.salaryTalkRequiresApproval) {
      const salaryPattern = /\b(salary|wage|pay|rate|compensation|earn|money|£|€|\$)\b/i;
      if (salaryPattern.test(text)) {
        return { requires: true, reason: "playbook_rule_salary_talk_requires_approval" };
      }
    }
  }

  // Check intent-based escalation
  if (intent === "JOB_QUERY") {
    // Job queries often involve salary, location, etc. - require approval
    return { requires: true, reason: "job_query_intent" };
  }

  // Check risk level from proposed action
  if (proposedAction?.riskLevel === "HIGH") {
    return { requires: true, reason: "high_risk_action" };
  }

  return { requires: false };
}

/**
 * Determine confidence level for auto-reply
 */
function getConfidence(
  intent: InboundIntent,
  proposedAction?: { riskLevel?: string; [key: string]: unknown }
): "HIGH" | "MEDIUM" | "LOW" {
  // High confidence: clear intent, low risk, known patterns
  if (intent !== "UNKNOWN" && proposedAction?.riskLevel === "LOW") {
    return "HIGH";
  }

  // Medium confidence: clear intent but medium risk
  if (intent !== "UNKNOWN" && proposedAction?.riskLevel === "MEDIUM") {
    return "MEDIUM";
  }

  // Low confidence: unknown intent or high risk
  return "LOW";
}

/**
 * Determine reply strategy based on messaging mode and content
 */
export function determineReplyStrategy(
  messagingMode: MessagingMode,
  intent: InboundIntent,
  messageText: string,
  proposedAction?: { riskLevel?: string; actionType?: string; [key: string]: unknown },
  playbook?: AgencyPlaybook
): ReplyDecision {
  // Check escalation triggers first (always require approval)
  const escalation = requiresEscalation(intent, messageText, proposedAction, playbook);
  if (escalation.requires) {
    return {
      shouldAutoReply: false,
      reason: "escalation_trigger",
      escalationReason: escalation.reason,
    };
  }

  // Mode-specific logic
  switch (messagingMode) {
    case "AUTOPILOT":
      // Always auto-reply unless hard-blocked (escalation already checked above)
      return {
        shouldAutoReply: true,
        reason: "autopilot_mode",
        confidence: getConfidence(intent, proposedAction),
      };

    case "HYBRID":
      // Auto-reply only if low-risk + high-confidence
      const confidence = getConfidence(intent, proposedAction);
      const riskLevel = proposedAction?.riskLevel || "MEDIUM";

      if (riskLevel === "LOW" && confidence === "HIGH") {
        return {
          shouldAutoReply: true,
          reason: "hybrid_auto_low_risk_high_confidence",
          confidence,
        };
      }

      // Otherwise require approval
      return {
        shouldAutoReply: false,
        reason: "hybrid_requires_approval",
        confidence,
        escalationReason: riskLevel !== "LOW" ? "medium_or_high_risk" : "low_confidence",
      };

    case "APPROVAL_ONLY":
      // Always require approval
      return {
        shouldAutoReply: false,
        reason: "approval_only_mode",
      };

    default:
      // Default to approval-only for safety
      log.warn({ messagingMode }, "Unknown messaging mode, defaulting to approval-only");
      return {
        shouldAutoReply: false,
        reason: "unknown_mode_default",
      };
  }
}

