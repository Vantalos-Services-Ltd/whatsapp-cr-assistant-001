/**
 * Global System Status indicator store
 * Tracks data freshness and system connectivity
 */

"use client";

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef, ReactNode } from "react";

export type DataStatus = "up_to_date" | "refreshing" | "out_of_date" | "offline";

export interface DataStatusState {
  status: DataStatus;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage?: string;
  lastRefreshStartedAt?: number | null;
}

interface DataStatusStore {
  state: DataStatusState;
  setRefreshing: () => void;
  setUpToDate: () => void;
  setOutOfDate: (errorMessage?: string) => void;
  setOffline: () => void;
  isStale: boolean;
  deriveStatus: () => DataStatus;
}

// Configuration
const STALE_THRESHOLD_MS = 60 * 1000; // 60 seconds (configurable)

const initialState: DataStatusState = {
  status: "up_to_date",
  lastSuccessAt: null,
  lastErrorAt: null,
  lastErrorMessage: undefined,
  lastRefreshStartedAt: null,
};

const DataStatusContext = createContext<DataStatusStore | null>(null);

/**
 * Provider component for DataStatus store
 */
export function DataStatusProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DataStatusState>(initialState);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const setRefreshing = useCallback(() => {
    setState((prev) => ({
      ...prev,
      status: "refreshing",
      lastRefreshStartedAt: Date.now(),
    }));
  }, []);

  const setUpToDate = useCallback(() => {
    setState((prev) => ({
      ...prev,
      status: "up_to_date",
      lastSuccessAt: Date.now(),
      lastErrorAt: null,
      lastErrorMessage: undefined,
      lastRefreshStartedAt: null,
    }));
  }, []);

  const setOutOfDate = useCallback((errorMessage?: string) => {
    setState((prev) => ({
      ...prev,
      status: "out_of_date",
      lastErrorAt: Date.now(),
      lastErrorMessage: errorMessage,
      lastRefreshStartedAt: null,
    }));
  }, []);

  const setOffline = useCallback(() => {
    setState((prev) => ({
      ...prev,
      status: "offline",
      lastErrorAt: Date.now(),
      lastErrorMessage: "Network offline",
      lastRefreshStartedAt: null,
    }));
  }, []);

  // Check if data is stale (lastSuccessAt older than threshold)
  const isStale = useMemo(() => {
    if (!state.lastSuccessAt) return true;
    const age = Date.now() - state.lastSuccessAt;
    return age > STALE_THRESHOLD_MS;
  }, [state.lastSuccessAt]);

  // Derive status: if stale and not already refreshing/offline, mark as out_of_date
  const deriveStatus = useCallback((): DataStatus => {
    // If already refreshing or offline, return that status (don't override)
    if (state.status === "refreshing" || state.status === "offline") {
      return state.status;
    }

    // If stale, mark as out_of_date
    if (isStale) {
      return "out_of_date";
    }

    // Otherwise return current status
    return state.status;
  }, [state.status, isStale]);

  // Timer to check for stale data every 10 seconds
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setState((prev) => {
        // Don't override offline or refreshing status
        if (prev.status === "offline" || prev.status === "refreshing") {
          return prev;
        }

        // Check if data is stale (lastSuccessAt older than threshold)
        if (prev.lastSuccessAt !== null) {
          const age = Date.now() - prev.lastSuccessAt;
          if (age > STALE_THRESHOLD_MS) {
            // Data is stale, mark as out_of_date
            return {
              ...prev,
              status: "out_of_date",
              lastErrorAt: prev.lastErrorAt || Date.now(),
              lastErrorMessage: prev.lastErrorMessage || "Data is stale",
            };
          }
        }

        return prev;
      });
    }, 10000); // Check every 10 seconds

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const store: DataStatusStore = {
    state,
    setRefreshing,
    setUpToDate,
    setOutOfDate,
    setOffline,
    isStale,
    deriveStatus,
  };

  return (
    <DataStatusContext.Provider value={store}>
      {children}
    </DataStatusContext.Provider>
  );
}

/**
 * Hook to access DataStatus store
 * Must be used within DataStatusProvider
 */
export function useDataStatus(): DataStatusStore {
  const context = useContext(DataStatusContext);
  if (!context) {
    throw new Error("useDataStatus must be used within DataStatusProvider");
  }
  return context;
}

/**
 * Alias for useDataStatus (for consistency with store naming)
 */
export const useDataStatusStore = useDataStatus;

/**
 * Export stale threshold for external configuration if needed
 */
export const STALE_THRESHOLD = STALE_THRESHOLD_MS;

