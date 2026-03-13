/**
 * Edit Metrics Utility
 * 
 * Computes metrics comparing proposed vs final message text.
 * Used for governance and quality control tracking.
 */

export interface EditMetrics {
  charDiffRatio: number; // Ratio of character difference (0-1)
  wordDiffCount: number; // Absolute difference in word count
  wasShortened: boolean; // True if final is shorter than proposed
  wasExpanded: boolean; // True if final is longer than proposed
}

/**
 * Normalize text for comparison:
 * - Trim whitespace
 * - Collapse multiple spaces to single space
 */
function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * Count words in text (simple whitespace-based)
 */
function countWords(text: string): number {
  const normalized = normalizeText(text);
  if (normalized.length === 0) return 0;
  return normalized.split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Cap text at max length for storage
 */
export function capText(text: string, maxLength: number = 2000): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength);
}

/**
 * Compute edit metrics comparing proposed vs final message text.
 * 
 * @param proposed - The AI-suggested message text (before operator edits)
 * @param final - The final approved message text (after operator edits, if any)
 * @returns EditMetrics object with computed values
 */
export function computeEditMetrics(proposed: string, final: string): EditMetrics {
  // Normalize both texts for comparison
  const normalizedProposed = normalizeText(proposed);
  const normalizedFinal = normalizeText(final);

  // Character-based metrics
  const proposedLength = normalizedProposed.length;
  const finalLength = normalizedFinal.length;
  const charDiff = Math.abs(proposedLength - finalLength);
  const charDiffRatio = proposedLength > 0 
    ? charDiff / Math.max(proposedLength, finalLength)
    : finalLength > 0 ? 1 : 0;

  // Word-based metrics
  const proposedWords = countWords(normalizedProposed);
  const finalWords = countWords(normalizedFinal);
  const wordDiffCount = Math.abs(proposedWords - finalWords);

  // Direction flags
  const wasShortened = finalLength < proposedLength;
  const wasExpanded = finalLength > proposedLength;

  return {
    charDiffRatio: Math.round(charDiffRatio * 1000) / 1000, // Round to 3 decimal places
    wordDiffCount,
    wasShortened,
    wasExpanded,
  };
}

/**
 * Determine if text was edited (beyond trivial whitespace changes).
 * 
 * @param proposed - The AI-suggested message text
 * @param final - The final approved message text
 * @returns true if texts differ after normalization
 */
export function wasEdited(proposed: string, final: string): boolean {
  const normalizedProposed = normalizeText(proposed);
  const normalizedFinal = normalizeText(final);
  return normalizedProposed !== normalizedFinal;
}

/**
 * Generate a short human-readable summary of the edit.
 * 
 * @param metrics - The computed edit metrics
 * @returns A short string describing the edit (e.g., "Shortened and removed uncertain language")
 */
export function generateEditSummary(metrics: EditMetrics): string {
  const parts: string[] = [];

  if (metrics.wasShortened) {
    parts.push("Shortened");
  } else if (metrics.wasExpanded) {
    parts.push("Expanded");
  }

  // Add detail based on word difference
  if (metrics.wordDiffCount > 0) {
    if (metrics.wordDiffCount <= 3) {
      parts.push("minor changes");
    } else if (metrics.wordDiffCount <= 10) {
      parts.push("moderate changes");
    } else {
      parts.push("significant changes");
    }
  }

  // If no meaningful changes detected, return default
  if (parts.length === 0) {
    return "No significant changes";
  }

  return parts.join(" ");
}

