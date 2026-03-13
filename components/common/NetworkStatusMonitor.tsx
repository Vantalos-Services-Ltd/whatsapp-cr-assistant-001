"use client";

import { useEffect, useRef } from "react";
import { useNetworkStatus } from "@/lib/useNetworkStatus";
import { useDataStatusStore } from "@/lib/dataStatusStore";

/**
 * Component that monitors network status and updates dataStatusStore
 * Should be rendered once at the app level (in layout)
 * 
 * When going offline: immediately sets status to offline
 * When coming back online: sets status to refreshing, then components will handle actual refresh
 */
export function NetworkStatusMonitor() {
  const isOnline = useNetworkStatus();
  const { setOffline, setRefreshing } = useDataStatusStore();
  const wasOnlineRef = useRef<boolean>(isOnline);

  useEffect(() => {
    // If we just went offline
    if (!isOnline && wasOnlineRef.current) {
      setOffline();
    }

    // If we just came back online
    if (isOnline && !wasOnlineRef.current) {
      // Set refreshing state - actual refresh will be triggered by components
      // (e.g., dashboard will detect online change and refresh)
      setRefreshing();
    }

    wasOnlineRef.current = isOnline;
  }, [isOnline, setOffline, setRefreshing]);

  // This component doesn't render anything
  return null;
}

