/**
 * Tests for AI action suggester
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { suggestActionWithAI } from './aiActionSuggester.ts';
import { ExplainabilitySchema } from '../../shared/types/explainability.ts';
import type { ContactProgressStage } from '../../shared/types/progress.ts';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock pino logger
vi.mock("pino", () => ({
  default: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function mockFetchOkJson(contentObject: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify(contentObject),
          },
        },
      ],
    }),
  });
}

function mockFetchReject(err: unknown) {
  mockFetch.mockRejectedValueOnce(err);
}

describe("aiActionSuggester", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
  });

  const baseInput = {
    intent: "LOOKING_FOR_WORK" as const,
    messageText: "I'm looking for work",
    contactName: "John",
    conversationHistory: [],
    memoryPack: {
      summary: "Experienced bricklayer",
      facts: {
        trade: "Bricklayer",
        location: "Manchester",
        availability: "Available immediately",
      },
    },
    progressStage: "LOOKING_FOR_WORK" as ContactProgressStage,
    progressData: {
      missingFields: ["CSCS card"],
      nextAction: null,
      followUpAt: null,
      lastDecision: null,
    },
  };

  describe("explainability handling", () => {
    it("should include explainability in AI response", async () => {
      const validExplainability = {
        riskLevel: "LOW",
        rationale: ["Candidate is looking for work", "Trade is known"],
        usedFacts: ["Trade: Bricklayer", "Location: Manchester"],
        uncertainty: null,
        missingInfo: ["CSCS card"],
        alternatives: [{ action: "Request CSCS photo", reason: "docs missing" }],
        generatedBy: "AI",
        generatedAt: new Date().toISOString(),
      };

      mockFetchOkJson({
        actionType: "SEND_MESSAGE",
        suggestedMessage: "Got it. What area are you based in?",
        reasoning: "Asking for location",
        riskLevel: "LOW",
        explainability: validExplainability,
      });

      const result = await suggestActionWithAI(baseInput);

      expect(result.explainability).toBeDefined();
      expect(result.explainability?.riskLevel).toBe("LOW");
      expect(result.explainability?.rationale).toHaveLength(2);
      expect(result.explainability?.generatedBy).toBe("AI");
    });

    it("should fallback to RULES explainability when AI explainability is invalid", async () => {
      const invalidExplainability = {
        riskLevel: "INVALID", // Invalid risk level
        rationale: "Not an array", // Should be array
        usedFacts: null, // Should be array
      };

      mockFetchOkJson({
        actionType: "SEND_MESSAGE",
        suggestedMessage: "Got it",
        reasoning: "Test",
        riskLevel: "LOW",
        explainability: invalidExplainability,
      });

      const result = await suggestActionWithAI(baseInput);

      // Should have explainability (fallback)
      expect(result.explainability).toBeDefined();
      expect(result.explainability?.generatedBy).toBe("RULES");
      expect(result.explainability?.rationale).toContain("AI suggestion generated but explanation unavailable");
    });

    it("should fallback to RULES explainability when AI explainability is missing", async () => {
      mockFetchOkJson({
        actionType: "SEND_MESSAGE",
        suggestedMessage: "Got it",
        reasoning: "Test",
        riskLevel: "MEDIUM",
        // No explainability field
      });

      const result = await suggestActionWithAI(baseInput);

      // Should have explainability (fallback)
      expect(result.explainability).toBeDefined();
      expect(result.explainability?.generatedBy).toBe("RULES");
      expect(result.explainability?.riskLevel).toBe("MEDIUM");
      expect(result.explainability?.usedFacts).toContain("Trade: Bricklayer");
      expect(result.explainability?.missingInfo).toContain("CSCS card");
    });

    it("should validate explainability with Zod schema", async () => {
      const explainabilityWithTooManyItems = {
        riskLevel: "LOW",
        rationale: ["1", "2", "3", "4", "5", "6"], // More than 4
        usedFacts: Array(20).fill("fact"), // More than 8
        uncertainty: null,
        missingInfo: Array(10).fill("info"), // More than 6
        alternatives: [{ action: "a", reason: "r" }, { action: "b", reason: "r" }, { action: "c", reason: "r" }], // More than 2
        generatedBy: "AI",
        generatedAt: new Date().toISOString(),
      };

      mockFetchOkJson({
        actionType: "SEND_MESSAGE",
        suggestedMessage: "Got it",
        reasoning: "Test",
        riskLevel: "LOW",
        explainability: explainabilityWithTooManyItems,
      });

      const result = await suggestActionWithAI(baseInput);

      // Zod should truncate arrays
      expect(result.explainability).toBeDefined();
      if (result.explainability) {
        expect(result.explainability.rationale.length).toBeLessThanOrEqual(4);
        expect(result.explainability.usedFacts.length).toBeLessThanOrEqual(8);
        expect(result.explainability.missingInfo.length).toBeLessThanOrEqual(6);
        expect(result.explainability.alternatives.length).toBeLessThanOrEqual(2);
      }
    });

    it("should trim strings in explainability", async () => {
      const explainabilityWithWhitespace = {
        riskLevel: "LOW",
        rationale: ["  Trimmed rationale  ", "  Another one  "],
        usedFacts: ["  Trade: Bricklayer  "],
        uncertainty: "  Uncertainty with spaces  ",
        missingInfo: ["  CSCS card  "],
        alternatives: [],
        generatedBy: "AI",
        generatedAt: new Date().toISOString(),
      };

      mockFetchOkJson({
        actionType: "SEND_MESSAGE",
        suggestedMessage: "Got it",
        reasoning: "Test",
        riskLevel: "LOW",
        explainability: explainabilityWithWhitespace,
      });

      const result = await suggestActionWithAI(baseInput);

      expect(result.explainability).toBeDefined();
      if (result.explainability) {
        expect(result.explainability.rationale[0]).toBe("Trimmed rationale");
        expect(result.explainability.usedFacts[0]).toBe("Trade: Bricklayer");
        expect(result.explainability.uncertainty).toBe("Uncertainty with spaces");
        expect(result.explainability.missingInfo[0]).toBe("CSCS card");
      }
    });
  });

  describe("task creation with explainability", () => {
    it("should always include explainability in suggested action", async () => {
      mockFetchOkJson({
        actionType: "SEND_MESSAGE",
        suggestedMessage: "Got it",
        reasoning: "Test",
        riskLevel: "LOW",
        explainability: {
          riskLevel: "LOW",
          rationale: ["Test rationale"],
          usedFacts: [],
          uncertainty: null,
          missingInfo: [],
          alternatives: [],
          generatedBy: "AI",
          generatedAt: new Date().toISOString(),
        },
      });

      const result = await suggestActionWithAI(baseInput);

      // Every suggested action should have explainability
      expect(result.explainability).toBeDefined();
      expect(result.explainability?.riskLevel).toBeDefined();
      expect(result.explainability?.rationale).toBeDefined();
      expect(result.explainability?.generatedBy).toBeDefined();
    });

    it("should create RULES explainability for NO_ACTION", async () => {
      const result = await suggestActionWithAI({
        ...baseInput,
        intent: "UNKNOWN",
        conversationHistory: [], // No history
      });

      // NO_ACTION should still have explainability
      expect(result.actionType).toBe("NO_ACTION");
      expect(result.explainability).toBeDefined();
      expect(result.explainability?.generatedBy).toBe("RULES");
    });
  });
});
