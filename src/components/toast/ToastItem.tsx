"use client";

import React, { useEffect, useState, useRef } from "react";
import { X, CheckCircle2, Info, AlertTriangle, XCircle } from "lucide-react";
import type { Toast } from "./ToastProvider";

interface ToastItemProps {
  toast: Toast;
  onClose: () => void;
  onPauseDismiss: () => void;
  onResumeDismiss: () => void;
}

const variantStyles = {
  success: {
    borderColor: "border-l-green-500",
    icon: CheckCircle2,
    iconColor: "text-green-500",
  },
  info: {
    borderColor: "border-l-blue-500",
    icon: Info,
    iconColor: "text-blue-500",
  },
  warning: {
    borderColor: "border-l-orange-500",
    icon: AlertTriangle,
    iconColor: "text-orange-500",
  },
  error: {
    borderColor: "border-l-red-500",
    icon: XCircle,
    iconColor: "text-red-500",
  },
};

export function ToastItem({ toast, onClose, onPauseDismiss, onResumeDismiss }: ToastItemProps) {
  const [isVisible, setIsVisible] = useState(false);
  const styles = variantStyles[toast.variant];
  const Icon = styles.icon;

  // Slide in animation
  useEffect(() => {
    // Trigger animation on mount
    const timer = setTimeout(() => setIsVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={`
        pointer-events-auto w-full bg-white rounded-lg border-l-4 shadow-lg transition-all duration-300 ease-out
        ${styles.borderColor}
        ${isVisible ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"}
      `}
      role="alert"
      onMouseEnter={onPauseDismiss}
      onMouseLeave={onResumeDismiss}
    >
      {/* Header row: icon, title, close button */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        {/* Icon */}
        <div className={`flex-shrink-0 ${styles.iconColor}`}>
          <Icon className="h-5 w-5" />
        </div>

        {/* Title */}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-gray-900">
            {toast.title}
          </div>
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="flex-shrink-0 rounded-md p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
          aria-label="Close notification"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body: confirmation, outcome, nextAction */}
      {(toast.confirmation || toast.outcome || toast.nextAction) && (
        <div className="px-4 pb-4 pt-0 space-y-1">
          {toast.confirmation && (
            <div className="text-sm text-gray-700 font-medium">
              {toast.confirmation}
            </div>
          )}
          {toast.outcome && (
            <div className="text-sm text-gray-600">
              {toast.outcome}
            </div>
          )}
          {toast.nextAction && (
            <div className="text-sm text-gray-600">
              {typeof toast.nextAction === "string" ? (
                <span>{toast.nextAction}</span>
              ) : (
                <button
                  onClick={() => {
                    toast.nextAction && typeof toast.nextAction === "object" && toast.nextAction.onClick?.();
                  }}
                  className="underline cursor-pointer hover:text-gray-900 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300 rounded"
                >
                  {toast.nextAction.label}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

