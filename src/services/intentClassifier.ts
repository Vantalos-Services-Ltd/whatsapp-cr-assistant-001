import type { InboundIntent } from "../domain/intent.ts";

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsPhrase(haystack: string, phrase: string): boolean {
  return haystack.includes(phrase);
}

function containsWord(haystack: string, word: string): boolean {
  // Word-boundary match to avoid false positives (e.g. "rate" in "separate").
  const re = new RegExp(`\\b${escapeRegExp(word)}\\b`);
  return re.test(haystack);
}

function containsAnyPhrase(haystack: string, phrases: string[]): boolean {
  return phrases.some((p) => containsPhrase(haystack, p));
}

function containsAnyWord(haystack: string, words: string[]): boolean {
  return words.some((w) => containsWord(haystack, w));
}

function containsDateOrTimeCue(haystack: string): boolean {
  // Keep this deterministic and lightweight: simple cues only (no NLP).
  // We include explicit words (today/tomorrow/next week) plus a minimal time pattern.
  const dateWords = ["today", "tomorrow", "next week", "nextweek"];
  if (containsAnyPhrase(haystack, dateWords)) return true;

  const timeLike = /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/; // e.g. "9am", "14:30", "2:15 pm"
  const dateLike = /\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/; // e.g. "12/01", "12/01/2026"
  return timeLike.test(haystack) || dateLike.test(haystack);
}

/**
 * Deterministic rules-based classifier for inbound message intent.
 *
 * Priority matters because messages often contain overlapping signals
 * (e.g. "Any update? I'm available tomorrow."). We prioritize:
 * - AVAILABILITY_UPDATE first (scheduling impacts immediate next action)
 * - LOOKING_FOR_WORK second (high-level goal)
 * - JOB_QUERY third (details about a role)
 * - FOLLOW_UP last (general status check)
 */
export function classifyInboundIntent(text: string): InboundIntent {
  const t = normalizeText(text);
  if (!t) return "UNKNOWN";

  const lookingForWorkPhrases = [
    "any work",
    "looking for work",
    "available for work",
    "got work",
    "any job",
  ];

  const availabilityPhrases = [
    "free tomorrow",
    "available",
    "not available",
    "can work",
    "can't work",
    "cant work",
  ];

  const jobQueryPhrases = [
    "how much",
    "where is the job",
    "what site",
    "location",
  ];
  const jobQueryWords = ["rate", "pay"];

  const followUpPhrases = ["any news", "follow up", "follow-up", "checking in"];
  const followUpWords = ["update"];

  const matchesAvailability =
    containsAnyPhrase(t, availabilityPhrases) || containsDateOrTimeCue(t);
  const matchesLookingForWork = containsAnyPhrase(t, lookingForWorkPhrases);
  const matchesJobQuery =
    containsAnyPhrase(t, jobQueryPhrases) || containsAnyWord(t, jobQueryWords);
  const matchesFollowUp =
    containsAnyPhrase(t, followUpPhrases) || containsAnyWord(t, followUpWords);

  // Priority order (see docstring above)
  if (matchesAvailability) return "AVAILABILITY_UPDATE";
  if (matchesLookingForWork) return "LOOKING_FOR_WORK";
  if (matchesJobQuery) return "JOB_QUERY";
  if (matchesFollowUp) return "FOLLOW_UP";

  return "UNKNOWN";
}


