/**
 * Outreach Message Generator
 * Generates personalized outreach messages for candidates
 */

import pino from "pino";
import type { AgencyPlaybook } from "../shared/playbook.ts";
import { buildPlaybookPolicyBlock } from "./playbook/playbookPromptBuilder.ts";

const log = pino({ name: "outreachGenerator" });

const MODEL = "gpt-4o-mini";
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 10_000;

export type CandidateOutreachPreview = {
  candidateId: string;
  phone: string;
  suggestedMessage: string;
};

type CandidateInfo = {
  candidateId: string;
  phone: string;
  name: string | null;
  desiredRole: string | null;
  skills: string[];
  yearsExperience: number | null;
  location: string | null;
};

type OpenAIChatCompletionsResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

/**
 * Generate personalized outreach message for a candidate
 */
export async function generateOutreachMessage(
  candidate: CandidateInfo,
  jobDescription: string,
  playbook?: AgencyPlaybook
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log.warn("OPENAI_API_KEY not set; using default message");
    return `Hi${candidate.name ? ` ${candidate.name}` : ""}, I have an opportunity that might interest you. ${jobDescription.substring(0, 100)}... Would you like to learn more?`;
  }

  log.info(
    {
      candidateId: candidate.candidateId,
      phone: candidate.phone,
    },
    "Generating outreach message with OpenAI"
  );

  const systemPrompt = [
    "You are a professional recruiter writing a personalized WhatsApp message to a candidate.",
    "Keep the message:",
    "- Short and friendly (under 200 characters)",
    "- Professional but conversational",
    "- Include a clear call to action",
    "- Reference their profile if relevant (skills, experience, location)",
    "",
    ...(playbook ? [buildPlaybookPolicyBlock(playbook), ""] : []),
    "Return ONLY the message text (no quotes, no markdown, no extra formatting).",
  ].join("\n");

  const candidateInfo = [
    candidate.name ? `Name: ${candidate.name}` : null,
    candidate.desiredRole ? `Desired Role: ${candidate.desiredRole}` : null,
    candidate.skills.length > 0 ? `Skills: ${candidate.skills.join(", ")}` : null,
    candidate.yearsExperience ? `Experience: ${candidate.yearsExperience} years` : null,
    candidate.location ? `Location: ${candidate.location}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const userPrompt = `Generate a personalized outreach message for this candidate:\n\n${candidateInfo}\n\nJob Description:\n${jobDescription}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const body = {
      model: MODEL,
      temperature: 0.7,
      max_tokens: 200,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
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

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      log.warn(
        {
          status: res.status,
          statusText: res.statusText,
          error: errText,
          candidateId: candidate.candidateId,
        },
        "OpenAI outreach generation failed"
      );
      // Fallback message
      return `Hi${candidate.name ? ` ${candidate.name}` : ""}, I have an opportunity that might interest you. ${jobDescription.substring(0, 100)}... Would you like to learn more?`;
    }

    const data = (await res.json()) as OpenAIChatCompletionsResponse;
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      log.warn({ candidateId: candidate.candidateId }, "OpenAI returned empty content for outreach");
      return `Hi${candidate.name ? ` ${candidate.name}` : ""}, I have an opportunity that might interest you. ${jobDescription.substring(0, 100)}... Would you like to learn more?`;
    }

    // Clean up the message (remove quotes, markdown, etc.)
    const message = content.trim().replace(/^["']|["']$/g, "").replace(/^```[\w]*\n?|\n?```$/g, "").trim();

    log.info(
      {
        candidateId: candidate.candidateId,
        messageLength: message.length,
      },
      "Outreach message generated"
    );

    return message;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      log.warn({ candidateId: candidate.candidateId }, "Outreach generation timed out");
    } else {
      log.error({ candidateId: candidate.candidateId, error }, "Outreach generation error");
    }

    // Fallback message
    return `Hi${candidate.name ? ` ${candidate.name}` : ""}, I have an opportunity that might interest you. ${jobDescription.substring(0, 100)}... Would you like to learn more?`;
  }
}

