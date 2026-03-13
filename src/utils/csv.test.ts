import { describe, it, expect } from "vitest";
import { sanitizeCsvCell, toCsvRow, arrayToGenerator } from '.ts';

describe("csv utilities", () => {
  describe("sanitizeCsvCell", () => {
    it("should convert null to empty string", () => {
      expect(sanitizeCsvCell(null)).toBe("");
    });

    it("should convert undefined to empty string", () => {
      expect(sanitizeCsvCell(undefined)).toBe("");
    });

    it("should convert number to string", () => {
      expect(sanitizeCsvCell(123)).toBe("123");
    });

    it("should remove carriage returns", () => {
      expect(sanitizeCsvCell("Hello\rWorld")).toBe("HelloWorld");
    });

    it("should replace newlines with space", () => {
      expect(sanitizeCsvCell("Hello\nWorld")).toBe("Hello World");
    });

    it("should remove null characters", () => {
      expect(sanitizeCsvCell("Hello\0World")).toBe("HelloWorld");
    });

    it("should trim whitespace", () => {
      expect(sanitizeCsvCell("  Hello World  ")).toBe("Hello World");
    });

    it("should prefix = with single quote (CSV injection protection)", () => {
      expect(sanitizeCsvCell("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
    });

    it("should prefix + with single quote (CSV injection protection)", () => {
      expect(sanitizeCsvCell("+1+1")).toBe("'+1+1");
    });

    it("should prefix - with single quote (CSV injection protection)", () => {
      expect(sanitizeCsvCell("-1+1")).toBe("'-1+1");
    });

    it("should prefix @ with single quote (CSV injection protection)", () => {
      expect(sanitizeCsvCell("@SUM(A1:A10)")).toBe("'@SUM(A1:A10)");
    });

    it("should not prefix safe strings", () => {
      expect(sanitizeCsvCell("Hello, World")).toBe("Hello, World");
    });

    it("should handle empty string", () => {
      expect(sanitizeCsvCell("")).toBe("");
    });

    it("should handle strings starting with space then dangerous char", () => {
      // After trimming, the string starts with "=" so it gets prefixed with quote
      expect(sanitizeCsvCell(" =SUM(A1)")).toBe("'=SUM(A1)");
    });
  });

  describe("toCsvRow", () => {
    it("should wrap cells in quotes", () => {
      expect(toCsvRow(["John", "Doe"])).toBe('"John","Doe"');
    });

    it("should escape quotes by doubling them", () => {
      expect(toCsvRow(['He said "Hello"'])).toBe('"He said ""Hello"""');
    });

    it("should handle commas in cells", () => {
      expect(toCsvRow(["John, Jr.", "Doe"])).toBe('"John, Jr.","Doe"');
    });

    it("should sanitize cells before wrapping", () => {
      expect(toCsvRow(["=SUM(A1)", "Hello"])).toBe('"\'=SUM(A1)","Hello"');
    });

    it("should handle empty cells", () => {
      expect(toCsvRow(["John", "", "Doe"])).toBe('"John","","Doe"');
    });

    it("should handle null values", () => {
      expect(toCsvRow(["John", null as any, "Doe"])).toBe('"John","","Doe"');
    });

    it("should handle newlines in cells", () => {
      expect(toCsvRow(["Line1\nLine2"])).toBe('"Line1 Line2"');
    });
  });

  describe("arrayToGenerator", () => {
    it("should yield all rows from array", async () => {
      const rows = [
        ["Row1", "Col1", "Col2"],
        ["Row2", "Col1", "Col2"],
      ];
      const generator = arrayToGenerator(rows);
      const results: string[][] = [];
      for await (const row of generator) {
        results.push(row);
      }
      expect(results).toEqual(rows);
    });

    it("should handle empty array", async () => {
      const generator = arrayToGenerator([]);
      const results: string[][] = [];
      for await (const row of generator) {
        results.push(row);
      }
      expect(results).toEqual([]);
    });
  });
});

