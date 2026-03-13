"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { ToastViewport } from "./ToastViewport";
import { ToastItem } from "./ToastItem";

export type ToastVariant = "success" | "info" | "warning" | "error";

export interface NextAction {
  label: string;
  onClick?: () => void;
}

export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  confirmation?: string;
  outcome?: string;
  nextAction?: string | NextAction;
  createdAt: number;
}

interface ToastContextValue {
  toasts: Toast[];
  pushToast: (toast: Omit<Toast, "id" | "createdAt">) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const MAX_VISIBLE_TOASTS = 3;
const AUTO_DISMISS_DURATION = 5000; // 5 seconds

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismissTimeouts = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const pausedToasts = useRef<Set<string>>(new Set());

  const removeToast = useCallback((id: string) => {
    // Clear timeout if exists
    const timeout = dismissTimeouts.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      dismissTimeouts.current.delete(id);
    }
    pausedToasts.current.delete(id);

    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const startDismissTimer = useCallback((id: string) => {
    // Clear existing timeout if any
    const existingTimeout = dismissTimeouts.current.get(id);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Don't start timer if paused
    if (pausedToasts.current.has(id)) {
      return;
    }

    const timeout = setTimeout(() => {
      removeToast(id);
    }, AUTO_DISMISS_DURATION);

    dismissTimeouts.current.set(id, timeout);
  }, [removeToast]);

  const pauseDismiss = useCallback((id: string) => {
    pausedToasts.current.add(id);
    const timeout = dismissTimeouts.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      dismissTimeouts.current.delete(id);
    }
  }, []);

  const resumeDismiss = useCallback((id: string) => {
    pausedToasts.current.delete(id);
    startDismissTimer(id);
  }, [startDismissTimer]);

  const pushToast = useCallback((toast: Omit<Toast, "id" | "createdAt">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newToast: Toast = {
      ...toast,
      id,
      createdAt: Date.now(),
    };

    setToasts((prev) => {
      const updated = [newToast, ...prev];
      
      // If we exceed max visible, remove the oldest ones
      if (updated.length > MAX_VISIBLE_TOASTS) {
        const toRemove = updated.slice(MAX_VISIBLE_TOASTS);
        toRemove.forEach((toast) => {
          const timeout = dismissTimeouts.current.get(toast.id);
          if (timeout) {
            clearTimeout(timeout);
            dismissTimeouts.current.delete(toast.id);
          }
          pausedToasts.current.delete(toast.id);
        });
        return updated.slice(0, MAX_VISIBLE_TOASTS);
      }
      
      return updated;
    });

    // Start auto-dismiss timer
    startDismissTimer(id);
  }, [startDismissTimer]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      dismissTimeouts.current.forEach((timeout) => clearTimeout(timeout));
      dismissTimeouts.current.clear();
      pausedToasts.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, pushToast, removeToast }}>
      {children}
      <ToastViewport>
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onClose={() => removeToast(toast.id)}
            onPauseDismiss={() => pauseDismiss(toast.id)}
            onResumeDismiss={() => resumeDismiss(toast.id)}
          />
        ))}
      </ToastViewport>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

