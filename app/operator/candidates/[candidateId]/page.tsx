"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getCandidateDetail, type CandidateDetailDTO } from "@/lib/api";
import { ConversationView } from "@/components/conversation/ConversationView";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft, User, MapPin, Briefcase, DollarSign, Award, Calendar, MessageSquare } from "lucide-react";
import { PersonLabel } from "@/components/common/PersonLabel";
import { getPrimaryDisplay, getSecondaryPhone } from "@/lib/displayName";

export default function CandidateProfilePage() {
  const params = useParams();
  const router = useRouter();
  const candidateId = params.candidateId as string;
  
  const [candidate, setCandidate] = useState<CandidateDetailDTO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadCandidate() {
      if (!candidateId) return;
      
      try {
        setIsLoading(true);
        setError(null);
        const data = await getCandidateDetail(candidateId);
        setCandidate(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load candidate");
      } finally {
        setIsLoading(false);
      }
    }

    loadCandidate();
  }, [candidateId]);

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const formatTime = (dateString: string): string => {
    return new Date(dateString).toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (error || !candidate) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </div>
        <div className="flex flex-col items-center justify-center py-16">
          <p className="text-sm font-medium text-foreground mb-1">
            {error || "Candidate not found"}
          </p>
          <p className="text-xs text-muted-foreground">
            {error ? "Failed to load candidate profile" : "This candidate does not exist"}
          </p>
        </div>
      </div>
    );
  }

  // Reverse messages for ConversationView (it expects ascending order)
  const messagesForView = [...candidate.recentMessages]
    .reverse()
    .map((msg) => ({
      messageId: msg.messageId,
      direction: msg.direction,
      body: msg.text,
      createdAt: msg.createdAt,
      // deliveryStatus and failureReason are not included in candidate detail DTO
      // They would need to be added to the API response if needed
    }));

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            <PersonLabel
              primary={getPrimaryDisplay({
                candidate: { name: candidate.name, phone: candidate.phone, desiredRole: candidate.desiredRole },
              })}
              phone={getSecondaryPhone({
                candidate: { name: candidate.name, phone: candidate.phone, desiredRole: candidate.desiredRole },
              })}
            />
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Candidate Profile</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Left Column: Profile Information */}
        <div className="space-y-6">
          {/* Profile Section */}
          <div className="rounded-lg border bg-card p-6">
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
                  <p className="text-sm">{candidate.yearsExperience} years</p>
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
                  <p className="text-sm">
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
          <div className="rounded-lg border bg-card p-6">
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
                <p className="text-sm text-foreground">
                  {formatDate(candidate.lastSeenAt)} ({formatTime(candidate.lastSeenAt)})
                </p>
              </div>
              {candidate.lastContactedAt && (
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Last Contacted
                    </span>
                  </div>
                  <p className="text-sm text-foreground">
                    {formatDate(candidate.lastContactedAt)} ({formatTime(candidate.lastContactedAt)})
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Conversation History */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="p-6 border-b">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Conversation History
            </h3>
          </div>
          <div className="h-[600px] overflow-hidden">
            {messagesForView.length > 0 ? (
              <ConversationView
                messages={messagesForView}
                participantPhone={candidate.phone}
                participantDisplayName={getPrimaryDisplay({
                  candidate: { name: candidate.name, phone: candidate.phone, desiredRole: candidate.desiredRole },
                })}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm text-muted-foreground">No messages yet</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

