"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DashboardEarnings } from "@/lib/api";
import { EarningsSetupModal } from "@/components/earnings/EarningsSetupModal";

interface EarningsTrackerCardProps {
  earnings: DashboardEarnings | null;
  isLoading?: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
}

export function EarningsTrackerCard({ earnings, isLoading, isRefreshing, onRefresh }: EarningsTrackerCardProps) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);

  // Only show skeleton on initial load when earnings is null
  if (isLoading && !earnings) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <div className="flex flex-col space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Earnings Tracker
          </p>
          <div className="h-8 w-24 animate-pulse bg-muted rounded mt-2" />
        </div>
      </div>
    );
  }

  // If earnings is null but not loading, treat as not configured
  if (!earnings || !earnings.configured) {
    return (
      <>
        <div className="rounded-lg border bg-card p-6">
          <div className="flex flex-col space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Earnings Tracker
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              Set up your commission brackets to track progress
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="text-sm px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors w-fit"
            >
              Set up
            </button>
          </div>
        </div>
        {showModal && (
          <EarningsSetupModal
            onClose={() => setShowModal(false)}
            onSave={() => {
              if (onRefresh) onRefresh();
            }}
          />
        )}
      </>
    );
  }

  const formatCurrency = (amount: number, currency: string): string => {
    if (currency === "GBP") {
      return `£${amount.toLocaleString("en-GB")}`;
    }
    return `${amount.toLocaleString("en-US")} ${currency}`;
  };

  return (
    <>
      <div className="rounded-lg border bg-card p-6">
        <div className="flex flex-col space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Earnings Tracker
              </p>
              {isRefreshing && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-orange-500"></span>
                  </span>
                  Refreshing...
                </span>
              )}
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="text-xs px-2 py-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              Edit
            </button>
          </div>
        
        {/* Big revenue amount */}
        <div>
          <p className="text-2xl font-semibold text-foreground">
            {formatCurrency(earnings.revenueTotal, earnings.currency)} this month
          </p>
        </div>

        {/* Bracket badge */}
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-1 bg-muted text-muted-foreground rounded">
            {earnings.currentBracketRatePct}% bracket
          </span>
        </div>

        {/* Amount to next bracket */}
        {earnings.amountToNextBracket !== null && earnings.amountToNextBracket > 0 && earnings.nextBracketRatePct !== null && (
          <p className="text-sm text-muted-foreground">
            {formatCurrency(earnings.amountToNextBracket, earnings.currency)} to hit {earnings.nextBracketRatePct}%
          </p>
        )}

        {/* Priority opportunities */}
        {earnings.opportunities.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Priority
            </p>
            <ul className="space-y-1.5">
              {earnings.opportunities.map((opp, index) => (
                <li key={index} className="text-sm text-foreground">
                  {opp.label}
                  {opp.estMonthlyMargin !== undefined && (
                    <span className="text-muted-foreground ml-1">
                      ({formatCurrency(opp.estMonthlyMargin, opp.currency)}/month margin)
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        </div>
      </div>
      {showModal && (
        <EarningsSetupModal
          onClose={() => setShowModal(false)}
          onSave={() => {
            if (onRefresh) onRefresh();
          }}
        />
      )}
    </>
  );
}

