import pino from "pino";
import type { InboundIntent } from "../domain/intent.ts";

const log = pino({ name: "aiIntentClassifier" });

const MODEL = "gpt-4o-mini";
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 8_000;

const ALLOWED_INTENTS = [
  "LOOKING_FOR_WORK",
  "AVAILABILITY_UPDATE",
  "JOB_QUERY",
  "FOLLOW_UP",
  "UNKNOWN",
] as const satisfies ReadonlyArray<InboundIntent>;

function isInboundIntent(value: string): value is InboundIntent {
  return (ALLOWED_INTENTS as readonly string[]).includes(value);
}

type OpenAIChatCompletionsResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

/**
 * AI-based intent classifier (fallback-only).
 *
 * Calls OpenAI Chat Completions API and returns ONLY a valid `InboundIntent`.
 * If the output is invalid or any error occurs, returns `UNKNOWN`.
 */
export async function classifyIntentWithAI(
  text: string
): Promise<InboundIntent> {
  const input = text.trim();
  if (!input) return "UNKNOWN";

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log.warn({ messageLen: input.length }, "OPENAI_API_KEY is missing; returning UNKNOWN");
    return "UNKNOWN";
  }

  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  // Don’t keep the process alive just for the timeout timer.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof (timeout as any).unref === "function") (timeout as any).unref();

  const startedAt = Date.now();

  try {
    const systemPrompt = [
      "You classify inbound recruitment messages into ONE intent.",
      "Return ONLY one of these exact values (no punctuation, no extra text):",
      "LOOKING_FOR_WORK, AVAILABILITY_UPDATE, JOB_QUERY, FOLLOW_UP, UNKNOWN.",
      "",
      "Intents:",
      "- LOOKING_FOR_WORK: wants work/opportunities. Example: 'any work?', 'looking for work'.",
      "- AVAILABILITY_UPDATE: availability/scheduling. Example: 'free tomorrow', 'can work next week'.",
      "- JOB_QUERY: asks job details (rate/pay/location/site). Example: 'what is the rate?', 'where is the job?'.",
      "- FOLLOW_UP: asks for updates. Example: 'any update?', 'checking in'.",
      "- UNKNOWN: none of the above. Example: 'hello'.",
    ].join("\n");

    const body = {
      model: MODEL,
      temperature: 0,
      max_tokens: 8,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input },
      ],
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
      log.error(
        {
          status: res.status,
          statusText: res.statusText,
          durationMs: Date.now() - startedAt,
          messageLen: input.length,
          errorBody: errText.slice(0, 500),
        },
        "OpenAI chat completion request failed"
      );
      return "UNKNOWN";
    }

    const json = (await res.json()) as OpenAIChatCompletionsResponse;
    const raw = (json.choices?.[0]?.message?.content ?? "").trim();

    if (!isInboundIntent(raw)) {
      log.warn(
        { raw, durationMs: Date.now() - startedAt, messageLen: input.length },
        "OpenAI returned invalid intent; returning UNKNOWN"
      );
      return "UNKNOWN";
    }

    log.debug(
      { intent: raw, durationMs: Date.now() - startedAt, messageLen: input.length },
      "AI intent classified"
    );

    return raw;
  } catch (error) {
    log.error(
      { err: error, durationMs: Date.now() - startedAt, messageLen: input.length },
      "AI intent classification failed"
    );
    return "UNKNOWN";
  } finally {
    clearTimeout(timeout);
  }
}


