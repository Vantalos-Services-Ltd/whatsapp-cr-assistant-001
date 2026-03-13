/**
 * Intent Safety Classifier
 * Determines if an intent is safe for automatic AI reply without approval
 */

import type { InboundIntent } from "../domain/intent.ts";

/**
 * Check if an intent is considered SAFE for automatic AI reply
 * 
 * SAFE intents:
 * - LOOKING_FOR_WORK: Candidate expressing interest (greeting-like)
 * - AVAILABILITY_UPDATE: Simple availability updates
 * - FOLLOW_UP: General follow-ups and status checks
 * - UNKNOWN: Default to safe (can be handled generically)
 * 
 * REQUIRES_APPROVAL intents:
 * - JOB_QUERY: Questions about salary, location, job details (sensitive)
 */
export function isIntentSafeForAutoReply(intent: InboundIntent): boolean {
  switch (intent) {
    case "LOOKING_FOR_WORK":
    case "AVAILABILITY_UPDATE":
    case "FOLLOW_UP":
    case "UNKNOWN":
      return true;
    
    case "JOB_QUERY":
      return false; // Always requires approval (salary, location, etc.)
    
    default:
      // Conservative: unknown intents default to requiring approval
      return false;
  }
}

/**
 * Check if message text contains greeting patterns
 * Used to identify safe greeting messages that should auto-reply
 */
export function isGreetingMessage(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  const greetingPatterns = [
    /^(hi|hello|hey|greetings|good morning|good afternoon|good evening)/i,
    /^(thanks|thank you|thx)/i,
    /^(ok|okay|sure|yes|yep|yeah)/i,
  ];
  
  return greetingPatterns.some(pattern => pattern.test(normalized));
}

/**
 * Check if message is a short clarification/response
 * Used to identify safe clarification messages that should auto-reply
 * Examples: "Any", "Either", "Doesn't matter", "Job or internship?", "Yes", "No"
 */
export function isClarificationMessage(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  
  // Very short responses (1-3 words) that are likely clarifications
  const wordCount = normalized.split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount > 3) {
    return false; // Too long to be a simple clarification
  }
  
  // Common clarification patterns
  const clarificationPatterns = [
    /^(any|either|both|neither|doesn't matter|don't care|whatever|sure|yes|no|yep|nope|ok|okay)$/i,
    /^(job|internship|full time|part time|contract|permanent)$/i,
    /^(morning|afternoon|evening|weekday|weekend)$/i,
    /^(manchester|liverpool|london|north|south|east|west)$/i,
    /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i,
    /^(this week|next week|asap|immediately)$/i,
    // Question-style clarifications (short questions)
    /^(job or internship|full or part|contract or permanent)\??$/i,
    /^(morning or afternoon|weekday or weekend)\??$/i,
  ];
  
  return clarificationPatterns.some(pattern => pattern.test(normalized));
}
