/**
 * Question Selector
 * Selects which open questions to ask in a reply message
 * Prevents nagging by respecting cooldowns and limits
 */

import type { OpenQuestion, OpenQuestionKey } from "../../../shared/types/memoryPack.ts";
import type { AgencyPlaybook } from "../../shared/playbook.ts";
import { shouldAskQuestion } from "./openQuestionRules.ts";

/**
 * Select questions to ask in a reply message
 * 
 * Rules:
 * - Only include questions that are required (in requiredKeys)
 * - Only include questions that should be asked (not in cooldown, not asked recently)
 * - Respect playbook maxQuestionsPerMessage limit
 * - Prioritize questions that haven't been asked recently
 */
export function selectQuestionsToAsk(
  openQuestions: OpenQuestion[],
  requiredKeys: OpenQuestionKey[],
  playbook: AgencyPlaybook | undefined,
  now: Date = new Date()
): OpenQuestion[] {
  const maxQuestions = playbook?.maxQuestionsPerMessage ?? 2;

  // Filter to only required questions that are OPEN and should be asked
  const askableQuestions = openQuestions.filter((q) => {
    // Must be required
    if (!requiredKeys.includes(q.key)) {
      return false;
    }

    // Must be OPEN (not resolved)
    if (q.status !== "OPEN") {
      return false;
    }

    // Must pass shouldAskQuestion check (cooldown, timing)
    return shouldAskQuestion(q.key, [q], now);
  });

  // Sort by priority:
  // 1. Questions never asked (no lastRemindedAt)
  // 2. Questions asked longest ago
  askableQuestions.sort((a, b) => {
    // Never reminded questions first
    if (!a.lastRemindedAt && b.lastRemindedAt) return -1;
    if (a.lastRemindedAt && !b.lastRemindedAt) return 1;
    
    // If both have lastRemindedAt, sort by oldest first
    if (a.lastRemindedAt && b.lastRemindedAt) {
      const aTime = new Date(a.lastRemindedAt).getTime();
      const bTime = new Date(b.lastRemindedAt).getTime();
      return aTime - bTime;
    }

    // If neither has lastRemindedAt, sort by askedAt (oldest first)
    const aAsked = new Date(a.askedAt).getTime();
    const bAsked = new Date(b.askedAt).getTime();
    return aAsked - bAsked;
  });

  // Return up to maxQuestions
  return askableQuestions.slice(0, maxQuestions);
}

/**
 * Build a neutral message when all required questions are in cooldown
 * Avoids nagging by not asking again
 */
export function buildNeutralCooldownMessage(
  openQuestions: OpenQuestion[],
  requiredKeys: OpenQuestionKey[],
  playbook: AgencyPlaybook | undefined
): string | null {
  // Check if all required questions are in cooldown
  const requiredOpenQuestions = openQuestions.filter(
    (q) => requiredKeys.includes(q.key) && q.status === "OPEN"
  );

  if (requiredOpenQuestions.length === 0) {
    return null; // No required questions, no need for neutral message
  }

  const now = new Date();
  const allInCooldown = requiredOpenQuestions.every((q) => {
    if (q.cooldownUntil) {
      return new Date(q.cooldownUntil) > now;
    }
    return false;
  });

  if (!allInCooldown) {
    return null; // Not all in cooldown, can ask questions
  }

  // Build neutral message based on what we're waiting for
  const waitingFor: string[] = [];
  for (const q of requiredOpenQuestions) {
    switch (q.key) {
      case "CSCS_PHOTO":
        waitingFor.push("CSCS card photo");
        break;
      case "RIGHT_TO_WORK":
        waitingFor.push("right to work document");
        break;
      case "LOCATION":
        waitingFor.push("location");
        break;
      case "AVAILABILITY":
        waitingFor.push("availability");
        break;
      default:
        waitingFor.push(q.key.toLowerCase().replace(/_/g, " "));
    }
  }

  if (waitingFor.length === 0) {
    return null;
  }

  const greeting = playbook
    ? (playbook.greetingStyle === "NONE" ? "" : playbook.greetingStyle === "SHORT" ? "Hey, " : "Hi, ")
    : "Hi, ";

  const item = waitingFor[0]; // Use first item for simplicity
  return `${greeting}No worries. When you get a moment, send your ${item} and we'll take it from there.`;
}

