/**
 * Earnings Calculator Service
 * Computes earnings summaries based on revenue and commission brackets
 */

export interface CommissionBracket {
  minRevenue: number;
  maxRevenue?: number | null;
  ratePct: number;
}

export interface EarningsSummary {
  revenueTotal: number;
  currency: string;
  currentBracket: {
    ratePct: number;
    minRevenue: number;
    maxRevenue: number | null;
  };
  nextBracket: {
    ratePct: number;
    minRevenue: number;
  } | null;
  amountToNextBracket: number | null;
  summaryText: string;
}

/**
 * Format currency amount
 * GBP uses £ and commas, other currencies use standard formatting
 */
function formatCurrency(amount: number, currency: string): string {
  if (currency === "GBP") {
    return `£${amount.toLocaleString("en-GB")}`;
  }
  // For other currencies, use standard formatting
  return `${amount.toLocaleString("en-US")} ${currency}`;
}

/**
 * Format percentage
 */
function formatPercentage(ratePct: number): string {
  return `${ratePct}%`;
}

/**
 * Find the current bracket based on revenue total
 * Brackets are [minRevenue, maxRevenue) - inclusive lower bound, exclusive upper bound
 * Except the last bracket which is [minRevenue, infinity) if maxRevenue is null
 */
function findCurrentBracket(
  revenueTotal: number,
  brackets: CommissionBracket[]
): CommissionBracket | null {
  // Iterate through brackets in order (they should be sorted by minRevenue)
  for (const bracket of brackets) {
    const { minRevenue, maxRevenue } = bracket;
    
    // Check if revenueTotal is at or above this bracket's minimum
    if (revenueTotal >= minRevenue) {
      // If maxRevenue is null, this bracket extends to infinity (last bracket)
      if (maxRevenue === null || maxRevenue === undefined) {
        return bracket;
      }
      // If revenueTotal is strictly less than maxRevenue, we're in this bracket
      // This makes brackets [minRevenue, maxRevenue) - inclusive lower, exclusive upper
      if (revenueTotal < maxRevenue) {
        return bracket;
      }
      // If revenueTotal >= maxRevenue, continue to next bracket
    } else {
      // revenueTotal < minRevenue, so we've passed all possible brackets
      // This means revenueTotal is below the first bracket
      break;
    }
  }
  
  // If revenueTotal is less than the first bracket's minRevenue, return null
  // This shouldn't happen in practice if brackets start at 0, but handle it gracefully
  return null;
}

/**
 * Find the next bracket (first bracket with minRevenue > currentBracket.minRevenue)
 */
function findNextBracket(
  currentBracket: CommissionBracket,
  brackets: CommissionBracket[]
): CommissionBracket | null {
  // Find first bracket with minRevenue > currentBracket.minRevenue
  for (const bracket of brackets) {
    if (bracket.minRevenue > currentBracket.minRevenue) {
      return bracket;
    }
  }
  
  return null;
}

/**
 * Compute earnings summary
 */
export function computeEarningsSummary({
  revenueTotal,
  brackets,
  currency = "GBP",
}: {
  revenueTotal: number;
  brackets: CommissionBracket[];
  currency?: string;
}): EarningsSummary {
  // Validate inputs
  if (revenueTotal < 0) {
    throw new Error("revenueTotal must be non-negative");
  }

  if (!Array.isArray(brackets) || brackets.length === 0) {
    throw new Error("brackets must be a non-empty array");
  }

  // Find current bracket
  const currentBracket = findCurrentBracket(revenueTotal, brackets);

  if (!currentBracket) {
    // Revenue is below the first bracket - use the first bracket as current
    // This handles edge case where revenue is less than first bracket's minRevenue
    const firstBracket = brackets[0];
    return {
      revenueTotal,
      currency,
      currentBracket: {
        ratePct: firstBracket.ratePct,
        minRevenue: firstBracket.minRevenue,
        maxRevenue: firstBracket.maxRevenue ?? null,
      },
      nextBracket: brackets.length > 1 ? {
        ratePct: brackets[1].ratePct,
        minRevenue: brackets[1].minRevenue,
      } : null,
      amountToNextBracket: brackets.length > 1
        ? Math.max(0, brackets[1].minRevenue - revenueTotal)
        : null,
      summaryText: generateSummaryText(
        revenueTotal,
        currency,
        firstBracket.ratePct,
        brackets.length > 1 ? {
          ratePct: brackets[1].ratePct,
          minRevenue: brackets[1].minRevenue,
        } : null,
        brackets.length > 1 ? Math.max(0, brackets[1].minRevenue - revenueTotal) : null
      ),
    };
  }

  // Find next bracket
  const nextBracket = findNextBracket(currentBracket, brackets);

  // Calculate amount to next bracket
  const amountToNextBracket = nextBracket
    ? Math.max(0, nextBracket.minRevenue - revenueTotal)
    : null;

  // Generate summary text
  const summaryText = generateSummaryText(
    revenueTotal,
    currency,
    currentBracket.ratePct,
    nextBracket,
    amountToNextBracket
  );

  return {
    revenueTotal,
    currency,
    currentBracket: {
      ratePct: currentBracket.ratePct,
      minRevenue: currentBracket.minRevenue,
      maxRevenue: currentBracket.maxRevenue ?? null,
    },
    nextBracket: nextBracket ? {
      ratePct: nextBracket.ratePct,
      minRevenue: nextBracket.minRevenue,
    } : null,
    amountToNextBracket,
    summaryText,
  };
}

/**
 * Generate summary text
 * Format: "£18,200 this month (8%). £1,800 to hit 12%."
 */
function generateSummaryText(
  revenueTotal: number,
  currency: string,
  currentRatePct: number,
  nextBracket: { ratePct: number; minRevenue: number } | null,
  amountToNextBracket: number | null
): string {
  const formattedRevenue = formatCurrency(revenueTotal, currency);
  const formattedRate = formatPercentage(currentRatePct);
  
  let text = `${formattedRevenue} this month (${formattedRate})`;
  
  if (nextBracket && amountToNextBracket !== null && amountToNextBracket > 0) {
    const formattedAmount = formatCurrency(amountToNextBracket, currency);
    const nextRate = formatPercentage(nextBracket.ratePct);
    text += `. ${formattedAmount} to hit ${nextRate}.`;
  }
  
  return text;
}

