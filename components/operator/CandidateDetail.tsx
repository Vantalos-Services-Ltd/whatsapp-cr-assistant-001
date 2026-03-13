"use client";

import type { CandidateDetailDTO } from "@/lib/api";
import { Briefcase, MapPin, Award, DollarSign, Calendar, MessageSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConversationView } from "@/components/conversation/ConversationView";
import { PersonLabel } from "@/components/common/PersonLabel";
import { getPrimaryDisplay, getSecondaryPhone } from "@/lib/displayName";

interface CandidateDetailProps {
  candidate: CandidateDetailDTO | null;
  loading: boolean;
  onClose: () => void;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "Never";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

export function CandidateDetail({ candidate, loading, onClose }: CandidateDetailProps) {
  if (loading) {
    return (
      <div className="w-96 border-l bg-background p-6 overflow-y-auto">
        <div className="mb-6">
          <Skeleton className="h-8 w-32 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="space-y-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i}>
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!candidate) {
    return null;
  }

  // Reverse messages for ConversationView (it expects ascending order)
  const recentMessagesForView = [...candidate.recentMessages]
    .reverse()
    .map((msg) => ({
      messageId: msg.messageId,
      direction: msg.direction,
      body: msg.text,
      createdAt: msg.createdAt,
    }));

  return (
    <div className="w-96 border-l bg-background flex flex-col overflow-hidden">
      <div className="flex-shrink-0 border-b px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <PersonLabel
            primary={getPrimaryDisplay({
              candidate: { name: candidate.name, phone: candidate.phone, desiredRole: candidate.desiredRole },
            })}
            phone={getSecondaryPhone({
              candidate: { name: candidate.name, phone: candidate.phone, desiredRole: candidate.desiredRole },
            })}
            className="text-xl font-semibold"
          />
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Profile Section */}
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
            Profile
          </h3>
          <div className="space-y-4">
            {candidate.desiredRole && (
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Briefcase className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Desired Role
                  </span>
                </div>
                <p className="text-sm text-foreground">{candidate.desiredRole}</p>
              </div>
            )}

            {candidate.location && (
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Location
                  </span>
                </div>
                <p className="text-sm text-foreground">{candidate.location}</p>
              </div>
            )}

            {candidate.yearsExperience !== null && (
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Award className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Experience
                  </span>
                </div>
                <p className="text-sm text-foreground">{candidate.yearsExperience} years</p>
              </div>
            )}

            {candidate.salary && (candidate.salary.min || candidate.salary.max) && (
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Salary Expectations
                  </span>
                </div>
                <p className="text-sm text-foreground">
                  {candidate.salary.min && candidate.salary.max
                    ? `${candidate.salary.min} - ${candidate.salary.max}`
                    : candidate.salary.min
                    ? `${candidate.salary.min}+`
                    : `Up to ${candidate.salary.max}`}
                  {candidate.salary.currency && ` ${candidate.salary.currency}`}
                </p>
              </div>
            )}

            {candidate.skills.length > 0 && (
              <div>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-2">
                  Skills
                </span>
                <div className="flex flex-wrap gap-2">
                  {candidate.skills.map((skill, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-1 bg-muted rounded-md text-xs text-muted-foreground"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {candidate.availabilityNotes && (
              <div>
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-2">
                  Availability
                </span>
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {candidate.availabilityNotes}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Activity Section */}
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
            Activity
          </h3>
          <div className="space-y-3">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Last Seen
                </span>
              </div>
              <p className="text-sm text-foreground">{formatDate(candidate.lastSeenAt)}</p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Last Contacted
                </span>
              </div>
              <p className="text-sm text-foreground">{formatDate(candidate.lastContactedAt)}</p>
            </div>
          </div>
        </div>

        {/* Recent Messages */}
        {candidate.recentMessages.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
              Recent Messages
            </h3>
            <div className="border rounded-lg overflow-hidden">
              <ConversationView
                messages={recentMessagesForView}
                participantPhone={getPrimaryDisplay({
                  candidate: { name: candidate.name, phone: candidate.phone, desiredRole: candidate.desiredRole },
                })}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

