/**
 * Auto verification service for CSCS cards using OpenAI Vision
 */

import pino from "pino";
import type { CscsVerificationPayload } from "../../shared/types/cscs.ts";

const log = pino({ name: "cscsAutoVerifier" });

const MODEL = "gpt-4o"; // Use vision-capable model
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds for vision

type OpenAIVisionResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

type ExtractedCscsData = {
  holderName?: string;
  cardType?: string;
  cardNumber?: string;
  expiryDate?: string;
  level?: string;
};

/**
 * Extract CSCS card details from image using OpenAI Vision
 */
export async function extractCscsDetailsFromImage(
  imageUrl: string
): Promise<ExtractedCscsData> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    log.warn("OPENAI_API_KEY not set; cannot extract CSCS details");
    throw new Error("OpenAI API key not configured");
  }

  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

  log.info({ imageUrl }, "Extracting CSCS details from image with OpenAI Vision");

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Extract CSCS card details from this image. Return a JSON object with the following fields:
- holderName: Full name on the card (string or null)
- cardType: Card type/level (e.g., "Green", "Blue", "Gold", "Red", "White") (string or null)
- cardNumber: Card number if visible (string or null)
- expiryDate: Expiry date in YYYY-MM-DD format (string or null)
- level: Additional level information if present (string or null)

If a field is not visible or cannot be determined, return null for that field.
Return ONLY valid JSON, no markdown, no code blocks.`,
              },
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                },
              },
            ],
          },
        ],
        max_tokens: 500,
        temperature: 0.1, // Low temperature for accuracy
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      log.warn(
        { status: response.status, error: errorText },
        "OpenAI Vision API request failed"
      );
      throw new Error(`OpenAI Vision API failed: ${response.status}`);
    }

    const data = (await response.json()) as OpenAIVisionResponse;

    if (!data.choices || data.choices.length === 0) {
      log.warn({ imageUrl }, "OpenAI returned no choices for CSCS extraction");
      throw new Error("OpenAI returned no choices");
    }

    const content = data.choices[0]?.message?.content;
    if (!content) {
      log.warn({ imageUrl }, "OpenAI returned empty content for CSCS extraction");
      throw new Error("OpenAI returned empty content");
    }

    // Parse JSON response (may be wrapped in markdown code blocks)
    let parsed: ExtractedCscsData;
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || content.match(/(\{[\s\S]*\})/);
      const jsonString = jsonMatch ? jsonMatch[1] : content;
      parsed = JSON.parse(jsonString) as ExtractedCscsData;
    } catch (parseError) {
      log.warn(
        { content, imageUrl, error: parseError },
        "Failed to parse OpenAI JSON response for CSCS extraction"
      );
      throw new Error("Failed to parse OpenAI response");
    }

    log.info(
      {
        imageUrl,
        extracted: {
          hasHolderName: !!parsed.holderName,
          hasCardType: !!parsed.cardType,
          hasCardNumber: !!parsed.cardNumber,
          hasExpiryDate: !!parsed.expiryDate,
          hasLevel: !!parsed.level,
        },
      },
      "Successfully extracted CSCS details"
    );

    return parsed;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      log.warn({ imageUrl, timeoutMs }, "OpenAI Vision request timed out");
      throw new Error("Request timed out");
    }
    log.error({ error, imageUrl }, "Failed to extract CSCS details from image");
    throw error;
  }
}

/**
 * Compute verification checks based on extracted data and candidate/job info
 */
export function computeVerificationChecks(
  extracted: ExtractedCscsData,
  candidateName?: string | null,
  jobRequirements?: any
): {
  nameMatchOk: boolean;
  expiryValidOk: boolean;
  requiredLevelOk: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  let nameMatchOk = true;
  let expiryValidOk = true;
  let requiredLevelOk = true;

  // Check name match
  if (extracted.holderName && candidateName) {
    // Normalize names for comparison (case-insensitive, trim whitespace)
    const extractedNormalized = extracted.holderName.toLowerCase().trim();
    const candidateNormalized = candidateName.toLowerCase().trim();
    
    // Simple match: check if candidate name appears in extracted name or vice versa
    // This handles cases like "John Smith" vs "J. Smith" or "Smith, John"
    const extractedWords = extractedNormalized.split(/\s+/);
    const candidateWords = candidateNormalized.split(/\s+/);
    
    // Check if at least one word from candidate name appears in extracted name
    const hasMatch = candidateWords.some(word => 
      word.length > 2 && extractedNormalized.includes(word)
    ) || extractedWords.some(word => 
      word.length > 2 && candidateNormalized.includes(word)
    );

    if (!hasMatch) {
      nameMatchOk = false;
      issues.push(`Name mismatch: Card shows "${extracted.holderName}" but candidate is "${candidateName}"`);
    }
  } else if (extracted.holderName && !candidateName) {
    // Can't verify name match if candidate name is missing
    log.debug("Cannot verify name match: candidate name not available");
  }

  // Check expiry date
  if (extracted.expiryDate) {
    try {
      const expiryDate = new Date(extracted.expiryDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      expiryDate.setHours(0, 0, 0, 0);

      if (expiryDate < today) {
        expiryValidOk = false;
        issues.push(`Card expired: Expiry date ${extracted.expiryDate} is in the past`);
      }
    } catch (error) {
      log.warn({ expiryDate: extracted.expiryDate, error }, "Failed to parse expiry date");
      expiryValidOk = false;
      issues.push(`Invalid expiry date format: ${extracted.expiryDate}`);
    }
  } else {
    // If expiry date is missing, we can't verify it
    log.debug("Cannot verify expiry: expiry date not extracted");
  }

  // Check level requirement (if job has requirements)
  // For now, default to true if no requirements specified
  // In the future, this could check against job.requirementsJson
  if (jobRequirements) {
    // TODO: Implement level requirement checking based on job requirements
    // For now, assume any card type is acceptable
    requiredLevelOk = true;
  }

  return {
    nameMatchOk,
    expiryValidOk,
    requiredLevelOk,
    issues,
  };
}

/**
 * Determine overall verification status
 */
export function determineOverallStatus(
  checks: {
    nameMatchOk: boolean;
    expiryValidOk: boolean;
    requiredLevelOk: boolean;
  }
): "VALID" | "INVALID" | "UNKNOWN" {
  // If any check explicitly failed, status is INVALID
  if (checks.nameMatchOk === false || checks.expiryValidOk === false || checks.requiredLevelOk === false) {
    return "INVALID";
  }

  // If all checks are explicitly true, status is VALID
  if (checks.nameMatchOk === true && checks.expiryValidOk === true && checks.requiredLevelOk === true) {
    return "VALID";
  }

  // Otherwise, status is UNKNOWN (some checks couldn't be determined)
  return "UNKNOWN";
}

