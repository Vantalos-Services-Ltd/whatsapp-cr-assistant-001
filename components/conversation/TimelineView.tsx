"use client";

import { useState, useEffect, useCallback } from "react";
import type { TimelineEventDTO } from "@/shared/dto/operator";
import { getConversationTimeline, ApiError } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { 
  MessageSquare, 
  Sparkles, 
  Clipboard, 
  CheckCircle, 
  XCircle, 
  ArrowRight, 
  Brain, 
  BadgeCheck 
} from "lucide-react";
// Relative time formatter (no external dependency)
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

interface TimelineViewProps {
  conversationId: string;
}

// Icon mapping for event types
const getEventIcon = (type: TimelineEventDTO["type"]) => {
  switch (type) {
    case "INBOUND_MESSAGE_RECEIVED":
      return MessageSquare;
    case "AI_SUGGESTION_CREATED":
      return Sparkles;
    case "TASK_CREATED":
    case "FOLLOW_UP_CREATED":
      return Clipboard;
    case "TASK_APPROVED":
    case "CSCS_APPROVED":
      return CheckCircle;
    case "TASK_REJECTED":
    case "CSCS_REJECTED":
      return XCircle;
    case "PROGRESS_STAGE_CHANGED":
      return ArrowRight;
    case "MEMORY_PACK_UPDATED":
      return Brain;
    case "CSCS_AUTO_VERIFIED":
      return BadgeCheck;
    case "OUTREACH_SENT":
      return MessageSquare;
    default:
      return Clipboard;
  }
};

// Color mapping for event types
const getEventColor = (type: TimelineEventDTO["type"]) => {
  switch (type) {
    case "INBOUND_MESSAGE_RECEIVED":
      return "text-blue-600";
    case "AI_SUGGESTION_CREATED":
      return "text-purple-600";
    case "TASK_CREATED":
    case "FOLLOW_UP_CREATED":
      return "text-gray-600";
    case "TASK_APPROVED":
    case "CSCS_APPROVED":
      return "text-green-600";
    case "TASK_REJECTED":
    case "CSCS_REJECTED":
      return "text-red-600";
    case "PROGRESS_STAGE_CHANGED":
      return "text-orange-600";
    case "MEMORY_PACK_UPDATED":
      return "text-indigo-600";
    case "CSCS_AUTO_VERIFIED":
      return "text-cyan-600";
    case "OUTREACH_SENT":
      return "text-blue-600";
    default:
      return "text-gray-600";
  }
};


export function TimelineView({ conversationId }: TimelineViewProps) {
  const [events, setEvents] = useState<TimelineEventDTO[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTimeline = useCallback(async (cursor: string | null = null, append: boolean = false) => {
    try {
      if (!append) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }
      setError(null);

      const result = await getConversationTimeline(conversationId, { limit: 25, cursor });
      
      if (append) {
        setEvents((prev) => [...prev, ...result.items]);
      } else {
        setEvents(result.items);
      }
      setNextCursor(result.nextCursor);
    } catch (err) {
      // Only show error for 500 or network failures, not 404 (empty timeline)
      if (err instanceof ApiError && err.status === 404) {
        // 404 means no timeline events - show empty state
        setEvents([]);
        setNextCursor(null);
      } else {
      setError(err instanceof Error ? err.message : "Failed to load timeline");
      console.error("Failed to load timeline:", err);
      }
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [conversationId]);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto px-6 pt-4 pb-12">
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 overflow-y-auto px-6 pt-4 pb-12">
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-6 pt-4 pb-12">
        <div className="text-center text-sm text-muted-foreground py-8">
          No timeline events yet
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 pt-4 pb-12">
      <div className="space-y-4">
        {events.map((event) => {
          const Icon = getEventIcon(event.type);
          const iconColor = getEventColor(event.type);
          const relativeTime = formatRelativeTime(event.createdAt);
          const absoluteTime = new Date(event.createdAt).toLocaleString();

          return (
            <div key={event.eventId} className="flex gap-4">
              <div className={`flex-shrink-0 ${iconColor}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{event.summary}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{event.actorName || "Unknown"}</span>
                      <span>•</span>
                      <span title={absoluteTime}>{relativeTime}</span>
                    </div>
                  </div>
                </div>
                {event.data && Object.keys(event.data).length > 0 && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    {event.data.taskType && (
                      <span className="inline-block mr-2">Task: {event.data.taskType}</span>
                    )}
                    {event.data.overallStatus && (
                      <span className="inline-block mr-2">Status: {event.data.overallStatus}</span>
                    )}
                    {event.data.from && event.data.to && (
                      <span className="inline-block mr-2">
                        {event.data.from} → {event.data.to}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {nextCursor && (
        <div className="mt-6 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadTimeline(nextCursor, true)}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}

