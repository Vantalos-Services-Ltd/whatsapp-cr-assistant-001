/**
 * Memory Pack types for conversation context
 * Shared between frontend and backend
 */

import { z } from "zod";

/**
 * Open question keys - what information we're waiting for
 */
export type OpenQuestionKey =
  | "LOCATION"
  | "AVAILABILITY"
  | "ROLE"
  | "SALARY"
  | "EXPERIENCE"
  | "SKILLS"
  | "CSCS_PHOTO"
  | "RIGHT_TO_WORK"
  | "ADDRESS"
  | "START_DATE_INTEREST";

/**
 * Open question status
 */
export type OpenQuestionStatus = "OPEN" | "RESOLVED";

/**
 * Open question evidence when resolved
 */
export interface OpenQuestionEvidence {
  messageId: string;
  snippet: string; // Text snippet from the message that answered the question
}

/**
 * Open question - tracks what we're waiting for from the candidate
 */
export interface OpenQuestion {
  /** Stable ID for this question (deterministic: sha1(conversationId + key)) */
  id: string;
  
  /** Question key (e.g., LOCATION, AVAILABILITY, CSCS_PHOTO) */
  key: OpenQuestionKey;
  
  /** The prompt text that was asked to the candidate */
  promptText: string;
  
  /** ISO timestamp when question was first asked */
  askedAt: string;
  
  /** ISO timestamp when question was last reminded (null if never reminded) */
  lastRemindedAt: string | null;
  
  /** Status: OPEN or RESOLVED */
  status: OpenQuestionStatus;
  
  /** ISO timestamp when question was resolved (null if still OPEN) */
  resolvedAt: string | null;
  
  /** Evidence of resolution (messageId and snippet) - null if still OPEN */
  evidence: OpenQuestionEvidence | null;
  
  /** ISO timestamp - do not ask again until this time (cooldown period) */
  cooldownUntil: string | null;
}

/**
 * Memory Pack - Compact summary of conversation context
 */
export interface MemoryPack {
  /** One-sentence summary of the contact */
  summary: string;
  
  /** Extracted facts about the candidate */
  facts: {
    trade?: string | null;
    location?: string | null;
    availability?: string | null;
    salary?: {
      min?: number;
      max?: number;
      currency?: string;
    } | null;
    skills?: string[] | null;
    tickets?: string[] | null; // CSCS, CPCS, etc.
    preferredAreas?: string[] | null;
    transport?: string | null;
    startDate?: string | null; // ISO date
    lastClient?: string | null;
  };
  
  /** Candidate's stated goal */
  goal: string;
  
  /** Open questions that need answers (legacy: array of strings for backward compatibility) */
  openQuestions: string[];
  
  /** Structured open questions tracking what we're waiting for */
  structuredOpenQuestions?: OpenQuestion[];
  
  /** Last job discussed with candidate */
  lastJobDiscussed: {
    jobId?: string;
    title?: string;
    location?: string;
    startDate?: string; // ISO date
  } | null;
  
  /** Next action to take */
  nextAction: string;
  
  /** ISO timestamp when memory pack was last updated */
  lastUpdatedAt: string;
  
  /** Version number for schema evolution */
  version: number;
}

/**
 * Merge non-null values from patch into existing object
 * Only overwrites fields that are explicitly provided and non-null
 */
export function mergeNonNull<T extends Record<string, any>>(
  existing: T,
  patch: Partial<T>
): T {
  const result = { ...existing };
  
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null && value !== undefined) {
      if (typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
        // Recursively merge nested objects
        result[key] = mergeNonNull(existing[key] || {}, value);
      } else {
        result[key] = value;
      }
    }
  }
  
  return result;
}

/**
 * Zod schema for OpenQuestionEvidence
 */
export const OpenQuestionEvidenceSchema = z.object({
  messageId: z.string().min(1),
  snippet: z.string().min(1).max(200), // Max 200 chars for snippet
});

/**
 * Zod schema for OpenQuestion
 */
export const OpenQuestionSchema = z.object({
  id: z.string().min(1),
  key: z.enum([
    "LOCATION",
    "AVAILABILITY",
    "ROLE",
    "SALARY",
    "EXPERIENCE",
    "SKILLS",
    "CSCS_PHOTO",
    "RIGHT_TO_WORK",
    "ADDRESS",
    "START_DATE_INTEREST",
  ]),
  promptText: z.string().min(1).max(500), // Max 500 chars for prompt text
  askedAt: z.string().datetime(), // ISO timestamp
  lastRemindedAt: z.string().datetime().nullable(),
  status: z.enum(["OPEN", "RESOLVED"]),
  resolvedAt: z.string().datetime().nullable(),
  evidence: OpenQuestionEvidenceSchema.nullable(),
  cooldownUntil: z.string().datetime().nullable(),
});

/**
 * Zod schema for structured open questions array
 * Clamps to max 20 questions
 */
export const StructuredOpenQuestionsSchema = z
  .array(OpenQuestionSchema)
  .max(20, "Maximum 20 open questions allowed");

/**
 * Sanitize memory pack to ensure all required fields are present
 * and data types are correct
 */
export function sanitizeMemoryPack(data: any): MemoryPack {
  const now = new Date().toISOString();
  
  // Sanitize structured open questions
  let structuredOpenQuestions: OpenQuestion[] = [];
  if (Array.isArray(data?.structuredOpenQuestions)) {
    const validation = StructuredOpenQuestionsSchema.safeParse(data.structuredOpenQuestions);
    if (validation.success) {
      structuredOpenQuestions = validation.data;
    } else {
      // If validation fails, try to sanitize each item individually
      structuredOpenQuestions = data.structuredOpenQuestions
        .slice(0, 20) // Clamp to max 20
        .map((q: any) => {
          const itemValidation = OpenQuestionSchema.safeParse(q);
          return itemValidation.success ? itemValidation.data : null;
        })
        .filter((q: OpenQuestion | null): q is OpenQuestion => q !== null);
    }
  }
  
  return {
    summary: typeof data?.summary === "string" ? data.summary : "",
    facts: {
      trade: data?.facts?.trade ?? null,
      location: data?.facts?.location ?? null,
      availability: data?.facts?.availability ?? null,
      salary: data?.facts?.salary ?? null,
      skills: Array.isArray(data?.facts?.skills) ? data.facts.skills : null,
      tickets: Array.isArray(data?.facts?.tickets) ? data.facts.tickets : null,
      preferredAreas: Array.isArray(data?.facts?.preferredAreas)
        ? data.facts.preferredAreas
        : null,
      transport: data?.facts?.transport ?? null,
      startDate: data?.facts?.startDate ?? null,
      lastClient: data?.facts?.lastClient ?? null,
    },
    goal: typeof data?.goal === "string" ? data.goal : "",
    openQuestions: Array.isArray(data?.openQuestions) ? data.openQuestions : [],
    structuredOpenQuestions,
    lastJobDiscussed: data?.lastJobDiscussed ?? null,
    nextAction: typeof data?.nextAction === "string" ? data.nextAction : "",
    lastUpdatedAt: data?.lastUpdatedAt ?? now,
    version: typeof data?.version === "number" ? data.version : 1,
  };
}

