"use client";

import { useEffect, useRef } from "react";
import { useDataStatusStore } from "@/lib/dataStatusStore";
import { getHealth } from "@/lib/api";

/**
 * HeartbeatMonitor
 * Polls /api/health every 15 seconds to update global status
 * This is the ONLY component that should change global status (plus offline events)
 * Uses trackGlobalStatus=true in getHealth() to update global status pill
 */
export function HeartbeatMonitor() {
  const { setOffline } = useDataStatusStore();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const performHeartbeat = async () => {
      // Check if offline first
      if (!navigator.onLine) {
        setOffline();
        return;
      }

      // Call getHealth with trackGlobalStatus=true
      // This will automatically update global status (up_to_date on success, out_of_date on failure)
      try {
        await getHealth();
        // getHealth with trackGlobalStatus=true will call setUpToDate() on success
      } catch (error) {
        // getHealth with trackGlobalStatus=true will call setOutOfDate() or setOffline() on failure
        // No need to manually update status here
      }
    };

    // Perform initial heartbeat immediately
    performHeartbeat();

    // Set up interval for subsequent heartbeats
    intervalRef.current = setInterval(performHeartbeat, 15000); // 15 seconds

    // Cleanup on unmount
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [setOffline]);

  // This component doesn't render anything
  return null;
}

