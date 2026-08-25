/**
 * Playbook Service
 * Handles retrieval, validation, and sanitization of agency playbooks
 */

import pino from "pino";
import { z } from "zod";

import type { AgencyPlaybook, PlaybookUpdate, RequiredChecks, EscalationRules } from "../../shared/playbook.ts";
import { DEFAULT_PLAYBOOK } from "../../shared/playbook.ts";

const log = pino({ name: "playbookService" });
import { prisma } from "../../db/prisma.ts";

/**
 * Common jailbreak phrases that should be stripped from toneStyle
 * These are patterns that could be used to inject unsafe instructions
 */
const JAILBREAK_PATTERNS = [
  /ignore\s+(previous|all|above|earlier)\s+(instructions?|rules?|guidelines?)/gi,
  /forget\s+(previous|all|above|earlier)\s+(instructions?|rules?|guidelines?)/gi,
  /disregard\s+(previous|all|above|earlier)\s+(instructions?|rules?|guidelines?)/gi,
  /override\s+(previous|all|above|earlier)\s+(instructions?|rules?|guidelines?)/gi,
  /you\s+are\s+(now|nowadays)\s+/gi,
  /act\s+as\s+(if\s+)?you\s+are\s+/gi,
  /pretend\s+(to\s+be|that\s+you\s+are)\s+/gi,
  /system\s*:\s*ignore\s+/gi,
  /\[system\]\s*ignore\s+/gi,
  /<system>\s*ignore\s+/gi,
];

/**
 * Sanitize toneStyle by removing common jailbreak patterns
 * Light sanitization - removes obvious injection attempts but preserves legitimate content
 */
function sanitizeToneStyle(toneStyle: string): string {
  let sanitized = toneStyle;
  
  for (const pattern of JAILBREAK_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }
  
  // Remove multiple spaces and trim
  sanitized = sanitized.replace(/\s+/g, " ").trim();
  
  return sanitized;
}

/**
 * Zod schema for validating RequiredChecks
 */
const RequiredChecksSchema = z.object({
  confirmLocation: z.boolean().optional(),
  confirmAvailability: z.boolean().optional(),
  confirmTickets: z.boolean().optional(),
}).strict(); // Reject unknown keys

/**
 * Zod schema for validating EscalationRules
 */
const EscalationRulesSchema = z.object({
  unknownIntentAlwaysApproval: z.boolean().optional(),
  salaryTalkRequiresApproval: z.boolean().optional(),
}).strict(); // Reject unknown keys

/**
 * Zod schema for validating playbook updates
 */
const PlaybookUpdateSchema = z.object({
  toneStyle: z.string()
    .max(200, "toneStyle must be 200 characters or less")
    .transform(sanitizeToneStyle)
    .optional(),
  maxQuestionsPerMessage: z.number()
    .int("maxQuestionsPerMessage must be an integer")
    .min(0, "maxQuestionsPerMessage must be at least 0")
    .max(3, "maxQuestionsPerMessage must be at most 3")
    .optional(),
  greetingStyle: z.enum(["SHORT", "NONE", "NORMAL"]).optional(),
  forbiddenPhrases: z.array(z.string().max(40, "Each forbidden phrase must be 40 characters or less"))
    .max(30, "Maximum 30 forbidden phrases allowed")
    .optional(),
  requiredChecks: RequiredChecksSchema.optional(),
  escalationRules: EscalationRulesSchema.optional(),
  signatureStyle: z.enum(["NONE", "NAME", "AGENCY"]).optional(),
}).strict();

/**
 * Get playbook for an agency, returning defaults if none exists
 */
export async function getPlaybook(agencyId: string): Promise<AgencyPlaybook> {
  const playbook = await prisma.agencyPlaybook.findUnique({
    where: { agencyId },
  });

  if (playbook) {
    // Parse JSON fields and return typed playbook
    return {
      id: playbook.id,
      agencyId: playbook.agencyId,
      toneStyle: playbook.toneStyle,
      maxQuestionsPerMessage: playbook.maxQuestionsPerMessage,
      greetingStyle: playbook.greetingStyle,
      forbiddenPhrases: (playbook.forbiddenPhrases as any) || [],
      requiredChecks: (playbook.requiredChecks as any) || {},
      escalationRules: (playbook.escalationRules as any) || {},
      signatureStyle: playbook.signatureStyle,
      updatedAt: playbook.updatedAt,
      createdAt: playbook.createdAt,
    };
  }

  // Return default playbook (not persisted)
  return {
    id: "default",
    agencyId,
    ...DEFAULT_PLAYBOOK,
    updatedAt: new Date(),
    createdAt: new Date(),
  };
}

/**
 * Update playbook for an agency
 * Validates and sanitizes input, then merges with existing playbook
 */
export async function updatePlaybook(
  agencyId: string,
  update: PlaybookUpdate
): Promise<AgencyPlaybook> {
  log.info({ agencyId, update }, "Updating playbook");

  // Validate and sanitize input
  const validated = PlaybookUpdateSchema.parse(update);

  // Get existing playbook or defaults
  const existing = await getPlaybook(agencyId);

  // Build update object with only provided fields
  const updateData: any = {};
  
  if (validated.toneStyle !== undefined) {
    updateData.toneStyle = validated.toneStyle;
  }
  if (validated.maxQuestionsPerMessage !== undefined) {
    updateData.maxQuestionsPerMessage = validated.maxQuestionsPerMessage;
  }
  if (validated.greetingStyle !== undefined) {
    updateData.greetingStyle = validated.greetingStyle;
  }
  if (validated.forbiddenPhrases !== undefined) {
    updateData.forbiddenPhrases = validated.forbiddenPhrases as any;
  }
  if (validated.requiredChecks !== undefined) {
    // Merge with existing requiredChecks
    updateData.requiredChecks = {
      ...existing.requiredChecks,
      ...validated.requiredChecks,
    } as any;
  }
  if (validated.escalationRules !== undefined) {
    // Merge with existing escalationRules
    updateData.escalationRules = {
      ...existing.escalationRules,
      ...validated.escalationRules,
    } as any;
  }
  if (validated.signatureStyle !== undefined) {
    updateData.signatureStyle = validated.signatureStyle;
  }

  // Upsert playbook
  const playbook = await prisma.agencyPlaybook.upsert({
    where: { agencyId },
    create: {
      agencyId,
      toneStyle: validated.toneStyle ?? existing.toneStyle ?? DEFAULT_PLAYBOOK.toneStyle,
      maxQuestionsPerMessage: validated.maxQuestionsPerMessage ?? existing.maxQuestionsPerMessage ?? DEFAULT_PLAYBOOK.maxQuestionsPerMessage,
      greetingStyle: validated.greetingStyle ?? existing.greetingStyle ?? DEFAULT_PLAYBOOK.greetingStyle,
      forbiddenPhrases: (validated.forbiddenPhrases ?? existing.forbiddenPhrases ?? DEFAULT_PLAYBOOK.forbiddenPhrases) as any,
      requiredChecks: (validated.requiredChecks ? { ...existing.requiredChecks, ...validated.requiredChecks } : existing.requiredChecks ?? DEFAULT_PLAYBOOK.requiredChecks) as any,
      escalationRules: (validated.escalationRules ? { ...existing.escalationRules, ...validated.escalationRules } : existing.escalationRules ?? DEFAULT_PLAYBOOK.escalationRules) as any,
      signatureStyle: validated.signatureStyle ?? existing.signatureStyle ?? DEFAULT_PLAYBOOK.signatureStyle,
    },
    update: updateData,
  });

  // Return typed playbook
  return {
    id: playbook.id,
    agencyId: playbook.agencyId,
    toneStyle: playbook.toneStyle,
    maxQuestionsPerMessage: playbook.maxQuestionsPerMessage,
    greetingStyle: playbook.greetingStyle,
    forbiddenPhrases: (playbook.forbiddenPhrases as any) || [],
    requiredChecks: (playbook.requiredChecks as any) || {},
    escalationRules: (playbook.escalationRules as any) || {},
    signatureStyle: playbook.signatureStyle,
    updatedAt: playbook.updatedAt,
    createdAt: playbook.createdAt,
  };
}

/**
 * Validate playbook update without persisting
 * Useful for client-side validation
 */
export function validatePlaybookUpdate(update: unknown): { success: boolean; error?: string; data?: PlaybookUpdate } {
  try {
    const validated = PlaybookUpdateSchema.parse(update);
    return { success: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join(", "),
      };
    }
    return { success: false, error: "Invalid playbook update" };
  }
}

