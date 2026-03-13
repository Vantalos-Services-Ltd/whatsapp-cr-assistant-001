"use client";

import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import { getConversations, getConversation, getPendingApproval, refreshConversationMemory, ApiError, type ConversationListItemDTO, type ConversationDTO, type PendingApprovalTaskDTO } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConversationView } from "@/components/conversation/ConversationView";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ActionPanel } from "@/components/operator/ActionPanel";
import type { TaskListItemDTO } from "@/shared/dto/operator";
import { PersonLabel } from "@/components/common/PersonLabel";
import { getSecondaryPhone } from "@/lib/displayName";

export default function MessagesPage() {
  const [conversations, setConversations] = useState<ConversationListItemDTO[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<ConversationDTO | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isInitialLoadingConversation, setIsInitialLoadingConversation] = useState(false);
  const [isRefreshingConversation, setIsRefreshingConversation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingApprovalTask, setPendingApprovalTask] = useState<PendingApprovalTaskDTO | null>(null);
  const [isRefreshingMemory, setIsRefreshingMemory] = useState(false);
  
  // Refs for polling and scroll detection
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const conversationPollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const isInitialLoadRef = useRef(true);
  const pathname = usePathname();
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const selectedConversationIdRef = useRef<string | null>(null);
  const interactionLockUntilRef = useRef<number>(0);
  const convUpdatedAtMapRef = useRef<Map<string, string>>(new Map());
  const isTickRunningRef = useRef(false);
  const isRefreshDetailRunningRef = useRef(false);
  const lastPendingApprovalTaskIdRef = useRef<string | null>(null);
  
  // Refs to store load functions so they can be called from event handlers
  const loadConversationsRef = useRef<((isInitial?: boolean) => Promise<void>) | null>(null);
  const loadConversationRef = useRef<((isInitial?: boolean) => Promise<void>) | null>(null);
  
  // Interaction lock helpers
  function bumpInteractionLock(ms = 10000) {
    interactionLockUntilRef.current = Date.now() + ms;
  }

  function isInteractionLocked() {
    return Date.now() < interactionLockUntilRef.current;
  }
  
  // Keep ref in sync with state
  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  // Helper to refresh pending approval task (separate from conversation detail)
  const refreshPendingApproval = useCallback(async () => {
    const conversationId = selectedConversationIdRef.current;
    if (!conversationId) {
      setPendingApprovalTask(null);
      lastPendingApprovalTaskIdRef.current = null;
      return;
    }

    try {
      const task = await getPendingApproval(conversationId);
      
      // Only update state if task id changed (to prevent flicker)
      const currentTaskId = task?.id || null;
      if (currentTaskId !== lastPendingApprovalTaskIdRef.current) {
        setPendingApprovalTask(task);
        lastPendingApprovalTaskIdRef.current = currentTaskId;
      }
    } catch (err) {
      // Handle errors gracefully - 404 or 500 should not break the page
      // 404 means no pending approval (normal case)
      // 500 means backend error (log but don't break UI)
      if (err instanceof ApiError && err.status === 404) {
        // No pending approval - clear state silently
        setPendingApprovalTask(null);
        lastPendingApprovalTaskIdRef.current = null;
      } else {
        // Other errors (500, network) - log but don't break page
        console.warn("Failed to refresh pending approval:", err);
        // Keep existing task state if we had one (don't clear on transient errors)
      }
    }
  }, []);

  // Helper to refresh selected conversation detail (used when updatedAt changes)
  const refreshSelectedConversationDetail = useCallback(async () => {
    const conversationId = selectedConversationIdRef.current;
    if (!conversationId) return;

    // Safety guard: prevent overlapping requests
    if (isRefreshDetailRunningRef.current) return;
    isRefreshDetailRunningRef.current = true;

    try {
      setIsRefreshingConversation(true);
      // Fetch conversation only (pending approval is polled separately)
      const newConversation = await getConversation(conversationId);
      
      // Update the map with the conversation's updatedAt
      convUpdatedAtMapRef.current.set(conversationId, newConversation.updatedAt);
      
      // Check if we have new messages (compare last message ID)
      const newMessages = newConversation.messages || [];
      const newestMessageId = newMessages.length > 0 ? newMessages[newMessages.length - 1]?.messageId : null;
      
      // Before updating: capture scroll position (inline to avoid deps)
      let previousDistanceFromBottom: number | null = null;
      if (messagesContainerRef.current) {
        const container = messagesContainerRef.current;
        const scrollHeight = container.scrollHeight;
        const scrollTop = container.scrollTop;
        previousDistanceFromBottom = scrollHeight - scrollTop;
      }
      
      // Never clear selectedConversation during refresh - always update with new data
      setSelectedConversation(newConversation);
      
      // Update last message ID
      if (newestMessageId) {
        lastMessageIdRef.current = newestMessageId;
      }
      
      // After updating: restore scroll position (inline to avoid deps)
      if (previousDistanceFromBottom !== null && messagesContainerRef.current) {
        requestAnimationFrame(() => {
          const container = messagesContainerRef.current;
          if (!container) return;
          const newScrollHeight = container.scrollHeight;
          
          // If user was near bottom (< 120px), scroll to bottom
          if (previousDistanceFromBottom < 120) {
            container.scrollTop = newScrollHeight;
          } else {
            // Otherwise, restore the exact scroll position
            container.scrollTop = newScrollHeight - previousDistanceFromBottom;
          }
        });
      }
    } catch (err) {
      // Don't show error during polling - just log it
      console.warn("Failed to refresh conversation:", err);
    } finally {
      setIsRefreshingConversation(false);
      isRefreshDetailRunningRef.current = false;
    }
  }, []);

  // Load conversations function (extracted so it can be called from event handlers)
  const loadConversations = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) {
        setIsInitialLoading(true);
        setError(null);
      } else {
        setIsRefreshing(true);
      }
      const data = await getConversations();
      
      // Update the updatedAt map and check if selected conversation changed
      const selectedId = selectedConversationIdRef.current;
      let shouldRefreshDetail = false;
      
      for (const conv of data) {
        const previousUpdatedAt = convUpdatedAtMapRef.current.get(conv.conversationId);
        const currentUpdatedAt = conv.updatedAt;
        
        // Update map with current updatedAt
        convUpdatedAtMapRef.current.set(conv.conversationId, currentUpdatedAt);
        
        // If this is the selected conversation and updatedAt changed, mark for refresh
        if (selectedId === conv.conversationId && previousUpdatedAt && previousUpdatedAt !== currentUpdatedAt) {
          shouldRefreshDetail = true;
        }
      }
      
      // Never clear conversations during refresh - always update with new data
      setConversations(data);
      
      // If selected conversation's updatedAt changed, refresh its detail
      if (shouldRefreshDetail && !isInteractionLocked()) {
        await refreshSelectedConversationDetail();
      }
      
      // Preserve selected conversation ID even if list updates
      // (conversation might have moved position in list)
    } catch (err) {
      if (isInitial) {
        setError(err instanceof Error ? err.message : "Failed to load messages");
      }
      // Don't show error during polling - just log it
      console.warn("Failed to refresh conversations:", err);
    } finally {
      if (isInitial) {
        setIsInitialLoading(false);
        isInitialLoadRef.current = false;
      } else {
        setIsRefreshing(false);
      }
    }
  }, [refreshSelectedConversationDetail]);

  // Stable refresh function for polling (sets isRefreshing, never clears data)
  const refreshConversationsList = useCallback(async () => {
    // Safety guard: prevent overlapping requests
    if (isTickRunningRef.current) return;
    isTickRunningRef.current = true;
    
    try {
      setIsRefreshing(true);
      const data = await getConversations();
      
      // Update the updatedAt map and check if selected conversation changed
      const selectedId = selectedConversationIdRef.current;
      let shouldRefreshDetail = false;
      
      for (const conv of data) {
        const previousUpdatedAt = convUpdatedAtMapRef.current.get(conv.conversationId);
        const currentUpdatedAt = conv.updatedAt;
        
        // Update map with current updatedAt
        convUpdatedAtMapRef.current.set(conv.conversationId, currentUpdatedAt);
        
        // If this is the selected conversation and updatedAt changed, mark for refresh
        if (selectedId === conv.conversationId && previousUpdatedAt && previousUpdatedAt !== currentUpdatedAt) {
          shouldRefreshDetail = true;
        }
      }
      
      // Never clear conversations during refresh - always update with new data
      setConversations(data);
      
      // If selected conversation's updatedAt changed, refresh its detail
      if (shouldRefreshDetail && !isInteractionLocked()) {
        await refreshSelectedConversationDetail();
      }
      
      // Also refresh pending approval if a conversation is selected (poll every 5s)
      if (selectedId && !isInteractionLocked()) {
        await refreshPendingApproval();
      }
      
      // Preserve selected conversation ID even if list updates
    } catch (err) {
      // Don't show error during polling - just log it
      console.warn("Failed to refresh conversations:", err);
    } finally {
      setIsRefreshing(false);
      isTickRunningRef.current = false;
    }
  }, [refreshSelectedConversationDetail, refreshPendingApproval]);

  // Initial load and polling for conversations list
  useEffect(() => {
    // Store function in ref for event handlers
    loadConversationsRef.current = loadConversations;

    // Initial load
    loadConversations(true);

    // Polling interval - only when visible, longer interval in dev
    let cancelled = false;
    let intervalId: NodeJS.Timeout | null = null;
    const pollInterval = process.env.NODE_ENV === "development" ? 10000 : 5000; // 10s in dev, 5s in prod

    const tick = async () => {
      if (cancelled) return;
      // Only poll when document is visible
      if (document.visibilityState !== "visible") return;
      if (isInteractionLocked()) return;
      await refreshConversationsList();
    };

    // Refetch on window focus
    const handleFocus = () => {
      if (cancelled) return;
      if (isInteractionLocked()) return;
      refreshConversationsList();
    };

    // Start polling after initial load completes
    intervalId = setInterval(tick, pollInterval);
    window.addEventListener("focus", handleFocus);

    // Cleanup on unmount
    return () => {
      cancelled = true;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      window.removeEventListener("focus", handleFocus);
    };
  }, [refreshConversationsList]); // Include refreshConversationsList in deps


  // Helper to capture distance from bottom before update (stable, uses ref)
  const captureScrollPosition = useCallback((): number | null => {
    if (!messagesContainerRef.current) return null;
    const container = messagesContainerRef.current;
    const scrollHeight = container.scrollHeight;
    const scrollTop = container.scrollTop;
    const distanceFromBottom = scrollHeight - scrollTop;
    return distanceFromBottom;
  }, []);

  // Helper to restore scroll position after update (stable, uses ref)
  const restoreScrollPosition = useCallback((previousDistanceFromBottom: number | null) => {
    if (!messagesContainerRef.current || previousDistanceFromBottom === null) return;
    
    const container = messagesContainerRef.current;
    const newScrollHeight = container.scrollHeight;
    
    // If user was near bottom (< 120px), scroll to bottom
    if (previousDistanceFromBottom < 120) {
      container.scrollTop = newScrollHeight;
    } else {
      // Otherwise, restore the exact scroll position
      // Calculate new scrollTop to maintain the same distance from bottom
      container.scrollTop = newScrollHeight - previousDistanceFromBottom;
    }
  }, []);

  // Load conversation detail function (extracted so it can be called from event handlers)
  const loadConversation = useCallback(async (isInitial = false) => {
    const conversationId = selectedConversationIdRef.current;
    if (!conversationId) {
      setSelectedConversation(null);
      setPendingApprovalTask(null);
      lastMessageIdRef.current = null;
      return;
    }

    try {
      if (isInitial) {
        setIsInitialLoadingConversation(true);
        setError(null);
      } else {
        setIsRefreshingConversation(true);
      }
      
      // Fetch conversation (pending approval is fetched separately and polled)
      const newConversation = await getConversation(conversationId);
      
      // Update the map with the conversation's updatedAt
      convUpdatedAtMapRef.current.set(conversationId, newConversation.updatedAt);
      
      // Check if we have new messages (compare last message ID)
      const newMessages = newConversation.messages || [];
      const newestMessageId = newMessages.length > 0 ? newMessages[newMessages.length - 1]?.messageId : null;
      const hadNewMessages = isInitial 
        ? false 
        : (newestMessageId && newestMessageId !== lastMessageIdRef.current);
      
      // Before updating: capture scroll position if not initial load
      const previousDistanceFromBottom = isInitial ? null : captureScrollPosition();
      
      // Update conversation state
      setSelectedConversation(newConversation);
      
      // Update last message ID
      if (newestMessageId) {
        lastMessageIdRef.current = newestMessageId;
      }
      
      // After updating: restore scroll position if not initial load
      if (!isInitial && previousDistanceFromBottom !== null) {
        // Use requestAnimationFrame to ensure DOM has updated
        requestAnimationFrame(() => {
          restoreScrollPosition(previousDistanceFromBottom);
        });
      }
      
      // Fetch pending approval when conversation is loaded
      await refreshPendingApproval();
    } catch (err) {
      if (isInitial) {
        // Show clean error UI for initial load failures
        if (err instanceof ApiError && err.status === 404) {
          setError("Conversation not found");
        } else {
          setError(err instanceof Error ? err.message : "Failed to load conversation");
        }
        setPendingApprovalTask(null);
        lastPendingApprovalTaskIdRef.current = null;
      } else {
        // Don't show error during polling - just log it
        console.warn("Failed to refresh conversation:", err);
      }
    } finally {
      if (isInitial) {
        setIsInitialLoadingConversation(false);
      } else {
        setIsRefreshingConversation(false);
      }
    }
  }, [refreshPendingApproval]); // Depends on refreshPendingApproval


  // Initial load when conversation is selected (separate from polling)
  useEffect(() => {
    // Store function in ref for event handlers
    loadConversationRef.current = loadConversation;

    // Initial load when conversation is selected
    if (selectedConversationId) {
      loadConversation(true);
    } else {
      // Clear state when no conversation selected
      setSelectedConversation(null);
      setPendingApprovalTask(null);
      lastMessageIdRef.current = null;
      lastPendingApprovalTaskIdRef.current = null;
    }
  }, [selectedConversationId, loadConversation]);

  // Attach scroll handler to messages container
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      bumpInteractionLock();
    };

    container.addEventListener("scroll", handleScroll);
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [selectedConversationId]); // Re-attach when conversation changes

  // Revalidation triggers: refresh when tab becomes visible or user returns to route
  useEffect(() => {
    const handleVisibilityChange = () => {
      // When tab becomes visible, trigger immediate refresh
      if (document.visibilityState === "visible") {
        // Refresh conversations list
        if (loadConversationsRef.current) {
          loadConversationsRef.current(false);
        }
        // Refresh selected conversation if one is open
        if (selectedConversationId && loadConversationRef.current) {
          loadConversationRef.current(false);
        }
      }
    };

    // Listen for visibility changes
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [selectedConversationId]);

  // Revalidation trigger: refresh when user returns to Messages route
  useEffect(() => {
    // Only trigger if we're on the messages route and not initial load
    if (pathname === "/operator/messages" && !isInitialLoadRef.current) {
      // Refresh conversations list
      if (loadConversationsRef.current) {
        loadConversationsRef.current(false);
      }
      // Refresh selected conversation if one is open
      if (selectedConversationId && loadConversationRef.current) {
        loadConversationRef.current(false);
      }
    }
  }, [pathname, selectedConversationId]);

  const formatTime = (dateString: string): string => {
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
  };

  return (
    <div className="flex h-full">
      {/* Conversations List */}
      <div className="w-80 border-r bg-background flex flex-col">
        <div className="p-6 border-b">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">Messages</h2>
          <p className="text-sm text-muted-foreground mt-1">
            View conversation history with candidates
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isInitialLoading && conversations.length === 0 ? (
            <div className="p-4 space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="p-3 border-b">
                  <Skeleton className="h-4 w-2/3 mb-2" />
                  <Skeleton className="h-3 w-full" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="p-4 text-center text-sm text-destructive">{error}</div>
          ) : conversations.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-foreground mb-1">No conversations</p>
              <p className="text-xs text-muted-foreground">No messages have been exchanged yet</p>
            </div>
          ) : (
            <div className="divide-y">
              {conversations.map((conv) => (
                <div
                  key={conv.conversationId}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    bumpInteractionLock();
                    setSelectedConversationId(conv.conversationId);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      bumpInteractionLock();
                      setSelectedConversationId(conv.conversationId);
                    }
                  }}
                  className={`w-full text-left p-4 hover:bg-muted/50 transition-colors cursor-pointer ${
                    selectedConversationId === conv.conversationId ? "bg-muted" : ""
                  }`}
                >
                  <div className="flex items-start justify-between mb-1">
                    <div className="font-medium text-sm text-foreground truncate flex-1">
                      <PersonLabel
                        primary={conv.participantDisplayName}
                        phone={getSecondaryPhone({ phone: conv.participantPhone })}
                        subtitle={conv.state === "PAUSED" ? "Paused" : null}
                      />
                    </div>
                    {conv.state === "PAUSED" && (
                      <span className="ml-2 px-1.5 py-0.5 text-xs bg-yellow-50 text-yellow-800 rounded dark:bg-yellow-900/20 dark:text-yellow-400">
                        Paused
                      </span>
                    )}
                  </div>
                  {conv.lastMessageSnippet && (
                    <p className="text-xs text-muted-foreground truncate mb-1">
                      {conv.lastMessageSnippet}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    <span suppressHydrationWarning>{formatTime(conv.updatedAt)}</span>
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Conversation Detail */}
      <div className="flex-1 flex flex-col">
        {selectedConversationId ? (
          isInitialLoadingConversation && !selectedConversation ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Skeleton className="h-4 w-32 mb-2 mx-auto" />
                <Skeleton className="h-3 w-48 mx-auto" />
              </div>
            </div>
          ) : selectedConversation ? (
            <>
              {/* Conversation Header */}
              <div className="border-b bg-background px-6 py-4 shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <PersonLabel
                      primary={selectedConversation.participantDisplayName}
                      phone={getSecondaryPhone({ phone: selectedConversation.participantPhone })}
                      subtitle={(selectedConversation.state === "PAUSED" || selectedConversation.state === "PAUSED_FOR_APPROVAL") ? "Paused" : null}
                      className="text-base font-semibold"
                    />
                    {(selectedConversation.state === "PAUSED" || selectedConversation.state === "PAUSED_FOR_APPROVAL") && selectedConversation.pausedReason && (
                      <div className="text-xs text-muted-foreground mt-1.5">
                        {selectedConversation.pausedReason}
                      </div>
                    )}
                  </div>
                  <div className="ml-4 shrink-0">
                    {selectedConversation.state === "PAUSED" || selectedConversation.state === "PAUSED_FOR_APPROVAL" ? (
                      <Badge variant="secondary" className="bg-yellow-50 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400">
                        Paused
                      </Badge>
                    ) : selectedConversation.state === "CLOSED" ? (
                      <Badge variant="outline">Closed</Badge>
                    ) : null}
                  </div>
                </div>
              </div>
              {pendingApprovalTask && (() => {
                // Adapt PendingApprovalTaskDTO to TaskListItemDTO format for ActionPanel
                // ActionPanel's extract functions expect proposedAction properties at task root level
                const proposedAction = pendingApprovalTask.proposedAction as any || {};
                const adaptedTask: TaskListItemDTO & { proposedAction?: any } = {
                  taskId: pendingApprovalTask.id,
                  type: pendingApprovalTask.type,
                  approvalStatus: pendingApprovalTask.approvalStatus,
                  status: pendingApprovalTask.status,
                  riskLevel: proposedAction?.riskLevel || null,
                  createdAt: pendingApprovalTask.createdAt,
                  conversationId: pendingApprovalTask.payload?.conversationId || pendingApprovalTask.relatedMessage?.conversationId || null,
                  senderPhone: null,
                  senderName: null,
                  displayName: selectedConversation.participantDisplayName,
                  trade: null,
                  phone: selectedConversation.participantPhone,
                  summary: null,
                  suggestedMessage: proposedAction?.suggestedMessage || null,
                  approvalReason: null,
                  payload: pendingApprovalTask.payload,
                  // Include proposedAction for ActionPanel (it accesses task.proposedAction)
                  proposedAction: pendingApprovalTask.proposedAction,
                  // Also merge proposedAction properties at root level for extract functions
                  ...proposedAction,
                } as any;

                return (
                  <div className="border-b bg-background shrink-0">
                    <ActionPanel
                      task={adaptedTask}
                      onActionComplete={async (actionType) => {
                        // Refetch conversation detail and pending approval after action
                        if (selectedConversationId) {
                          try {
                            const [conversationData, pendingApproval] = await Promise.all([
                              getConversation(selectedConversationId),
                              getPendingApproval(selectedConversationId),
                            ]);
                            setSelectedConversation(conversationData);
                            
                            // Update or clear pending approval task
                            if (pendingApproval) {
                              setPendingApprovalTask(pendingApproval);
                              lastPendingApprovalTaskIdRef.current = pendingApproval.id;
                            } else {
                              // Task was completed/rejected, clear it
                              setPendingApprovalTask(null);
                              lastPendingApprovalTaskIdRef.current = null;
                            }
                          } catch (err) {
                            console.error(`Failed to refetch after ${actionType}:`, err);
                          }
                        }
                      }}
                    />
                  </div>
                );
              })()}
              <div 
                className="flex-1 flex flex-col min-h-0"
                onMouseDown={() => bumpInteractionLock()}
                onPointerDown={() => bumpInteractionLock()}
              >
                <ConversationView
                  conversationId={selectedConversationId || undefined}
                  ref={messagesContainerRef}
                  messages={selectedConversation.messages}
                  participantPhone={selectedConversation.participantPhone}
                  participantDisplayName={selectedConversation.participantDisplayName}
                  state={selectedConversation.state}
                  pausedReason={selectedConversation.pausedReason}
                  showHeader={false}
                  progressStage={selectedConversation.progressStage}
                  progressData={selectedConversation.progressData}
                  memorySummary={selectedConversation.memoryPack?.summary || selectedConversation.memorySummary}
                  onRefreshMemory={async () => {
                    if (!selectedConversationId || isRefreshingMemory) return;
                    setIsRefreshingMemory(true);
                    try {
                      // Call backend to refresh memory using lib/api
                      await refreshConversationMemory(selectedConversationId);
                      // Refetch conversation to get updated data
                      const updated = await getConversation(selectedConversationId);
                      setSelectedConversation(updated);
                    } catch (error) {
                      console.error("Failed to refresh memory:", error);
                    } finally {
                      setIsRefreshingMemory(false);
                    }
                  }}
                  isRefreshingMemory={isRefreshingMemory}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <p className="text-sm font-medium text-foreground mb-1">Failed to load conversation</p>
                <p className="text-xs text-muted-foreground">{error || "Unknown error"}</p>
              </div>
            </div>
          )
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm font-medium text-foreground mb-1">Select a conversation</p>
              <p className="text-xs text-muted-foreground">
                Choose a conversation from the list to view messages
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
