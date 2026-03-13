/**
 * Open Question Rules
 * Deterministic logic for tracking and managing open questions
 * No AI calls - pure rules-based logic
 */

import { createHash } from "crypto";
import type {
  OpenQuestion,
  OpenQuestionKey,
  OpenQuestionEvidence,
} from "../../../shared/types/memoryPack.ts";
import type { ContactProgressStage, ContactProgressData } from "../../../shared/types/progress.ts";
import type { CandidateSnapshot } from "../progress/stateMachineTypes.ts";
import type { AgencyPlaybook } from "../../shared/playbook.ts";
import { buildGreeting } from "../playbook/playbookPromptBuilder.ts";

/**
 * Generate stable ID for an open question
 * Uses sha1(conversationId + key) for deterministic IDs
 */
export function generateQuestionId(conversationId: string, key: OpenQuestionKey): string {
  const hash = createHash("sha1");
  hash.update(conversationId);
  hash.update(key);
  return hash.digest("hex").substring(0, 16); // Use first 16 chars for shorter ID
}

/**
 * Get required questions from progress stage and data
 * Deterministic rules-based logic
 */
export function getRequiredQuestionsFromProgress(
  progressStage: ContactProgressStage,
  progressData: ContactProgressData | null,
  candidateSnapshot: CandidateSnapshot | null,
  jobContext?: { requiresCscs?: boolean; requiresRightToWork?: boolean }
): OpenQuestionKey[] {
  const required: OpenQuestionKey[] = [];

  // Check progress stage
  switch (progressStage) {
    case "PROFILE_INCOMPLETE":
      // Check missing fields from progressData
      if (progressData?.missingFields) {
        for (const field of progressData.missingFields) {
          const normalized = field.toLowerCase().trim();
          if (normalized.includes("location") || normalized.includes("area") || normalized.includes("city")) {
            if (!required.includes("LOCATION")) required.push("LOCATION");
          } else if (normalized.includes("availability") || normalized.includes("when") || normalized.includes("free")) {
            if (!required.includes("AVAILABILITY")) required.push("AVAILABILITY");
          } else if (normalized.includes("role") || normalized.includes("trade") || normalized.includes("position")) {
            if (!required.includes("ROLE")) required.push("ROLE");
          } else if (normalized.includes("experience") || normalized.includes("years")) {
            if (!required.includes("EXPERIENCE")) required.push("EXPERIENCE");
          } else if (normalized.includes("skill")) {
            if (!required.includes("SKILLS")) required.push("SKILLS");
          } else if (normalized.includes("salary") || normalized.includes("pay") || normalized.includes("rate")) {
            if (!required.includes("SALARY")) required.push("SALARY");
          } else if (normalized.includes("address")) {
            if (!required.includes("ADDRESS")) required.push("ADDRESS");
          } else if (normalized.includes("start date") || normalized.includes("when can you start")) {
            if (!required.includes("START_DATE_INTEREST")) required.push("START_DATE_INTEREST");
          }
        }
      }
      
      // Also check candidate snapshot for missing data
      if (!candidateSnapshot?.location) {
        if (!required.includes("LOCATION")) required.push("LOCATION");
      }
      if (!candidateSnapshot?.availability) {
        if (!required.includes("AVAILABILITY")) required.push("AVAILABILITY");
      }
      if (!candidateSnapshot?.desiredRole) {
        if (!required.includes("ROLE")) required.push("ROLE");
      }
      break;

    case "DOCS_NEEDED":
      // Check job context for specific document requirements
      if (jobContext?.requiresCscs) {
        if (!required.includes("CSCS_PHOTO")) required.push("CSCS_PHOTO");
      }
      if (jobContext?.requiresRightToWork) {
        if (!required.includes("RIGHT_TO_WORK")) required.push("RIGHT_TO_WORK");
      }
      // Default to CSCS if no specific requirement
      if (required.length === 0) {
        required.push("CSCS_PHOTO");
      }
      break;

    case "CSCS_VERIFICATION":
      if (!required.includes("CSCS_PHOTO")) required.push("CSCS_PHOTO");
      break;

    case "LOOKING_FOR_WORK":
      // Basic info needed for matching
      if (!candidateSnapshot?.location) {
        if (!required.includes("LOCATION")) required.push("LOCATION");
      }
      if (!candidateSnapshot?.availability) {
        if (!required.includes("AVAILABILITY")) required.push("AVAILABILITY");
      }
      if (!candidateSnapshot?.desiredRole) {
        if (!required.includes("ROLE")) required.push("ROLE");
      }
      break;

    default:
      // For other stages, check missingFields if present
      if (progressData?.missingFields) {
        for (const field of progressData.missingFields) {
          const normalized = field.toLowerCase().trim();
          if (normalized.includes("cscs") || normalized.includes("card") || normalized.includes("photo")) {
            if (!required.includes("CSCS_PHOTO")) required.push("CSCS_PHOTO");
          } else if (normalized.includes("right to work") || normalized.includes("visa") || normalized.includes("passport")) {
            if (!required.includes("RIGHT_TO_WORK")) required.push("RIGHT_TO_WORK");
          }
        }
      }
      break;
  }

  return required;
}

/**
 * Build prompt text for a question key
 * Respects playbook greeting style and max questions
 */
export function buildPromptTextForKey(
  key: OpenQuestionKey,
  playbook?: AgencyPlaybook,
  candidateName?: string | null
): string {
  const greeting = playbook ? buildGreeting(playbook, candidateName) : (candidateName ? `Hi ${candidateName.split(' ')[0]}, ` : "Hi, ");

  const prompts: Record<OpenQuestionKey, string> = {
    LOCATION: `${greeting}What area are you based in?`,
    AVAILABILITY: `${greeting}When are you available to start?`,
    ROLE: `${greeting}What trade or role are you looking for?`,
    SALARY: `${greeting}What's your expected pay rate?`,
    EXPERIENCE: `${greeting}How many years experience do you have?`,
    SKILLS: `${greeting}What skills or qualifications do you have?`,
    CSCS_PHOTO: `${greeting}Can you send a photo of your CSCS card?`,
    RIGHT_TO_WORK: `${greeting}Do you have the right to work in the UK?`,
    ADDRESS: `${greeting}What's your full address?`,
    START_DATE_INTEREST: `${greeting}When would you be able to start?`,
  };

  return prompts[key] || `${greeting}Can you provide more information?`;
}

/**
 * Check if a question should be asked
 * Returns false if:
 * - Question already OPEN and cooldownUntil is in future
 * - Question already RESOLVED
 * - Question was asked within last 24 hours
 */
export function shouldAskQuestion(
  key: OpenQuestionKey,
  openQuestions: OpenQuestion[],
  now: Date = new Date()
): boolean {
  const existing = openQuestions.find((q) => q.key === key);

  if (!existing) {
    // No existing question, can ask
    return true;
  }

  if (existing.status === "RESOLVED") {
    // Already resolved, don't ask again
    return false;
  }

  // Check cooldown
  if (existing.cooldownUntil) {
    const cooldownUntil = new Date(existing.cooldownUntil);
    if (cooldownUntil > now) {
      // Still in cooldown, don't ask
      return false;
    }
  }

  // Check if asked within last 24 hours
  const askedAt = new Date(existing.askedAt);
  const hoursSinceAsked = (now.getTime() - askedAt.getTime()) / (1000 * 60 * 60);
  if (hoursSinceAsked < 24) {
    // Asked within last 24 hours, don't ask again
    return false;
  }

  // Can ask (cooldown expired and not asked recently)
  return true;
}

/**
 * Add a new open question
 * Creates object with stable ID and sets timestamps
 */
export function addOpenQuestion(
  conversationId: string,
  key: OpenQuestionKey,
  messageId: string,
  promptText: string,
  now: Date = new Date(),
  cooldownHours: number = 12
): OpenQuestion {
  const id = generateQuestionId(conversationId, key);
  const askedAt = now.toISOString();
  const cooldownUntil = new Date(now.getTime() + cooldownHours * 60 * 60 * 1000).toISOString();

  return {
    id,
    key,
    promptText,
    askedAt,
    lastRemindedAt: null,
    status: "OPEN",
    resolvedAt: null,
    evidence: null,
    cooldownUntil,
  };
}

/**
 * Resolve an open question with evidence
 */
export function resolveOpenQuestion(
  question: OpenQuestion,
  messageId: string,
  snippet: string,
  now: Date = new Date()
): OpenQuestion {
  return {
    ...question,
    status: "RESOLVED",
    resolvedAt: now.toISOString(),
    evidence: {
      messageId,
      snippet: snippet.substring(0, 200), // Clamp snippet to 200 chars
    },
    cooldownUntil: null, // Clear cooldown when resolved
  };
}

/**
 * Update last reminded timestamp
 */
export function updateLastReminded(
  question: OpenQuestion,
  now: Date = new Date(),
  cooldownHours: number = 12
): OpenQuestion {
  return {
    ...question,
    lastRemindedAt: now.toISOString(),
    cooldownUntil: new Date(now.getTime() + cooldownHours * 60 * 60 * 1000).toISOString(),
  };
}

