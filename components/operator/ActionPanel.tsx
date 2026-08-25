"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { TaskListItemDTO } from "@/shared/dto/operator";
import { approveTask, rejectTask, ApiError, getConversation } from "@/lib/api";
import { useToast } from "@/components/toast";
import { TwoStepConfirmButtons } from "@/components/common/TwoStepConfirmButtons";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ExplainabilityPanel } from "./ExplainabilityPanel";
import { useApprovalShortcuts } from "@/components/common/useApprovalShortcuts";

interface ActionPanelProps {
  task: TaskListItemDTO;
  onActionComplete: (actionType: "approved" | "rejected") => void;
}

function extractActionType(proposedAction: unknown): string | null {
  if (!proposedAction || typeof proposedAction !== "object") {
    return null;
  }
  const action = proposedAction as Record<string, unknown>;
  const actionType = action.actionType;
  return typeof actionType === "string" ? actionType : null;
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

function extractSuggestedMessage(proposedAction: unknown): string | null {
  if (!proposedAction || typeof proposedAction !== "object") {
    return null;
  }
  const action = proposedAction as Record<string, unknown>;
  const suggestedMessage = action.suggestedMessage;
  return typeof suggestedMessage === "string" ? suggestedMessage : null;
}

export function ActionPanel({ task, onActionComplete }: ActionPanelProps) {
  const [showRejectTextarea, setShowRejectTextarea] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationData, setConversationData] = useState<{ progressStage?: string; memorySummary?: string | null } | null>(null);
  const { pushToast } = useToast();
  
  // Fetch conversation data if conversationId is available
  useEffect(() => {
    if (task.conversationId && !conversationData) {
      getConversation(task.conversationId)
        .then((conv) => {
          setConversationData({
            progressStage: conv.progressStage,
            memorySummary: conv.memoryPack?.summary || null,
          });
        })
        .catch((err) => {
          console.error("Failed to fetch conversation data:", err);
        });
    }
  }, [task.conversationId, conversationData]);

  // Robust resolver for inbound message text
  const taskAny = task as any;
  const inboundText = 
    taskAny.relatedMessage?.text ?? 
    taskAny.payload?.lastMessageText ?? 
    "This is outreach — the candidate hasn\u2019t messaged yet.";

  // Robust resolver for suggested message
  // Check multiple sources: proposedAction, payload.suggestedMessage (for opportunity tasks), payload.pendingReplyText
  const suggested = 
    taskAny.proposedAction?.suggestedMessage ??
    taskAny.payload?.suggestedMessage ??
    taskAny.payload?.pendingReplyText ??
    "Got it. Just to confirm what trade you're looking for and what area you're based in?";

  // Check if fallback is being used
  const isFallback = !taskAny.proposedAction?.suggestedMessage && !taskAny.payload?.suggestedMessage && !taskAny.payload?.pendingReplyText;

  // Editable message state
  const [editedMessage, setEditedMessage] = useState(suggested);
  const [isAuditExpanded, setIsAuditExpanded] = useState(false);

  // Update edited message when suggested changes
  useEffect(() => {
    setEditedMessage(suggested);
  }, [suggested]);

  // Extract audit data from task payload (if available after approval)
  // Note: This uses editedMessage which is defined above
  const payload = taskAny.payload || {};
  const hasAuditData = payload.approvedMessageText || payload.proposedMessageText;
  const auditData = hasAuditData ? {
    proposedMessageText: payload.proposedMessageText || suggested,
    approvedMessageText: payload.approvedMessageText || editedMessage,
    wasEdited: payload.wasEdited || false,
    editMetrics: payload.editMetrics || null,
    editSummary: payload.editSummary || null,
  } : null;

  // Show audit section if: task is approved OR operator is editing message
  const shouldShowAudit = hasAuditData || (editedMessage.trim() !== suggested.trim());

  // Extract action details from task
  const actionType = extractActionType(task as any);
  const riskLevel = extractRiskLevel(task as any);

  const handleApprove = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    try {
      // Only send override if message was edited and differs from suggested
      const messageOverride = editedMessage.trim() !== suggested.trim() ? editedMessage.trim() : undefined;
      await approveTask(task.taskId, messageOverride);
      
      // Show success toast ONLY after successful API call
      pushToast({
        variant: "success",
        title: "Message sent",
        confirmation: "✓ Sent successfully",
        outcome: "Task completed",
        nextAction: "→ Continue conversation",
      });
      
      onActionComplete("approved");
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
      
      // Re-throw error so TwoStepConfirmButtons can reset state
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const handleReject = async () => {
    if (isLoading) return;
    
    // This is called when user clicks "✓ Confirm Rejection"
    // Textarea should already be shown (via onRejectConfirm)
    setIsLoading(true);
    const reason = rejectReason || undefined;
    try {
      await rejectTask(task.taskId, reason);
      
      // Show success toast ONLY after successful API call
      pushToast({
        variant: "info",
        title: "Message discarded",
        confirmation: "✓ Suggestion rejected",
        outcome: "Task marked rejected",
        nextAction: "→ Review next approval",
      });
      
      setShowRejectTextarea(false);
      setRejectReason("");
      onActionComplete("rejected");
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
      
      // Re-throw error so TwoStepConfirmButtons can reset state
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // Keyboard: A approves, R rejects. Inert while typing in the message box.
  useApprovalShortcuts({
    onApprove: () => { if (!isLoading) void handleApprove(); },
    onReject: () => { if (!isLoading) void handleReject(); },
    enabled: Boolean(task),
  });


  const handleCopyMessage = () => {
    if (editedMessage) {
      navigator.clipboard.writeText(editedMessage);
    }
  };

  return (
    <div className="flex w-96 flex-col border-l bg-background">
      <div className="border-b px-6 py-4">
        <h3 className="text-lg font-semibold text-foreground">Suggested Action</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Candidate Message */}
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Candidate Message</div>
          <div className="border rounded-lg p-4 bg-muted/30">
            <div className="text-sm whitespace-pre-wrap break-words text-foreground leading-relaxed">
              {inboundText}
            </div>
          </div>
        </div>

        {actionType && (
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Action Type</div>
            <div className="text-sm text-foreground">{actionType}</div>
          </div>
        )}
        
        {/* Explainability Panel */}
        <ExplainabilityPanel
          explainability={task.proposedAction?.explainability || taskAny.proposedAction?.explainability || taskAny.payload?.proposedAction?.explainability}
          riskLevel={riskLevel || task.proposedAction?.riskLevel || null}
          suggestedMessage={suggested}
        />
        
        {/* Memory Summary and Progress */}
        {conversationData && (conversationData.memorySummary || conversationData.progressStage) && (
          <div className="border-t pt-4 space-y-2">
            {conversationData.progressStage && (
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Progress</div>
                <Badge variant="outline" className="text-xs">
                  {conversationData.progressStage.split("_").map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(" ")}
                </Badge>
              </div>
            )}
            {conversationData.memorySummary && (
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Summary</div>
                <div className="text-sm text-foreground leading-relaxed">{conversationData.memorySummary}</div>
              </div>
            )}
          </div>
        )}
        
        {/* Suggested Message (Editable) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Suggested Response</div>
            {isFallback && (
              <Badge variant="outline" className="text-xs bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400">
                Fallback reply (AI suggestion missing)
              </Badge>
            )}
          </div>
          <textarea
            value={editedMessage}
            onChange={(e) => setEditedMessage(e.target.value)}
            className="w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-y text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0"
            placeholder="Enter your response message..."
          />
          <div className="mt-2 flex items-center justify-between">
            <button
              onClick={handleCopyMessage}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Copy
            </button>
            {editedMessage !== suggested && (
              <button
                onClick={() => setEditedMessage(suggested)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Reset to original
              </button>
            )}
          </div>
        </div>

        {/* Message Audit Section (collapsible) */}
        {shouldShowAudit && (
          <div className="border-t pt-4">
            <button
              onClick={() => setIsAuditExpanded(!isAuditExpanded)}
              className="w-full flex items-center justify-between text-xs font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
            >
              <span>Message Audit</span>
              {isAuditExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
            {isAuditExpanded && (
              <div className="mt-3 space-y-3">
                {auditData ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Proposed</p>
                        <div className="border rounded p-2 bg-muted/30 text-xs text-foreground max-h-24 overflow-y-auto">
                          {auditData.proposedMessageText}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Final</p>
                        <div className="border rounded p-2 bg-muted/30 text-xs text-foreground max-h-24 overflow-y-auto">
                          {auditData.approvedMessageText}
                        </div>
                      </div>
                    </div>
                    {auditData.editMetrics && (
                      <div className="text-xs space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">Edited:</span>
                          <Badge variant="outline" className="text-xs">
                            {auditData.wasEdited ? "Yes" : "No"}
                          </Badge>
                        </div>
                        {auditData.wasEdited && auditData.editMetrics && (
                          <div className="text-muted-foreground space-y-0.5">
                            <div>Char diff: {(auditData.editMetrics.charDiffRatio * 100).toFixed(1)}%</div>
                            <div>Word diff: {auditData.editMetrics.wordDiffCount}</div>
                            {auditData.editSummary && (
                              <div className="italic">{auditData.editSummary}</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    Audit data will be available after approval
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {showRejectTextarea && (
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Rejection Reason</div>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Optional reason for rejection..."
              className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0"
            />
          </div>
        )}
        <div className="flex flex-col gap-2 pt-2">
          <TwoStepConfirmButtons
            onApprove={handleApprove}
            onReject={handleReject}
            onRejectConfirm={() => {
              // Called when entering confirmReject state - show textarea
              if (!showRejectTextarea) {
                setShowRejectTextarea(true);
              }
            }}
            onCancel={() => {
              // Called when canceling - hide textarea and reset reason
              setShowRejectTextarea(false);
              setRejectReason("");
            }}
            disabled={isLoading}
          />
        </div>
      </div>
    </div>
  );
}

