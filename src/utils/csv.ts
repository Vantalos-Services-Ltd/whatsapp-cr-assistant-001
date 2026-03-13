/**
 * CSV Export Utilities
 * 
 * Provides secure, production-grade CSV generation with:
 * - CSV injection protection
 * - Proper escaping of quotes and commas
 * - UTF-8 BOM for Excel compatibility
 * - Streaming support to avoid loading all data in memory
 */

import { FastifyReply } from "fastify";

/**
 * Sanitize a single CSV cell value
 * 
 * Security: Prevents CSV injection by prefixing dangerous characters (=, +, -, @)
 * with a single quote. Also removes newlines and null characters.
 * 
 * @param value The value to sanitize (can be any type)
 * @returns Sanitized string (empty string for null/undefined)
 * 
 * @example
 * sanitizeCsvCell("=SUM(A1:A10)") // Returns "'=SUM(A1:A10)"
 * sanitizeCsvCell("Hello, World") // Returns "Hello, World"
 * sanitizeCsvCell(null) // Returns ""
 */
export function sanitizeCsvCell(value: unknown): string {
  // Convert null/undefined to empty string
  if (value === null || value === undefined) {
    return "";
  }

  // Convert to string
  let str = String(value);

  // Remove carriage returns, newlines, and null characters
  str = str.replace(/\r/g, "").replace(/\n/g, " ").replace(/\0/g, "");

  // Trim whitespace
  str = str.trim();

  // CSV injection protection: prefix dangerous characters with single quote
  // Excel and Google Sheets interpret =, +, -, @ as formula starts
  if (str.length > 0 && ["=", "+", "-", "@"].includes(str[0])) {
    str = "'" + str;
  }

  return str;
}

/**
 * Convert an array of cell values to a CSV row
 * 
 * Properly escapes quotes by doubling them and wraps each cell in quotes.
 * 
 * @param cells Array of cell values (will be sanitized)
 * @returns CSV-formatted row string
 * 
 * @example
 * toCsvRow(["John", "Doe", "He said \"Hello\""])
 * // Returns: "John","Doe","He said ""Hello"""
 */
export function toCsvRow(cells: string[]): string {
  return cells
    .map((cell) => {
      // Sanitize the cell
      const sanitized = sanitizeCsvCell(cell);
      
      // Escape quotes by doubling them
      const escaped = sanitized.replace(/"/g, '""');
      
      // Wrap in quotes
      return `"${escaped}"`;
    })
    .join(",");
}

/**
 * Write CSV response with proper headers and UTF-8 BOM
 * 
 * Sets appropriate headers for CSV download and writes UTF-8 BOM
 * so Excel and Google Sheets correctly interpret Unicode characters.
 * 
 * Supports streaming via a generator function to avoid loading all rows
 * into memory at once.
 * 
 * @param reply Fastify reply object
 * @param filename Filename for the download (without .csv extension)
 * @param headers Array of column header names
 * @param rowsGenerator Async generator that yields row arrays
 * 
 * @example
 * async function* generateRows() {
 *   for (let i = 0; i < 1000; i++) {
 *     yield [i, `Name ${i}`, `Value ${i}`];
 *   }
 * }
 * 
 * await writeCsvResponse(reply, "export", ["ID", "Name", "Value"], generateRows());
 */
export async function writeCsvResponse(
  reply: FastifyReply,
  filename: string,
  headers: string[],
  rowsGenerator: AsyncGenerator<string[], void, unknown>
): Promise<void> {
  // Set headers for CSV download
  reply.header("Content-Type", "text/csv; charset=utf-8");
  reply.header(
    "Content-Disposition",
    `attachment; filename="${filename}.csv"`
  );

  // Write UTF-8 BOM so Excel reads Unicode correctly
  // BOM is U+FEFF encoded as EF BB BF in UTF-8
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  reply.raw.write(bom);

  // Write header row
  const headerRow = toCsvRow(headers);
  reply.raw.write(headerRow + "\n");

  // Stream rows from generator
  for await (const row of rowsGenerator) {
    const csvRow = toCsvRow(row);
    reply.raw.write(csvRow + "\n");
  }

  // End the response
  reply.raw.end();
}

/**
 * Helper: Create an async generator from an array (for small datasets)
 * 
 * For larger datasets, implement a custom generator that fetches in chunks.
 * 
 * @param rows Array of row arrays
 * @returns Async generator
 */
export async function* arrayToGenerator(
  rows: string[][]
): AsyncGenerator<string[], void, unknown> {
  for (const row of rows) {
    yield row;
  }
}

