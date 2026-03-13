"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

export type StatusPillStatus = "up_to_date" | "refreshing" | "out_of_date" | "offline";

interface StatusPillProps {
  status: StatusPillStatus;
  lastSuccessAt?: number | null;
  lastErrorMessage?: string;
  className?: string;
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) {
    return "Just now";
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return new Date(timestamp).toLocaleDateString();
  }
}

function formatFullTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function StatusPill({
  status,
  lastSuccessAt,
  lastErrorMessage,
  className,
}: StatusPillProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close tooltip
  useEffect(() => {
    if (!showTooltip) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowTooltip(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showTooltip]);

  const statusConfig = {
    up_to_date: {
      label: "Up to date",
      bgColor: "bg-green-100 dark:bg-green-900/20",
      textColor: "text-green-700 dark:text-green-400",
      borderColor: "border-green-200 dark:border-green-800",
    },
    refreshing: {
      label: "Refreshing...",
      bgColor: "bg-orange-100 dark:bg-orange-900/20",
      textColor: "text-orange-700 dark:text-orange-400",
      borderColor: "border-orange-200 dark:border-orange-800",
    },
    out_of_date: {
      label: "Out of date",
      bgColor: "bg-red-100 dark:bg-red-900/20",
      textColor: "text-red-700 dark:text-red-400",
      borderColor: "border-red-200 dark:border-red-800",
    },
    offline: {
      label: "Offline",
      bgColor: "bg-gray-100 dark:bg-gray-900/20",
      textColor: "text-gray-700 dark:text-gray-400",
      borderColor: "border-gray-200 dark:border-gray-800",
    },
  };

  const config = statusConfig[status];
  const hasTooltip = lastSuccessAt !== null && lastSuccessAt !== undefined;

  return (
    <div ref={containerRef} className={cn("relative inline-flex", className)}>
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
          config.bgColor,
          config.textColor,
          config.borderColor,
          hasTooltip && "cursor-pointer hover:opacity-80"
        )}
        onMouseEnter={() => hasTooltip && setShowTooltip(true)}
        onMouseLeave={() => hasTooltip && setShowTooltip(false)}
        onClick={() => hasTooltip && setShowTooltip(!showTooltip)}
      >
        {/* Status dot */}
        <div
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            status === "up_to_date" && "bg-green-600 dark:bg-green-400",
            status === "refreshing" && "bg-orange-600 dark:bg-orange-400",
            status === "out_of_date" && "bg-red-600 dark:bg-red-400",
            status === "offline" && "bg-gray-600 dark:bg-gray-400"
          )}
        >
          {status === "refreshing" && (
            <div
              className={cn(
                "absolute inset-0 rounded-full animate-ping",
                "bg-orange-600 dark:bg-orange-400",
                "opacity-75"
              )}
            />
          )}
        </div>
        <span>{config.label}</span>
      </div>

      {/* Tooltip */}
      {showTooltip && hasTooltip && (
        <div
          ref={tooltipRef}
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50"
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <div className="bg-popover border border-border rounded-md shadow-lg px-3 py-2 text-sm text-popover-foreground whitespace-nowrap max-w-xs">
            <div className="space-y-1">
              {lastSuccessAt && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground">
                    Last updated
                  </div>
                  <div className="text-xs">
                    {formatTimeAgo(lastSuccessAt)} ({formatFullTime(lastSuccessAt)})
                  </div>
                </div>
              )}
              {lastErrorMessage && status === "out_of_date" && (
                <div className="pt-1 border-t border-border">
                  <div className="text-xs font-medium text-muted-foreground">
                    Error
                  </div>
                  <div className="text-xs text-red-600 dark:text-red-400 break-words whitespace-normal max-w-[200px]">
                    {lastErrorMessage}
                  </div>
                </div>
              )}
            </div>
            {/* Arrow */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
              <div className="w-2 h-2 bg-popover border-r border-b border-border rotate-45"></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



