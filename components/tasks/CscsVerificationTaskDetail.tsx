"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import type { TaskListItemDTO } from "@/shared/dto/operator";
import { approveTask, rejectTask, verifyCscs, getTasks, ApiError } from "@/lib/api";
import { useToast } from "@/components/toast";
import type { CscsVerificationPayload } from "@/shared/types/cscs";
import { X, ZoomIn } from "lucide-react";
import { TwoStepConfirmButtons } from "@/components/common/TwoStepConfirmButtons";
import { PersonLabel } from "@/components/common/PersonLabel";
import { getPrimaryDisplay, getSecondaryPhone } from "@/lib/displayName";

interface CscsVerificationTaskDetailProps {
  task: TaskListItemDTO & {
    payload?: any; // Full payload including CscsVerificationPayload
  };
  onActionComplete: (actionType: "approved" | "rejected") => void;
  onTaskUpdate?: (updatedTask: TaskListItemDTO & { payload?: any }) => void;
}

/**
 * Format date for display
 */
function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "TBD";
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateString;
  }
}

/**
 * Format currency amount
 */
function formatCurrency(amount: number | null | undefined, currency: string = "GBP"): string {
  if (amount === null || amount === undefined) return "—";
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency;
  return `${symbol}${amount.toLocaleString()}`;
}

/**
 * Get badge color for overall verification status
 */
function getOverallBadgeColor(overall: "VALID" | "INVALID" | "UNKNOWN"): string {
  switch (overall) {
    case "VALID":
      return "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400";
    case "INVALID":
      return "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400";
    case "UNKNOWN":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400";
  }
}

export function CscsVerificationTaskDetail({
  task,
  onActionComplete,
  onTaskUpdate,
}: CscsVerificationTaskDetailProps) {
  const [showRejectTextarea, setShowRejectTextarea] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingVerification, setIsSavingVerification] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const { pushToast } = useToast();
  const router = useRouter();

  // Verification form state
  const [holderName, setHolderName] = useState("");
  const [cardType, setCardType] = useState<string>("");
  const [expiryDate, setExpiryDate] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [nameMatchOk, setNameMatchOk] = useState(false);
  const [expiryValidOk, setExpiryValidOk] = useState(false);
  const [requiredLevelOk, setRequiredLevelOk] = useState(true);
  
  // Track manual edits to prevent auto-sync from overriding user changes
  const [isDirty, setIsDirty] = useState({
    nameMatch: false,
    expiryValid: false,
    requiredLevel: false,
  });

  // Local task state (updated when verification is saved or task prop changes)
  const [localTask, setLocalTask] = useState(task);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollingStartTimeRef = useRef<number>(Date.now());
  const MAX_POLLING_DURATION = 30_000; // 30 seconds max

  // Update local task when prop changes (e.g., from parent refresh)
  useEffect(() => {
    setLocalTask(task);
    pollingStartTimeRef.current = Date.now(); // Reset polling timer when task changes
    // Reset dirty flags when task changes (e.g., after auto verification)
    setIsDirty({
      nameMatch: false,
      expiryValid: false,
      requiredLevel: false,
    });
  }, [task]);

  // Parse payload
  const payload = localTask.payload as CscsVerificationPayload | undefined;
  
  if (!payload) {
    return (
      <div className="flex w-96 flex-col border-l bg-background p-6">
        <p className="text-sm text-muted-foreground">Task payload not available</p>
      </div>
    );
  }

  const { candidate, job, cscs, nextSteps } = payload;

  // Check if verification has been saved (has checks object with overall status)
  const hasVerification = cscs?.checks && cscs.checks.overall !== undefined;
  const overallStatus = cscs?.checks?.overall as "VALID" | "INVALID" | "UNKNOWN" | undefined;
  
  // Determine action button states based on overall status
  const canApprove = localTask.status === "OPEN" && localTask.type === "CSCS_VERIFICATION" && hasVerification && overallStatus === "VALID";
  const canReject = localTask.status === "OPEN" && localTask.type === "CSCS_VERIFICATION" && hasVerification && (overallStatus === "VALID" || overallStatus === "INVALID");
  const showApprove = overallStatus === "VALID";
  const showReject = overallStatus === "VALID" || overallStatus === "INVALID";
  
  // Auto-generate rejection reason from issues when INVALID
  const getAutoRejectionReason = (): string => {
    if (overallStatus === "INVALID" && cscs.checks.issues && cscs.checks.issues.length > 0) {
      return `CSCS verification failed: ${cscs.checks.issues.join("; ")}`;
    }
    return "Rejected by operator";
  };

  // Initialize form from existing extracted data
  useEffect(() => {
    if (cscs.extracted) {
      setHolderName(cscs.extracted.holderName || "");
      setCardType(cscs.extracted.cardType || "");
      setExpiryDate(cscs.extracted.expiryDate || "");
      setCardNumber(cscs.extracted.cardNumber || "");
    }
  }, [cscs.extracted]);

  // Auto-sync checkboxes from computed verification results
  // Only update if user hasn't manually edited
  useEffect(() => {
    if (cscs.checks) {
      if (!isDirty.nameMatch) {
        setNameMatchOk(cscs.checks.nameMatch?.ok || false);
      }
      if (!isDirty.expiryValid) {
        setExpiryValidOk(cscs.checks.expiryValid?.ok || false);
      }
      if (!isDirty.requiredLevel) {
        setRequiredLevelOk(cscs.checks.requiredLevel?.ok ?? true);
      }
    }
  }, [cscs.checks, isDirty]);

  // Poll for auto verification updates when overall is UNKNOWN
  useEffect(() => {
    const overall = cscs?.checks?.overall;
    const isUnknown = overall === "UNKNOWN" || overall === undefined;
    const hasAutoVerified = cscs?.autoVerified === true;
    const elapsed = Date.now() - pollingStartTimeRef.current;

    // Only poll if:
    // - Status is UNKNOWN (waiting for auto verify)
    // - Not already auto verified (still processing)
    // - Within max polling duration
    if (isUnknown && !hasAutoVerified && elapsed < MAX_POLLING_DURATION) {
      // Poll every 2 seconds
      pollingIntervalRef.current = setInterval(async () => {
        try {
          // Refetch pending tasks and find matching task
          const tasks = await getTasks("pending");
          const updatedTask = tasks.find((t) => t.taskId === localTask.taskId);
          
          if (updatedTask && updatedTask.payload) {
            const updatedPayload = updatedTask.payload as CscsVerificationPayload;
            const updatedOverall = updatedPayload.cscs?.checks?.overall;
            const updatedAutoVerified = updatedPayload.cscs?.autoVerified === true;
            
            // Update if:
            // 1. Status changed from UNKNOWN (VALID/INVALID)
            // 2. Auto verified flag appeared (even if still UNKNOWN - shows error badge)
            if ((updatedOverall && updatedOverall !== "UNKNOWN") || updatedAutoVerified) {
              setLocalTask(updatedTask as any);
              if (onTaskUpdate) {
                onTaskUpdate(updatedTask as any);
              }
              // Stop polling once we have a result
              if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
              }
            }
          }
        } catch (error) {
          console.warn("Failed to poll for task updates:", error);
        }
      }, 2000); // Poll every 2 seconds
    }

    // Cleanup on unmount or when status changes
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [cscs?.checks?.overall, cscs?.autoVerified, localTask.taskId, onTaskUpdate]);

  const handleSaveVerification = async () => {
    if (isSavingVerification) return;

    setIsSavingVerification(true);
    try {
      const response = await verifyCscs(localTask.taskId, {
        extracted: {
          holderName: holderName.trim() || undefined,
          cardType: cardType || undefined,
          expiryDate: expiryDate || undefined,
          cardNumber: cardNumber.trim() || undefined,
        },
        checks: {
          nameMatchOk,
          expiryValidOk,
          requiredLevelOk,
        },
      });

      // Update local task state with new payload
      const updatedTask = {
        ...localTask,
        payload: response.payload,
      };
      setLocalTask(updatedTask);

      // Notify parent if callback provided
      if (onTaskUpdate) {
        onTaskUpdate(updatedTask);
      }

      pushToast({
        variant: "success",
        title: "Verification saved",
        confirmation: "✓ Confirmation: Verification data saved",
        outcome: "📋 Outcome: CSCS verification details have been updated",
        nextAction: "→ Continue reviewing",
      });
    } catch (error) {
      console.error("Failed to save verification:", error);
      
      let errorMessage = "An unexpected error occurred";
      if (error instanceof ApiError) {
        errorMessage = error.message || "Failed to save verification";
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      pushToast({
        variant: "error",
        title: "Failed to save verification",
        confirmation: "✗ Confirmation: Could not save verification",
        outcome: `📋 Outcome: ${errorMessage}`,
        nextAction: {
          label: "→ Next: Retry saving",
          onClick: () => {
            handleSaveVerification();
          },
        },
      });
    } finally {
      setIsSavingVerification(false);
    }
  };

  const handleApprove = async () => {
    if (isLoading) return;
    
    // Check if verification is valid (should be disabled in UI, but double-check)
    if (overallStatus !== "VALID") {
      pushToast({
        variant: "warning",
        title: "Cannot approve",
        confirmation: "⚠ Confirmation: Verification must be valid",
        outcome: "📋 Outcome: Please complete verification and ensure all checks pass before approving",
        nextAction: "→ Next: Review verification",
      });
      return;
    }
    
    setIsLoading(true);
    try {
      await approveTask(localTask.taskId);
      
      // Show success toast
      pushToast({
        variant: "success",
        title: "Placement confirmed",
        confirmation: "✓ Confirmation: Candidate notified",
        outcome: "📋 Outcome: Placement has been confirmed and candidate has been notified",
        nextAction: {
          label: "→ Next: Review next task",
          onClick: () => {
            router.push("/operator/inbox");
          },
        },
      });
      
      onActionComplete("approved");
    } catch (error) {
      console.error("Failed to approve task:", error);
      
      let errorMessage = "An unexpected error occurred";
      if (error instanceof ApiError) {
        errorMessage = error.message || "Failed to approve task";
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      pushToast({
        variant: "error",
        title: "Action failed",
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
    
    // Determine rejection reason:
    // 1. Use operator-entered reason if provided
    // 2. Use auto-generated reason if INVALID
    // 3. Use default fallback
    const finalReason = rejectReason?.trim() || (overallStatus === "INVALID" ? getAutoRejectionReason() : "Rejected by operator");

    setIsLoading(true);
    try {
      await rejectTask(localTask.taskId, finalReason);
      
      // Show warning toast
      pushToast({
        variant: "warning",
        title: "Placement not confirmed",
        confirmation: "⚠ Confirmation: Requested updated CSCS",
        outcome: "📋 Outcome: Candidate has been requested to provide an updated CSCS card",
        nextAction: {
          label: "→ Next: Await candidate response",
          onClick: () => {
            router.push("/operator/inbox");
          },
        },
      });
      
      onActionComplete("rejected");
    } catch (error) {
      console.error("Failed to reject task:", error);
      
      let errorMessage = "An unexpected error occurred";
      if (error instanceof ApiError) {
        errorMessage = error.message || "Failed to reject task";
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      
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

  return (
    <div className="flex w-[500px] flex-col border-l bg-background overflow-y-auto">
      <div className="border-b px-6 py-4">
        <h3 className="text-lg font-semibold text-foreground">CSCS Verification</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* 1. Candidate Summary */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">
            Candidate
          </h4>
          <div className="bg-muted/30 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <PersonLabel
                primary={getPrimaryDisplay({
                  candidate: { name: candidate.name, phone: candidate.phone, desiredRole: candidate.desiredRole },
                })}
                phone={getSecondaryPhone({
                  candidate: { name: candidate.name, phone: candidate.phone, desiredRole: candidate.desiredRole },
                })}
                className="text-sm font-medium"
              />
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              {candidate.desiredRole && <div>Role: {candidate.desiredRole}</div>}
              {candidate.location && <div>Location: {candidate.location}</div>}
              {candidate.availabilityNotes && (
                <div>Availability: {candidate.availabilityNotes}</div>
              )}
            </div>
          </div>
        </div>

        {/* 2. Selected Job Summary */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">
            Selected Job
          </h4>
          <div className="bg-muted/30 rounded-lg p-4 space-y-2">
            <div className="text-sm font-medium text-foreground">{job.title}</div>
            <div className="text-xs text-muted-foreground space-y-1">
              {job.siteName && <div>Site: {job.siteName}</div>}
              {job.clientName && <div>Client: {job.clientName}</div>}
              {job.startDate && <div>Start: {formatDate(job.startDate)}</div>}
              {job.durationWeeks && <div>Duration: {job.durationWeeks} weeks</div>}
              {(job.city || job.postcode) && (
                <div>Location: {[job.city, job.postcode].filter(Boolean).join(", ")}</div>
              )}
            </div>
          </div>
        </div>

        {/* 3. Margin Box */}
        {(job.marginPerHour !== undefined || job.weeklyMargin !== undefined || job.projectMargin !== undefined) && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">
              Margins
            </h4>
            <div className="bg-muted/30 rounded-lg p-4 space-y-2">
              {job.marginPerHour !== undefined && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Margin/Hour:</span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(job.marginPerHour, job.currency)}
                  </span>
                </div>
              )}
              {job.weeklyMargin !== undefined && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Weekly Margin:</span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(job.weeklyMargin, job.currency)}
                  </span>
                </div>
              )}
              {job.projectMargin !== undefined && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Project Margin:</span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(job.projectMargin, job.currency)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 4. CSCS Card Preview */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">
            CSCS Card
          </h4>
          <div className="bg-muted/30 rounded-lg p-4 space-y-3">
            {/* Primary image (from cscs.imageUrl) */}
            {cscs.imageUrl && (
              <div className="relative group cursor-pointer" onClick={() => setShowImageModal(true)}>
                <img
                  src={cscs.imageUrl}
                  alt="CSCS Card"
                  className="w-full rounded-lg border border-border object-contain max-h-64 bg-white"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded-lg flex items-center justify-center">
                  <ZoomIn className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            )}
            
            {/* Additional attached images from mediaUrls */}
            {cscs.mediaUrls && Array.isArray(cscs.mediaUrls) && cscs.mediaUrls.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">
                  Additional Images ({cscs.mediaUrls.length})
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {cscs.mediaUrls.map((mediaItem: any, idx: number) => (
                    <div
                      key={mediaItem.sid || idx}
                      className="relative group cursor-pointer"
                      onClick={() => setShowImageModal(true)}
                    >
                      <img
                        src={mediaItem.url}
                        alt={`CSCS card image ${idx + 1}`}
                        className="w-full rounded-lg border border-border object-contain max-h-32 bg-white"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded-lg flex items-center justify-center">
                        <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <div className="text-xs text-muted-foreground">
              Source: {cscs.source === "WHATSAPP" ? "WhatsApp" : "Operator Upload"}
            </div>
          </div>
        </div>

        {/* 4.5. Verification Form */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">
              Verification
            </h4>
            {cscs.autoVerified && (
              <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400 text-xs">
                Auto verified
                {cscs.autoVerifiedAt && (
                  <span className="ml-1 text-[10px] opacity-75">
                    {new Date(cscs.autoVerifiedAt).toLocaleTimeString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </Badge>
            )}
            {cscs.autoVerifyError && (
              <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400 text-xs">
                Auto verify failed
              </Badge>
            )}
          </div>
          {cscs.autoVerifyError && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-amber-300 dark:border-yellow-800 rounded-md p-2">
              <p className="text-xs text-amber-900 dark:text-yellow-400">
                {cscs.autoVerifyError}
              </p>
            </div>
          )}
          <div className="bg-muted/30 rounded-lg p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-foreground mb-1.5 block">
                  Holder Name
                </label>
                <Input
                  type="text"
                  value={holderName}
                  onChange={(e) => setHolderName(e.target.value)}
                  placeholder="Enter name on card"
                  className="w-full text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1.5 block">
                  Card Type
                </label>
                <select
                  value={cardType}
                  onChange={(e) => setCardType(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0"
                >
                  <option value="">Select type</option>
                  <option value="Green">Green</option>
                  <option value="Blue">Blue</option>
                  <option value="Gold">Gold</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-foreground mb-1.5 block">
                  Expiry Date
                </label>
                <Input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-foreground mb-1.5 block">
                  Card Number (optional)
                </label>
                <Input
                  type="text"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  placeholder="Enter card number"
                  className="w-full text-sm"
                />
              </div>
            </div>
            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="name-match"
                  checked={nameMatchOk}
                  onChange={(e) => {
                    setNameMatchOk(e.target.checked);
                    setIsDirty((prev) => ({ ...prev, nameMatch: true }));
                  }}
                />
                <label htmlFor="name-match" className="text-sm text-foreground cursor-pointer">
                  Name matches candidate
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="expiry-valid"
                  checked={expiryValidOk}
                  onChange={(e) => {
                    setExpiryValidOk(e.target.checked);
                    setIsDirty((prev) => ({ ...prev, expiryValid: true }));
                  }}
                />
                <label htmlFor="expiry-valid" className="text-sm text-foreground cursor-pointer">
                  Expiry valid
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="required-level"
                  checked={requiredLevelOk}
                  onChange={(e) => {
                    setRequiredLevelOk(e.target.checked);
                    setIsDirty((prev) => ({ ...prev, requiredLevel: true }));
                  }}
                />
                <label htmlFor="required-level" className="text-sm text-foreground cursor-pointer">
                  Level meets requirement
                </label>
              </div>
            </div>
            <Button
              onClick={handleSaveVerification}
              disabled={isSavingVerification}
              variant="outline"
              className="w-full"
            >
              {isSavingVerification ? "Saving..." : "Save Verification"}
            </Button>
          </div>
        </div>

        {/* 5. Verification Checklist */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">
            Verification Status
          </h4>
          <div className="bg-muted/30 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">Overall Status:</span>
              <Badge className={getOverallBadgeColor(cscs.checks.overall)}>
                {cscs.checks.overall}
              </Badge>
            </div>
            
            {cscs.checks.nameMatch && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Name Match:</span>
                <span className={cscs.checks.nameMatch.ok ? "text-green-600" : "text-red-600"}>
                  {cscs.checks.nameMatch.ok ? "✓ Match" : "✗ No Match"}
                </span>
              </div>
            )}
            
            {cscs.checks.expiryValid && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Expiry Valid:</span>
                <span className={cscs.checks.expiryValid.ok ? "text-green-600" : "text-red-600"}>
                  {cscs.checks.expiryValid.ok ? "✓ Valid" : "✗ Invalid"}
                </span>
              </div>
            )}

            {cscs.checks.requiredLevel && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Level Meets Requirement:</span>
                <span className={cscs.checks.requiredLevel.ok ? "text-green-600" : "text-red-600"}>
                  {cscs.checks.requiredLevel.ok ? "✓ Valid" : "✗ Invalid"}
                </span>
              </div>
            )}

            {cscs.checks.issues && cscs.checks.issues.length > 0 && (
              <div className="space-y-1 pt-2 border-t">
                <div className="text-xs font-medium text-red-600 dark:text-red-400">Issues:</div>
                <ul className="text-xs text-red-600 dark:text-red-400 space-y-1 list-disc list-inside">
                  {cscs.checks.issues.map((issue, idx) => (
                    <li key={idx}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* 6. Approve / Reject Buttons */}
        <div className="space-y-3">
          {/* Show rejection reason textarea only for VALID status (optional) */}
          {showRejectTextarea && overallStatus === "VALID" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Rejection Reason (optional)
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Enter reason for rejection (optional)..."
                className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0"
              />
            </div>
          )}
          
          {/* Show auto-generated reason preview for INVALID status */}
          {overallStatus === "INVALID" && (
            <div className="bg-muted/30 rounded-lg p-3">
              <p className="text-xs font-medium text-foreground mb-1">Rejection Reason:</p>
              <p className="text-xs text-muted-foreground">{getAutoRejectionReason()}</p>
            </div>
          )}
          
          <div className="flex flex-col gap-2">
            {!hasVerification && (
              <p className="text-xs text-amber-800 dark:text-yellow-400 text-center bg-yellow-50 dark:bg-yellow-900/20 border border-amber-300 dark:border-yellow-800 rounded-md p-2">
                Save verification to enable approval
              </p>
            )}
            {hasVerification && overallStatus === "UNKNOWN" && (
              <p className="text-xs text-amber-800 dark:text-yellow-400 text-center bg-yellow-50 dark:bg-yellow-900/20 border border-amber-300 dark:border-yellow-800 rounded-md p-2">
                Complete verification and ensure all checks pass
              </p>
            )}
            {showApprove || showReject ? (
              <TwoStepConfirmButtons
                onApprove={showApprove ? handleApprove : undefined}
                onReject={showReject ? (() => {
                  if (overallStatus === "VALID" && !showRejectTextarea) {
                    // For VALID, show textarea first
                    setShowRejectTextarea(true);
                  } else {
                    // For INVALID or VALID with textarea shown, reject immediately
                    handleReject();
                  }
                }) : undefined}
                disabled={isLoading || (showApprove && !canApprove) || (showReject && !canReject) || (showRejectTextarea && overallStatus === "VALID" && (!rejectReason || rejectReason.trim().length === 0))}
              />
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground">Actions unavailable</p>
              </div>
            )}
            {hasVerification && overallStatus === "INVALID" && (
              <p className="text-xs text-muted-foreground text-center">
                Verification failed. Reject to request an updated CSCS card from the candidate.
              </p>
            )}
          </div>
        </div>

        {/* 7. "What happens next" box */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">
            What Happens Next
          </h4>
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-2">
            <div className="text-sm text-foreground">
              <div className="font-medium mb-1">If approved:</div>
              <div className="text-muted-foreground">
                {nextSteps?.approveText || "Placement will be confirmed and candidate will receive a confirmation message."}
              </div>
            </div>
            <div className="text-sm text-foreground">
              <div className="font-medium mb-1">If rejected:</div>
              <div className="text-muted-foreground">
                {nextSteps?.rejectText || "Candidate will be asked to provide a new CSCS card photo."}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Image Modal */}
      {showImageModal && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setShowImageModal(false)}
        >
          <div className="relative max-w-4xl max-h-[90vh] bg-white rounded-lg overflow-hidden">
            <button
              onClick={() => setShowImageModal(false)}
              className="absolute top-4 right-4 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
            <img
              src={cscs.imageUrl}
              alt="CSCS Card - Full Size"
              className="w-full h-full object-contain max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
}

