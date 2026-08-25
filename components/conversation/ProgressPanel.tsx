"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

function formatDistanceToNow(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
  return `${Math.floor(diffDays / 30)} month${Math.floor(diffDays / 30) !== 1 ? "s" : ""} ago`;
}

interface ProgressPanelProps {
  progressStage?: string;
  progressData?: {
    missingFields?: string[];
    nextAction?: string | null;
    followUpAt?: string | null;
    flags?: {
      waitingForOperator?: boolean;
      highPriority?: boolean;
    };
  } | null;
  memorySummary?: string | null;
  onRefreshMemory?: () => void;
  isRefreshingMemory?: boolean;
}

const stageColors: Record<string, string> = {
  NEW: "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800 dark:text-gray-400",
  PROFILE_INCOMPLETE: "bg-yellow-100 text-yellow-800 border-amber-300 dark:bg-yellow-900/20 dark:text-yellow-400",
  LOOKING_FOR_WORK: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400",
  MATCHED_TO_JOBS: "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400",
  DOCS_NEEDED: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400",
  CSCS_VERIFICATION: "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-400",
  READY_TO_PLACE: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-400",
  PLACED: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400",
  AFTERCARE: "bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-900/20 dark:text-teal-400",
  DORMANT: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400",
  CLOSED: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400",
};

function formatStageLabel(stage: string): string {
  return stage
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

export function ProgressPanel({
  progressStage,
  progressData,
  memorySummary,
  onRefreshMemory,
  isRefreshingMemory = false,
}: ProgressPanelProps) {
  if (!progressStage && !memorySummary && !progressData) {
    return null;
  }

  const hasFollowUp = progressData?.followUpAt;
  const followUpDate = hasFollowUp ? new Date(progressData.followUpAt!) : null;
  const isFollowUpOverdue = followUpDate && followUpDate < new Date();

  return (
    <div className="border-b bg-muted/30 px-6 py-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          {/* Progress stage and summary */}
          <div className="flex items-center gap-2 flex-wrap">
            {progressStage && (
              <Badge
                variant="outline"
                className={`text-xs ${stageColors[progressStage] || stageColors.NEW}`}
              >
                {formatStageLabel(progressStage)}
              </Badge>
            )}
            {progressData?.flags?.waitingForOperator && (
              <Badge variant="outline" className="text-xs bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400">
                Waiting for operator
              </Badge>
            )}
            {progressData?.flags?.highPriority && (
              <Badge variant="outline" className="text-xs bg-red-100 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-400">
                High priority
              </Badge>
            )}
          </div>

          {/* Memory summary */}
          {memorySummary && (
            <p className="text-sm text-foreground leading-relaxed">{memorySummary}</p>
          )}

          {/* Missing fields */}
          {progressData?.missingFields && progressData.missingFields.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {progressData.missingFields.map((field, idx) => (
                <Badge
                  key={idx}
                  variant="outline"
                  className="text-xs bg-amber-50 text-amber-900 border-amber-300 dark:bg-yellow-900/10 dark:text-amber-800"
                >
                  Missing: {field}
                </Badge>
              ))}
            </div>
          )}

          {/* Next action */}
          {progressData?.nextAction && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Next:</span> {progressData.nextAction}
            </p>
          )}

          {/* Follow up */}
          {followUpDate && (
            <p className={`text-xs ${isFollowUpOverdue ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}`}>
              {isFollowUpOverdue ? "⚠ " : ""}
              Follow up: {formatDistanceToNow(followUpDate, { addSuffix: true })}
            </p>
          )}
        </div>

        {/* Refresh Memory button */}
        {onRefreshMemory && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefreshMemory}
            disabled={isRefreshingMemory}
            className="shrink-0 h-8 px-2"
            title="Refresh memory pack"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingMemory ? "animate-spin" : ""}`} />
          </Button>
        )}
      </div>
    </div>
  );
}

