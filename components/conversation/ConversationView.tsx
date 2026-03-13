"use client";

import { forwardRef, useState } from "react";
import type { MessageDTO } from "@/shared/dto/operator";
import { PersonLabel } from "@/components/common/PersonLabel";
import { getPrimaryDisplay, getSecondaryPhone } from "@/lib/displayName";
import { ProgressPanel } from "./ProgressPanel";
import { TimelineView } from "./TimelineView";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageMediaBlock } from "./MessageMediaBlock";

interface ConversationViewProps {
  messages: MessageDTO[];
  participantPhone: string; // Can be displayName or phone - will be handled correctly
  participantDisplayName?: string; // Optional: if provided, use this instead of deriving from phone
  state?: "ACTIVE" | "PAUSED_FOR_APPROVAL" | "PAUSED" | "CLOSED";
  pausedReason?: string | null;
  showHeader?: boolean; // Optional: hide header if parent provides its own
  conversationId?: string; // Optional: for timeline view
  // Progress and Memory Pack data
  progressStage?: string;
  progressData?: any;
  memorySummary?: string | null;
  onRefreshMemory?: () => void;
  isRefreshingMemory?: boolean;
}

function formatTime(dateString: string): string {
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

function formatTimestamp(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export const ConversationView = forwardRef<HTMLDivElement, ConversationViewProps>(
  function ConversationView(
    {
      messages,
      participantPhone,
      participantDisplayName,
      state = "ACTIVE",
      pausedReason,
      showHeader = true,
      progressStage,
      progressData,
      memorySummary,
      onRefreshMemory,
      isRefreshingMemory,
      conversationId,
    },
    ref
  ) {
    const [activeTab, setActiveTab] = useState<"messages" | "timeline">("messages");
    const isPaused = state === "PAUSED" || state === "PAUSED_FOR_APPROVAL";

    // Use provided displayName if available, otherwise derive from phone
    const displayName = participantDisplayName || getPrimaryDisplay({ phone: participantPhone });
    const phone = getSecondaryPhone({ phone: participantPhone });

    return (
      <div className="flex h-full flex-col">
        {showHeader && (
          <div className="border-b px-6 py-4">
            <div className="flex items-center justify-between">
              <PersonLabel
                primary={displayName}
                phone={phone}
                subtitle={isPaused ? "Paused" : null}
                className="text-sm font-medium"
              />
              {isPaused && (
                <div className="flex items-center gap-2 rounded-md bg-yellow-50 px-2 py-1 text-xs text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-yellow-600 dark:bg-yellow-400"></span>
                  Paused
                </div>
              )}
            </div>
            {isPaused && pausedReason && (
              <div className="mt-2 text-xs text-muted-foreground">{pausedReason}</div>
            )}
          </div>
        )}
        {/* Progress Panel */}
        <ProgressPanel
          progressStage={progressStage}
          progressData={progressData}
          memorySummary={memorySummary}
          onRefreshMemory={onRefreshMemory}
          isRefreshingMemory={isRefreshingMemory}
        />
        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "messages" | "timeline")} className="flex-1 flex flex-col min-h-0">
          <div className="border-b px-6 shrink-0">
            <TabsList>
              <TabsTrigger value="messages">Messages</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="messages" className="flex-1 min-h-0 overflow-hidden m-0">
            <div ref={ref} className="h-full overflow-y-auto px-6 pt-4 pb-12">
        <div className="space-y-3">
          {messages.map((message) => {
            const isInbound = message.direction === "INBOUND";
            return (
              <div
                key={message.messageId}
                className={`flex ${isInbound ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[75%] ${isInbound ? "text-left" : "text-right"}`}
                >
                  <div
                    className={`rounded-lg border px-4 py-3 ${
                      isInbound
                        ? "bg-muted/50 border-border"
                        : "bg-background border-border"
                    }`}
                  >
                    {/* Display text (body, transcript, or attachment label) */}
                    <div className="text-sm whitespace-pre-wrap break-words text-foreground leading-relaxed">
                      {message.displayText || message.body}
                    </div>
                    
                    {/* Media and transcript */}
                    {message.metadata && (
                      <MessageMediaBlock
                        media={message.metadata.media}
                        transcript={message.metadata.transcript}
                      />
                    )}
                    
                    {!isInbound && message.deliveryStatus && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        {message.deliveryStatus}
                        {message.deliveryStatus === "FAILED" &&
                          message.failureReason && (
                            <span className="ml-1.5 text-destructive">
                              • {message.failureReason}
                            </span>
                          )}
                      </div>
                    )}
                  </div>
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    {formatTimestamp(message.createdAt)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
            </div>
          </TabsContent>
          <TabsContent value="timeline" className="flex-1 min-h-0 overflow-hidden m-0">
            {conversationId ? (
              <TimelineView conversationId={conversationId} />
            ) : (
              <div className="h-full overflow-y-auto px-6 pt-4 pb-12">
                <div className="text-center text-sm text-muted-foreground py-8">
                  Conversation ID required for timeline
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    );
  }
);

