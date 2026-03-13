"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { searchCandidates, type CandidateSearchResult, previewOutreach, submitOutreach, type OutreachPreview, getCandidateDetail, type CandidateDetailDTO } from "@/lib/api";
import { getApiBaseUrl } from "@/lib/getApiBaseUrl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, User, MapPin, Briefcase, Award, Send, X, Download } from "lucide-react";
import { CandidateDetail } from "@/components/operator/CandidateDetail";
import { PersonLabel } from "@/components/common/PersonLabel";
import { getPrimaryDisplay, getSecondaryPhone } from "@/lib/displayName";

export default function SearchPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateSearchResult | null>(null);
  const [data, setData] = useState<{ results: CandidateSearchResult[] } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [jobDescription, setJobDescription] = useState("");
  const [previewData, setPreviewData] = useState<OutreachPreview[] | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [candidateDetail, setCandidateDetail] = useState<CandidateDetailDTO | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  useEffect(() => {
    if (searchQuery.length > 0) {
      setIsLoading(true);
      setError(null);
      searchCandidates(searchQuery, 50)
        .then((result) => {
          setData(result);
          setIsLoading(false);
        })
        .catch((err) => {
          setError(err);
          setIsLoading(false);
        });
    } else {
      setData(null);
    }
  }, [searchQuery]);

  const handleSearch = () => {
    if (query.trim().length > 0) {
      setSearchQuery(query.trim());
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const toggleCandidateSelection = (candidateId: string) => {
    const newSelected = new Set(selectedCandidates);
    if (newSelected.has(candidateId)) {
      newSelected.delete(candidateId);
    } else {
      newSelected.add(candidateId);
    }
    setSelectedCandidates(newSelected);
  };

  const handleCandidateClick = async (candidate: CandidateSearchResult) => {
    setSelectedCandidate(candidate);
    setIsLoadingDetail(true);
    setCandidateDetail(null);
    try {
      const detail = await getCandidateDetail(candidate.candidateId);
      setCandidateDetail(detail);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to load candidate detail"));
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleContactSelected = async () => {
    if (selectedCandidates.size === 0 || !jobDescription.trim()) {
      alert("Please select candidates and provide a job description.");
      return;
    }
    setIsPreviewLoading(true);
    setError(null);
    try {
      const candidateIdsArray = Array.from(selectedCandidates);
      const result = await previewOutreach(candidateIdsArray, jobDescription);
      setPreviewData(result.previews);
      setShowPreviewModal(true);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to preview outreach"));
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleSubmitOutreach = async () => {
    if (!previewData || previewData.length === 0) {
      alert("No messages to submit.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const candidateIdsArray = previewData.map((p) => p.candidateId);
      const suggestedMessages: Record<string, string> = {};
      previewData.forEach((p) => {
        suggestedMessages[p.candidateId] = p.suggestedMessage;
      });
      await submitOutreach(candidateIdsArray, jobDescription, suggestedMessages);
      alert("Outreach tasks submitted for approval!");
      setShowPreviewModal(false);
      setSelectedCandidates(new Set());
      setJobDescription("");
      setPreviewData(null);
      router.push("/operator/inbox");
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to submit outreach"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const results = data?.results || [];

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className="flex-1 flex flex-col p-8">
        <div className="mb-8">
            <h1 className="text-3xl font-semibold mb-2">Candidates</h1>
              <p className="text-muted-foreground">Search and view candidate profiles</p>
        </div>

        {/* Search input */}
        <div className="flex gap-4 mb-8">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              type="text"
              placeholder="e.g., React developer with 5+ years experience in London"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyPress={handleKeyPress}
              className="pl-10"
            />
          </div>
          <Button onClick={handleSearch} disabled={isLoading || query.trim().length === 0}>
            Search
          </Button>
          {results.length > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                // Build export URL with current query params
                const params = new URLSearchParams();
                if (searchQuery) {
                  params.set("q", searchQuery);
                }
                const apiBaseUrl = getApiBaseUrl();
                const exportUrl = `${apiBaseUrl}/api/exports/candidates.csv?${params.toString()}`;
                window.open(exportUrl, "_blank");
              }}
              disabled={isLoading || results.length === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          )}
          {selectedCandidates.size > 0 && (
            <Button onClick={handleContactSelected} variant="default">
              <Send className="h-4 w-4 mr-2" />
              Contact Selected ({selectedCandidates.size})
            </Button>
          )}
        </div>

        {/* Job description input (shown when candidates are selected) */}
        {selectedCandidates.size > 0 && (
          <div className="mb-4">
            <label className="text-sm font-medium mb-2 block">Job Description</label>
            <textarea
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Enter job description for outreach messages..."
            />
          </div>
        )}

        {/* Results */}
        {isLoading && (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <Skeleton className="h-6 w-1/3 mb-2" />
                  <Skeleton className="h-4 w-2/3 mb-4" />
                  <Skeleton className="h-4 w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {error && (
          <Card>
            <CardContent className="p-6">
              <p className="text-destructive">Failed to search candidates. Please try again.</p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !error && searchQuery && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 px-6">
            <p className="text-sm font-medium text-foreground mb-1">No candidates found</p>
            <p className="text-xs text-muted-foreground text-center max-w-sm">
              No candidates match your search criteria. Try adjusting your query or check that candidates have been created from conversations.
            </p>
          </div>
        )}

        {!isLoading && !error && !searchQuery && (
          <div className="flex flex-col items-center justify-center py-16 px-6">
            <p className="text-sm font-medium text-foreground mb-1">Search candidates</p>
            <p className="text-xs text-muted-foreground text-center max-w-sm">
              Enter a natural language query to find candidates. For example: "React developer with 5+ years experience in London" or "Python developer available for remote work".
            </p>
          </div>
        )}

        {!isLoading && !error && results.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Found {results.length} candidate{results.length !== 1 ? "s" : ""}
              </p>
              {selectedCandidates.size > 0 && (
                <p className="text-sm text-muted-foreground">
                  {selectedCandidates.size} selected
                </p>
              )}
            </div>

            {results.map((candidate) => (
              <Card
                key={candidate.candidateId}
                className={`cursor-pointer transition-colors ${
                  selectedCandidate?.candidateId === candidate.candidateId
                    ? "border-primary"
                    : "hover:border-primary/50"
                }`}
                onClick={() => handleCandidateClick(candidate)}
              >
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <Checkbox
                      checked={selectedCandidates.has(candidate.candidateId)}
                      onChange={() => toggleCandidateSelection(candidate.candidateId)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex-1">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className="font-semibold text-lg">
                            <PersonLabel
                              primary={getPrimaryDisplay({
                                candidate: { name: candidate.name, phone: candidate.phone, desiredRole: candidate.desiredRole },
                              })}
                              phone={getSecondaryPhone({
                                candidate: { name: candidate.name, phone: candidate.phone, desiredRole: candidate.desiredRole },
                              })}
                            />
                          </h3>
                          {candidate.desiredRole && (
                            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                              <Briefcase className="h-3 w-3" />
                              {candidate.desiredRole}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium">Match: {candidate.matchScore}</div>
                          <div className="text-xs text-muted-foreground">Score</div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-4 mt-4 text-sm text-muted-foreground">
                        {candidate.location && (
                          <div className="flex items-center gap-1">
                            <MapPin className="h-4 w-4" />
                            {candidate.location}
                          </div>
                        )}
                        {candidate.yearsExperience !== null && (
                          <div className="flex items-center gap-1">
                            <Award className="h-4 w-4" />
                            {candidate.yearsExperience} years
                          </div>
                        )}
                        {candidate.salary && (candidate.salary.min || candidate.salary.max) && (
                          <div className="flex items-center gap-1">
                            <span className="text-sm">£</span>
                            {candidate.salary.min && candidate.salary.max
                              ? `${candidate.salary.min} - ${candidate.salary.max}`
                              : candidate.salary.min
                              ? `${candidate.salary.min}+`
                              : `Up to ${candidate.salary.max}`}
                            {candidate.salary.currency && ` ${candidate.salary.currency}`}
                          </div>
                        )}
                      </div>

                      {candidate.skills.length > 0 && (
                        <div className="mt-3">
                          <div className="flex flex-wrap gap-2">
                            {candidate.skills.slice(0, 5).map((skill, idx) => (
                              <span
                                key={idx}
                                className="px-2 py-1 bg-muted rounded-md text-xs text-muted-foreground"
                              >
                                {skill}
                              </span>
                            ))}
                            {candidate.skills.length > 5 && (
                              <span className="px-2 py-1 text-xs text-muted-foreground">
                                +{candidate.skills.length - 5} more
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {candidate.reasons.length > 0 && (
                        <div className="mt-3 pt-3 border-t">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                            Match Reasons
                          </p>
                          <ul className="text-xs text-muted-foreground space-y-1">
                            {candidate.reasons.map((reason, idx) => (
                              <li key={idx} className="flex items-start gap-1.5">
                                <span className="text-primary mt-0.5">•</span>
                                <span>{reason}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Candidate detail drawer */}
      {selectedCandidate && (
        <CandidateDetail
          candidate={candidateDetail}
          loading={isLoadingDetail}
          onClose={() => {
            setSelectedCandidate(null);
            setCandidateDetail(null);
          }}
        />
      )}

      {/* Preview Modal */}
      {showPreviewModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg border w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Preview Outreach Messages</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Review messages before sending ({selectedCandidates.size} candidates)
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowPreviewModal(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {isPreviewLoading && (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <Card key={i}>
                      <CardContent className="p-4">
                        <Skeleton className="h-4 w-1/3 mb-2" />
                        <Skeleton className="h-20 w-full" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {!isPreviewLoading && previewData && (
                <div className="space-y-4">
                  {previewData.map((preview) => {
                    const candidate = results.find((r) => r.candidateId === preview.candidateId);
                    return (
                      <Card key={preview.candidateId}>
                        <CardContent className="p-4">
                          <div className="mb-2">
                            <h3 className="font-semibold">
                              {candidate?.name || "Contact"}
                            </h3>
                            {preview.phone && (
                              <p className="text-xs text-muted-foreground">Phone: {preview.phone}</p>
                            )}
                          </div>
                          <div className="mt-3 p-3 bg-muted rounded-md">
                            <p className="text-sm whitespace-pre-wrap">{preview.suggestedMessage}</p>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}

              {error && (
                <Card>
                  <CardContent className="p-4">
                    <p className="text-sm text-destructive">
                      {error instanceof Error ? error.message : "An error occurred"}
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="p-6 border-t flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowPreviewModal(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button onClick={handleSubmitOutreach} disabled={isSubmitting || !previewData || !jobDescription.trim()}>
                {isSubmitting ? "Submitting..." : "Submit for Approval"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

