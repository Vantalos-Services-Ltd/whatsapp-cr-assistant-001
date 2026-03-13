"use client";

import React, { useEffect, useState } from "react";
import type { Toast, ToastActionRef } from "./ToastProvider";

interface ToastItemProps {
  toast: Toast;
  onClose: () => void;
  getActionHandler: (actionId: string) => (() => void) | undefined;
}

const variantStyles = {
  success: {
    borderColor: "border-l-green-500",
    bgColor: "bg-green-50",
    textColor: "text-green-800",
    icon: "✓",
  },
  info: {
    borderColor: "border-l-blue-500",
    bgColor: "bg-blue-50",
    textColor: "text-blue-800",
    icon: "ℹ",
  },
  warning: {
    borderColor: "border-l-orange-500",
    bgColor: "bg-orange-50",
    textColor: "text-orange-800",
    icon: "⚠",
  },
  error: {
    borderColor: "border-l-red-500",
    bgColor: "bg-red-50",
    textColor: "text-red-800",
    icon: "✕",
  },
};

export function ToastItem({ toast, onClose, getActionHandler }: ToastItemProps) {
  const [isVisible, setIsVisible] = useState(false);
  const styles = variantStyles[toast.variant];

  // Slide in animation
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={`
        pointer-events-auto w-full ${styles.bgColor} rounded-lg border-l-4 shadow-lg transition-all duration-300 ease-out
        ${styles.borderColor}
        ${isVisible ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"}
      `}
      role="alert"
    >
      {/* Header row: icon, title, close button */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        {/* Icon */}
        <div className={`flex-shrink-0 ${styles.textColor} text-lg font-bold`}>
          {styles.icon}
        </div>

        {/* Title */}
        <div className="flex-1 min-w-0">
          <div className={`font-semibold text-sm ${styles.textColor}`}>
            {toast.title}
          </div>
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className={`flex-shrink-0 rounded-md p-1 ${styles.textColor} opacity-60 hover:opacity-100 hover:bg-black/5 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300`}
          aria-label="Close notification"
        >
          <span className="text-lg leading-none">×</span>
        </button>
      </div>

      {/* Body: confirmation, outcome, nextAction */}
      {(toast.confirmation || toast.outcome || toast.nextAction) && (
        <div className="px-4 pb-4 pt-0 space-y-1">
          {toast.confirmation && (
            <div className={`text-sm ${styles.textColor} font-medium`}>
              {toast.confirmation}
            </div>
          )}
          {toast.outcome && (
            <div className={`text-sm ${styles.textColor} opacity-80`}>
              {toast.outcome}
            </div>
          )}
          {toast.nextAction && (
            <div className={`text-sm ${styles.textColor} opacity-80`}>
              {typeof toast.nextAction === "string" ? (
                toast.nextAction
              ) : (
                <button
                  onClick={() => {
                    const actionRef = toast.nextAction as ToastActionRef;
                    const handler = getActionHandler(actionRef.actionId);
                    if (handler) {
                      handler();
                    }
                    onClose();
                  }}
                  className="underline hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-gray-300 rounded px-1"
                >
                  {(toast.nextAction as ToastActionRef).label}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

