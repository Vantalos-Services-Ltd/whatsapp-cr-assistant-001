"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { PendingApprovalTaskDTO } from "@/lib/api";
import { approveTask, rejectTask, ApiError } from "@/lib/api";
import { useToast } from "@/components/toast";

interface InlineApprovalCardProps {
  task: PendingApprovalTaskDTO;
  onActionComplete: () => void;
}

function extractSuggestedMessage(proposedAction: unknown, payload: unknown): string | null {
  // First check payload.pendingReplyText (normalized field)
  if (payload && typeof payload === "object") {
    const payloadObj = payload as Record<string, unknown>;
    if (typeof payloadObj.pendingReplyText === "string" && payloadObj.pendingReplyText) {
      return payloadObj.pendingReplyText;
    }
    // Fallback: check payload.proposedAction.suggestedMessage
    if (payloadObj.proposedAction && typeof payloadObj.proposedAction === "object") {
      const proposedActionInPayload = payloadObj.proposedAction as Record<string, unknown>;
      if (typeof proposedActionInPayload.suggestedMessage === "string") {
        return proposedActionInPayload.suggestedMessage;
      }
    }
  }

  // Check top-level proposedAction.suggestedMessage
  if (proposedAction && typeof proposedAction === "object") {
    const action = proposedAction as Record<string, unknown>;
    const suggestedMessage = action.suggestedMessage;
    if (typeof suggestedMessage === "string") {
      return suggestedMessage;
    }
  }

  return null;
}

function extractRiskLevel(proposedAction: unknown): "LOW" | "MEDIUM" | "HIGH" | null {
  if (!proposedAction || typeof proposedAction !== "object") {
    return null;
  }
  const action = proposedAction as Record<string, unknown>;
  const riskLevel = action.riskLevel;
  if (riskLevel === "LOW" || riskLevel === "MEDIUM" || riskLevel === "HIGH") {
    return riskLevel;
  }
  return null;
}

export function InlineApprovalCard({ task, onActionComplete }: InlineApprovalCardProps) {
  const [showRejectTextarea, setShowRejectTextarea] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { pushToast } = useToast();

  const suggestedMessage = extractSuggestedMessage(task.proposedAction, task.payload);
  const riskLevel = extractRiskLevel(task.proposedAction);

  const handleApprove = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    try {
      await approveTask(task.id);
      
      // Show success toast ONLY after successful API call
      pushToast({
        variant: "success",
        title: "Message sent",
        confirmation: "✓ Sent successfully",
        outcome: "Task completed",
        nextAction: "→ Continue conversation",
      });
      
      onActionComplete();
    } catch (error) {
      console.error("Failed to approve task:", error);
      
      // Extract error message
      let errorMessage = "An unexpected error occurred";
      if (error instanceof ApiError) {
        errorMessage = error.message || "Failed to send message";
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      // Show error toast with retry action
      pushToast({
        variant: "error",
        title: "Message failed to send",
        confirmation: "✗ Confirmation: Could not complete action",
        outcome: `📋 Outcome: ${errorMessage}`,
        nextAction: {
          label: "→ Next: Retry sending",
          onClick: () => {
            handleApprove();
          },
        },
      });
      
      // Re-throw error so parent can handle state reset
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const handleReject = async () => {
    if (isLoading) return;
    
    if (!showRejectTextarea) {
      setShowRejectTextarea(true);
      return;
    }

    setIsLoading(true);
    try {
      await rejectTask(task.id, rejectReason || undefined);
      
      // Show success toast ONLY after successful API call
      pushToast({
        variant: "info",
        title: "Message discarded",
        confirmation: "✓ Suggestion rejected",
        outcome: "Task marked rejected",
        nextAction: "→ Review next approval",
      });
      
      onActionComplete();
    } catch (error) {
      console.error("Failed to reject task:", error);
      
      // Extract error message
      let errorMessage = "An unexpected error occurred";
      if (error instanceof ApiError) {
        errorMessage = error.message || "Failed to reject task";
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      // Show error toast with retry action
      pushToast({
        variant: "error",
        title: "Action failed",
        confirmation: "✗ Confirmation: Could not complete action",
        outcome: `📋 Outcome: ${errorMessage}`,
        nextAction: {
          label: "→ Next: Retry sending",
          onClick: () => {
            handleReject();
          },
        },
      });
      
      // Re-throw error so parent can handle state reset
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-muted/50 border rounded-lg p-4 space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-semibold text-foreground">Pending Approval</span>
            {riskLevel && (
              <Badge variant="outline" className="text-xs">
                {riskLevel} Risk
              </Badge>
            )}
          </div>
          {suggestedMessage && (
            <div className="text-sm text-foreground bg-background border rounded p-3 mb-3 whitespace-pre-wrap break-words">
              {suggestedMessage}
            </div>
          )}
        </div>
      </div>
      
      {showRejectTextarea && (
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Rejection Reason (optional)
          </label>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Optional reason for rejection..."
            className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0"
          />
        </div>
      )}

      <div className="flex gap-2">
        {showRejectTextarea ? (
          <>
            <Button
              onClick={handleReject}
              disabled={isLoading}
              variant="destructive"
              className="flex-1"
            >
              Confirm Reject
            </Button>
            <Button
              onClick={handleApprove}
              disabled={isLoading}
              variant="secondary"
              className="flex-1"
            >
              Approve
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={handleApprove}
              disabled={isLoading}
              className="flex-1 bg-green-600 text-white hover:bg-green-700 focus-visible:ring-green-600"
            >
              Approve
            </Button>
            <Button
              onClick={handleReject}
              disabled={isLoading}
              variant="destructive"
              className="flex-1"
            >
              Reject
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

