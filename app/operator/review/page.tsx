"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  listReviewSamples,
  getReviewSample,
  setReviewVerdict,
  type ReviewSampleDTO,
  ApiError,
} from "@/lib/api";
import { useToast } from "@/components/toast";
import { formatDistanceToNow } from "date-fns";
import { ChevronRight, CheckCircle2, AlertCircle, XCircle } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type Bucket = "pending" | "reviewed";

function formatTime(dateString: string): string {
  return formatDistanceToNow(new Date(dateString), { addSuffix: true });
}

function getSampledReasonBadge(reason: "EDITED" | "HIGH_RISK" | "RANDOM") {
  switch (reason) {
    case "EDITED":
      return (
        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400">
          Edited
        </Badge>
      );
    case "HIGH_RISK":
      return (
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400">
          High Risk
        </Badge>
      );
    case "RANDOM":
      return (
        <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900/20 dark:text-gray-400">
          Random
        </Badge>
      );
  }
}

function getVerdictBadge(verdict: "GOOD" | "NEEDS_IMPROVEMENT" | "UNSAFE" | null) {
  if (!verdict) return null;
  switch (verdict) {
    case "GOOD":
      return (
        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400">
          Good
        </Badge>
      );
    case "NEEDS_IMPROVEMENT":
      return (
        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400">
          Needs Improvement
        </Badge>
      );
    case "UNSAFE":
      return (
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400">
          Unsafe
        </Badge>
      );
  }
}

function getDiffSummary(metrics: ReviewSampleDTO["editMetrics"]): string {
  if (metrics.wordDiffCount === 0) return "No changes";
  const parts: string[] = [];
  if (metrics.wasShortened) {
    parts.push(`shortened ${metrics.wordDiffCount} words`);
  } else if (metrics.wasExpanded) {
    parts.push(`expanded ${metrics.wordDiffCount} words`);
  } else {
    parts.push(`changed ${metrics.wordDiffCount} words`);
  }
  return parts.join(", ");
}

function ReviewSampleList({
  bucket,
  onSampleSelect,
  selectedSampleId,
  refreshKey,
}: {
  bucket: Bucket;
  onSampleSelect: (sample: ReviewSampleDTO) => void;
  selectedSampleId: string | null;
  refreshKey: number;
}) {
  const [samples, setSamples] = useState<ReviewSampleDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    async function loadSamples() {
      setLoading(true);
      setError(null);
      try {
        const data = await listReviewSamples(bucket, 25);
        setSamples(data.samples);
        setNextCursor(data.nextCursor);
        setHasMore(data.hasMore);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("Failed to load review samples");
        }
      } finally {
        setLoading(false);
      }
    }

    loadSamples();
  }, [bucket, refreshKey]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (samples.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-muted-foreground">
          {bucket === "pending" ? "No pending reviews" : "No reviewed samples"}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {samples.map((sample) => (
        <button
          key={sample.id}
          onClick={() => onSampleSelect(sample)}
          className={`w-full text-left p-4 rounded-lg border transition-colors ${
            selectedSampleId === sample.id
              ? "bg-accent border-accent-foreground/20"
              : "bg-card hover:bg-accent/50"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                {getSampledReasonBadge(sample.sampledReason)}
                {sample.editMetrics.wordDiffCount > 0 && (
                  <Badge variant="outline" className="text-xs">
                    Edited
                  </Badge>
                )}
                {sample.verdict && getVerdictBadge(sample.verdict)}
              </div>
              {sample.candidate?.name && (
                <p className="text-sm font-medium text-foreground">
                  {sample.candidate.name}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {sample.task?.type || "Task"} • {getDiffSummary(sample.editMetrics)} • {formatTime(sample.createdAt)}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          </div>
        </button>
      ))}
      {hasMore && (
        <p className="text-xs text-center text-muted-foreground py-2">
          Load more coming soon...
        </p>
      )}
    </div>
  );
}

function ReviewSampleDetail({
  sampleId,
  open,
  onOpenChange,
  onVerdictSet,
}: {
  sampleId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerdictSet: () => void;
}) {
  const [sample, setSample] = useState<ReviewSampleDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedVerdict, setSelectedVerdict] = useState<"GOOD" | "NEEDS_IMPROVEMENT" | "UNSAFE" | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const { pushToast } = useToast();

  useEffect(() => {
    if (open && sampleId) {
      loadSample();
    } else {
      setSample(null);
      setSelectedVerdict(null);
      setNotes("");
    }
  }, [open, sampleId]);

  async function loadSample() {
    if (!sampleId) return;
    setLoading(true);
    try {
      const data = await getReviewSample(sampleId);
      setSample(data);
      setSelectedVerdict(data.verdict);
      setNotes(data.notes || "");
    } catch (error) {
      console.error("Failed to load sample:", error);
      pushToast({
        variant: "error",
        title: "Failed to load review sample",
        confirmation: "Error",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveVerdict() {
    if (!sampleId || !selectedVerdict) return;
    setSaving(true);
    try {
      await setReviewVerdict(sampleId, {
        verdict: selectedVerdict,
        notes: notes.trim() || undefined,
      });
      pushToast({
        variant: "success",
        title: "Verdict saved",
        confirmation: "✓ Saved successfully",
      });
      onVerdictSet();
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to save verdict:", error);
      pushToast({
        variant: "error",
        title: "Failed to save verdict",
        confirmation: "Error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-4xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Review Sample</SheetTitle>
          <SheetDescription>
            Compare proposed and final messages
          </SheetDescription>
        </SheetHeader>
        {loading ? (
          <div className="space-y-4 mt-6">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : sample ? (
          <div className="mt-6 space-y-6">
            {/* Context */}
            {sample.candidate && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                  Candidate
                </p>
                <p className="text-sm text-foreground">
                  {sample.candidate.name || "Unknown"} • {sample.candidate.desiredRole || "No role"}
                </p>
              </div>
            )}

            {/* Side-by-side comparison */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Proposed Message
                </p>
                <div className="border rounded-lg p-4 bg-muted/30 min-h-[200px]">
                  <p className="text-sm whitespace-pre-wrap break-words text-foreground">
                    {sample.proposedText}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Final Message
                </p>
                <div className="border rounded-lg p-4 bg-muted/30 min-h-[200px]">
                  <p className="text-sm whitespace-pre-wrap break-words text-foreground">
                    {sample.finalText}
                  </p>
                </div>
              </div>
            </div>

            {/* Metrics */}
            <div className="border rounded-lg p-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Edit Metrics
              </p>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Character diff ratio: </span>
                  <span className="text-foreground">{(sample.editMetrics.charDiffRatio * 100).toFixed(1)}%</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Word diff: </span>
                  <span className="text-foreground">{sample.editMetrics.wordDiffCount}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Shortened: </span>
                  <span className="text-foreground">{sample.editMetrics.wasShortened ? "Yes" : "No"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Expanded: </span>
                  <span className="text-foreground">{sample.editMetrics.wasExpanded ? "Yes" : "No"}</span>
                </div>
              </div>
            </div>

            {/* Conversation snippet */}
            {sample.conversationSnippet && sample.conversationSnippet.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Conversation Context
                </p>
                <div className="border rounded-lg p-4 space-y-2">
                  {sample.conversationSnippet.map((msg) => (
                    <div key={msg.messageId} className="text-sm">
                      <span className="text-muted-foreground">
                        {msg.direction === "INBOUND" ? "Candidate: " : "Operator: "}
                      </span>
                      <span className="text-foreground">{msg.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Verdict selection */}
            <div className="space-y-4">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Verdict
              </p>
              <div className="flex gap-2">
                <Button
                  variant={selectedVerdict === "GOOD" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedVerdict("GOOD")}
                  className="flex items-center gap-2"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Good
                </Button>
                <Button
                  variant={selectedVerdict === "NEEDS_IMPROVEMENT" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedVerdict("NEEDS_IMPROVEMENT")}
                  className="flex items-center gap-2"
                >
                  <AlertCircle className="h-4 w-4" />
                  Needs Improvement
                </Button>
                <Button
                  variant={selectedVerdict === "UNSAFE" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedVerdict("UNSAFE")}
                  className="flex items-center gap-2"
                >
                  <XCircle className="h-4 w-4" />
                  Unsafe
                </Button>
              </div>

              {/* Notes */}
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                  Notes (optional)
                </p>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add notes about this review..."
                  className="min-h-[100px]"
                />
              </div>

              {/* Save button */}
              <Button
                onClick={handleSaveVerdict}
                disabled={!selectedVerdict || saving}
                className="w-full"
              >
                {saving ? "Saving..." : "Save Verdict"}
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export default function ReviewPage() {
  const [activeTab, setActiveTab] = useState<Bucket>("pending");
  const [selectedSample, setSelectedSample] = useState<ReviewSampleDTO | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  function handleSampleSelect(sample: ReviewSampleDTO) {
    setSelectedSample(sample);
    setIsDetailOpen(true);
  }

  function handleVerdictSet() {
    setRefreshKey((k) => k + 1);
    setSelectedSample(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Message Review</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Quality control for AI-suggested messages
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Bucket)}>
        <TabsList>
          <TabsTrigger value="pending">Pending Review</TabsTrigger>
          <TabsTrigger value="reviewed">Reviewed</TabsTrigger>
        </TabsList>
        <TabsContent value="pending" className="mt-4">
          <ReviewSampleList
            bucket="pending"
            onSampleSelect={handleSampleSelect}
            selectedSampleId={selectedSample?.id || null}
            refreshKey={refreshKey}
          />
        </TabsContent>
        <TabsContent value="reviewed" className="mt-4">
          <ReviewSampleList
            bucket="reviewed"
            onSampleSelect={handleSampleSelect}
            selectedSampleId={selectedSample?.id || null}
            refreshKey={refreshKey}
          />
        </TabsContent>
      </Tabs>

      <ReviewSampleDetail
        sampleId={selectedSample?.id || null}
        open={isDetailOpen}
        onOpenChange={setIsDetailOpen}
        onVerdictSet={handleVerdictSet}
      />
    </div>
  );
}

