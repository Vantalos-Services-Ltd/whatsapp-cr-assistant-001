"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { ToastViewport } from "./ToastViewport";
import { ToastItem } from "./ToastItem";

export type ToastVariant = "success" | "info" | "warning" | "error";

export type ToastAction = { label: string; onClick: () => void };

export type ToastActionRef = { label: string; actionId: string };

export interface ToastInput {
  variant: ToastVariant;
  title: string;
  confirmation?: string;
  outcome?: string;
  nextAction?: string | ToastAction;
}

export interface Toast extends Omit<ToastInput, "nextAction"> {
  id: string;
  createdAt: number;
  nextAction?: string | ToastActionRef;
}

interface ToastContextValue {
  pushToast: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const MAX_VISIBLE_TOASTS = 3;
const AUTO_DISMISS_DURATION = 5000; // 5 seconds

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismissTimeouts = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const actionHandlersRef = useRef<Map<string, () => void>>(new Map());

  const removeToast = useCallback((id: string) => {
    // Clear timeout if exists
    const timeout = dismissTimeouts.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      dismissTimeouts.current.delete(id);
    }

    // Clean up action handler if exists
    setToasts((prev) => {
      const toast = prev.find((t) => t.id === id);
      if (toast?.nextAction && typeof toast.nextAction === "object" && "actionId" in toast.nextAction) {
        actionHandlersRef.current.delete(toast.nextAction.actionId);
      }
      return prev.filter((t) => t.id !== id);
    });
  }, []);

  const startDismissTimer = useCallback((id: string) => {
    // Clear existing timeout if any
    const existingTimeout = dismissTimeouts.current.get(id);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeout = setTimeout(() => {
      removeToast(id);
    }, AUTO_DISMISS_DURATION);

    dismissTimeouts.current.set(id, timeout);
  }, [removeToast]);

  const pushToast = useCallback((toast: ToastInput) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Convert ToastAction to ToastActionRef if needed
    let nextAction: string | ToastActionRef | undefined = toast.nextAction;
    if (toast.nextAction && typeof toast.nextAction === "object" && "onClick" in toast.nextAction) {
      const actionId = `action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      actionHandlersRef.current.set(actionId, toast.nextAction.onClick);
      nextAction = { label: toast.nextAction.label, actionId };
    }
    
    const newToast: Toast = {
      ...toast,
      nextAction,
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
          }
          dismissTimeouts.current.delete(toast.id);
          
          // Clean up action handler
          if (toast.nextAction && typeof toast.nextAction === "object" && "actionId" in toast.nextAction) {
            actionHandlersRef.current.delete(toast.nextAction.actionId);
          }
        });
        return updated.slice(0, MAX_VISIBLE_TOASTS);
      }
      
      return updated;
    });

    // Start auto-dismiss timer
    startDismissTimer(id);
  }, [startDismissTimer]);

  const getActionHandler = useCallback((actionId: string): (() => void) | undefined => {
    return actionHandlersRef.current.get(actionId);
  }, []);

  // Cleanup timeouts and handlers on unmount
  useEffect(() => {
    return () => {
      dismissTimeouts.current.forEach((timeout) => clearTimeout(timeout));
      dismissTimeouts.current.clear();
      actionHandlersRef.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <ToastViewport>
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onClose={() => removeToast(toast.id)}
            getActionHandler={getActionHandler}
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

