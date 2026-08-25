/**
 * Candidate Profile Extraction Service
 * Extracts candidate profile data from conversation history using OpenAI
 */

import pino from "pino";

const log = pino({ name: "candidateExtractor" });
import { prisma } from "../db/prisma.ts";

const MODEL = "gpt-4o-mini";
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 10_000;

export type ExtractedCandidateProfile = {
  name: string | null;
  location: string | null;
  desiredRole: string | null;
  skills: string[];
  yearsExperience: number | null;
  salary: {
    min: number | null;
    max: number | null;
    currency: string | null;
  } | null;
  availabilityNotes: string | null;
};

/**
 * Enriched extraction result with confidence and method metadata
 */
export type EnrichedExtractionResult = {
  fields: {
    name?: FieldMeta<string | null>;
    location?: FieldMeta<string | null>;
    desiredRole?: FieldMeta<string | null>;
    skills?: FieldMeta<string[] | null>;
    yearsExperience?: FieldMeta<number | null>;
    salary?: FieldMeta<{
      min: number | null;
      max: number | null;
      currency: "GBP" | null;
    } | null>;
    availabilityNotes?: FieldMeta<string | null>;
  };
};

type ConversationMessage = {
  direction: "INBOUND" | "OUTBOUND";
  text: string;
  createdAt: Date;
};

type ExtractCandidateInput = {
  conversationHistory: ConversationMessage[];
  latestMessage: ConversationMessage;
  contactPhone: string;
  sourceMessageId?: string; // Optional message ID for tracking source
};

type OpenAIChatCompletionsResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

/**
 * Metadata for a single extracted field
 */
export type FieldMeta<T> = {
  value: T | null;
  confidence: number; // 0..1
  method: "explicit" | "inferred";
  sourceMessageId: string;
  lastUpdatedAt: string; // ISO
};

/**
 * Enrichment metadata blob stored in rawProfile.enrichment
 */
export type EnrichmentBlob = {
  fields: Record<string, FieldMeta<any>>;
  conflicts: Record<string, Array<{
    old: any;
    incoming: any;
    createdAt: string;
    sourceMessageId: string;
    reason: string;
  }>>;
  needsReview: boolean;
  needsReviewReasons: string[];
};

/**
 * Safely convert any value to an object, returning {} if null/undefined/non-object
 */
function safeObject(raw: any): Record<string, any> {
  if (raw === null || raw === undefined) {
    return {};
  }
  if (typeof raw !== "object") {
    return {};
  }
  // Handle arrays - convert to object with numeric keys
  if (Array.isArray(raw)) {
    return {};
  }
  return raw as Record<string, any>;
}

/**
 * Check if a value is a plain object (not null, not array, not Date, etc.)
 */
function isPlainObject(value: any): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  // Check if it's a plain object (not a class instance like Date, RegExp, etc.)
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

/**
 * Get enrichment blob from rawProfile, returning defaults if missing
 * Handles backward compatibility with legacy rawProfile formats
 * Never throws - always returns valid structure with defaults
 */
function getEnrichment(rawProfile: any): EnrichmentBlob {
  // Guard: if rawProfile is not a plain object, wrap it to preserve legacy data
  let normalizedProfile: any;
  if (!isPlainObject(rawProfile)) {
    normalizedProfile = { legacyRawProfile: rawProfile };
    log.warn(
      {
        rawProfileType: typeof rawProfile,
        isArray: Array.isArray(rawProfile),
      },
      "rawProfile is not a plain object, wrapping in legacyRawProfile for backward compatibility"
    );
  } else {
    normalizedProfile = rawProfile;
  }

  // Safely extract enrichment, falling back to defaults if missing or malformed
  // safeObject() already handles null/undefined/non-objects gracefully
  const profile = safeObject(normalizedProfile);
  const enrichment = safeObject(profile.enrichment);

  // Validate and return enrichment blob with defaults
  // Never throw - always return valid structure
  return {
    fields: safeObject(enrichment.fields),
    conflicts: safeObject(enrichment.conflicts),
    needsReview: typeof enrichment.needsReview === "boolean" ? enrichment.needsReview : false,
    needsReviewReasons: Array.isArray(enrichment.needsReviewReasons)
      ? enrichment.needsReviewReasons.filter((r): r is string => typeof r === "string")
      : [],
  };
}

/**
 * Set enrichment blob in rawProfile, merging without deleting other keys
 */
function setEnrichment(rawProfile: any, enrichment: EnrichmentBlob): any {
  const profile = safeObject(rawProfile);
  
  // Merge enrichment into profile without deleting other keys
  return {
    ...profile,
    enrichment: {
      fields: enrichment.fields,
      conflicts: enrichment.conflicts,
      needsReview: enrichment.needsReview,
      needsReviewReasons: enrichment.needsReviewReasons,
    },
  };
}

/**
 * Normalize salary value to ensure consistent format
 * - Ensures min/max are integers or null
 * - Swaps min/max if min > max and both exist
 * - Clamps negatives to null
 * - Normalizes currency to "GBP" (uppercase) when provided, else null
 */
function normalizeSalaryValue(input: any): { min: number | null; max: number | null; currency: "GBP" | null } | null {
  if (input === null || input === undefined) {
    return null;
  }
  
  if (typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  
  const obj = input as Record<string, unknown>;
  
  // Normalize min
  let min: number | null = null;
  if (typeof obj.min === "number") {
    if (obj.min < 0) {
      min = null; // Clamp negatives to null
    } else {
      min = Math.round(obj.min); // Ensure integer
    }
  }
  
  // Normalize max
  let max: number | null = null;
  if (typeof obj.max === "number") {
    if (obj.max < 0) {
      max = null; // Clamp negatives to null
    } else {
      max = Math.round(obj.max); // Ensure integer
    }
  }
  
  // Normalize currency
  let currency: "GBP" | null = null;
  if (obj.currency !== null && obj.currency !== undefined) {
    const currencyStr = String(obj.currency).trim().toUpperCase();
    if (currencyStr === "GBP") {
      currency = "GBP";
    } else {
      currency = null;
    }
  }
  
  // Swap min/max if min > max and both exist
  if (min !== null && max !== null && min > max) {
    const temp = min;
    min = max;
    max = temp;
  }
  
  // Only return salary object if at least one field is present
  if (min !== null || max !== null || currency !== null) {
    return { min, max, currency };
  }
  
  return null;
}

/**
 * Check if two values are meaningfully different
 * Handles strings (case-insensitive), numbers, arrays, and salary objects
 */
function valuesMeaningfullyDifferent(a: any, b: any): boolean {
  // Both null/undefined -> same
  if ((a === null || a === undefined) && (b === null || b === undefined)) {
    return false;
  }
  
  // One null, one not -> different
  if ((a === null || a === undefined) !== (b === null || b === undefined)) {
    return true;
  }
  
  // String comparison (case-insensitive, trimmed)
  if (typeof a === "string" && typeof b === "string") {
    return a.trim().toLowerCase() !== b.trim().toLowerCase();
  }
  
  // Number comparison (strict)
  if (typeof a === "number" && typeof b === "number") {
    return a !== b;
  }
  
  // Array comparison (sorted, unique)
  if (Array.isArray(a) && Array.isArray(b)) {
    const aSorted = Array.from(new Set(a.map(String))).sort();
    const bSorted = Array.from(new Set(b.map(String))).sort();
    if (aSorted.length !== bSorted.length) {
      return true;
    }
    return aSorted.some((val, idx) => val !== bSorted[idx]);
  }
  
  // Salary object comparison (min/max/currency, treat nulls carefully)
  if (a && typeof a === "object" && b && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    // Check if both are salary-like objects
    const hasSalaryKeys = (obj: any) => 
      ("min" in obj || "max" in obj || "currency" in obj) &&
      !("value" in obj || "confidence" in obj || "method" in obj);
    
    if (hasSalaryKeys(a) && hasSalaryKeys(b)) {
      // Normalize both values before comparison
      const normalizedA = normalizeSalaryValue(a);
      const normalizedB = normalizeSalaryValue(b);
      
      if (normalizedA === null && normalizedB === null) {
        return false; // Both null -> same
      }
      if (normalizedA === null || normalizedB === null) {
        return true; // One null, one not -> different
      }
      
      return normalizedA.min !== normalizedB.min || 
             normalizedA.max !== normalizedB.max || 
             normalizedA.currency !== normalizedB.currency;
    }
  }
  
  // Default: strict equality
  return a !== b;
}

/**
 * Merge field metadata with conflict detection
 * Returns decision, final metadata, reason, and optional conflict record
 */
function mergeField<T>(
  fieldName: string,
  existing: FieldMeta<T> | null,
  incoming: FieldMeta<T>,
  sourceMessageId: string
): {
  decision: "accept" | "reject" | "conflict";
  finalMeta: FieldMeta<T>;
  reason: string;
  conflict?: {
    old: any;
    incoming: any;
    createdAt: string;
    sourceMessageId: string;
    reason: string;
  };
} {
  const now = new Date().toISOString();
  
  // Normalize salary values if this is a salary field
  let normalizedIncoming = incoming;
  if (fieldName === "salary" && incoming.value !== null) {
    const normalizedValue = normalizeSalaryValue(incoming.value);
    normalizedIncoming = {
      ...incoming,
      value: normalizedValue as T,
    };
  }
  
  // Normalize existing salary value if present
  let normalizedExisting = existing;
  if (fieldName === "salary" && existing && existing.value !== null) {
    const normalizedValue = normalizeSalaryValue(existing.value);
    normalizedExisting = {
      ...existing,
      value: normalizedValue as T,
    };
  }
  
  // Rule 1: No existing -> accept
  if (!normalizedExisting) {
    return {
      decision: "accept",
      finalMeta: {
        ...normalizedIncoming,
        sourceMessageId,
        lastUpdatedAt: now,
      },
      reason: `New field: ${fieldName}`,
    };
  }
  
  // Rule 2: Incoming value is null -> reject (do not overwrite)
  if (normalizedIncoming.value === null) {
    return {
      decision: "reject",
      finalMeta: normalizedExisting,
      reason: `Incoming ${fieldName} is null, keeping existing value`,
    };
  }
  
  // Rule 7: Values equal -> accept, update meta timestamps and sourceMessageId
  if (!valuesMeaningfullyDifferent(normalizedExisting.value, normalizedIncoming.value)) {
      return {
        decision: "accept",
        finalMeta: {
          ...normalizedExisting,
          sourceMessageId,
          lastUpdatedAt: now,
          // Update confidence/method if incoming is better
          confidence: normalizedIncoming.confidence > normalizedExisting.confidence ? normalizedIncoming.confidence : normalizedExisting.confidence,
          method: normalizedIncoming.method === "explicit" ? normalizedIncoming.method : normalizedExisting.method,
        },
        reason: `Values match, updating metadata for ${fieldName}`,
      };
    }
  
  // Rule 3: Incoming explicit + existing inferred -> accept (unless confidence < 0.3)
  if (normalizedIncoming.method === "explicit" && normalizedExisting.method === "inferred") {
    if (normalizedIncoming.confidence >= 0.3) {
      return {
        decision: "accept",
        finalMeta: {
          ...normalizedIncoming,
          sourceMessageId,
          lastUpdatedAt: now,
        },
        reason: `Explicit ${fieldName} (confidence ${normalizedIncoming.confidence}) overrides inferred (confidence ${normalizedExisting.confidence})`,
      };
    } else {
      return {
        decision: "reject",
        finalMeta: normalizedExisting,
        reason: `Explicit ${fieldName} has low confidence (${normalizedIncoming.confidence} < 0.3), keeping inferred`,
      };
    }
  }
  
  // Rule 4: Incoming confidence >= existing + 0.2 -> accept
  if (normalizedIncoming.confidence >= normalizedExisting.confidence + 0.2) {
    return {
      decision: "accept",
      finalMeta: {
        ...normalizedIncoming,
        sourceMessageId,
        lastUpdatedAt: now,
      },
      reason: `Incoming ${fieldName} confidence (${normalizedIncoming.confidence}) significantly higher than existing (${normalizedExisting.confidence})`,
    };
  }
  
  // Rule 5: Incoming is newer and abs(confidence diff) <= 0.15 -> accept
  const incomingTime = new Date(normalizedIncoming.lastUpdatedAt).getTime();
  const existingTime = new Date(normalizedExisting.lastUpdatedAt).getTime();
  const confidenceDiff = Math.abs(normalizedIncoming.confidence - normalizedExisting.confidence);
  
  if (incomingTime > existingTime && confidenceDiff <= 0.15) {
    return {
      decision: "accept",
      finalMeta: {
        ...normalizedIncoming,
        sourceMessageId,
        lastUpdatedAt: now,
      },
      reason: `Newer ${fieldName} with similar confidence (diff: ${confidenceDiff.toFixed(2)})`,
    };
  }
  
  // Rule 6: Values differ meaningfully and abs(confidence diff) < 0.2 -> conflict
  if (confidenceDiff < 0.2) {
    return {
      decision: "conflict",
      finalMeta: normalizedExisting,
      reason: `Conflicting ${fieldName}: values differ but confidence difference (${confidenceDiff.toFixed(2)}) is small`,
      conflict: {
        old: normalizedExisting.value,
        incoming: normalizedIncoming.value,
        createdAt: now,
        sourceMessageId,
        reason: `Conflicting ${fieldName}: existing confidence ${normalizedExisting.confidence}, incoming confidence ${normalizedIncoming.confidence}`,
      },
    };
  }
  
  // Default: reject (incoming doesn't meet acceptance criteria)
  return {
    decision: "reject",
    finalMeta: normalizedExisting,
    reason: `Incoming ${fieldName} does not meet acceptance criteria (confidence: ${normalizedIncoming.confidence}, existing: ${normalizedExisting.confidence})`,
  };
}

/**
 * Extract candidate profile from conversation history using OpenAI
 * Returns enriched extraction with confidence and method metadata
 */
export async function extractCandidateProfile(
  input: ExtractCandidateInput
): Promise<EnrichedExtractionResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log.warn("OPENAI_API_KEY not set; skipping candidate extraction");
    return null;
  }

  const { conversationHistory, latestMessage, contactPhone, sourceMessageId } = input;

  log.info(
    {
      contactPhone,
      messageCount: conversationHistory.length,
    },
    "Extracting candidate profile from conversation"
  );

  // Build conversation context (last 20 messages for context)
  const recentMessages = conversationHistory.slice(-20);
  const conversationText = recentMessages
    .map((msg) => {
      const role = msg.direction === "INBOUND" ? "Candidate" : "Recruiter";
      const timestamp = msg.createdAt.toISOString();
      return `[${timestamp}] ${role}: ${msg.text}`;
    })
    .join("\n");

  const systemPrompt = [
    "You are a candidate profile extraction system. Extract structured candidate information from WhatsApp conversation history.",
    "Return ONLY valid JSON (no markdown, no extra text).",
    "",
    "Output schema:",
    "{",
    '  "fields": {',
    '    "name": { "value": string | null, "confidence": number, "method": "explicit" | "inferred" },',
    '    "location": { "value": string | null, "confidence": number, "method": "explicit" | "inferred" },',
    '    "desiredRole": { "value": string | null, "confidence": number, "method": "explicit" | "inferred" },',
    '    "skills": { "value": string[] | null, "confidence": number, "method": "explicit" | "inferred" },',
    '    "yearsExperience": { "value": number | null, "confidence": number, "method": "explicit" | "inferred" },',
    '    "salary": { "value": { "min": number | null, "max": number | null, "currency": "GBP" | null } | null, "confidence": number, "method": "explicit" | "inferred" },',
    '    "availabilityNotes": { "value": string | null, "confidence": number, "method": "explicit" | "inferred" }',
    "  }",
    "}",
    "",
    "Rules:",
    "- confidence: must be a number between 0 and 1 (0.0 to 1.0)",
    "- method: 'explicit' means the candidate directly stated it in messages; 'inferred' means guessed from context",
    "- inferred fields should have confidence <= 0.6",
    "- explicit fields should have confidence >= 0.7",
    "- Only extract information mentioned in the conversation",
    "- If a field is not mentioned, use null for value (not empty string or 0)",
    "- skills: array of skill names mentioned (e.g., ['JavaScript', 'React', 'Node.js'])",
    "- yearsExperience: numeric value only (e.g., 5, not '5 years')",
    "- salary: extract min/max/currency if mentioned, otherwise null",
    "- currency: use 'GBP' only if salary is explicitly stated in pounds; otherwise null",
    "- availabilityNotes: any notes about availability, schedule, or timing",
    "- NEVER fabricate salary numbers or name; use null if not provided",
    "- Be conservative: prefer null over guessing",
  ].join("\n");

  const userPrompt = `Extract candidate profile from this conversation:\n\n${conversationText}\n\nLatest message: ${latestMessage.text}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const body = {
      model: MODEL,
      temperature: 0,
      max_tokens: 500,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    };

    const res = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      log.warn(
        {
          status: res.status,
          statusText: res.statusText,
          error: errText,
          contactPhone,
        },
        "OpenAI candidate extraction failed"
      );
      return null;
    }

    const data = (await res.json()) as OpenAIChatCompletionsResponse;
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      log.warn({ contactPhone }, "OpenAI returned empty content for candidate extraction");
      return null;
    }

    // Parse JSON response
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      log.warn(
        { contactPhone, content, error: parseError },
        "Failed to parse OpenAI JSON response"
      );
      return null;
    }

    // Validate and normalize the response
    const result = validateAndNormalizeProfile(parsed, sourceMessageId || "");

    // Dev-only smoke check: validate and coerce any remaining invalid values
    const checkedResult = smokeCheckExtractedProfile(result, contactPhone);

    log.info(
      {
        contactPhone,
        extractedFields: Object.keys(checkedResult.fields),
        fieldsWithValues: Object.keys(checkedResult.fields).filter(
          (key) => checkedResult.fields[key as keyof typeof checkedResult.fields]?.value !== null
        ),
      },
      "Candidate profile extracted successfully"
    );

    return checkedResult;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      log.warn({ contactPhone }, "Candidate extraction timed out");
    } else {
      log.error(
        { contactPhone, error },
        "Candidate extraction error"
      );
    }
    return null;
  }
}

/**
 * Validate and normalize extracted profile data
 * Normalizes only .value fields while preserving confidence and method metadata
 */
function validateAndNormalizeProfile(data: unknown, sourceMessageId: string = ""): EnrichedExtractionResult {
  if (!data || typeof data !== "object") {
    return { fields: {} };
  }

  const obj = data as Record<string, unknown>;
  const fields = safeObject(obj.fields);
  const result: EnrichedExtractionResult = { fields: {} };

  // Normalize name field
  if (fields.name && typeof fields.name === "object" && fields.name !== null) {
    const nameMeta = fields.name as Record<string, unknown>;
    const value = typeof nameMeta.value === "string" && nameMeta.value.trim() ? nameMeta.value.trim() : null;
    const confidence = typeof nameMeta.confidence === "number" ? Math.max(0, Math.min(1, nameMeta.confidence)) : 0.5;
    const method = nameMeta.method === "explicit" || nameMeta.method === "inferred" ? nameMeta.method : "inferred";
    
    result.fields.name = {
      value,
      confidence,
      method,
      sourceMessageId: typeof nameMeta.sourceMessageId === "string" ? nameMeta.sourceMessageId : sourceMessageId,
      lastUpdatedAt: typeof nameMeta.lastUpdatedAt === "string" ? nameMeta.lastUpdatedAt : new Date().toISOString(),
    };
  }

  // Normalize location field
  if (fields.location && typeof fields.location === "object" && fields.location !== null) {
    const locationMeta = fields.location as Record<string, unknown>;
    const value = typeof locationMeta.value === "string" && locationMeta.value.trim() ? locationMeta.value.trim() : null;
    const confidence = typeof locationMeta.confidence === "number" ? Math.max(0, Math.min(1, locationMeta.confidence)) : 0.5;
    const method = locationMeta.method === "explicit" || locationMeta.method === "inferred" ? locationMeta.method : "inferred";
    
    result.fields.location = {
      value,
      confidence,
      method,
      sourceMessageId: typeof locationMeta.sourceMessageId === "string" ? locationMeta.sourceMessageId : sourceMessageId,
      lastUpdatedAt: typeof locationMeta.lastUpdatedAt === "string" ? locationMeta.lastUpdatedAt : new Date().toISOString(),
    };
  }

  // Normalize desiredRole field
  if (fields.desiredRole && typeof fields.desiredRole === "object" && fields.desiredRole !== null) {
    const roleMeta = fields.desiredRole as Record<string, unknown>;
    const value = typeof roleMeta.value === "string" && roleMeta.value.trim() ? roleMeta.value.trim() : null;
    const confidence = typeof roleMeta.confidence === "number" ? Math.max(0, Math.min(1, roleMeta.confidence)) : 0.5;
    const method = roleMeta.method === "explicit" || roleMeta.method === "inferred" ? roleMeta.method : "inferred";
    
    result.fields.desiredRole = {
      value,
      confidence,
      method,
      sourceMessageId: typeof roleMeta.sourceMessageId === "string" ? roleMeta.sourceMessageId : sourceMessageId,
      lastUpdatedAt: typeof roleMeta.lastUpdatedAt === "string" ? roleMeta.lastUpdatedAt : new Date().toISOString(),
    };
  }

  // Normalize skills field
  if (fields.skills && typeof fields.skills === "object" && fields.skills !== null) {
    const skillsMeta = fields.skills as Record<string, unknown>;
    let value: string[] | null = null;
    if (skillsMeta.value !== null && Array.isArray(skillsMeta.value)) {
      const skills = skillsMeta.value
        .filter((s): s is string => typeof s === "string" && s.trim())
        .map((s) => s.trim());
      // Deduplicate skills
      value = Array.from(new Set(skills));
    }
    const confidence = typeof skillsMeta.confidence === "number" ? Math.max(0, Math.min(1, skillsMeta.confidence)) : 0.5;
    const method = skillsMeta.method === "explicit" || skillsMeta.method === "inferred" ? skillsMeta.method : "inferred";
    
    result.fields.skills = {
      value,
      confidence,
      method,
      sourceMessageId: typeof skillsMeta.sourceMessageId === "string" ? skillsMeta.sourceMessageId : sourceMessageId,
      lastUpdatedAt: typeof skillsMeta.lastUpdatedAt === "string" ? skillsMeta.lastUpdatedAt : new Date().toISOString(),
    };
  }

  // Normalize yearsExperience field
  if (fields.yearsExperience && typeof fields.yearsExperience === "object" && fields.yearsExperience !== null) {
    const expMeta = fields.yearsExperience as Record<string, unknown>;
    let value: number | null = null;
    if (typeof expMeta.value === "number" && expMeta.value > 0) {
      // Clamp to reasonable range (0-100 years)
      value = Math.max(0, Math.min(100, Math.round(expMeta.value)));
    }
    const confidence = typeof expMeta.confidence === "number" ? Math.max(0, Math.min(1, expMeta.confidence)) : 0.5;
    const method = expMeta.method === "explicit" || expMeta.method === "inferred" ? expMeta.method : "inferred";
    
    result.fields.yearsExperience = {
      value,
      confidence,
      method,
      sourceMessageId: typeof expMeta.sourceMessageId === "string" ? expMeta.sourceMessageId : sourceMessageId,
      lastUpdatedAt: typeof expMeta.lastUpdatedAt === "string" ? expMeta.lastUpdatedAt : new Date().toISOString(),
    };
  }

  // Normalize salary field
  if (fields.salary && typeof fields.salary === "object" && fields.salary !== null) {
    const salaryMeta = fields.salary as Record<string, unknown>;
    
    // Normalize salary value using normalizeSalaryValue()
    const value = normalizeSalaryValue(salaryMeta.value);
    
    const confidence = typeof salaryMeta.confidence === "number" ? Math.max(0, Math.min(1, salaryMeta.confidence)) : 0.5;
    const method = salaryMeta.method === "explicit" || salaryMeta.method === "inferred" ? salaryMeta.method : "inferred";
    
    result.fields.salary = {
      value,
      confidence,
      method,
      sourceMessageId: typeof salaryMeta.sourceMessageId === "string" ? salaryMeta.sourceMessageId : sourceMessageId,
      lastUpdatedAt: typeof salaryMeta.lastUpdatedAt === "string" ? salaryMeta.lastUpdatedAt : new Date().toISOString(),
    };
  }

  // Normalize availabilityNotes field
  if (fields.availabilityNotes && typeof fields.availabilityNotes === "object" && fields.availabilityNotes !== null) {
    const notesMeta = fields.availabilityNotes as Record<string, unknown>;
    const value = typeof notesMeta.value === "string" && notesMeta.value.trim() ? notesMeta.value.trim() : null;
    const confidence = typeof notesMeta.confidence === "number" ? Math.max(0, Math.min(1, notesMeta.confidence)) : 0.5;
    const method = notesMeta.method === "explicit" || notesMeta.method === "inferred" ? notesMeta.method : "inferred";
    
    result.fields.availabilityNotes = {
      value,
      confidence,
      method,
      sourceMessageId: typeof notesMeta.sourceMessageId === "string" ? notesMeta.sourceMessageId : sourceMessageId,
      lastUpdatedAt: typeof notesMeta.lastUpdatedAt === "string" ? notesMeta.lastUpdatedAt : new Date().toISOString(),
    };
  }

  return result;
}

/**
 * Dev-only smoke check: validate and coerce extracted profile data
 * Prevents GPT quirks from breaking the inbound pipeline
 * Logs warnings and coerces invalid values, never throws
 */
function smokeCheckExtractedProfile(
  result: EnrichedExtractionResult,
  contactPhone: string
): EnrichedExtractionResult {
  // Only run in development
  if (process.env.NODE_ENV === "production") {
    return result;
  }

  const issues: string[] = [];
  const coerced: EnrichedExtractionResult = { fields: {} };

  // Check each field
  for (const [fieldName, fieldMeta] of Object.entries(result.fields)) {
    if (!fieldMeta) {
      continue;
    }

    const coercedMeta: any = { ...fieldMeta };
    let hasIssues = false;

    // Check confidence: must be between 0 and 1
    if (typeof fieldMeta.confidence !== "number" || fieldMeta.confidence < 0 || fieldMeta.confidence > 1) {
      const original = fieldMeta.confidence;
      coercedMeta.confidence = Math.max(0, Math.min(1, typeof fieldMeta.confidence === "number" ? fieldMeta.confidence : 0.5));
      issues.push(`${fieldName}.confidence: ${original} → ${coercedMeta.confidence}`);
      hasIssues = true;
    }

    // Check method: must be "explicit" or "inferred"
    if (fieldMeta.method !== "explicit" && fieldMeta.method !== "inferred") {
      const original = fieldMeta.method;
      coercedMeta.method = "inferred";
      issues.push(`${fieldName}.method: ${original} → inferred`);
      hasIssues = true;
    }

    // Check salary min/max: must be integers or null
    if (fieldName === "salary" && fieldMeta.value !== null) {
      const salaryValue = fieldMeta.value as { min: number | null; max: number | null; currency: "GBP" | null } | null;
      if (salaryValue) {
        const coercedSalary: any = { ...salaryValue };
        let salaryHasIssues = false;

        if (salaryValue.min !== null && (!Number.isInteger(salaryValue.min) || salaryValue.min < 0)) {
          const original = salaryValue.min;
          coercedSalary.min = salaryValue.min !== null && salaryValue.min >= 0 ? Math.round(salaryValue.min) : null;
          issues.push(`${fieldName}.value.min: ${original} → ${coercedSalary.min}`);
          salaryHasIssues = true;
          hasIssues = true;
        }

        if (salaryValue.max !== null && (!Number.isInteger(salaryValue.max) || salaryValue.max < 0)) {
          const original = salaryValue.max;
          coercedSalary.max = salaryValue.max !== null && salaryValue.max >= 0 ? Math.round(salaryValue.max) : null;
          issues.push(`${fieldName}.value.max: ${original} → ${coercedSalary.max}`);
          salaryHasIssues = true;
          hasIssues = true;
        }

        if (salaryHasIssues) {
          coercedMeta.value = coercedSalary;
        }
      }
    }

    // Always include the field (coerced if needed, original if no issues)
    coerced.fields[fieldName as keyof typeof coerced.fields] = coercedMeta;
  }

  // Log warning if issues found
  if (issues.length > 0) {
    log.warn(
      {
        contactPhone,
        issues,
        issueCount: issues.length,
      },
      "Smoke check: coerced invalid values in extracted profile"
    );
  }

  // Return coerced result (or original if no issues)
  return issues.length > 0 ? coerced : result;
}

/**
 * Upsert candidate profile
 * - Uses mergeField() to decide accept/reject/conflict for each field
 * - Only updates Candidate columns when decision is "accept"
 * - Updates rawProfile.enrichment with final field metas and conflicts
 * - Always updates lastSeenAt and lastConversationId
 */
export async function upsertCandidateProfile({
  agencyId,
  phone,
  conversationId,
  extractedProfile,
  sourceMessageId,
}: {
  agencyId: string;
  phone: string;
  conversationId: string;
  extractedProfile: EnrichedExtractionResult;
  sourceMessageId: string;
}): Promise<void> {
  log.info(
    {
      agencyId,
      phone,
      conversationId,
      sourceMessageId,
      extractedFields: Object.keys(extractedProfile.fields),
    },
    "Upserting candidate profile"
  );

  // Find existing candidate
  const existing = await prisma.candidate.findUnique({
    where: {
      agencyId_phone: {
        agencyId,
        phone,
      },
    },
  });

  // Load existing enrichment metadata
  const existingRawProfile = existing?.rawProfile || {};
  const existingEnrichment = getEnrichment(existingRawProfile);

  // Build final enrichment blob
  const finalEnrichment: EnrichmentBlob = {
    fields: { ...existingEnrichment.fields },
    conflicts: { ...existingEnrichment.conflicts },
    needsReview: existingEnrichment.needsReview,
    needsReviewReasons: [...existingEnrichment.needsReviewReasons],
  };

  // Build update/create data
  const updateData: any = {
    lastSeenAt: new Date(),
    lastConversationId: conversationId,
  };

  const now = new Date().toISOString();

  // Collect merge events to log after we have candidateId
  const mergeEvents: Array<{
    field: string;
    decision: string;
    reason: string;
    incomingConfidence: number;
    existingConfidence: number | null;
  }> = [];

  // Process each field from extractedProfile
  const fieldProcessors: Array<{
    fieldName: string;
    incomingMeta: FieldMeta<any> | undefined;
    process: (meta: FieldMeta<any>) => void;
  }> = [
    {
      fieldName: "name",
      incomingMeta: extractedProfile.fields.name,
      process: (meta) => {
        const existingMeta = existingEnrichment.fields.name || null;
        const mergeResult = mergeField("name", existingMeta, meta, sourceMessageId);
        
        finalEnrichment.fields.name = mergeResult.finalMeta;
        
        // Collect merge event for logging (only if incoming value is not null)
        if (meta.value !== null) {
          mergeEvents.push({
            field: "name",
            decision: mergeResult.decision,
            reason: mergeResult.reason,
            incomingConfidence: meta.confidence,
            existingConfidence: existingMeta?.confidence ?? null,
          });
        }
        
        if (mergeResult.decision === "accept" && mergeResult.finalMeta.value !== null) {
          updateData.name = mergeResult.finalMeta.value;
        }
        
        if (mergeResult.decision === "conflict" && mergeResult.conflict) {
          if (!finalEnrichment.conflicts.name) {
            finalEnrichment.conflicts.name = [];
          }
          finalEnrichment.conflicts.name.push(mergeResult.conflict);
          finalEnrichment.needsReview = true;
          if (!finalEnrichment.needsReviewReasons.includes(mergeResult.reason)) {
            finalEnrichment.needsReviewReasons.push(mergeResult.reason);
          }
        }
      },
    },
    {
      fieldName: "location",
      incomingMeta: extractedProfile.fields.location,
      process: (meta) => {
        const existingMeta = existingEnrichment.fields.location || null;
        const mergeResult = mergeField("location", existingMeta, meta, sourceMessageId);
        
        finalEnrichment.fields.location = mergeResult.finalMeta;
        
        // Collect merge event for logging (only if incoming value is not null)
        if (meta.value !== null) {
          mergeEvents.push({
            field: "location",
            decision: mergeResult.decision,
            reason: mergeResult.reason,
            incomingConfidence: meta.confidence,
            existingConfidence: existingMeta?.confidence ?? null,
          });
        }
        
        if (mergeResult.decision === "accept" && mergeResult.finalMeta.value !== null) {
          updateData.location = mergeResult.finalMeta.value;
        }
        
        if (mergeResult.decision === "conflict" && mergeResult.conflict) {
          if (!finalEnrichment.conflicts.location) {
            finalEnrichment.conflicts.location = [];
          }
          finalEnrichment.conflicts.location.push(mergeResult.conflict);
          finalEnrichment.needsReview = true;
          if (!finalEnrichment.needsReviewReasons.includes(mergeResult.reason)) {
            finalEnrichment.needsReviewReasons.push(mergeResult.reason);
          }
        }
      },
    },
    {
      fieldName: "desiredRole",
      incomingMeta: extractedProfile.fields.desiredRole,
      process: (meta) => {
        const existingMeta = existingEnrichment.fields.desiredRole || null;
        const mergeResult = mergeField("desiredRole", existingMeta, meta, sourceMessageId);
        
        finalEnrichment.fields.desiredRole = mergeResult.finalMeta;
        
        // Collect merge event for logging (only if incoming value is not null)
        if (meta.value !== null) {
          mergeEvents.push({
            field: "desiredRole",
            decision: mergeResult.decision,
            reason: mergeResult.reason,
            incomingConfidence: meta.confidence,
            existingConfidence: existingMeta?.confidence ?? null,
          });
        }
        
        if (mergeResult.decision === "accept" && mergeResult.finalMeta.value !== null) {
          updateData.desiredRole = mergeResult.finalMeta.value;
        }
        
        if (mergeResult.decision === "conflict" && mergeResult.conflict) {
          if (!finalEnrichment.conflicts.desiredRole) {
            finalEnrichment.conflicts.desiredRole = [];
          }
          finalEnrichment.conflicts.desiredRole.push(mergeResult.conflict);
          finalEnrichment.needsReview = true;
          if (!finalEnrichment.needsReviewReasons.includes(mergeResult.reason)) {
            finalEnrichment.needsReviewReasons.push(mergeResult.reason);
          }
        }
      },
    },
    {
      fieldName: "yearsExperience",
      incomingMeta: extractedProfile.fields.yearsExperience,
      process: (meta) => {
        const existingMeta = existingEnrichment.fields.yearsExperience || null;
        const mergeResult = mergeField("yearsExperience", existingMeta, meta, sourceMessageId);
        
        finalEnrichment.fields.yearsExperience = mergeResult.finalMeta;
        
        // Collect merge event for logging (only if incoming value is not null)
        if (meta.value !== null) {
          mergeEvents.push({
            field: "yearsExperience",
            decision: mergeResult.decision,
            reason: mergeResult.reason,
            incomingConfidence: meta.confidence,
            existingConfidence: existingMeta?.confidence ?? null,
          });
        }
        
        if (mergeResult.decision === "accept" && mergeResult.finalMeta.value !== null) {
          updateData.yearsExperience = mergeResult.finalMeta.value;
        }
        
        if (mergeResult.decision === "conflict" && mergeResult.conflict) {
          if (!finalEnrichment.conflicts.yearsExperience) {
            finalEnrichment.conflicts.yearsExperience = [];
          }
          finalEnrichment.conflicts.yearsExperience.push(mergeResult.conflict);
          finalEnrichment.needsReview = true;
          if (!finalEnrichment.needsReviewReasons.includes(mergeResult.reason)) {
            finalEnrichment.needsReviewReasons.push(mergeResult.reason);
          }
        }
      },
    },
    {
      fieldName: "availabilityNotes",
      incomingMeta: extractedProfile.fields.availabilityNotes,
      process: (meta) => {
        const existingMeta = existingEnrichment.fields.availabilityNotes || null;
        const mergeResult = mergeField("availabilityNotes", existingMeta, meta, sourceMessageId);
        
        finalEnrichment.fields.availabilityNotes = mergeResult.finalMeta;
        
        // Collect merge event for logging (only if incoming value is not null)
        if (meta.value !== null) {
          mergeEvents.push({
            field: "availabilityNotes",
            decision: mergeResult.decision,
            reason: mergeResult.reason,
            incomingConfidence: meta.confidence,
            existingConfidence: existingMeta?.confidence ?? null,
          });
        }
        
        if (mergeResult.decision === "accept" && mergeResult.finalMeta.value !== null) {
          updateData.availabilityNotes = mergeResult.finalMeta.value;
        }
        
        if (mergeResult.decision === "conflict" && mergeResult.conflict) {
          if (!finalEnrichment.conflicts.availabilityNotes) {
            finalEnrichment.conflicts.availabilityNotes = [];
          }
          finalEnrichment.conflicts.availabilityNotes.push(mergeResult.conflict);
          finalEnrichment.needsReview = true;
          if (!finalEnrichment.needsReviewReasons.includes(mergeResult.reason)) {
            finalEnrichment.needsReviewReasons.push(mergeResult.reason);
          }
        }
      },
    },
    {
      fieldName: "skills",
      incomingMeta: extractedProfile.fields.skills,
      process: (meta) => {
        const existingMeta = existingEnrichment.fields.skills || null;
        const mergeResult = mergeField("skills", existingMeta, meta, sourceMessageId);
        
        finalEnrichment.fields.skills = mergeResult.finalMeta;
        
        // Collect merge event for logging (only if incoming value is not null)
        if (meta.value !== null) {
          mergeEvents.push({
            field: "skills",
            decision: mergeResult.decision,
            reason: mergeResult.reason,
            incomingConfidence: meta.confidence,
            existingConfidence: existingMeta?.confidence ?? null,
          });
        }
        
        if (mergeResult.decision === "accept" && mergeResult.finalMeta.value !== null) {
          // Union existing skills with incoming skills
          const existingSkills = existing?.skills || [];
          const incomingSkills = mergeResult.finalMeta.value;
          const mergedSkills = Array.from(new Set([...existingSkills, ...incomingSkills]));
          updateData.skills = mergedSkills;
          // Store final normalized array in meta.value
          finalEnrichment.fields.skills = {
            ...mergeResult.finalMeta,
            value: mergedSkills,
          };
        }
        
        if (mergeResult.decision === "conflict" && mergeResult.conflict) {
          if (!finalEnrichment.conflicts.skills) {
            finalEnrichment.conflicts.skills = [];
          }
          finalEnrichment.conflicts.skills.push(mergeResult.conflict);
          finalEnrichment.needsReview = true;
          if (!finalEnrichment.needsReviewReasons.includes(mergeResult.reason)) {
            finalEnrichment.needsReviewReasons.push(mergeResult.reason);
          }
        }
      },
    },
    {
      fieldName: "salary",
      incomingMeta: extractedProfile.fields.salary,
      process: (meta) => {
        const existingMeta = existingEnrichment.fields.salary || null;
        const mergeResult = mergeField("salary", existingMeta, meta, sourceMessageId);
        
        finalEnrichment.fields.salary = mergeResult.finalMeta;
        
        // Collect merge event for logging (only if incoming value is not null)
        if (meta.value !== null) {
          mergeEvents.push({
            field: "salary",
            decision: mergeResult.decision,
            reason: mergeResult.reason,
            incomingConfidence: meta.confidence,
            existingConfidence: existingMeta?.confidence ?? null,
          });
        }
        
        if (mergeResult.decision === "accept" && mergeResult.finalMeta.value !== null) {
          const salaryValue = mergeResult.finalMeta.value;
          updateData.salaryMin = salaryValue.min;
          updateData.salaryMax = salaryValue.max;
          updateData.currency = salaryValue.currency;
        }
        
        if (mergeResult.decision === "conflict" && mergeResult.conflict) {
          if (!finalEnrichment.conflicts.salary) {
            finalEnrichment.conflicts.salary = [];
          }
          finalEnrichment.conflicts.salary.push(mergeResult.conflict);
          finalEnrichment.needsReview = true;
          if (!finalEnrichment.needsReviewReasons.includes(mergeResult.reason)) {
            finalEnrichment.needsReviewReasons.push(mergeResult.reason);
          }
        }
      },
    },
  ];

  // Process each field
  for (const processor of fieldProcessors) {
    if (processor.incomingMeta) {
      // Build incoming meta with sourceMessageId and timestamp
      const incomingMeta: FieldMeta<any> = {
        ...processor.incomingMeta,
        sourceMessageId,
        lastUpdatedAt: now,
      };
      processor.process(incomingMeta);
    }
  }

  // Update rawProfile with enrichment metadata
  const updatedRawProfile = setEnrichment(existingRawProfile, finalEnrichment);
  updateData.rawProfile = updatedRawProfile;

  // Determine candidateId for logging
  let candidateId: string | undefined;
  
  if (existing) {
    // Update existing candidate
    candidateId = existing.id;
    await prisma.candidate.update({
      where: { id: existing.id },
      data: updateData,
    });

    log.info(
      {
        candidateId: existing.id,
        phone,
        sourceMessageId,
        updatedFields: Object.keys(updateData).filter((k) => k !== "lastSeenAt" && k !== "lastConversationId" && k !== "rawProfile"),
        hasConflicts: Object.keys(finalEnrichment.conflicts).length > 0,
        needsReview: finalEnrichment.needsReview,
      },
      "Candidate profile updated"
    );
  } else {
    // Create new candidate - use accepted values or defaults
    const createData: any = {
      agencyId,
      phone,
      source: "WHATSAPP",
      name: updateData.name ?? null,
      location: updateData.location ?? null,
      desiredRole: updateData.desiredRole ?? null,
      skills: updateData.skills ?? [],
      yearsExperience: updateData.yearsExperience ?? null,
      salaryMin: updateData.salaryMin ?? null,
      salaryMax: updateData.salaryMax ?? null,
      currency: updateData.currency ?? null,
      availabilityNotes: updateData.availabilityNotes ?? null,
      lastSeenAt: updateData.lastSeenAt,
      lastConversationId: updateData.lastConversationId,
      rawProfile: updateData.rawProfile,
    };

    const candidate = await prisma.candidate.create({
      data: createData as any, // Type assertion needed until Prisma client is regenerated
    });

    candidateId = candidate.id;

    log.info(
      {
        candidateId: candidate.id,
        phone,
        sourceMessageId,
        hasConflicts: Object.keys(finalEnrichment.conflicts).length > 0,
        needsReview: finalEnrichment.needsReview,
      },
      "Candidate profile created"
    );
  }

  // Log all merge events now that we have candidateId
  for (const event of mergeEvents) {
    log.info({
      event: "candidate_enrichment_merge",
      candidateId: candidateId!,
      agencyId,
      phone,
      conversationId,
      sourceMessageId,
      field: event.field,
      decision: event.decision,
      reason: event.reason,
      incomingConfidence: event.incomingConfidence,
      existingConfidence: event.existingConfidence,
    });
  }
}

