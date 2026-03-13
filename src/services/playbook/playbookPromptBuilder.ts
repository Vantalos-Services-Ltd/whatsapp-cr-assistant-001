/**
 * Playbook Prompt Builder
 * Centralized function to build a compact policy block for AI prompts
 */

import type { AgencyPlaybook } from "../../shared/playbook.ts";

/**
 * Builds a compact policy block string from playbook settings
 * Designed to be minimal to avoid token bloat
 */
export function buildPlaybookPolicyBlock(playbook: AgencyPlaybook): string {
  const parts: string[] = [];

  // Tone style
  if (playbook.toneStyle && playbook.toneStyle !== "UK recruiter, friendly, direct") {
    parts.push(`Tone: ${playbook.toneStyle}`);
  }

  // Max questions per message
  if (playbook.maxQuestionsPerMessage !== undefined && playbook.maxQuestionsPerMessage !== 2) {
    parts.push(`Max questions: ${playbook.maxQuestionsPerMessage}`);
  } else {
    parts.push("Max questions: 2");
  }

  // Greeting style
  if (playbook.greetingStyle !== "SHORT") {
    parts.push(`Greeting: ${playbook.greetingStyle === "NONE" ? "skip" : playbook.greetingStyle.toLowerCase()}`);
  }

  // Forbidden phrases
  if (playbook.forbiddenPhrases && playbook.forbiddenPhrases.length > 0) {
    parts.push(`Never use: ${playbook.forbiddenPhrases.slice(0, 5).join(", ")}${playbook.forbiddenPhrases.length > 5 ? "..." : ""}`);
  }

  // Required checks
  const checks: string[] = [];
  if (playbook.requiredChecks?.confirmLocation) checks.push("location");
  if (playbook.requiredChecks?.confirmAvailability) checks.push("availability");
  if (playbook.requiredChecks?.confirmTickets) checks.push("tickets");
  if (checks.length > 0) {
    parts.push(`Always confirm: ${checks.join(", ")}`);
  }

  // Escalation rules
  const escalations: string[] = [];
  if (playbook.escalationRules?.unknownIntentAlwaysApproval) {
    escalations.push("unknown intent → approval");
  }
  if (playbook.escalationRules?.salaryTalkRequiresApproval) {
    escalations.push("salary talk → approval");
  }
  if (escalations.length > 0) {
    parts.push(`Escalate: ${escalations.join(", ")}`);
  }

  // Signature style (for message generation, not prompt)
  // This is handled separately in message generation

  if (parts.length === 0) {
    return ""; // No custom policy, use defaults
  }

  return `POLICY: ${parts.join(" | ")}`;
}

/**
 * Builds greeting text based on playbook greeting style
 */
export function buildGreeting(playbook: AgencyPlaybook, candidateName?: string | null): string {
  if (playbook.greetingStyle === "NONE") {
    return "";
  }

  const name = candidateName ? candidateName.split(" ")[0] : "";
  
  if (playbook.greetingStyle === "SHORT") {
    return name ? `Hi ${name}, ` : "Hi, ";
  }

  // NORMAL
  if (name) {
    return `Hello ${name}, `;
  }
  return "Hello, ";
}

/**
 * Builds signature text based on playbook signature style
 */
export function buildSignature(playbook: AgencyPlaybook, operatorName?: string | null, agencyName?: string | null): string {
  if (playbook.signatureStyle === "NONE") {
    return "";
  }

  if (playbook.signatureStyle === "NAME" && operatorName) {
    return `\n\n${operatorName}`;
  }

  if (playbook.signatureStyle === "AGENCY" && agencyName) {
    return `\n\n${agencyName}`;
  }

  return "";
}

