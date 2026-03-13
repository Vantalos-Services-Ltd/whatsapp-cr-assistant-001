"use client";

import { useDataStatus } from "@/lib/dataStatusStore";
import { StatusPill } from "@/components/common/StatusPill";

/**
 * System Status Indicator Component
 * Displays current data status using StatusPill
 */
export function SystemStatusIndicator() {
  const { state, deriveStatus } = useDataStatus();
  
  // Derive the effective status (handles stale data)
  const effectiveStatus = deriveStatus();

  return (
    <StatusPill
      status={effectiveStatus}
      lastSuccessAt={state.lastSuccessAt}
      lastErrorMessage={state.lastErrorMessage}
    />
  );
}

