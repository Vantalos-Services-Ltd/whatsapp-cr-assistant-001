"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PersonLabel } from "@/components/common/PersonLabel";
import { getPrimaryDisplay, getSecondaryPhone } from "@/lib/displayName";
import { MessageSquare, User, MapPin, DollarSign, Calendar } from "lucide-react";
import type { ConversationListItemDTO } from "@/lib/api";

interface Candidate {
  name?: string | null;
  phone?: string | null;
  desiredRole?: string | null;
  location?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  currency?: string | null;
  availabilityNotes?: string | null;
}

interface ContactCardProps {
  candidate?: Candidate | null;
  candidateId?: string | null;
  lastConversation?: ConversationListItemDTO | null;
  lastMessageSnippet?: string | null;
  status: "ACTIVE" | "PAUSED" | "DORMANT" | "PLACED";
  onOpenMessages?: (candidateId: string | null, conversationId: string | null) => void;
  onViewProfile?: (candidateId: string | null) => void;
  // Progress and Memory Pack data
  progressStage?: string;
  memorySummary?: string | null;
  followUpAt?: string | null;
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
  // Treat undefined and null the same, and ensure values are finite numbers
  const safeMin = typeof min === "number" && Number.isFinite(min) ? min : null;
  const safeMax = typeof max === "number" && Number.isFinite(max) ? max : null;
  
  if (safeMin === null && safeMax === null) return null;
  
  // Ensure symbol falls back safely
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : (currency ?? "");
  
  // Use safeMin/safeMax when formatting
  const minStr = safeMin != null ? `${symbol}${safeMin.toLocaleString()}` : "";
  const maxStr = safeMax != null ? `${symbol}${safeMax.toLocaleString()}` : "";
  
  if (minStr && maxStr) return `${minStr} - ${maxStr}`;
  if (minStr) return `From ${minStr}`;
  if (maxStr) return `Up to ${maxStr}`;
  return null;
}

export function ContactCard({
  candidate,
  candidateId,
  lastConversation,
  lastMessageSnippet,
  status,
  onOpenMessages,
  onViewProfile,
  progressStage: progressStageProp,
  memorySummary,
  followUpAt,
}: ContactCardProps) {
  // Define progressStage with fallback chain
  const progressStage = progressStageProp ?? lastConversation?.progressStage ?? status ?? null;
  
  // Build primary display using getPrimaryDisplay
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
  
  // Get last message time from conversation or use current time
  const lastMessageTime = lastConversation?.updatedAt || null;
  
  // Build secondary metadata
  const metadataItems: Array<{ icon: React.ReactNode; text: string }> = [];
  
  if (candidate?.location) {
    metadataItems.push({
      icon: <MapPin className="h-3 w-3" />,
      text: candidate.location,
    });
  }
  
  const salaryRange = formatSalaryRange(
    candidate?.salaryMin ?? null,
    candidate?.salaryMax ?? null,
    candidate?.currency ?? "GBP"
  );
  if (salaryRange) {
    metadataItems.push({
      icon: <DollarSign className="h-3 w-3" />,
      text: salaryRange,
    });
  }
  
  if (candidate?.availabilityNotes) {
    metadataItems.push({
      icon: <Calendar className="h-3 w-3" />,
      text: candidate.availabilityNotes,
    });
  }

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        {/* Header: Primary display + Status pill */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <PersonLabel
              primary={primaryDisplay}
              phone={secondaryPhone || undefined}
            />
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {progressStage && (
              <Badge variant="outline" className="text-xs bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400">
                {progressStage.split("_").map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(" ")}
              </Badge>
            )}
            <Badge variant="outline" className={`text-xs ${statusInfo.className}`}>
              {statusInfo.label}
            </Badge>
          </div>
        </div>
        
        {/* Memory summary */}
        {memorySummary && (
          <div className="text-xs text-muted-foreground line-clamp-1 mb-2">
            {memorySummary}
          </div>
        )}
        
        {/* Follow up overdue indicator */}
        {followUpAt && new Date(followUpAt) < new Date() && (
          <Badge variant="outline" className="text-xs bg-red-100 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-400 mb-2">
            Needs follow up
          </Badge>
        )}
        
        {/* Secondary metadata row */}
        {metadataItems.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mb-3">
            {metadataItems.map((item, idx) => (
              <div key={idx} className="flex items-center gap-1">
                {item.icon}
                <span>{item.text}</span>
              </div>
            ))}
          </div>
        )}
        
        {/* Last message snippet */}
        {lastMessageSnippet && (
          <div className="text-sm text-muted-foreground line-clamp-2 mb-2">
            {lastMessageSnippet}
          </div>
        )}
        
        {/* Last message time */}
        {lastMessageTime && (
          <div className="text-xs text-muted-foreground">
            <span suppressHydrationWarning>{formatRelativeTime(lastMessageTime)}</span>
          </div>
        )}
      </CardContent>
      
      {/* Footer: Quick actions */}
      <div className="pt-0 pb-4 px-4 flex gap-2 border-t">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOpenMessages?.(candidateId ?? null, lastConversation?.conversationId ?? null)}
          className="flex-1"
        >
          <MessageSquare className="h-4 w-4 mr-1.5" />
          Messages
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onViewProfile?.(candidateId ?? null)}
          className="flex-1"
        >
          <User className="h-4 w-4 mr-1.5" />
          Profile
        </Button>
      </div>
    </Card>
  );
}
