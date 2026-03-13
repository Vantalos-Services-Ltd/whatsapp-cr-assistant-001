"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getJobDetail, getJobMatches, markJobFilled, previewOutreach, submitOutreach, type JobDetail, type JobMatch } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/toast";
import { StartCscsVerificationModal } from "@/components/jobs/StartCscsVerificationModal";
import { PipelineTab } from "@/components/jobs/PipelineTab";
import { PersonLabel } from "@/components/common/PersonLabel";
import { getPrimaryDisplay, getSecondaryPhone } from "@/lib/displayName";

function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "ACTIVE":
      return "default";
    case "URGENT":
      return "destructive";
    case "PAUSED":
      return "secondary";
    case "FILLED":
      return "outline";
    case "CLOSED":
      return "outline";
    default:
      return "default";
  }
}

function getTierBadgeVariant(tier: string): "default" | "secondary" | "destructive" | "outline" {
  switch (tier) {
    case "PROVEN":
      return "default";
    case "EXCELLENT":
      return "default";
    case "GOOD":
      return "secondary";
    case "WEAK":
      return "outline";
    default:
      return "outline";
  }
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatCurrency(amount: number | null, currency: string): string {
  if (amount === null) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency || "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.id as string;
  const [job, setJob] = useState<JobDetail | null>(null);
  const [matches, setMatches] = useState<JobMatch[]>([]);
  const [totalAvailable, setTotalAvailable] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMatches, setIsLoadingMatches] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contactCandidate, setContactCandidate] = useState<JobMatch | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cscsCandidate, setCscsCandidate] = useState<JobMatch | null>(null);
  const { pushToast } = useToast();

  useEffect(() => {
    async function loadJob() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await getJobDetail(jobId);
        setJob(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load job");
      } finally {
        setIsLoading(false);
      }
    }

    async function loadMatches() {
      try {
        setIsLoadingMatches(true);
        const data = await getJobMatches(jobId, 8);
        setMatches(data.matches);
        setTotalAvailable(data.totalAvailable);
      } catch (err) {
        console.error("Failed to load matches:", err);
        // Don't show error for matches, just log it
      } finally {
        setIsLoadingMatches(false);
      }
    }

    if (jobId) {
      loadJob();
      loadMatches();
    }
  }, [jobId]);

  const handleMarkFilled = async () => {
    if (!job) return;
    
    try {
      await markJobFilled(jobId, true);
      // Reload job to get updated status
      const data = await getJobDetail(jobId);
      setJob(data);
    } catch (err) {
      console.error("Failed to mark job as filled:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to mark job as filled";
      alert(errorMessage);
    }
  };

  const handleContactClick = (match: JobMatch) => {
    setContactCandidate(match);
  };

  const handleContactConfirm = async () => {
    if (!contactCandidate || !job) return;

    setIsSubmitting(true);
    try {
      // Build job description from job data
      const jobDescription = [
        job.title,
        `Trade: ${job.tradeRequired}`,
        job.startDate ? `Start: ${formatDate(job.startDate)}` : null,
        job.durationWeeks ? `Duration: ${job.durationWeeks} weeks` : null,
        job.hoursPerDay && job.daysPerWeek
          ? `Hours: ${job.hoursPerDay}h/day, ${job.daysPerWeek} days/week`
          : null,
        job.city || job.postcode ? `Location: ${job.city || ""} ${job.postcode || ""}`.trim() : null,
        job.payRate ? `Pay: ${formatCurrency(job.payRate, job.currency)}` : null,
        job.notes ? `Notes: ${job.notes}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      // Step 1: Preview outreach message
      const previewResult = await previewOutreach([contactCandidate.candidateId], jobDescription);
      const preview = previewResult.previews[0];

      if (!preview) {
        throw new Error("No preview generated");
      }

      // Step 2: Submit outreach (creates task)
      await submitOutreach(
        [contactCandidate.candidateId],
        jobDescription,
        { [contactCandidate.candidateId]: preview.suggestedMessage }
      );

      // Success - close modal and show message
      setContactCandidate(null);
      alert(`Outreach task created for ${contactCandidate.displayName || getPrimaryDisplay({
        candidate: { name: contactCandidate.name, phone: contactCandidate.phone, desiredRole: contactCandidate.desiredRole },
      })}. Check the Inbox to approve and send.`);
    } catch (err) {
      console.error("Failed to send outreach:", err);
      alert(err instanceof Error ? err.message : "Failed to send outreach. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleContactCancel = () => {
    setContactCandidate(null);
  };

  const handleCscsClick = (match: JobMatch) => {
    setCscsCandidate(match);
  };

  const handleCscsClose = () => {
    setCscsCandidate(null);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-64 w-full" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.push("/operator/jobs")}
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          ← Back to Jobs
        </button>
        <div className="rounded-md border border-destructive bg-destructive/10 p-4">
          <p className="text-sm text-destructive">
            {error || "Job not found"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back Link */}
      <button
        onClick={() => router.push("/operator/jobs")}
        className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
      >
        ← Back to Jobs
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-semibold text-foreground">{job.title}</h1>
            <Badge variant={getStatusBadgeVariant(job.status)} className="text-xs">
              {job.status}
            </Badge>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{job.positionsFilled}</span> /{" "}
              <span className="font-medium text-foreground">{job.positionsOpen}</span> positions
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // TODO: Implement edit functionality
              alert("Edit functionality coming soon");
            }}
          >
            Edit
          </Button>
          {job.status !== "FILLED" && (
            <Button
              variant="default"
              size="sm"
              onClick={handleMarkFilled}
            >
              Mark as Filled
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="mt-6">
      {/* Two Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Job Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Job Details Section */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-semibold mb-4 text-foreground">Job Details</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Trade:</span>
                <span className="font-medium text-foreground">{job.tradeRequired}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Start Date:</span>
                <span className="text-foreground">{formatDate(job.startDate)}</span>
              </div>
              {job.durationWeeks && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Duration:</span>
                  <span className="text-foreground">{job.durationWeeks} weeks</span>
                </div>
              )}
              {(job.hoursPerDay || job.daysPerWeek) && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Working Hours:</span>
                  <span className="text-foreground">
                    {job.hoursPerDay ? `${job.hoursPerDay}h/day` : ""}
                    {job.hoursPerDay && job.daysPerWeek ? ", " : ""}
                    {job.daysPerWeek ? `${job.daysPerWeek} days/week` : ""}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Location Section */}
          {(job.siteName || job.addressLine1 || job.addressLine2 || job.postcode || job.city) && (
            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-semibold mb-4 text-foreground">Location</h2>
              <div className="space-y-2 text-sm">
                {job.siteName && (
                  <div>
                    <span className="text-muted-foreground">Site:</span>{" "}
                    <span className="text-foreground">{job.siteName}</span>
                  </div>
                )}
                {job.addressLine1 && (
                  <div className="text-foreground">{job.addressLine1}</div>
                )}
                {job.addressLine2 && (
                  <div className="text-foreground">{job.addressLine2}</div>
                )}
                {(job.city || job.postcode) && (
                  <div className="text-foreground">
                    {job.city && <span>{job.city}</span>}
                    {job.city && job.postcode && <span>, </span>}
                    {job.postcode && <span>{job.postcode}</span>}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Client Information Section */}
          {(job.clientName || job.clientType || job.siteManagerName || job.siteManagerPhone || job.isPremiumClient) && (
            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-semibold mb-4 text-foreground">Client Information</h2>
              <div className="space-y-2 text-sm">
                {job.clientName && (
                  <div>
                    <span className="text-muted-foreground">Client:</span>{" "}
                    <span className="text-foreground">{job.clientName}</span>
                  </div>
                )}
                {job.clientType && (
                  <div>
                    <span className="text-muted-foreground">Type:</span>{" "}
                    <span className="text-foreground">{job.clientType}</span>
                  </div>
                )}
                {job.siteManagerName && (
                  <div>
                    <span className="text-muted-foreground">Site Manager:</span>{" "}
                    <span className="text-foreground">{job.siteManagerName}</span>
                  </div>
                )}
                {job.siteManagerPhone && (
                  <div>
                    <span className="text-muted-foreground">Manager Phone:</span>{" "}
                    <span className="text-foreground">{job.siteManagerPhone}</span>
                  </div>
                )}
                {job.isPremiumClient && (
                  <div className="pt-2">
                    <Badge variant="default" className="text-xs">
                      Premium Client
                    </Badge>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Requirements Section */}
          {job.requirementsJson && Object.keys(job.requirementsJson).length > 0 && (
            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-semibold mb-4 text-foreground">Requirements</h2>
              <div className="space-y-4 text-sm">
                {job.requirementsJson.mustHave && Array.isArray(job.requirementsJson.mustHave) && job.requirementsJson.mustHave.length > 0 && (
                  <div>
                    <h3 className="font-medium text-foreground mb-2">Must Have</h3>
                    <ul className="space-y-2">
                      {job.requirementsJson.mustHave.map((item: any, idx: number) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-green-600 dark:text-green-400 mt-0.5 shrink-0">✓</span>
                          <div className="flex-1">
                            {item.label && (
                              <span className="font-medium text-foreground">{item.label}: </span>
                            )}
                            <span className="text-muted-foreground">{item.value || item}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {job.requirementsJson.preferred && Array.isArray(job.requirementsJson.preferred) && job.requirementsJson.preferred.length > 0 && (
                  <div>
                    <h3 className="font-medium text-foreground mb-2">Preferred</h3>
                    <ul className="space-y-2">
                      {job.requirementsJson.preferred.map((item: any, idx: number) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-foreground mt-0.5 shrink-0">•</span>
                          <div className="flex-1">
                            {item.label && (
                              <span className="font-medium text-foreground">{item.label}: </span>
                            )}
                            <span className="text-muted-foreground">{item.value || item}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {job.requirementsJson.notes && Array.isArray(job.requirementsJson.notes) && job.requirementsJson.notes.length > 0 && (
                  <div>
                    <h3 className="font-medium text-foreground mb-2">Notes</h3>
                    <ul className="space-y-2">
                      {job.requirementsJson.notes.map((note: string, idx: number) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-foreground mt-0.5 shrink-0">•</span>
                          <span className="text-muted-foreground flex-1">{note}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {/* Fallback: if structure doesn't match, show raw JSON */}
                {(!job.requirementsJson.mustHave || !Array.isArray(job.requirementsJson.mustHave)) &&
                 (!job.requirementsJson.preferred || !Array.isArray(job.requirementsJson.preferred)) &&
                 (!job.requirementsJson.notes || !Array.isArray(job.requirementsJson.notes)) && (
                  <div className="text-sm text-muted-foreground bg-muted p-4 rounded-md">
                    <pre className="whitespace-pre-wrap font-sans text-foreground">
                      {JSON.stringify(job.requirementsJson, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Financial Section */}
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-semibold mb-4 text-foreground">Financial</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pay Rate:</span>
                <span className="font-medium text-foreground">{formatCurrency(job.payRate, job.currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Charge Rate:</span>
                <span className="font-medium text-foreground">{formatCurrency(job.chargeRate, job.currency)}</span>
              </div>
              {job.marginPerHour !== null && (
                <div className="flex justify-between border-t pt-3">
                  <span className="text-muted-foreground">Margin/Hour:</span>
                  <span className="font-semibold text-green-600 dark:text-green-400">
                    {formatCurrency(job.marginPerHour, job.currency)}
                  </span>
                </div>
              )}
              {job.weeklyMargin !== null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Weekly Margin:</span>
                  <span className="font-semibold text-green-600 dark:text-green-400">
                    {formatCurrency(job.weeklyMargin, job.currency)}
                  </span>
                </div>
              )}
              {job.projectMargin !== null && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Project Margin:</span>
                  <span className="font-semibold text-green-600 dark:text-green-400">
                    {formatCurrency(job.projectMargin, job.currency)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Notes Section */}
          {job.notes && (
            <div className="rounded-lg border bg-card p-6">
              <h2 className="text-lg font-semibold mb-4 text-foreground">Notes</h2>
              <div className="text-sm text-muted-foreground bg-muted p-4 rounded-md whitespace-pre-wrap text-foreground">
                {job.notes}
              </div>
            </div>
          )}
        </div>

        {/* Right Column - Matched Candidates */}
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-lg font-semibold mb-4 text-foreground">Matched Candidates</h2>
            
            {isLoadingMatches ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="border rounded-lg p-4 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                ))}
              </div>
            ) : matches.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No matches found
              </div>
            ) : (
              <div className="space-y-4">
                {matches.map((match) => (
                  <div
                    key={match.candidateId}
                    className="border rounded-lg p-4 space-y-3 hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-foreground truncate">
                            {match.displayName || match.name || "Contact"}
                          </h3>
                          <Badge
                            variant={getTierBadgeVariant(match.tier)}
                            className="text-xs shrink-0"
                          >
                            {match.tier}
                          </Badge>
                        </div>
                        {/* Note: match.displayName already includes desiredRole as "Name - DesiredRole" */}
                        {/* Only show trade separately if displayName doesn't include it (fallback case) */}
                        {match.trade && !match.displayName?.includes(" - ") && (
                          <p className="text-xs text-muted-foreground truncate">
                            {match.trade}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-semibold text-foreground">
                          {match.score}%
                        </div>
                        <div className="text-xs text-muted-foreground">Match</div>
                      </div>
                    </div>

                    {match.highlights.length > 0 && (
                      <div className="space-y-1">
                        {match.highlights.map((highlight, idx) => (
                          <div
                            key={idx}
                            className="text-xs text-muted-foreground flex items-start gap-1.5"
                          >
                            <span className="text-foreground">•</span>
                            <span>{highlight}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex flex-col gap-2 pt-2">
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 text-xs"
                          onClick={() => handleContactClick(match)}
                        >
                          Contact {match.displayName?.split(" - ")[0]?.split(" ")[0] || match.name?.split(" ")[0] || "Candidate"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs"
                          onClick={() => {
                            router.push(`/operator/candidates/${match.candidateId}`);
                          }}
                        >
                          View Profile
                        </Button>
                      </div>
                      <Button
                        variant="default"
                        size="sm"
                        className="w-full text-xs bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => handleCscsClick(match)}
                      >
                        Verify CSCS + Confirm Placement
                      </Button>
                    </div>
                  </div>
                ))}

                {totalAvailable > matches.length && (
                  <Button
                    variant="outline"
                    className="w-full text-sm"
                    onClick={() => {
                      // TODO: Show more matches or navigate to full matches view
                      alert(`View ${totalAvailable - matches.length} more matches`);
                    }}
                  >
                    View {totalAvailable - matches.length} More Matches
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
        </TabsContent>

        <TabsContent value="pipeline" className="mt-6">
          <PipelineTab jobId={jobId} />
        </TabsContent>
      </Tabs>

      {/* Contact Confirmation Modal */}
      {contactCandidate && job && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-background border rounded-lg p-6 max-w-md w-full mx-4 shadow-lg">
            <h3 className="text-lg font-semibold mb-4 text-foreground">Confirm Outreach</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Send WhatsApp outreach to <span className="font-medium text-foreground">
                <PersonLabel
                  primary={contactCandidate.displayName || getPrimaryDisplay({
                    candidate: { name: contactCandidate.name, phone: contactCandidate.phone, desiredRole: contactCandidate.desiredRole },
                  })}
                  phone={contactCandidate.phone ? getSecondaryPhone({ phone: contactCandidate.phone }) : getSecondaryPhone({
                    candidate: { name: contactCandidate.name, phone: contactCandidate.phone, desiredRole: contactCandidate.desiredRole },
                  })}
                />
              </span> about <span className="font-medium text-foreground">{job.title}</span>?
            </p>
            <div className="flex gap-3 justify-end">
              <Button
                variant="outline"
                onClick={handleContactCancel}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                onClick={handleContactConfirm}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Sending..." : "Send Outreach"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* CSCS Verification Modal */}
      {cscsCandidate && job && (
        <StartCscsVerificationModal
          jobId={job.id}
          candidateId={cscsCandidate.candidateId}
          candidateName={cscsCandidate.displayName || getPrimaryDisplay({
            candidate: { name: cscsCandidate.name, phone: cscsCandidate.phone, desiredRole: cscsCandidate.desiredRole },
          })}
          onClose={handleCscsClose}
        />
      )}
    </div>
  );
}
