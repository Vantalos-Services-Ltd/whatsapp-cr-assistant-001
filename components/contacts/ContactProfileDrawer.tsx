"use client";

import React, { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PersonLabel } from "@/components/common/PersonLabel";
import { getPrimaryDisplay, getSecondaryPhone, formatPhone } from "@/lib/displayName";
import { X, MessageSquare, User, MapPin, Briefcase, Award, DollarSign, Calendar, Clock, Copy, Check } from "lucide-react";
import { useState } from "react";

interface Candidate {
  name?: string | null;
  phone?: string | null;
  desiredRole?: string | null;
  location?: string | null;
  skills?: string[] | null;
  yearsExperience?: number | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string | null;
  availabilityNotes?: string | null;
}

interface ContactProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  candidate?: Candidate | null;
  candidateId?: string | null;
  status: "ACTIVE" | "PAUSED" | "DORMANT" | "PLACED";
  lastSeenAt?: string | null;
  lastMessageSnippet?: string | null;
  aiSummary?: string | null;
  onOpenMessages?: (candidateId: string | null, conversationId: string | null) => void;
  onViewCandidate?: (candidateId: string | null) => void;
}

function formatRelativeTime(dateString: string | Date | null | undefined): string {
  if (!dateString) return "—";
  
  const date = typeof dateString === "string" ? new Date(dateString) : dateString;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

function formatSalaryRange(
  min: number | null | undefined,
  max: number | null | undefined,
  currency: string | null | undefined
): string | null {
  const safeMin = typeof min === "number" && Number.isFinite(min) ? min : null;
  const safeMax = typeof max === "number" && Number.isFinite(max) ? max : null;
  
  if (safeMin === null && safeMax === null) return null;
  
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : (currency ?? "");
  
  const minStr = safeMin != null ? `${symbol}${safeMin.toLocaleString()}` : "";
  const maxStr = safeMax != null ? `${symbol}${safeMax.toLocaleString()}` : "";
  
  if (minStr && maxStr) return `${minStr} - ${maxStr}`;
  if (minStr) return `From ${minStr}`;
  if (maxStr) return `Up to ${maxStr}`;
  return null;
}

function buildSummaryLine(candidate: Candidate | null | undefined): string | null {
  if (!candidate) return null;
  
  const parts: string[] = [];
  
  // Desired role
  if (candidate.desiredRole) {
    parts.push(candidate.desiredRole);
  }
  
  // Location
  if (candidate.location) {
    parts.push(candidate.location);
  }
  
  // Years experience
  if (candidate.yearsExperience != null && typeof candidate.yearsExperience === "number" && Number.isFinite(candidate.yearsExperience)) {
    const years = candidate.yearsExperience;
    parts.push(`${years} ${years === 1 ? "yr" : "yrs"} exp`);
  }
  
  // Salary range (compact format for summary)
  const symbol = candidate.currency === "GBP" ? "£" : candidate.currency === "USD" ? "$" : (candidate.currency ?? "");
  const min = candidate.salaryMin;
  const max = candidate.salaryMax;
  
  if (min != null && max != null && Number.isFinite(min) && Number.isFinite(max)) {
    // Assume hourly if values are in reasonable hourly range (10-100), otherwise annual
    if (min >= 10 && min <= 100 && max >= 10 && max <= 100) {
      parts.push(`${symbol}${min}–${symbol}${max}/hr`);
    } else {
      // Annual - show in thousands
      const minK = Math.round(min / 1000);
      const maxK = Math.round(max / 1000);
      parts.push(`${symbol}${minK}k–${symbol}${maxK}k`);
    }
  } else if (min != null && Number.isFinite(min)) {
    if (min >= 10 && min <= 100) {
      parts.push(`From ${symbol}${min}/hr`);
    } else {
      parts.push(`From ${symbol}${Math.round(min / 1000)}k`);
    }
  } else if (max != null && Number.isFinite(max)) {
    if (max >= 10 && max <= 100) {
      parts.push(`Up to ${symbol}${max}/hr`);
    } else {
      parts.push(`Up to ${symbol}${Math.round(max / 1000)}k`);
    }
  }
  
  // Availability notes (truncate if too long, keep first sentence or first 50 chars)
  if (candidate.availabilityNotes) {
    const availability = candidate.availabilityNotes.trim();
    if (availability.length > 50) {
      // Try to extract first sentence
      const firstSentence = availability.split(/[.!?]/)[0].trim();
      if (firstSentence.length > 0 && firstSentence.length <= 50) {
        parts.push(firstSentence);
      } else {
        // Fallback to first 50 chars
        parts.push(availability.substring(0, 47) + "...");
      }
    } else {
      parts.push(availability);
    }
  }
  
  if (parts.length === 0) return null;
  
  // Join with middle dot separator
  return parts.join(" · ");
}

export function ContactProfileDrawer({
  isOpen,
  onClose,
  candidate,
  candidateId,
  status,
  lastSeenAt,
  lastMessageSnippet,
  aiSummary,
  onOpenMessages,
  onViewCandidate,
}: ContactProfileDrawerProps) {
  const [copied, setCopied] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  // Handle animation
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
    } else {
      // Delay hiding to allow slide-out animation
      const timer = setTimeout(() => setIsVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isVisible) return null;

  // Build primary display
  const primaryDisplay = getPrimaryDisplay({
    candidate: candidate ? {
      name: candidate.name,
      desiredRole: candidate.desiredRole,
      phone: candidate.phone,
    } : undefined,
  });

  const secondaryPhone = getSecondaryPhone({
    candidate: candidate ? { phone: candidate.phone } : undefined,
  });

  // Status chip styling
  const statusConfig = {
    ACTIVE: {
      label: "Active",
      className: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-400",
    },
    PAUSED: {
      label: "Paused",
      className: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400",
    },
    DORMANT: {
      label: "Dormant",
      className: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400",
    },
    PLACED: {
      label: "Placed",
      className: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400",
    },
  };

  const statusInfo = statusConfig[status];

  const handleCopyPhone = async () => {
    if (candidate?.phone) {
      const formatted = formatPhone(candidate.phone);
      try {
        await navigator.clipboard.writeText(formatted);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error("Failed to copy phone:", err);
      }
    }
  };

  const salaryRange = formatSalaryRange(
    candidate?.salaryMin ?? null,
    candidate?.salaryMax ?? null,
    candidate?.currency ?? "GBP"
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className={`fixed right-0 top-0 h-full w-full max-w-[480px] bg-background shadow-xl z-50 flex flex-col transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b flex-shrink-0">
          <div className="flex-1 min-w-0">
            <div id="drawer-title" className="flex items-center gap-2 flex-wrap mb-2">
              <PersonLabel
                primary={primaryDisplay}
                phone={secondaryPhone || undefined}
              />
              <Badge variant="outline" className={`text-xs flex-shrink-0 ${statusInfo.className}`}>
                {statusInfo.label}
              </Badge>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label="Close drawer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Summary Line */}
          {(() => {
            const summaryLine = buildSummaryLine(candidate);
            return summaryLine ? (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Summary</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{summaryLine}</p>
              </div>
            ) : null;
          })()}

          {/* AI Summary (if provided) */}
          {aiSummary && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">AI Summary</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{aiSummary}</p>
            </div>
          )}

          {/* Key Fields */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Details</h3>
            
            <div className="space-y-3">
              {/* Location */}
              {candidate?.location && (
                <div className="flex items-start gap-3">
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground mb-0.5">Location</div>
                    <div className="text-sm text-foreground">{candidate.location}</div>
                  </div>
                </div>
              )}

              {/* Role */}
              {candidate?.desiredRole && (
                <div className="flex items-start gap-3">
                  <Briefcase className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground mb-0.5">Desired Role</div>
                    <div className="text-sm text-foreground">{candidate.desiredRole}</div>
                  </div>
                </div>
              )}

              {/* Skills */}
              {candidate?.skills && candidate.skills.length > 0 && (
                <div className="flex items-start gap-3">
                  <Award className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground mb-1.5">Skills</div>
                    <div className="flex flex-wrap gap-1.5">
                      {candidate.skills.map((skill, idx) => (
                        <Badge key={idx} variant="secondary" className="text-xs">
                          {skill}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Years Experience */}
              {candidate?.yearsExperience != null && (
                <div className="flex items-start gap-3">
                  <Award className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground mb-0.5">Experience</div>
                    <div className="text-sm text-foreground">
                      {candidate.yearsExperience} {candidate.yearsExperience === 1 ? "year" : "years"}
                    </div>
                  </div>
                </div>
              )}

              {/* Salary Range */}
              {salaryRange && (
                <div className="flex items-start gap-3">
                  <DollarSign className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground mb-0.5">Salary Range</div>
                    <div className="text-sm text-foreground">{salaryRange}</div>
                  </div>
                </div>
              )}

              {/* Availability Notes */}
              {candidate?.availabilityNotes && (
                <div className="flex items-start gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground mb-0.5">Availability</div>
                    <div className="text-sm text-foreground">{candidate.availabilityNotes}</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Last Seen */}
          {lastSeenAt && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">Last Seen</h3>
              </div>
              <p className="text-sm text-muted-foreground pl-6">
                <span suppressHydrationWarning>{formatRelativeTime(lastSeenAt)}</span>
              </p>
            </div>
          )}

          {/* Last Message */}
          {lastMessageSnippet && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Last Message</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{lastMessageSnippet}</p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="border-t p-6 flex flex-col gap-2 flex-shrink-0">
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              onOpenMessages?.(candidateId ?? null, null);
              onClose();
            }}
            className="w-full"
          >
            <MessageSquare className="h-4 w-4 mr-2" />
            Open Messages
          </Button>
          
          {candidateId && onViewCandidate && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onViewCandidate(candidateId);
                onClose();
              }}
              className="w-full"
            >
              <User className="h-4 w-4 mr-2" />
              View Candidate
            </Button>
          )}

          {candidate?.phone && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyPhone}
              className="w-full"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Phone
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

