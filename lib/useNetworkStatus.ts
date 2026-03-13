"use client";

import { useState, useEffect } from "react";

/**
 * Hook to detect network online/offline status
 * Uses navigator.onLine and listens to window online/offline events
 */
export function useNetworkStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    // Initialize with navigator.onLine if available, default to true
    if (typeof window !== "undefined" && typeof navigator !== "undefined") {
      return navigator.onLine;
    }
    return true; // Assume online during SSR
  });

  useEffect(() => {
    // Only run in browser
    if (typeof window === "undefined") return;

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



