import pino from "pino";
import type { InboundIntent } from "../domain/intent.ts";
import { MessageDirection } from "@prisma/client";
import type { Explainability } from "../../shared/types/explainability.ts";
import { sanitizeExplainability, createRulesExplainability, ExplainabilitySchema } from "../../shared/types/explainability.ts";
import type { AgencyPlaybook } from "../shared/playbook.ts";
import { buildPlaybookPolicyBlock } from "./playbook/playbookPromptBuilder.ts";
import { selectQuestionsToAsk, buildNeutralCooldownMessage } from "./continuity/questionSelector.ts";
import type { OpenQuestion } from "../../shared/types/memoryPack.ts";
import { getRequiredQuestionsFromProgress } from "./continuity/openQuestionRules.ts";
import type { ContactProgressStage, ContactProgressData } from "../../shared/types/progress.ts";

const log = pino({ name: "aiActionSuggester" });

const MODEL = "gpt-4o-mini";
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 8_000;

export type SuggestedAction = {
  actionType: "SEND_MESSAGE" | "REQUEST_INFO" | "ESCALATE" | "NO_ACTION";
  suggestedMessage?: string;
  reasoning: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  explainability?: Explainability;
};

export type ConversationMessage = {
  direction: MessageDirection;
  text: string;
  createdAt: Date;
};

export type SuggestActionInput = {
  intent: InboundIntent;
  messageText: string;
  contactName?: string | null;
  conversationHistory?: ConversationMessage[];
  playbook?: AgencyPlaybook; // Optional playbook for AI behavior configuration
  // Memory Pack and Progress context
  memoryPack?: {
    summary?: string;
    facts?: {
      trade?: string | null;
      location?: string | null;
      availability?: string | null;
      salary?: { min?: number; max?: number; currency?: string } | null;
      skills?: string[] | null;
      tickets?: string[] | null;
      preferredAreas?: string[] | null;
      transport?: string | null;
      startDate?: string | null;
      lastClient?: string | null;
    };
    openQuestions?: string[];
    structuredOpenQuestions?: OpenQuestion[];
    goal?: string;
    lastJobDiscussed?: {
      jobId?: string;
      title?: string;
      location?: string;
      startDate?: string;
    } | null;
  } | null;
  progressStage?: ContactProgressStage;
  progressData?: ContactProgressData | null;
};

type OpenAIChatCompletionsResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

function safeNoAction(reasoning: string, input?: SuggestActionInput): SuggestedAction {
  // Create fallback explainability for NO_ACTION
  const missingInfo: string[] = [];
  if (input?.progressData?.missingFields) {
    missingInfo.push(...input.progressData.missingFields.slice(0, 6));
  }
  if (input?.intent === "UNKNOWN") {
    missingInfo.push("Clear intent");
  }

  const explainability = createRulesExplainability({
    riskLevel: "LOW",
    rationale: [reasoning],
    usedFacts: [],
    uncertainty: null,
    missingInfo,
    alternatives: [],
  });

  return {
    actionType: "NO_ACTION",
    reasoning,
    riskLevel: "LOW",
    explainability,
  };
}

function isSuggestedAction(value: unknown): value is SuggestedAction {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;

  const actionType = v.actionType;
  const riskLevel = v.riskLevel;
  const reasoning = v.reasoning;
  const suggestedMessage = v.suggestedMessage;

  const actionOk =
    actionType === "SEND_MESSAGE" ||
    actionType === "REQUEST_INFO" ||
    actionType === "ESCALATE" ||
    actionType === "NO_ACTION";
  const riskOk = riskLevel === "LOW" || riskLevel === "MEDIUM" || riskLevel === "HIGH";
  const reasoningOk = typeof reasoning === "string" && reasoning.trim().length > 0;
  const suggestedOk =
    suggestedMessage === undefined ||
    suggestedMessage === null ||
    (typeof suggestedMessage === "string" && suggestedMessage.trim().length > 0);

  return actionOk && riskOk && reasoningOk && suggestedOk;
}

/**
 * Robust JSON parser for AI responses
 * Handles code fences, extra text, and malformed JSON with multiple fallback strategies
 */
function parseAIResponse(
  content: string,
  intent: InboundIntent
): {
  parsed: SuggestedAction | null;
  parseFailed: boolean;
  extractionMethod: "direct" | "codefence" | "extracted" | "cleanup" | "regex";
  rawContent: string;
} {
  const rawContent = content;
  const contentLength = content.length;
  let hasCodeFence = false;
  let cleanedContent = content.trim();

  // Step 1: Detect and remove code fences
  // Match ```json ... ``` or ``` ... ```
  const codeFencePattern = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;
  const codeFenceMatch = cleanedContent.match(codeFencePattern);
  if (codeFenceMatch) {
    hasCodeFence = true;
    cleanedContent = codeFenceMatch[1].trim();
    log.debug({ intent, contentLength, hasCodeFence: true }, "Detected code fence, extracted content");
  }

  // Step 2: Try direct JSON parse
  let parsed: unknown = null;
  let extractionMethod: "direct" | "codefence" | "extracted" | "cleanup" | "regex" = hasCodeFence ? "codefence" : "direct";
  
  try {
    parsed = JSON.parse(cleanedContent);
    if (isSuggestedAction(parsed)) {
      log.info(
        {
          intent,
          contentLength,
          hasCodeFence,
          extractionMethod,
          actionType: parsed.actionType,
          hasSuggestedMessage: Boolean(parsed.suggestedMessage),
        },
        "AI response parsed successfully"
      );
      return {
        parsed: parsed as SuggestedAction,
        parseFailed: false,
        extractionMethod,
        rawContent,
      };
    }
  } catch (error) {
    // Direct parse failed, continue to extraction strategies
  }

  // Step 3: Extract first JSON object using regex
  const jsonObjectPattern = /\{[\s\S]*\}/;
  const jsonMatch = cleanedContent.match(jsonObjectPattern);
  if (jsonMatch) {
    extractionMethod = "extracted";
    try {
      parsed = JSON.parse(jsonMatch[0]);
      if (isSuggestedAction(parsed)) {
        log.info(
          {
            intent,
            contentLength,
            hasCodeFence,
            extractionMethod,
            actionType: parsed.actionType,
            hasSuggestedMessage: Boolean(parsed.suggestedMessage),
          },
          "AI response parsed after JSON extraction"
        );
        return {
          parsed: parsed as SuggestedAction,
          parseFailed: false,
          extractionMethod,
          rawContent,
        };
      }
    } catch (error) {
      // Extraction parse failed, continue to cleanup
    }
  }

  // Step 4: Cleanup - remove leading/trailing non-JSON text
  // Find the first { and last } and extract everything between
  const firstBrace = cleanedContent.indexOf("{");
  const lastBrace = cleanedContent.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    extractionMethod = "cleanup";
    const jsonSubstring = cleanedContent.substring(firstBrace, lastBrace + 1);
    try {
      parsed = JSON.parse(jsonSubstring);
      if (isSuggestedAction(parsed)) {
        log.info(
          {
            intent,
            contentLength,
            hasCodeFence,
            extractionMethod,
            actionType: parsed.actionType,
            hasSuggestedMessage: Boolean(parsed.suggestedMessage),
          },
          "AI response parsed after cleanup"
        );
        return {
          parsed: parsed as SuggestedAction,
          parseFailed: false,
          extractionMethod,
          rawContent,
        };
      }
    } catch (error) {
      // Cleanup parse failed, continue to regex fallback
    }
  }

  // Step 5: Regex fallback - extract key fields even if JSON is malformed
  extractionMethod = "regex";
  const messageMatch = content.match(/"suggestedMessage"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const actionMatch = content.match(/"actionType"\s*:\s*"([^"]+)"/);
  const reasoningMatch = content.match(/"reasoning"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const riskMatch = content.match(/"riskLevel"\s*:\s*"([^"]+)"/);

  if (messageMatch && actionMatch) {
    const extractedMessage = messageMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n");
    const extractedActionType = actionMatch[1];
    const extractedReasoning = reasoningMatch?.[1]?.replace(/\\"/g, '"').replace(/\\n/g, "\n") || "Message extracted from malformed JSON";
    const extractedRisk = riskMatch?.[1] || "LOW";

    // Validate actionType and riskLevel
    const validActionTypes = ["SEND_MESSAGE", "REQUEST_INFO", "ESCALATE", "NO_ACTION"];
    const validRiskLevels = ["LOW", "MEDIUM", "HIGH"];
    
    if (validActionTypes.includes(extractedActionType) && validRiskLevels.includes(extractedRisk)) {
      const regexParsed: SuggestedAction = {
        actionType: extractedActionType as SuggestedAction["actionType"],
        suggestedMessage: extractedMessage,
        reasoning: extractedReasoning,
        riskLevel: extractedRisk as SuggestedAction["riskLevel"],
      };

      log.info(
        {
          intent,
          contentLength,
          hasCodeFence,
          extractionMethod,
          actionType: regexParsed.actionType,
          hasSuggestedMessage: Boolean(regexParsed.suggestedMessage),
        },
        "AI response parsed using regex fallback"
      );

      return {
        parsed: regexParsed,
        parseFailed: false,
        extractionMethod,
        rawContent,
      };
    }
  }

  // All parsing strategies failed
  log.warn(
    {
      intent,
      contentLength,
      hasCodeFence,
      extractionMethod,
      contentPreview: content.slice(0, 300),
    },
    "AI response parsing failed - all strategies exhausted"
  );

  return {
    parsed: null,
    parseFailed: true,
    extractionMethod,
    rawContent,
  };
}

/**
 * Suggest a structured recruiter action using AI (fallback-only).
 *
 * IMPORTANT:
 * - This function MUST NOT send messages.
 * - This function MUST NOT mutate the database.
 * - It only returns a JSON object describing a proposed action.
 */
export async function suggestActionWithAI(
  input: SuggestActionInput
): Promise<SuggestedAction> {
  const intent = input.intent;
  const messageText = (input.messageText ?? "").trim();
  const contactName = input.contactName?.trim() || undefined;

  // Rule: If intent is UNKNOWN and there's no conversation history, don't attempt AI actions.
  // But if conversation history exists, allow AI to run (for natural mid-conversation replies like "Any", "Yes", etc.)
  if (intent === "UNKNOWN") {
    const hasHistory = input.conversationHistory && input.conversationHistory.length > 0;
    if (!hasHistory) {
      return safeNoAction("Intent is UNKNOWN and no conversation history; no automated action suggested.", input);
    }
    // If history exists, continue with AI suggestion (allows handling of clarification messages)
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return safeNoAction("OPENAI_API_KEY is not configured; AI suggestion disabled.", input);
  }

  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof (timeout as any).unref === "function") (timeout as any).unref();

  const startedAt = Date.now();

  try {
    log.info(
      { intent, messageLen: messageText.length, hasContactName: Boolean(contactName) },
      "Calling AI action suggester"
    );

    // Build memory pack context
    const memoryContext = input.memoryPack
      ? [
          "CANDIDATE MEMORY (what you know about this person):",
          input.memoryPack.summary ? `Summary: ${input.memoryPack.summary}` : "",
          input.memoryPack.facts
            ? [
                input.memoryPack.facts.trade ? `Trade: ${input.memoryPack.facts.trade}` : "",
                input.memoryPack.facts.location ? `Location: ${input.memoryPack.facts.location}` : "",
                input.memoryPack.facts.availability ? `Availability: ${input.memoryPack.facts.availability}` : "",
                input.memoryPack.facts.salary
                  ? `Salary: ${input.memoryPack.facts.salary.min || ""}-${input.memoryPack.facts.salary.max || ""} ${input.memoryPack.facts.salary.currency || ""}`
                  : "",
                input.memoryPack.facts.skills && input.memoryPack.facts.skills.length > 0
                  ? `Skills: ${input.memoryPack.facts.skills.join(", ")}`
                  : "",
                input.memoryPack.facts.tickets && input.memoryPack.facts.tickets.length > 0
                  ? `Tickets/Certifications: ${input.memoryPack.facts.tickets.join(", ")}`
                  : "",
              ]
                .filter(Boolean)
                .join("\n")
            : "",
          input.memoryPack.openQuestions && input.memoryPack.openQuestions.length > 0
            ? `Open questions to explore: ${input.memoryPack.openQuestions.join(", ")}`
            : "",
          input.memoryPack.goal ? `Goal: ${input.memoryPack.goal}` : "",
          input.memoryPack.lastJobDiscussed
            ? `Last job discussed: ${input.memoryPack.lastJobDiscussed.title || ""} in ${input.memoryPack.lastJobDiscussed.location || ""}`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";

    const progressContext = input.progressStage
      ? [
          "PROGRESS CONTEXT:",
          `Current stage: ${input.progressStage}`,
          input.progressData?.nextAction ? `Next action needed: ${input.progressData.nextAction}` : "",
          input.progressData?.missingFields && input.progressData.missingFields.length > 0
            ? `Missing info: ${input.progressData.missingFields.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";

    // Hard guard: Check if we already asked for CSCS photo
    const cscsPhotoRequested =
      input.memoryPack?.openQuestions?.some((q) =>
        q.toLowerCase().includes("cscs") && q.toLowerCase().includes("photo")
      ) ||
      input.memoryPack?.openQuestions?.some((q) =>
        q.toLowerCase().includes("cscs") && (q.toLowerCase().includes("card") || q.toLowerCase().includes("picture"))
      ) ||
      input.memoryPack?.structuredOpenQuestions?.some((q) => q.key === "CSCS_PHOTO" && q.status === "OPEN");

    // Select questions to ask based on open questions and cooldowns
    const openQuestions = input.memoryPack?.structuredOpenQuestions || [];
    const requiredKeys = getRequiredQuestionsFromProgress(
      (input.progressStage || "NEW") as ContactProgressStage,
      input.progressData || null,
      null, // candidateSnapshot - can be enhanced later
      {} // jobContext - can be enhanced later
    );
    const questionsToAsk = selectQuestionsToAsk(openQuestions, requiredKeys, input.playbook, new Date());
    const neutralCooldownMessage = buildNeutralCooldownMessage(openQuestions, requiredKeys, input.playbook);

    const systemPrompt = [
      "Return a single JSON object ONLY (no markdown, no extra text).",
      "",
      "ROLE: You are a senior UK recruitment consultant having a WhatsApp chat with a candidate. You're experienced, personable, and know the market inside out—especially construction, but you handle all sectors naturally.",
      "",
      ...(memoryContext ? [memoryContext, ""] : []),
      ...(progressContext ? [progressContext, ""] : []),
      ...(cscsPhotoRequested
        ? [
            "CRITICAL GUARD: We have already asked this candidate for a CSCS card photo. DO NOT ask again unless there's a followUpAt plan or operator task. Reference the previous request if needed, but do not repeat it.",
            "",
          ]
        : []),
      "CONVERSATION STYLE:",
      "- Chat like you're texting a mate, but keep it professional",
      "- Acknowledge what they just said before moving on",
      "- Use natural UK English—'cheers', 'ta', 'mate' when appropriate, but don't overdo it",
      "- Keep replies to 1-2 WhatsApp-style sentences—short, punchy, conversational",
      "- Never sound like a bot or use corporate speak",
      "- Avoid phrases like 'we'll get back to you', 'thank you for your interest', 'we'll review'",
      "- Prefer short affirmations ('Nice', 'Got it', 'Sounds good', 'Brilliant') before progressing",
      "- Use memory pack context to reference what you know about them (their trade, location, etc.)",
      "- Reference progress stage to understand where they are in the process",
      `- Ask at most ${input.playbook?.maxQuestionsPerMessage ?? 2} questions per message`,
      "- Always move forward: if you have enough info, present jobs or next step",
      "- Never promise 'I will get back to you' without creating a task—either act now or escalate",
      "",
      ...(questionsToAsk.length > 0
        ? [
            `OPEN QUESTIONS TO ASK (prioritize these in your reply):`,
            ...questionsToAsk.map((q) => `- ${q.promptText}`),
            "",
          ]
        : []),
      ...(neutralCooldownMessage
        ? [
            `COOLDOWN GUARD: All required questions are in cooldown. Use this neutral message instead of asking again: "${neutralCooldownMessage}"`,
            "",
          ]
        : []),
      ...(input.playbook ? [buildPlaybookPolicyBlock(input.playbook), ""] : []),
      "CONVERSATION HEURISTICS:",
      "",
      "Acknowledgment-first pattern:",
      "- ALWAYS acknowledge what the candidate just said before asking a new question",
      "- Use short affirmations: 'Nice', 'Got it', 'Sounds good', 'Brilliant', 'Perfect', 'Cheers'",
      "- This shows you're listening and keeps the conversation flowing naturally",
      "- Example: 'I'm a bricklayer' → 'Nice 👍 How many years you been doing that?'",
      "- Example: 'I'm free next week' → 'Got it. What area you based in?'",
      "- Never jump straight to a question without acknowledging their message first",
      "",
      "Responding to different message types:",
      "- GREETINGS (hi, hello, hey, morning): Match their energy, be friendly, maybe ask what they're after",
      "  Example: 'Hi' → 'Hey 👋 What can I help you with today?'",
      "- QUESTIONS (what's the rate, where's the job, when can I start): Answer briefly, then ask a clarifying follow-up",
      "  Example: 'What's the rate?' → 'Depends on the role really. What trade you looking at?'",
      "- STATEMENTS (I'm a bricklayer, I'm free next week, I need work): Acknowledge with affirmation, show interest, ask one natural follow-up",
      "  Example: 'I'm a bricklayer' → 'Brilliant, always need good brickies. How many years you been doing it?'",
      "",
      "Answer-then-ask pattern:",
      "- When they ask something, give a brief helpful answer first, then pivot to a related question",
      "- Don't just answer and stop—use their question as a springboard",
      "- Example: 'Where's the job?' → 'Got sites in Manchester and Liverpool. What area you based in?'",
      "",
      "Inferring from hints:",
      "- Read between the lines—if they say 'I've been doing this 10 years', they've told you experience",
      "- If they mention 'Manchester site', they've given you location",
      "- If they say 'I finish my current job Friday', that's availability",
      "- Don't ask for info they've already implied—acknowledge it instead",
      "- Example: If they said 'I'm in Liverpool' earlier, don't ask 'Where are you based?'—say 'You mentioned Liverpool, yeah?'",
      "",
      "Avoiding repetition:",
      "- ALWAYS check conversation history before asking anything",
      "- Never repeat information the candidate has already provided",
      "- If they already said their trade, don't ask 'What trade are you?'",
      "- If they mentioned location, don't ask 'Where are you based?'",
      "- If they gave experience level, don't ask 'How many years experience?'",
      "- Instead, reference what they said: 'You said you're a carpenter, right? How long you been doing that?'",
      "- Only ask for info that's genuinely missing from the conversation",
      "",
      "STRICT RULE: NO RE-ASKING ON SAME DIMENSION:",
      "- Once the candidate has clearly answered a question and you have acknowledged it, DO NOT ask a follow-up on the same dimension again",
      "- Treat acknowledged answers as complete unless the candidate re-opens the topic themselves",
      "- Avoid rephrasing the same question in different ways (e.g. 'brands' → 'companies' → 'shops' → 'employers')",
      "- Progress forward, not sideways—move to the NEXT missing info dimension after acknowledging an answer",
      "- Example: If you asked 'What trade?' and they said 'Bricklayer' and you acknowledged it, DO NOT later ask 'What type of construction work?' or 'What's your role?'—that's the same dimension",
      "- Example: If you asked 'Where are you based?' and they said 'Manchester' and you acknowledged it, DO NOT later ask 'What area?' or 'Which city?'—that's the same dimension",
      "- If all basic info is collected (trade, experience, location, availability), prepare to summarize or escalate, not continue probing",
      "- Internal guidance: After acknowledging an answer, immediately move to the NEXT missing info dimension",
      "- Internal guidance: If you've collected all basic info, don't keep asking questions—either summarize what you have or escalate appropriately",
      "",
      "Opportunistic follow-ups:",
      "- Ask follow-up questions when they naturally flow from what the candidate just said",
      "- Don't ask mechanically or like you're ticking boxes",
      "- Wait for natural openings—if they mention trade, ask about experience; if they mention availability, ask about location",
      "- If the conversation is flowing well, you don't need to ask a question every time—sometimes a simple acknowledgment is enough",
      "- Example: If they say 'I'm available Monday', you might just say 'Nice, I'll check what's coming up' without immediately asking another question",
      "",
      "HOW TO COLLECT INFORMATION:",
      "- Don't interrogate like a checklist—let the conversation flow",
      "- Pick up on what they mention naturally (trade, location, availability, etc.)",
      "- If they mention something useful, acknowledge it and maybe ask one related follow-up",
      "- Only ask for missing info when it feels natural to the conversation",
      "- Useful things to know: trade/role, experience level, location, availability, pay expectations",
      "- But don't force it—better to have a good chat than extract every detail immediately",
      "",
      "INFORMATION EXTRACTION PERSISTENCE:",
      "- CRITICAL: Do NOT pause or hand off while basic candidate information is still missing",
      "- Basic info to collect: role/trade, experience level, location, availability",
      "- If any of these are missing, continue asking follow-up questions—don't pause",
      "- Ambiguity alone is NOT a reason to pause—refine with a follow-up question instead",
      "- Vague answers (e.g. 'Any', 'Either', 'Doesn't matter') should trigger a clarifying question, not a pause",
      "- Example: If they say 'Any' when asked about location, ask 'Manchester or Liverpool area?'",
      "- Example: If they say 'Either' when asked about job type, ask 'So construction work, yeah? What trade?'",
      "- Pausing should feel like a LAST RESORT, not a default response",
      "- Only pause when you genuinely cannot proceed without human input (e.g. specific salary numbers, job offers)",
      "- Keep the conversation moving forward—extract info progressively over multiple messages",
      "",
      "FOLLOW-UP QUESTIONS:",
      "- Ask follow-ups only when they make sense in context",
      "- If they say 'I'm a bricklayer', you might ask 'How long you been doing that?' or 'What area you based in?'",
      "- If they ask about rates, acknowledge it but don't give numbers—ask what trade/experience first",
      "- Reference earlier messages when relevant ('You mentioned you're in Manchester...')",
      "",
      "WHAT TO AVOID:",
      "- Don't close conversations prematurely",
      "- Don't ask multiple questions at once",
      "- Don't use formal templates or scripts",
      "- Don't ignore what they just said",
      "- Don't make it feel like an interview",
      "- Don't pause just because an answer is vague—ask a clarifying question instead",
      "- Don't hand off to approval when you can still extract basic info with follow-ups",
      "- Don't treat ambiguity as a blocker—treat it as an opportunity to refine",
      "",
      "EXAMPLES OF GOOD RESPONSES:",
      "Candidate: 'I'm looking for work'",
      "You: 'Nice one 👍 What sort of work you after? Construction, warehouse, or something else?'",
      "",
      "Candidate: 'I'm a bricklayer'",
      "You: 'Brilliant, always need good brickies. How many years experience you got?'",
      "",
      "Candidate: 'What's the rate?'",
      "You: 'Rates depend on the site and setup—let me check what fits your experience and I'll come back to you.'",
      "",
      "Candidate: 'I'm free next week'",
      "You: 'Perfect timing. What area you based in? We've got sites across the North West.'",
      "",
      "Candidate: 'I've got 10 years experience'",
      "You: 'Sounds good 👍 What trade you in?'",
      "",
      "Candidate: 'I'm in Manchester'",
      "You: 'Got it. What sort of work you looking for?'",
      "",
      "Candidate: 'Any' (when asked about location)",
      "You: 'Nice. Manchester or Liverpool area? We've got sites in both.'",
      "",
      "Candidate: 'Either' (when asked about job type)",
      "You: 'Got it. So construction work, yeah? What trade you in?'",
      "",
      "Candidate: 'Doesn't matter' (when asked about availability)",
      "You: 'Sound. So you're flexible? What area you based in?'",
      "",
      "HANDLING ESCALATION MOMENTS:",
      "When candidates ask about rates, offers, interviews, or other sensitive topics:",
      "- Always acknowledge their question first—don't ignore it or deflect awkwardly",
      "- Explain briefly that details depend on specific checks (site, role, experience, etc.)",
      "- Signal you're actively checking: 'let me check', 'just confirming', 'I'll verify'",
      "- Sound intentional and helpful, not blocked or evasive",
      "- Make it feel like a natural pause in the conversation, not a dead end",
      "",
      "Examples of good escalation handling:",
      "Candidate: 'What's the rate?'",
      "You: 'Rates depend on the site and setup—let me check what fits your experience and I'll come back to you.'",
      "",
      "Candidate: 'When can I start?'",
      "You: 'I'll just confirm the start dates with the recruiter and come back to you. What's your availability looking like?'",
      "",
      "Candidate: 'Is there an interview?'",
      "You: 'Let me check the process for this role and I'll update you. What's your availability for next week?'",
      "",
      "ESCALATION RULES:",
      "Only escalate to approval if:",
      "- Sending a job offer",
      "- Sharing specific salary/rate numbers",
      "- Booking interviews or start dates",
      "- Making commitments on behalf of the recruiter",
      "",
      "OUTPUT FORMAT:",
      "- Return a single JSON object ONLY (no markdown, no extra text)",
      "- Keep suggestedMessage to 1-2 sentences",
      "- Allowed actionType: SEND_MESSAGE | REQUEST_INFO | ESCALATE | NO_ACTION",
      "- Allowed riskLevel: LOW | MEDIUM | HIGH",
      "",
      "EXPLAINABILITY (required):",
      "- Include an 'explainability' object explaining your decision",
      "- rationale: Array of up to 4 short bullet points explaining why this action was suggested",
      "  * Keep each bullet to one sentence, user-safe, no chain of thought",
      "  * Example: ['Candidate is looking for work', 'Trade is known', 'Location confirmed']",
      "  * If playbook checks were applied (location, availability, tickets), mention them in rationale",
      "- usedFacts: Array of up to 8 concrete facts you used",
      "  * Format: 'Key: Value' (e.g., 'Trade: Electrician', 'Location: Manchester', 'Availability: tomorrow')",
      "  * Only include facts that were actually used in the decision",
      "  * If playbook checks were applied, include them as 'Playbook checks: location, availability'",
      "- uncertainty: Optional one sentence (max 140 chars) about what you're uncertain about, or null",
      "  * Example: 'Candidate intent is unclear' or null",
      "- missingInfo: Array of up to 6 items describing what information would improve the suggestion",
      "  * NOT questions to ask directly, but information gaps (e.g., 'CSCS card status', 'Salary expectations')",
      "- alternatives: Array of up to 2 alternative actions you considered",
      "  * Each must have 'action' (string) and 'reason' (string)",
      "  * Operator-meaningful options like: { action: 'Request CSCS photo', reason: 'docs missing' }",
      "  * Or: { action: 'Escalate to operator', reason: 'uncertain intent' }",
      "- confidence: Optional number 0-1 indicating confidence level",
      "- generatedBy: Always 'AI'",
      "- generatedAt: ISO timestamp (current time)",
      "- Do NOT include chain of thought, internal reasoning, or raw prompts",
      "- Keep all text short, safe, and user-friendly",
      "",
      "REQUIRED JSON STRUCTURE:",
      '{',
      '  "actionType": "SEND_MESSAGE" | "REQUEST_INFO" | "ESCALATE" | "NO_ACTION",',
      '  "suggestedMessage": "..." (required if actionType is SEND_MESSAGE),',
      '  "reasoning": "Short explanation of the action",',
      '  "riskLevel": "LOW" | "MEDIUM" | "HIGH",',
      '  "explainability": {',
      '    "riskLevel": "LOW" | "MEDIUM" | "HIGH",',
      '    "rationale": ["bullet 1", "bullet 2", ...],',
      '    "usedFacts": ["Trade: Electrician", "Location: Manchester", ...],',
      '    "uncertainty": "..." | null,',
      '    "missingInfo": ["info 1", "info 2", ...],',
      '    "alternatives": [{ "action": "...", "reason": "..." }],',
      '    "confidence": 0.85 (optional),',
      '    "generatedBy": "AI",',
      '    "generatedAt": "2024-01-01T12:00:00.000Z"',
      '  }',
      '}',
    ].join("\n");

    // Limit to last 10 messages only
    const recentHistory = input.conversationHistory
      ? input.conversationHistory.slice(-10)
      : [];
    
    const conversationContext = recentHistory.length > 0
      ? "\n\nRecent conversation (last 10 messages):\n" + recentHistory
          .map((msg, idx) => {
            const role = msg.direction === "INBOUND" ? "Candidate" : "Recruiter";
            return `${idx + 1}. ${role}: ${msg.text}`;
          })
          .join("\n")
      : "";

    const userPrompt = [
      `intent: ${intent}`,
      contactName ? `contactName: ${contactName}` : "contactName: (unknown)",
      `messageText: ${messageText}${conversationContext}`,
    ].join("\n");

    const systemPromptText = Array.isArray(systemPrompt) ? systemPrompt.join("\n") : systemPrompt;
    const userPromptText = Array.isArray(userPrompt) ? userPrompt.join("\n") : userPrompt;
    const totalPromptSize = systemPromptText.length + userPromptText.length;

    // Log prompt size for monitoring
    log.info(
      {
        intent,
        systemPromptSize: systemPromptText.length,
        userPromptSize: userPromptText.length,
        totalPromptSize,
        hasMemoryPack: Boolean(input.memoryPack),
        hasProgressData: Boolean(input.progressStage),
        messageCount: recentHistory.length,
      },
      "AI action suggester prompt prepared"
    );

    const body = {
      model: MODEL,
      temperature: 0.25,
      max_tokens: 200,
      messages: [
        { role: "system", content: systemPromptText },
        { role: "user", content: userPromptText },
      ],
      // If supported by the model, this nudges strict JSON output.
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

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      log.warn(
        {
          status: res.status,
          statusText: res.statusText,
          durationMs: Date.now() - startedAt,
          intent,
          messageLen: messageText.length,
          errorBody: errText.slice(0, 500),
        },
        "OpenAI action suggestion failed; returning NO_ACTION"
      );
      return safeNoAction("AI request failed; no action suggested.", input);
    }

    const json = (await res.json()) as OpenAIChatCompletionsResponse;
    const content = (json.choices?.[0]?.message?.content ?? "").trim();

    // Use robust JSON parser with multiple fallback strategies
    const parseResult = parseAIResponse(content, intent);

    // If parsing failed completely, return NO_ACTION with parse failure flag
    if (parseResult.parseFailed || !parseResult.parsed) {
      log.warn(
        {
          intent,
          durationMs: Date.now() - startedAt,
          contentLength: content.length,
          extractionMethod: parseResult.extractionMethod,
          contentPreview: content.slice(0, 300),
        },
        "AI returned non-JSON or invalid structure; returning NO_ACTION with parse failure flag"
      );
      // Return a special NO_ACTION that indicates parse failure
      const failedAction = safeNoAction("AI returned invalid output; parsing failed.", input);
      // Add a flag to indicate this is a parse failure (we'll check reasoning string in inboundWorker)
      return {
        ...failedAction,
        reasoning: `PARSE_FAILED: ${failedAction.reasoning}`,
      };
    }

    const parsed = parseResult.parsed;

    // Extract and validate explainability with strict Zod validation
    let explainability: Explainability | undefined = undefined;
    if (parsed.explainability) {
      try {
        // Strict validation with Zod schema
        const validationResult = ExplainabilitySchema.safeParse(parsed.explainability);
        if (validationResult.success) {
          explainability = validationResult.data as Explainability;
          log.debug({ intent }, "Explainability validated successfully with Zod");
        } else {
          log.warn(
            { intent, errors: validationResult.error.errors, rawExplainability: parsed.explainability },
            "Explainability failed Zod validation; will use fallback"
          );
        }
      } catch (error) {
        log.warn(
          { intent, error, rawExplainability: parsed.explainability },
          "Failed to parse explainability from AI response; will use fallback"
        );
      }
    }

    // If explainability is missing or invalid, create a fallback
    if (!explainability) {
      const usedFacts: string[] = [];
      if (input.memoryPack?.facts?.trade) {
        usedFacts.push(`Trade: ${input.memoryPack.facts.trade}`);
      }
      if (input.memoryPack?.facts?.location) {
        usedFacts.push(`Location: ${input.memoryPack.facts.location}`);
      }
      if (input.memoryPack?.facts?.availability) {
        usedFacts.push(`Availability: ${input.memoryPack.facts.availability}`);
      }

      const missingInfo: string[] = [];
      if (input.progressData?.missingFields) {
        missingInfo.push(...input.progressData.missingFields.slice(0, 6));
      }
      if (intent === "UNKNOWN") {
        missingInfo.push("Clear intent");
      }

      explainability = createRulesExplainability({
        riskLevel: parsed.riskLevel,
        rationale: ["AI suggestion generated but explanation unavailable"],
        usedFacts,
        uncertainty: "Some details are missing",
        missingInfo,
        alternatives: [],
      });
    }

    const action: SuggestedAction = {
      actionType: parsed.actionType,
      riskLevel: parsed.riskLevel,
      reasoning: parsed.reasoning.trim(),
      explainability,
      ...(parsed.suggestedMessage
        ? { suggestedMessage: String(parsed.suggestedMessage).trim() }
        : {}),
    };

    // Log successful completion with prompt size and model response
    log.info(
      {
        intent,
        actionType: action.actionType,
        riskLevel: action.riskLevel,
        hasSuggestedMessage: Boolean(action.suggestedMessage),
        durationMs: Date.now() - startedAt,
        totalPromptSize,
        systemPromptSize: systemPromptText.length,
        userPromptSize: userPromptText.length,
        hasMemoryPack: Boolean(input.memoryPack),
        hasProgressData: Boolean(input.progressStage),
      },
      "AI action suggestion completed"
    );

    return action;
  } catch (error) {
    log.warn(
      { err: error, durationMs: Date.now() - startedAt, intent, messageLen: messageText.length },
      "AI action suggestion errored; returning NO_ACTION"
    );
    return safeNoAction("AI error/timeout; no action suggested.", input);
  } finally {
    clearTimeout(timeout);
  }
}


