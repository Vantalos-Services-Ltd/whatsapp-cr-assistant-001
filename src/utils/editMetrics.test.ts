/**
 * Tests for edit metrics utility functions
 */

import { describe, it, expect } from "vitest";
import {
  computeEditMetrics,
  wasEdited,
  capText,
  generateEditSummary,
  type EditMetrics,
} from '.ts';

describe("editMetrics", () => {
  describe("wasEdited", () => {
    it("should return false for whitespace-only changes", () => {
      expect(wasEdited("Hello world", "  Hello   world  ")).toBe(false);
      expect(wasEdited("  Test  ", "Test")).toBe(false);
      expect(wasEdited("Line1\nLine2", "Line1 Line2")).toBe(false);
      expect(wasEdited("", "   ")).toBe(false);
    });

    it("should return true for real edits", () => {
      expect(wasEdited("Hello world", "Hello there")).toBe(true);
      expect(wasEdited("Short", "Short message")).toBe(true);
      expect(wasEdited("Long message here", "Short")).toBe(true);
      expect(wasEdited("Original", "Modified original")).toBe(true);
    });

    it("should return false for identical texts", () => {
      expect(wasEdited("Same text", "Same text")).toBe(false);
      expect(wasEdited("", "")).toBe(false);
    });
  });

  describe("computeEditMetrics", () => {
    it("should handle whitespace-only changes -> wasEdited false", () => {
      const metrics = computeEditMetrics("Hello world", "  Hello   world  ");
      expect(metrics.charDiffRatio).toBe(0);
      expect(metrics.wordDiffCount).toBe(0);
      expect(metrics.wasShortened).toBe(false);
      expect(metrics.wasExpanded).toBe(false);
    });

    it("should detect real edits -> wasEdited true", () => {
      const metrics = computeEditMetrics("Hello world", "Hello there friend");
      expect(metrics.charDiffRatio).toBeGreaterThan(0);
      expect(metrics.wordDiffCount).toBeGreaterThan(0);
    });

    it("should compute char ratio boundaries correctly", () => {
      // Identical texts
      const identical = computeEditMetrics("Test", "Test");
      expect(identical.charDiffRatio).toBe(0);

      // Completely different (100% change when one is empty)
      const completelyDifferent = computeEditMetrics("A", "");
      expect(completelyDifferent.charDiffRatio).toBe(1);
      
      // Note: charDiffRatio measures length difference, not content difference
      // "AB" vs "AC" have same length, so ratio is 0
      const sameLength = computeEditMetrics("AB", "AC");
      expect(sameLength.charDiffRatio).toBe(0);
      expect(sameLength.wordDiffCount).toBe(0); // Same word count too

      // 50% change (one char replaced, but same length = 0 ratio)
      // Note: charDiffRatio measures length difference, not content difference
      const sameLengthDifferent = computeEditMetrics("AB", "AC");
      expect(sameLengthDifferent.charDiffRatio).toBe(0); // Same length = 0 ratio
      
      // 50% change when lengths differ
      const halfChange = computeEditMetrics("AB", "A");
      expect(halfChange.charDiffRatio).toBe(0.5); // 1 char diff / 2 max length = 0.5

      // Shortened text
      const shortened = computeEditMetrics("Long message here", "Short");
      expect(shortened.wasShortened).toBe(true);
      expect(shortened.wasExpanded).toBe(false);
      expect(shortened.charDiffRatio).toBeGreaterThan(0);

      // Expanded text
      const expanded = computeEditMetrics("Short", "Long message here");
      expect(expanded.wasShortened).toBe(false);
      expect(expanded.wasExpanded).toBe(true);
      expect(expanded.charDiffRatio).toBeGreaterThan(0);
    });

    it("should handle empty strings", () => {
      const emptyToText = computeEditMetrics("", "Hello");
      expect(emptyToText.charDiffRatio).toBe(1);
      expect(emptyToText.wordDiffCount).toBe(1);
      expect(emptyToText.wasExpanded).toBe(true);

      const textToEmpty = computeEditMetrics("Hello", "");
      expect(textToEmpty.charDiffRatio).toBe(1);
      expect(textToEmpty.wordDiffCount).toBe(1);
      expect(textToEmpty.wasShortened).toBe(true);

      const bothEmpty = computeEditMetrics("", "");
      expect(bothEmpty.charDiffRatio).toBe(0);
      expect(bothEmpty.wordDiffCount).toBe(0);
    });

    it("should compute word differences correctly", () => {
      const sameWords = computeEditMetrics("Hello world", "world Hello");
      expect(sameWords.wordDiffCount).toBe(0); // Same words, different order

      const addedWords = computeEditMetrics("Hello", "Hello world test");
      expect(addedWords.wordDiffCount).toBe(2);
      expect(addedWords.wasExpanded).toBe(true);

      const removedWords = computeEditMetrics("Hello world test", "Hello");
      expect(removedWords.wordDiffCount).toBe(2);
      expect(removedWords.wasShortened).toBe(true);
    });

    it("should round charDiffRatio to 3 decimal places", () => {
      const metrics = computeEditMetrics("A", "B");
      // Should be rounded to 3 decimal places
      const rounded = Math.round(metrics.charDiffRatio * 1000) / 1000;
      expect(metrics.charDiffRatio).toBe(rounded);
    });
  });

  describe("capText", () => {
    it("should cap text at max length", () => {
      const longText = "a".repeat(3000);
      const capped = capText(longText, 2000);
      expect(capped.length).toBe(2000);
      expect(capped).toBe("a".repeat(2000));
    });

    it("should not cap text if under limit", () => {
      const shortText = "Hello world";
      const capped = capText(shortText, 2000);
      expect(capped).toBe(shortText);
      expect(capped.length).toBe(shortText.length);
    });

    it("should use default max length of 2000", () => {
      const longText = "a".repeat(3000);
      const capped = capText(longText);
      expect(capped.length).toBe(2000);
    });
  });

  describe("generateEditSummary", () => {
    it("should generate summary for shortened text", () => {
      const metrics: EditMetrics = {
        charDiffRatio: 0.5,
        wordDiffCount: 5,
        wasShortened: true,
        wasExpanded: false,
      };
      const summary = generateEditSummary(metrics);
      expect(summary).toContain("Shortened");
    });

    it("should generate summary for expanded text", () => {
      const metrics: EditMetrics = {
        charDiffRatio: 0.3,
        wordDiffCount: 8,
        wasShortened: false,
        wasExpanded: true,
      };
      const summary = generateEditSummary(metrics);
      expect(summary).toContain("Expanded");
    });

    it("should categorize word differences", () => {
      const minor: EditMetrics = {
        charDiffRatio: 0.1,
        wordDiffCount: 2,
        wasShortened: false,
        wasExpanded: true,
      };
      expect(generateEditSummary(minor)).toContain("minor changes");

      const moderate: EditMetrics = {
        charDiffRatio: 0.2,
        wordDiffCount: 5,
        wasShortened: true,
        wasExpanded: false,
      };
      expect(generateEditSummary(moderate)).toContain("moderate changes");

      const significant: EditMetrics = {
        charDiffRatio: 0.5,
        wordDiffCount: 15,
        wasShortened: false,
        wasExpanded: true,
      };
      expect(generateEditSummary(significant)).toContain("significant changes");
    });

    it("should return default for no changes", () => {
      const noChange: EditMetrics = {
        charDiffRatio: 0,
        wordDiffCount: 0,
        wasShortened: false,
        wasExpanded: false,
      };
      expect(generateEditSummary(noChange)).toBe("No significant changes");
    });
  });
});

