"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Mode = "idle" | "confirmApprove" | "confirmReject";

interface TwoStepConfirmButtonsProps {
  onApprove: (() => Promise<void> | void) | undefined;
  onReject: (() => Promise<void> | void) | undefined;
  onRejectConfirm?: () => void; // Called when entering confirmReject state (before onReject)
  onCancel?: () => void; // Called when canceling (returning to idle)
  approveLabel?: string;
  rejectLabel?: string;
  confirmApproveLabel?: string;
  confirmRejectLabel?: string;
  cancelLabel?: string;
  size?: "sm" | "md";
  disabled?: boolean;
}

export function TwoStepConfirmButtons({
  onApprove,
  onReject,
  onRejectConfirm,
  onCancel,
  approveLabel = "Approve",
  rejectLabel = "Reject",
  confirmApproveLabel = "✓ Confirm Approval",
  confirmRejectLabel = "✓ Confirm Rejection",
  cancelLabel = "Cancel",
  size = "md",
  disabled = false,
}: TwoStepConfirmButtonsProps) {
  const [mode, setMode] = useState<Mode>("idle");
  const [isLoading, setIsLoading] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-reset after 5 seconds in confirm states
  useEffect(() => {
    if (mode === "confirmApprove" || mode === "confirmReject") {
      timeoutRef.current = setTimeout(() => {
        setMode("idle");
        if (onCancel) {
          onCancel();
        }
      }, 5000);

      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
      };
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
  }, [mode, onCancel]);

  // Escape key handler - cancel when in confirm state
  useEffect(() => {
    if (mode === "confirmApprove" || mode === "confirmReject") {
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setMode("idle");
          if (onCancel) {
            onCancel();
          }
        }
      };

      document.addEventListener("keydown", handleEscape);
      return () => {
        document.removeEventListener("keydown", handleEscape);
      };
    }
  }, [mode, onCancel]);

  // Click outside handler - cancel when in confirm state
  useEffect(() => {
    if (mode === "confirmApprove" || mode === "confirmReject") {
      const handleClickOutside = (e: MouseEvent) => {
        if (
          containerRef.current &&
          !containerRef.current.contains(e.target as Node)
        ) {
          setMode("idle");
          if (onCancel) {
            onCancel();
          }
        }
      };

      // Use capture phase to catch clicks before they bubble
      document.addEventListener("mousedown", handleClickOutside, true);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside, true);
      };
    }
  }, [mode, onCancel]);

  const handleApproveClick = () => {
    if (!onApprove) return;
    if (mode === "idle") {
      setMode("confirmApprove");
    } else if (mode === "confirmApprove") {
      handleConfirmApprove();
    }
  };

  const handleRejectClick = () => {
    if (!onReject) return;
    if (mode === "idle") {
      setMode("confirmReject");
      // Call onRejectConfirm if provided (e.g., to show textarea)
      if (onRejectConfirm) {
        onRejectConfirm();
      }
    } else if (mode === "confirmReject") {
      handleConfirmReject();
    }
  };

  const handleCancel = () => {
    setMode("idle");
    // Call onCancel callback if provided (e.g., to hide textarea)
    if (onCancel) {
      onCancel();
    }
  };

  const handleConfirmApprove = async () => {
    if (!onApprove) return;
    setIsLoading(true);
    try {
      await onApprove();
      setMode("idle");
    } catch (error) {
      // Let error bubble up for toast handling
      setMode("idle");
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmReject = async () => {
    if (!onReject) return;
    setIsLoading(true);
    try {
      await onReject();
      setMode("idle");
    } catch (error) {
      // Let error bubble up for toast handling
      setMode("idle");
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const buttonSize = size === "sm" ? "sm" : "default";

  return (
    <div ref={containerRef} className="flex flex-col gap-2">
      <div className="flex gap-3">
        {/* Left Button */}
        {mode === "idle" ? (
          onApprove ? (
            // Approve is the primary action and is styled as such. It previously
            // rendered as an outline button, visually identical in weight to
            // Reject, which gave the destructive path equal prominence.
            <Button
              type="button"
              variant="default"
              size={buttonSize}
              onClick={handleApproveClick}
              disabled={disabled || isLoading}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-sm"
            >
              {approveLabel}
            </Button>
          ) : null
        ) : mode === "confirmApprove" ? (
          <Button
            type="button"
            variant="default"
            size={buttonSize}
            onClick={handleConfirmApprove}
            disabled={disabled || isLoading}
            className={cn(
              "bg-green-600 hover:bg-green-700 text-white",
              "animate-pulse"
            )}
          >
            {confirmApproveLabel}
          </Button>
        ) : (
          // mode === "confirmReject"
          <Button
            type="button"
            variant="outline"
            size={buttonSize}
            onClick={handleCancel}
            disabled={disabled || isLoading}
          >
            {cancelLabel}
          </Button>
        )}

        {/* Right Button */}
        {mode === "idle" ? (
          onReject ? (
            <Button
              type="button"
              variant="outline"
              size={buttonSize}
              onClick={handleRejectClick}
              disabled={disabled || isLoading}
              className="border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              {rejectLabel}
            </Button>
          ) : null
        ) : mode === "confirmReject" ? (
          <Button
            type="button"
            variant="default"
            size={buttonSize}
            onClick={handleConfirmReject}
            disabled={disabled || isLoading}
            className={cn(
              "bg-blue-600 hover:bg-blue-700 text-white",
              "animate-pulse"
            )}
          >
            {confirmRejectLabel}
          </Button>
        ) : (
          // mode === "confirmApprove"
          <Button
            type="button"
            variant="outline"
            size={buttonSize}
            onClick={handleCancel}
            disabled={disabled || isLoading}
          >
            {cancelLabel}
          </Button>
        )}
      </div>
      
      {/* Helper text for confirm states */}
      {mode === "confirmApprove" && (
        <p className="text-xs text-muted-foreground text-center">
          Button turns GREEN and requires second click
        </p>
      )}
      {mode === "confirmReject" && (
        <p className="text-xs text-muted-foreground text-center">
          Button turns BLUE and requires second click
        </p>
      )}
    </div>
  );
}

