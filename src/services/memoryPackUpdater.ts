/**
 * Memory Pack Updater Service
 * Updates conversation memory pack and progress tracking using OpenAI
 */

import pino from "pino";
import { z } from "zod";
import type { MemoryPack } from "../../shared/types/memoryPack.ts";
import type { ContactProgressStage, ContactProgressData } from "../../shared/types/progress.ts";
import { mergeNonNull } from "../../shared/types/memoryPack.ts";
import { determineProgressStage } from "./progressEngine.ts";
import type { ProgressEngineInput } from "./progressEngine.ts";

const log = pino({ name: "memoryPackUpdater" });

const MODEL = "gpt-4o-mini";
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 12_000;

/**
 * Candidate snapshot (read-only for context)
 */
export type CandidateSnapshot = {
  name: string | null;
  desiredRole: string | null;
  location: string | null;
  availability: string | null;
  salary: {
    min: number | null;
    max: number | null;
    currency: string | null;
  } | null;
  skills: string[];
  yearsExperience: number | null;
};

/**
 * Message for context
 */
export type MessageForContext = {
  direction: "INBOUND" | "OUTBOUND";
  text: string;
  createdAt: Date;
};

/**
 * Input for memory pack update
 */
export type MemoryPackUpdateInput = {
  conversationId: string;
  forceRecomputeMemory?: boolean;
  forceRecomputeProgress?: boolean;
  lastMessages: MessageForContext[]; // Last 15-25 messages
  existingMemoryPack: MemoryPack | null;
  existingProgressStage: ContactProgressStage;
  existingProgressData: ContactProgressData | null;
  candidateSnapshot: CandidateSnapshot | null;
};

/**
 * Output from memory pack update
 */
export type MemoryPackUpdateOutput = {
  memoryPackPatch: Partial<MemoryPack>;
  progressUpdate: {
    stage: ContactProgressStage;
    progressDataPatch: Partial<ContactProgressData>;
  };
};

/**
 * Zod schema for OpenAI response
 */
const MemoryPackUpdateResponseSchema = z.object({
  memoryPackPatch: z.object({
    summary: z.string().optional(),
    facts: z
      .object({
        trade: z.string().nullable().optional(),
        location: z.string().nullable().optional(),
        availability: z.string().nullable().optional(),
        salary: z
          .object({
            min: z.number().nullable().optional(),
            max: z.number().nullable().optional(),
            currency: z.string().nullable().optional(),
          })
          .nullable()
          .optional(),
        skills: z.array(z.string()).nullable().optional(),
        tickets: z.array(z.string()).nullable().optional(),
        preferredAreas: z.array(z.string()).nullable().optional(),
        transport: z.string().nullable().optional(),
        startDate: z.string().nullable().optional(),
        lastClient: z.string().nullable().optional(),
      })
      .optional(),
    goal: z.string().optional(),
    openQuestions: z.array(z.string()).optional(),
    lastJobDiscussed: z
      .object({
        jobId: z.string().optional(),
        title: z.string().optional(),
        location: z.string().optional(),
        startDate: z.string().optional(),
      })
      .nullable()
      .optional(),
    nextAction: z.string().optional(),
  }),
  progressUpdate: z.object({
    stage: z.enum([
      "NEW",
      "PROFILE_INCOMPLETE",
      "LOOKING_FOR_WORK",
      "MATCHED_TO_JOBS",
      "DOCS_NEEDED",
      "CSCS_VERIFICATION",
      "READY_TO_PLACE",
      "PLACED",
      "AFTERCARE",
      "DORMANT",
      "CLOSED",
    ]),
    progressDataPatch: z.object({
      missingFields: z.array(z.string()).optional(),
      nextAction: z.string().nullable().optional(),
      followUpAt: z.string().nullable().optional(),
      flags: z
        .object({
          waitingForOperator: z.boolean().optional(),
          highPriority: z.boolean().optional(),
        })
        .optional(),
      confidence: z.number().min(0).max(100).optional(),
    }),
  }),
});

/**
 * Update memory pack and progress for a conversation
 */
export async function updateMemoryPackAndProgress(
  input: MemoryPackUpdateInput
): Promise<MemoryPackUpdateOutput | null> {
  const { conversationId, lastMessages, existingMemoryPack, existingProgressStage, existingProgressData, candidateSnapshot, forceRecomputeMemory, forceRecomputeProgress } = input;

  // If forceRecomputeMemory is true, treat as if no existing memory pack
  const effectiveMemoryPack = forceRecomputeMemory ? null : existingMemoryPack;
  
  // If forceRecomputeProgress is true, treat as if no existing progress
  const effectiveProgressStage = forceRecomputeProgress ? null : existingProgressStage;
  const effectiveProgressData = forceRecomputeProgress ? null : existingProgressData;

  // Skip if no OpenAI key
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    log.debug({ conversationId }, "OpenAI API key not available; skipping memory pack update");
    return null;
  }

  // Prepare messages for context (last 20 messages, format for prompt)
  const messageContext = lastMessages
    .slice(-20) // Last 20 messages
    .map((msg) => {
      const direction = msg.direction === "INBOUND" ? "Candidate" : "Recruiter";
      const timestamp = msg.createdAt.toISOString();
      return `${direction} (${timestamp}): ${msg.text}`;
    })
    .join("\n");

  // Build prompt
  const prompt = buildPrompt({
    existingMemoryPack: effectiveMemoryPack,
    existingProgressStage: effectiveProgressStage || "NEW",
    existingProgressData: effectiveProgressData,
    candidateSnapshot,
    messageContext,
  });

  try {
    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a UK construction recruitment assistant. Update the conversation memory pack and progress tracking based on recent messages. Return ONLY valid JSON matching the exact schema.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 1500,
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.warn(
        {
          conversationId,
          status: response.status,
          error: errorText,
        },
        "OpenAI API error during memory pack update"
      );
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      log.warn({ conversationId }, "Empty response from OpenAI");
      return null;
    }

    // Parse and validate JSON
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      log.warn(
        { conversationId, error: parseError, content },
        "Failed to parse OpenAI JSON response"
      );
      return null;
    }

    // Validate with Zod
    const validated = MemoryPackUpdateResponseSchema.safeParse(parsed);
    if (!validated.success) {
      log.warn(
        {
          conversationId,
          errors: validated.error.errors,
          received: parsed,
        },
        "OpenAI response failed Zod validation"
      );
      return null;
    }

    // Apply progress engine rules to finalize stage
    const engineInput: ProgressEngineInput = {
      currentStage: effectiveProgressStage || "NEW",
      candidateSnapshot,
      lastIntent: input.lastIntent || null,
      hasPendingApproval: input.hasPendingApproval || false,
      hasOpenTasks: input.hasOpenTasks || { types: [] },
      lastActivityAt: input.lastActivityAt || null,
      matchedJobsCount: input.matchedJobsCount || 0,
      placementConfirmed: input.placementConfirmed || false,
    };

    const engineResult = determineProgressStage(
      engineInput,
      validated.data.progressUpdate.stage // AI suggested stage
    );

    // Merge AI progress patch with engine result
    const finalProgressDataPatch = {
      ...validated.data.progressUpdate.progressDataPatch,
      ...engineResult.progressDataPatch,
    };

    log.info(
      {
        conversationId,
        aiSuggestedStage: validated.data.progressUpdate.stage,
        finalStage: engineResult.stage,
        hasMemoryPatch: Object.keys(validated.data.memoryPackPatch).length > 0,
        hasProgressPatch: Object.keys(finalProgressDataPatch).length > 0,
      },
      "Memory pack update completed successfully"
    );

    return {
      memoryPackPatch: validated.data.memoryPackPatch,
      progressUpdate: {
        stage: engineResult.stage, // Use engine-finalized stage
        progressDataPatch: finalProgressDataPatch,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      log.warn({ conversationId }, "Memory pack update timed out");
    } else {
      log.error({ conversationId, error }, "Failed to update memory pack");
    }
    return null;
  }
}

/**
 * Build prompt for OpenAI
 */
function buildPrompt({
  existingMemoryPack,
  existingProgressStage,
  existingProgressData,
  candidateSnapshot,
  messageContext,
}: {
  existingMemoryPack: MemoryPack | null;
  existingProgressStage: ContactProgressStage;
  existingProgressData: ContactProgressData | null;
  candidateSnapshot: CandidateSnapshot | null;
  messageContext: string;
}): string {
  const memoryPackJson = existingMemoryPack
    ? JSON.stringify(existingMemoryPack, null, 2)
    : "null (no existing memory pack)";

  const progressDataJson = existingProgressData
    ? JSON.stringify(existingProgressData, null, 2)
    : "null (no existing progress data)";

  const candidateJson = candidateSnapshot
    ? JSON.stringify(candidateSnapshot, null, 2)
    : "null (no candidate profile)";

  return `Update the conversation memory pack and progress tracking based on recent messages.

EXISTING MEMORY PACK:
${memoryPackJson}

CURRENT PROGRESS:
- Stage: ${existingProgressStage}
- Progress Data: ${progressDataJson}

CANDIDATE SNAPSHOT (read-only context):
${candidateJson}

RECENT MESSAGES (last 20):
${messageContext}

TASK:
1. Update memoryPackPatch with any new information from recent messages:
   - summary: One-sentence summary (update if new info)
   - facts: Update any fields that have new information (trade, location, availability, salary, skills, tickets, preferredAreas, transport, startDate, lastClient)
   - goal: Candidate's stated goal (update if mentioned)
   - openQuestions: List of questions that still need answers
   - lastJobDiscussed: Update if a job was discussed
   - nextAction: What should happen next

2. Update progressUpdate:
   - stage: Current progress stage (one of: NEW, PROFILE_INCOMPLETE, LOOKING_FOR_WORK, MATCHED_TO_JOBS, DOCS_NEEDED, CSCS_VERIFICATION, READY_TO_PLACE, PLACED, AFTERCARE, DORMANT, CLOSED)
   - progressDataPatch:
     - missingFields: List of fields still missing from profile
     - nextAction: Next action to take (or null)
     - followUpAt: ISO timestamp for follow-up (or null)
     - flags: { waitingForOperator?: boolean, highPriority?: boolean }
     - confidence: 0-100 score for stage assessment

RETURN ONLY VALID JSON matching this exact schema:
{
  "memoryPackPatch": {
    "summary": "...",
    "facts": { ... },
    "goal": "...",
    "openQuestions": [...],
    "lastJobDiscussed": { ... } or null,
    "nextAction": "..."
  },
  "progressUpdate": {
    "stage": "LOOKING_FOR_WORK",
    "progressDataPatch": {
      "missingFields": [...],
      "nextAction": "..." or null,
      "followUpAt": "..." or null,
      "flags": { ... },
      "confidence": 85
    }
  }
}

Only include fields in patches that have changed. Use null for optional fields that should be cleared.`;
}

