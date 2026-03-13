/**
 * Shared types and constants for Agency Playbooks
 */

import type { GreetingStyle, SignatureStyle } from "@prisma/client";

/**
 * Required checks flags
 */
export interface RequiredChecks {
  confirmLocation?: boolean;
  confirmAvailability?: boolean;
  confirmTickets?: boolean;
}

/**
 * Escalation rules flags
 */
export interface EscalationRules {
  unknownIntentAlwaysApproval?: boolean;
  salaryTalkRequiresApproval?: boolean;
}

/**
 * Agency Playbook interface matching the Prisma model
 */
export interface AgencyPlaybook {
  id: string;
  agencyId: string;
  toneStyle: string;
  maxQuestionsPerMessage: number;
  greetingStyle: GreetingStyle;
  forbiddenPhrases: string[];
  requiredChecks: RequiredChecks;
  escalationRules: EscalationRules;
  signatureStyle: SignatureStyle;
  updatedAt: Date;
  createdAt: Date;
}

/**
 * Default playbook values
 */
export const DEFAULT_PLAYBOOK: Omit<AgencyPlaybook, "id" | "agencyId" | "updatedAt" | "createdAt"> = {
  toneStyle: "UK recruiter, friendly, direct",
  maxQuestionsPerMessage: 2,
  greetingStyle: "SHORT",
  forbiddenPhrases: [],
  requiredChecks: {},
  escalationRules: {},
  signatureStyle: "NONE",
};

/**
 * Partial playbook update (for patching)
 */
export type PlaybookUpdate = Partial<Pick<AgencyPlaybook, "toneStyle" | "maxQuestionsPerMessage" | "greetingStyle" | "forbiddenPhrases" | "requiredChecks" | "escalationRules" | "signatureStyle">>;

