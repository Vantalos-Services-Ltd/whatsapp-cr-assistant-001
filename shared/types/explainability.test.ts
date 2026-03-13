/**
 * Tests for explainability types and sanitization
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeExplainability,
  createRulesExplainability,
  ExplainabilitySchema,
} from "./explainability.js";

describe("explainability", () => {
  describe("sanitizeExplainability", () => {
    it("should truncate arrays to max length", () => {
      const input = {
        riskLevel: "LOW",
        rationale: ["1", "2", "3", "4", "5", "6"], // More than 4
        usedFacts: Array(20).fill("fact"), // More than 8
        uncertainty: null,
        missingInfo: Array(10).fill("info"), // More than 6
        alternatives: [
          { action: "a", reason: "r1" },
          { action: "b", reason: "r2" },
          { action: "c", reason: "r3" },
        ], // More than 2
        generatedBy: "AI",
        generatedAt: new Date().toISOString(),
      };

      const result = sanitizeExplainability(input);

      expect(result.rationale.length).toBeLessThanOrEqual(4);
      expect(result.usedFacts.length).toBeLessThanOrEqual(8);
      expect(result.missingInfo.length).toBeLessThanOrEqual(6);
      expect(result.alternatives.length).toBeLessThanOrEqual(2);
    });

    it("should trim strings", () => {
      const input = {
        riskLevel: "LOW",
        rationale: ["  Trimmed rationale  ", "  Another one  "],
        usedFacts: ["  Trade: Bricklayer  "],
        uncertainty: "  Uncertainty with spaces  ",
        missingInfo: ["  CSCS card  "],
        alternatives: [],
        generatedBy: "AI",
        generatedAt: new Date().toISOString(),
      };

      const result = sanitizeExplainability(input);

      expect(result.rationale[0]).toBe("Trimmed rationale");
      expect(result.rationale[1]).toBe("Another one");
      expect(result.usedFacts[0]).toBe("Trade: Bricklayer");
      expect(result.uncertainty).toBe("Uncertainty with spaces");
      expect(result.missingInfo[0]).toBe("CSCS card");
    });

    it("should drop empty entries from arrays", () => {
      const input = {
        riskLevel: "MEDIUM",
        rationale: ["Valid", "", "  ", "Another valid"],
        usedFacts: ["Fact 1", "", "Fact 2"],
        uncertainty: null,
        missingInfo: ["Info 1", "  ", "Info 2"],
        alternatives: [],
        generatedBy: "AI",
        generatedAt: new Date().toISOString(),
      };

      const result = sanitizeExplainability(input);

      expect(result.rationale).toEqual(["Valid", "Another valid"]);
      expect(result.usedFacts).toEqual(["Fact 1", "Fact 2"]);
      expect(result.missingInfo).toEqual(["Info 1", "Info 2"]);
    });

    it("should handle invalid input gracefully", () => {
      const invalidInput = {
        riskLevel: "INVALID",
        rationale: "Not an array",
        usedFacts: null,
      };

      const result = sanitizeExplainability(invalidInput);

      // Should return safe defaults
      expect(result.riskLevel).toBe("LOW"); // Default
      expect(result.rationale).toEqual([]);
      expect(result.usedFacts).toEqual([]);
      expect(result.generatedBy).toBe("RULES");
    });

    it("should validate with Zod schema", () => {
      const validInput = {
        riskLevel: "HIGH",
        rationale: ["Reason 1", "Reason 2"],
        usedFacts: ["Fact 1"],
        uncertainty: "Some uncertainty",
        missingInfo: ["Missing 1"],
        alternatives: [{ action: "Action", reason: "Reason" }],
        confidence: 0.85,
        generatedBy: "AI",
        generatedAt: new Date().toISOString(),
      };

      const result = ExplainabilitySchema.safeParse(validInput);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.riskLevel).toBe("HIGH");
        expect(result.data.rationale.length).toBe(2);
        expect(result.data.confidence).toBe(0.85);
      }
    });
  });

  describe("createRulesExplainability", () => {
    it("should create RULES explainability with provided options", () => {
      const result = createRulesExplainability({
        riskLevel: "MEDIUM",
        rationale: ["Deterministic fallback"],
        usedFacts: ["Trade: Electrician"],
        uncertainty: "Some details missing",
        missingInfo: ["CSCS card"],
        alternatives: [],
      });

      expect(result.generatedBy).toBe("RULES");
      expect(result.riskLevel).toBe("MEDIUM");
      expect(result.rationale).toEqual(["Deterministic fallback"]);
      expect(result.usedFacts).toEqual(["Trade: Electrician"]);
      expect(result.uncertainty).toBe("Some details missing");
      expect(result.missingInfo).toEqual(["CSCS card"]);
      expect(result.generatedAt).toBeDefined();
    });

    it("should sanitize input when creating RULES explainability", () => {
      const result = createRulesExplainability({
        riskLevel: "LOW",
        rationale: ["  Trimmed  ", "  Another  "],
        usedFacts: Array(20).fill("fact"), // Will be truncated
        uncertainty: null,
        missingInfo: [],
        alternatives: [],
      });

      expect(result.rationale[0]).toBe("Trimmed");
      expect(result.usedFacts.length).toBeLessThanOrEqual(8);
    });
  });
});
