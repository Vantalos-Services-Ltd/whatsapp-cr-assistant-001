/**
 * Open Question Resolver
 * Detects when open questions are answered from inbound messages
 * Deterministic rules-based logic (no AI calls)
 */

import pino from "pino";
import type {
  OpenQuestion,
  OpenQuestionKey,
} from "../../../shared/types/memoryPack.ts";
import { resolveOpenQuestion } from "./openQuestionRules.ts";
import type { EnrichedExtractionResult } from "../candidateExtractor.ts";
import type { MediaItem } from "../transcriptionService.ts";

const log = pino({ name: "openQuestionResolver" });

/**
 * Input for resolving open questions
 */
export interface ResolveOpenQuestionsInput {
  /** Current open questions */
  openQuestions: OpenQuestion[];
  
  /** Inbound message text (transcript if available, else original) */
  inboundMessageText: string;
  
  /** Message ID for evidence */
  messageId: string;
  
  /** Candidate extractor result (what was extracted from this message) */
  candidateExtractorResult: EnrichedExtractionResult | null;
  
  /** Media items from the message */
  mediaItems: MediaItem[];
  
  /** Current timestamp */
  now: Date;
}

/**
 * Result of resolving open questions
 */
export interface ResolveOpenQuestionsResult {
  /** Updated open questions (with resolved ones marked) */
  resolvedQuestions: OpenQuestion[];
  
  /** Questions that were resolved in this call */
  newlyResolved: Array<{
    question: OpenQuestion;
    key: OpenQuestionKey;
    evidence: string; // Snippet
  }>;
}

/**
 * Detect availability from text using simple heuristics
 * Conservative patterns to avoid false positives
 */
function detectAvailabilityInText(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  
  // Conservative patterns
  const availabilityPatterns = [
    /\b(tomorrow|next week|next monday|next tuesday|next wednesday|next thursday|next friday|next saturday|next sunday)\b/,
    /\b(im free|i'm free|i am free|available|can start|ready to start)\b/,
    /\b(start|begin|commence)\s+(tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week)\b/,
    /\b(free|available)\s+(tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week)\b/,
  ];
  
  return availabilityPatterns.some((pattern) => pattern.test(normalized));
}

/**
 * Detect location from text using simple heuristics
 * Conservative patterns to avoid false positives
 */
function detectLocationInText(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  
  // UK city patterns
  const locationPatterns = [
    /\b(london|manchester|birmingham|leeds|glasgow|edinburgh|liverpool|bristol|cardiff|belfast)\b/,
    /\b(based in|from|in|near|around)\s+[a-z]+/,
    /\b([a-z]{1,2}\d{1,2}\s?\d[a-z]{2})\b/, // UK postcode pattern
  ];
  
  return locationPatterns.some((pattern) => pattern.test(normalized));
}

/**
 * Resolve open questions based on inbound message content
 * Idempotent: won't re-resolve already resolved questions
 */
export function resolveOpenQuestions(
  input: ResolveOpenQuestionsInput
): ResolveOpenQuestionsResult {
  const {
    openQuestions,
    inboundMessageText,
    messageId,
    candidateExtractorResult,
    mediaItems,
    now,
  } = input;

  const resolvedQuestions: OpenQuestion[] = [];
  const newlyResolved: Array<{
    question: OpenQuestion;
    key: OpenQuestionKey;
    evidence: string;
  }> = [];

  // Process each open question
  for (const question of openQuestions) {
    // Skip if already resolved (idempotency)
    if (question.status === "RESOLVED") {
      resolvedQuestions.push(question);
      continue;
    }

    let resolved = false;
    let evidenceSnippet = "";

    // Check candidate extractor result
    if (candidateExtractorResult?.fields) {
      const fields = candidateExtractorResult.fields;
      
      if (question.key === "LOCATION" && fields.location?.value) {
        resolved = true;
        evidenceSnippet = String(fields.location.value).substring(0, 80);
      } else if (question.key === "ROLE" && fields.desiredRole?.value) {
        resolved = true;
        evidenceSnippet = String(fields.desiredRole.value).substring(0, 80);
      } else if (question.key === "AVAILABILITY" && fields.availabilityNotes?.value) {
        resolved = true;
        evidenceSnippet = String(fields.availabilityNotes.value).substring(0, 80);
      } else if (question.key === "SALARY" && fields.salary?.value) {
        const salary = fields.salary.value;
        if (salary && (salary.min !== null || salary.max !== null)) {
          const salaryStr = `${salary.min || ""}-${salary.max || ""} ${salary.currency || ""}`.trim();
          if (salaryStr) {
            resolved = true;
            evidenceSnippet = salaryStr.substring(0, 80);
          }
        }
      } else if (question.key === "EXPERIENCE" && fields.yearsExperience?.value !== null && fields.yearsExperience?.value !== undefined) {
        resolved = true;
        evidenceSnippet = `${fields.yearsExperience.value} years`.substring(0, 80);
      } else if (question.key === "SKILLS" && fields.skills?.value && Array.isArray(fields.skills.value) && fields.skills.value.length > 0) {
        resolved = true;
        evidenceSnippet = fields.skills.value.join(", ").substring(0, 80);
      }
    }

    // Check media items
    if (!resolved && mediaItems.length > 0) {
      if (question.key === "CSCS_PHOTO") {
        // Check for image media
        const hasImage = mediaItems.some(
          (m) => m.kind === "image" && m.contentType?.startsWith("image/")
        );
        if (hasImage) {
          resolved = true;
          evidenceSnippet = "CSCS card photo received";
        }
      }
      // Note: RIGHT_TO_WORK resolution requires explicit task workflow confirmation
      // For now, we don't auto-resolve it from media alone
    }

    // Check text heuristics (conservative)
    if (!resolved && inboundMessageText) {
      if (question.key === "AVAILABILITY" && detectAvailabilityInText(inboundMessageText)) {
        resolved = true;
        // Extract snippet from message (max 80 chars)
        evidenceSnippet = inboundMessageText.substring(0, 80).trim();
      } else if (question.key === "LOCATION" && detectLocationInText(inboundMessageText)) {
        resolved = true;
        // Extract snippet from message (max 80 chars)
        evidenceSnippet = inboundMessageText.substring(0, 80).trim();
      }
    }

    // If resolved, update the question
    if (resolved) {
      const resolvedQuestion = resolveOpenQuestion(question, messageId, evidenceSnippet, now);
      resolvedQuestions.push(resolvedQuestion);
      newlyResolved.push({
        question: resolvedQuestion,
        key: question.key,
        evidence: evidenceSnippet,
      });

      log.info(
        {
          questionId: question.id,
          key: question.key,
          messageId,
          evidenceLength: evidenceSnippet.length,
        },
        "Open question resolved"
      );
    } else {
      // Keep question as-is
      resolvedQuestions.push(question);
    }
  }

  return {
    resolvedQuestions,
    newlyResolved,
  };
}

