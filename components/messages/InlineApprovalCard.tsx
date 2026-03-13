"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { approveTask, rejectTask, ApiError } from "@/lib/api";
import { useToast } from "@/components/toast";
import { TwoStepConfirmButtons } from "@/components/common/TwoStepConfirmButtons";
import { ExplainabilityPanel } from "@/components/operator/ExplainabilityPanel";

/**
 * Task DTO with full payload and proposedAction support
 */
interface TaskDTO {
  taskId?: string;
  id?: string; // Some endpoints use 'id' instead of 'taskId'
  type: "APPROVAL_REQUIRED" | "FOLLOW_UP" | "ESCALATION" | "OUTREACH";
  approvalStatus: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";
  status: "OPEN" | "APPROVED" | "REJECTED" | "DONE" | "FAILED";
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | null;
  createdAt?: string;
  conversationId?: string | null;
  senderPhone?: string | null;
  senderName?: string | null;
  summary?: string | null;
  suggestedMessage?: string | null;
  approvalReason?: string | null;
  // Extended fields for full task data
  proposedAction?: any; // JSON object
  payload?: any; // JSON object
  relatedMessageId?: string | null;
  candidateId?: string | null;
}

interface JobMatch {
  jobId: string;
  title: string;
  status: string;
  startDate: string | null;
  durationWeeks: number | null;
  payRate: number | null;
  currency: string;
  scorePct: number;
  reasons: Array<{ label: string; points: number }>;
  highlights: string[];
}

interface ExcludedJob {
  jobId: string;
  title: string;
  reason: string;
}

interface JobMatchesData {
  matches: JobMatch[];
  excluded: ExcludedJob[];
  generatedAt?: string;
}

interface InlineApprovalCardProps {
  task: TaskDTO;
  candidateName: string;
  onApproved: () => void;
  onRejected: () => void;
}

/**
 * Resolve suggested message text with safe fallback order
 */
function resolveSuggestedMessage(task: TaskDTO): string | null {
  // Access payload and proposedAction from task (they may be in different places)
  const taskAny = task as any;
  
  // 1) task.payload?.pendingReplyText
  if (taskAny.payload?.pendingReplyText && typeof taskAny.payload.pendingReplyText === "string") {
    return taskAny.payload.pendingReplyText;
  }
  
  // 2) task.proposedAction?.suggestedMessage
  if (taskAny.proposedAction?.suggestedMessage && typeof taskAny.proposedAction.suggestedMessage === "string") {
    return taskAny.proposedAction.suggestedMessage;
  }
  
  // 3) task.payload?.proposedAction?.suggestedMessage
  if (taskAny.payload?.proposedAction?.suggestedMessage && typeof taskAny.payload.proposedAction.suggestedMessage === "string") {
    return taskAny.payload.proposedAction.suggestedMessage;
  }
  
  // 4) null
  return null;
}

/**
 * Format date for display
 */
function formatDate(dateString: string | null): string {
  if (!dateString) return "TBD";
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return dateString;
  }
}

/**
 * Format currency amount
 */
function formatCurrency(amount: number | null, currency: string = "GBP"): string {
  if (amount === null) return "TBD";
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency;
  return `${symbol}${amount.toLocaleString()}`;
}

export function InlineApprovalCard({
  task,
  candidateName,
  onApproved,
  onRejected,
}: InlineApprovalCardProps) {
  const [showEditModal, setShowEditModal] = useState(false);
  const [editedMessage, setEditedMessage] = useState("");
  const [showMatchingDetails, setShowMatchingDetails] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showRejectTextarea, setShowRejectTextarea] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const { pushToast } = useToast();

  const suggestedMessage = resolveSuggestedMessage(task);
  const taskAny = task as any;
  const jobMatches: JobMatchesData | null = taskAny.payload?.jobMatches || null;
  const topMatches = jobMatches?.matches?.slice(0, 3) || [];

  // Initialize edited message when opening modal
  const handleEditClick = () => {
    setEditedMessage(suggestedMessage || "");
    setShowEditModal(true);
  };

  const handleCopy = () => {
    const textToCopy = editedMessage || suggestedMessage || "";
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
      // Could add a toast notification here
    }
  };

  const handleApprove = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    try {
      const taskId = task.id || task.taskId;
      if (!taskId) {
        throw new Error("Task ID not found");
      }

      // Determine if we should send messageOverride
      const hasEditedMessage = editedMessage && editedMessage.trim() !== "";
      const messageDiffers = hasEditedMessage && editedMessage !== suggestedMessage;
      const messageOverride = messageDiffers ? editedMessage : undefined;

      await approveTask(taskId, messageOverride);
      
      // Close edit modal if open
      setShowEditModal(false);
      
      // Show success toast
      pushToast({
        variant: "success",
        title: `Message sent to ${candidateName}`,
        confirmation: "✓ Sent successfully",
        outcome: "Task completed",
        nextAction: "→ Continue conversation",
      });
      
      // Call callback to refetch data
      onApproved();
    } catch (error) {
      console.error("Failed to approve:", error);
      
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
      
      // Do NOT call onApproved on error - preserve UI state
    } finally {
      setIsLoading(false);
    }
  };

  const handleReject = async () => {
    if (isLoading) return;
    
    // This is called when user clicks "✓ Confirm Rejection"
    // Textarea should already be shown (via onRejectConfirm)
    setIsLoading(true);
    try {
      const taskId = task.id || task.taskId;
      if (!taskId) {
        throw new Error("Task ID not found");
      }

      const rejectionReason = rejectReason.trim() || undefined;
      await rejectTask(taskId, rejectionReason);
      
      // Reset reject UI
      setShowRejectTextarea(false);
      setRejectReason("");
      
      // Show info toast
      pushToast({
        variant: "info",
        title: "Message discarded",
        confirmation: "✓ Suggestion rejected",
        outcome: "Task marked rejected",
        nextAction: "→ Review next approval",
      });
      
      // Call callback to refetch data
      onRejected();
    } catch (error) {
      console.error("Failed to reject:", error);
      
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
      
      // Do NOT call onRejected on error - preserve UI state
      throw error; // Re-throw to let TwoStepConfirmButtons handle it
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-muted/30 border rounded-lg p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-foreground">AI Suggested Response</h3>
          {task.approvalStatus === "PENDING" && (
            <Badge variant="secondary" className="bg-yellow-50 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400">
              PENDING APPROVAL
            </Badge>
          )}
        </div>
      </div>

      {/* Suggested Message */}
      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          Suggested Message
        </div>
        {suggestedMessage ? (
          <div className="bg-background border rounded-lg p-4">
            <div className="text-sm whitespace-pre-wrap break-words text-foreground leading-relaxed">
              {suggestedMessage}
            </div>
          </div>
        ) : (
          <div className="bg-background border rounded-lg p-4 text-sm text-muted-foreground italic">
            No suggested reply yet
          </div>
        )}
      </div>

      {/* Explainability Panel (minimal) */}
      <ExplainabilityPanel
        explainability={taskAny.proposedAction?.explainability || taskAny.payload?.proposedAction?.explainability}
        riskLevel={task.riskLevel || null}
        suggestedMessage={suggestedMessage}
      />

      {/* Matched Jobs Section */}
      {topMatches.length > 0 && (
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Matched Jobs ({topMatches.length})
          </div>
          <div className="space-y-3">
            {topMatches.map((match) => (
              <div key={match.jobId} className="bg-background border rounded-lg p-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-sm font-semibold text-foreground">{match.title}</h4>
                      {match.status === "URGENT" && (
                        <Badge variant="destructive" className="text-xs">URGENT</Badge>
                      )}
                      <Badge variant="outline" className="text-xs">
                        {match.scorePct}% match
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div>Start: {formatDate(match.startDate)}</div>
                      {match.durationWeeks && (
                        <div>Duration: {match.durationWeeks} weeks</div>
                      )}
                      {match.payRate && (
                        <div>Pay: {formatCurrency(match.payRate, match.currency)}/hr</div>
                      )}
                    </div>
                  </div>
                </div>
                {match.highlights && match.highlights.length > 0 && (
                  <div className="mt-2">
                    <ul className="text-xs text-muted-foreground space-y-0.5">
                      {match.highlights.map((highlight, idx) => (
                        <li key={idx} className="flex items-start gap-1.5">
                          <span className="text-foreground mt-0.5">•</span>
                          <span>{highlight}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Collapsible Matching Details */}
      {jobMatches && (jobMatches.matches.length > 0 || jobMatches.excluded.length > 0) && (
        <div>
          <button
            onClick={() => setShowMatchingDetails(!showMatchingDetails)}
            className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>{showMatchingDetails ? "▼" : "▶"}</span>
            <span>How AI matched these jobs</span>
          </button>
          {showMatchingDetails && (
            <div className="mt-3 space-y-4 pl-4 border-l-2 border-muted">
              {/* Match Reasons */}
              {topMatches.map((match) => (
                <div key={match.jobId} className="space-y-1">
                  <div className="text-xs font-medium text-foreground">{match.title}</div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    {match.reasons.map((reason, idx) => (
                      <div key={idx}>
                        {reason.label}: +{reason.points} points
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              
              {/* Excluded Jobs */}
              {jobMatches.excluded && jobMatches.excluded.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    Excluded Jobs ({jobMatches.excluded.length})
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    {jobMatches.excluded.map((excluded) => (
                      <div key={excluded.jobId}>
                        <span className="font-medium">{excluded.title}</span>: {excluded.reason}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-2 pt-2 border-t">
        <div className="flex gap-2">
          <Button
            onClick={handleEditClick}
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={!suggestedMessage}
          >
            Edit Message
          </Button>
          <Button
            onClick={handleCopy}
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={!suggestedMessage && !editedMessage}
          >
            Copy
          </Button>
        </div>
        {showRejectTextarea && (
          <div className="mb-2">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Rejection Reason (optional)
            </label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Optional reason for rejection..."
              className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 mb-3"
            />
          </div>
        )}
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
            // Called when canceling - hide textarea, reset reason, but keep edited text
            setShowRejectTextarea(false);
            setRejectReason("");
            // Keep editedMessage - user can still use it if they approve later
          }}
          disabled={isLoading}
          size="sm"
        />
      </div>

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background border rounded-lg p-6 w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">Edit Message</h3>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>
            <textarea
              value={editedMessage}
              onChange={(e) => setEditedMessage(e.target.value)}
              placeholder="Enter your message..."
              className="flex-1 min-h-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0"
            />
            <div className="flex gap-2 mt-4">
              <Button
                onClick={() => setShowEditModal(false)}
                variant="outline"
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setShowEditModal(false);
                  // Edited message is already stored in state, will be used on approve
                }}
                className="flex-1 bg-green-600 text-white hover:bg-green-700"
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

