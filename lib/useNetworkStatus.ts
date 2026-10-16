"use client";

import { useState, useEffect } from "react";
import { isDemoMode } from "./mock/isDemoMode";

/**
 * Hook to detect network online/offline status
 * Uses navigator.onLine and listens to window online/offline events
 */
export function useNetworkStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    // Demo mode needs no network, so it is never "offline"
    if (isDemoMode()) return true;
    // Initialize with navigator.onLine if available, default to true
    if (typeof window !== "undefined" && typeof navigator !== "undefined") {
      return navigator.onLine;
    }
    return true; // Assume online during SSR
  });

  useEffect(() => {
    // Only run in browser
    if (typeof window === "undefined" || isDemoMode()) return;

    const handleOnline = () => {
      setIsOnline(true);
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    // Listen to online/offline events
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Cleanup
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}



