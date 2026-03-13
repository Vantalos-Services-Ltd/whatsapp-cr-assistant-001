"use client";

import { useEffect, useState, useRef } from "react";
import { getDashboardStats, getTasks, getConversations, getDashboardEarnings, type DashboardStats, type TaskListItemDTO, type ConversationListItemDTO, type DashboardEarnings } from "@/lib/api";
import { formatTime } from "@/lib/utils";
import { PersonLabel } from "@/components/common/PersonLabel";
import { getPrimaryDisplay, getSecondaryPhone } from "@/lib/displayName";
import { useNetworkStatus } from "@/lib/useNetworkStatus";
import { EarningsTrackerCard } from "@/components/dashboard/EarningsTrackerCard";
import { OpportunitiesList } from "@/components/dashboard/OpportunitiesList";

export default function OperatorDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentTasks, setRecentTasks] = useState<TaskListItemDTO[]>([]);
  const [recentConversations, setRecentConversations] = useState<ConversationListItemDTO[]>([]);
  const [earnings, setEarnings] = useState<DashboardEarnings | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isEarningsRefreshing, setIsEarningsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Status tracking is now handled by API wrapper (fetchApi with trackStatus: true)
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const statsRef = useRef<DashboardStats | null>(null);
  const isOnline = useNetworkStatus();
  const wasOnlineRef = useRef<boolean>(isOnline);

  useEffect(() => {
    let mounted = true;

    async function loadDashboard(isRefresh = false) {
      // Don't make requests while offline
      if (!isOnline) {
        return;
      }

      try {
        // On first load, show loading state
        if (!isRefresh) {
          setIsInitialLoading(true);
        } else {
          // On refresh, keep existing data visible and show refreshing state
          setIsRefreshing(true);
        }
        
        setError(null);
        
        // Load stats (trackStatus: true is set in getDashboardStats)
        const statsData = await getDashboardStats();
        if (!mounted) return;
        setStats(statsData);
        statsRef.current = statsData;
        
        // Load recent actionable tasks (pending approval)
        try {
          const tasksData = await getTasks("pending");
          if (!mounted) return;
          setRecentTasks(tasksData.slice(0, 5)); // Last 5
        } catch (err) {
          console.warn("Failed to load recent tasks:", err);
        }
        
        // Load recent conversations
        try {
          const conversationsData = await getConversations();
          if (!mounted) return;
          setRecentConversations(conversationsData.slice(0, 5)); // Last 5
        } catch (err) {
          console.warn("Failed to load recent conversations:", err);
        }

        // Load earnings data
        if (isRefresh && earnings !== null) {
          // Only set refreshing state if we have existing data (stale-while-revalidate)
          setIsEarningsRefreshing(true);
        }
        try {
          const earningsData = await getDashboardEarnings();
          if (!mounted) return;
          setEarnings(earningsData);
        } catch (err) {
          console.warn("Failed to load earnings:", err);
        } finally {
          if (mounted) {
            setIsEarningsRefreshing(false);
          }
        }

        // Status tracking is handled by API wrapper (getDashboardStats with trackStatus: true)
      } catch (err) {
        if (!mounted) return;
        const errorMessage = err instanceof Error ? err.message : "Failed to load dashboard";
        setError(errorMessage);
        
        // Status tracking is handled by API wrapper
      } finally {
        if (mounted) {
          setIsInitialLoading(false);
          setIsRefreshing(false);
        }
      }
    }

    // Initial load (only if online)
    if (isOnline) {
      loadDashboard(false);
    }

    // Polling interval - only when visible, longer interval in dev
    const pollInterval = process.env.NODE_ENV === "development" ? 60000 : 30000; // 60s in dev, 30s in prod

    // Refresh on interval (stale-while-revalidate pattern)
    // Only refresh when online and visible
    intervalRef.current = setInterval(() => {
      // Only refresh if document is visible, we have existing data, and we're online
      if (document.visibilityState === "visible" && statsRef.current !== null && isOnline) {
        loadDashboard(true);
      }
    }, pollInterval);

    // Refetch on window focus
    const handleFocus = () => {
      if (mounted && statsRef.current !== null && isOnline) {
        loadDashboard(true);
      }
    };
    window.addEventListener("focus", handleFocus);

    // Trigger refresh when coming back online
    if (isOnline && !wasOnlineRef.current && statsRef.current !== null) {
      loadDashboard(true);
    }
    wasOnlineRef.current = isOnline;

    return () => {
      mounted = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      window.removeEventListener("focus", handleFocus);
    };
  }, [isOnline]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Overview of your recruitment operations
          </p>
        </div>
        {isRefreshing && (
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse"></span>
            Refreshing…
          </span>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-card p-6">
          <div className="flex flex-col space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Active Tasks
            </p>
            {!stats ? (
              <div className="h-8 w-16 animate-pulse bg-muted rounded" />
            ) : error ? (
              <p className="text-sm text-destructive">Error</p>
            ) : (
              <p className="text-2xl font-semibold text-foreground">
                {stats.activeTasks}
              </p>
            )}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <div className="flex flex-col space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Pending Approval
            </p>
            {!stats ? (
              <div className="h-8 w-16 animate-pulse bg-muted rounded" />
            ) : error ? (
              <p className="text-sm text-destructive">Error</p>
            ) : (
              <p className="text-2xl font-semibold text-foreground">
                {stats.pendingApproval}
              </p>
            )}
          </div>
        </div>
        <div className={`rounded-lg border p-6 ${stats && stats.stuckTasks > 0 ? "border-red-500 bg-red-50 dark:bg-red-900/10" : "bg-card"}`}>
          <div className="flex flex-col space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Stuck Approvals
              </p>
              {stats && stats.stuckTasks > 0 && (
                <button
                  onClick={() => window.location.href = "/operator/inbox?tab=stuck"}
                  className="text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-medium"
                >
                  View
                </button>
              )}
            </div>
            {!stats ? (
              <div className="h-8 w-16 animate-pulse bg-muted rounded" />
            ) : error ? (
              <p className="text-sm text-destructive">Error</p>
            ) : (
              <p className={`text-2xl font-semibold ${stats.stuckTasks > 0 ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>
                {stats.stuckTasks}
              </p>
            )}
          </div>
        </div>
        <div className="rounded-lg border bg-card p-6">
          <div className="flex flex-col space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Messages Today
            </p>
            {!stats ? (
              <div className="h-8 w-16 animate-pulse bg-muted rounded" />
            ) : error ? (
              <p className="text-sm text-destructive">Error</p>
            ) : (
              <p className="text-2xl font-semibold text-foreground">
                {stats.messagesToday}
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-card p-6">
          <div className="flex flex-col space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Active Contacts
            </p>
            {!stats ? (
              <div className="h-8 w-16 animate-pulse bg-muted rounded" />
            ) : error ? (
              <p className="text-sm text-destructive">Error</p>
            ) : (
              <p className="text-2xl font-semibold text-foreground">
                {stats.activeContacts}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Earnings Tracker Card and Quality Card */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <EarningsTrackerCard
          earnings={earnings}
          isLoading={isInitialLoading && !earnings}
          isRefreshing={isEarningsRefreshing}
          onRefresh={async () => {
            try {
              setIsEarningsRefreshing(true);
              const earningsData = await getDashboardEarnings();
              setEarnings(earningsData);
            } catch (err) {
              console.warn("Failed to refresh earnings:", err);
            } finally {
              setIsEarningsRefreshing(false);
            }
          }}
        />
        <div className="rounded-lg border bg-card p-6">
          <div className="flex flex-col space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Quality
            </p>
            {!stats ? (
              <div className="h-8 w-16 animate-pulse bg-muted rounded" />
            ) : error ? (
              <p className="text-sm text-destructive">Error</p>
            ) : (
              <div className="space-y-1">
                <p className="text-sm text-foreground">
                  Edited today: <span className="font-semibold">{stats.approvalsEditedToday}</span>
                </p>
                <p className="text-sm text-foreground">
                  Unsafe (7d): <span className="font-semibold">{stats.unsafeReviews7d}</span>
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Revenue Opportunities */}
      <OpportunitiesList />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold text-foreground">Recent Tasks</h3>
          {!stats ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : recentTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8">
              <p className="text-sm font-medium text-foreground mb-1">No pending tasks</p>
              <p className="text-xs text-muted-foreground">All tasks are up to date</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentTasks.map((task) => (
                <div key={task.taskId} className="border-b pb-3 last:border-0 last:pb-0">
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex-1 min-w-0">
                      <PersonLabel
                        primary={task.displayName || getPrimaryDisplay({
                          contact: task.senderName ? { name: task.senderName, phone: task.senderPhone } : undefined,
                          phone: task.senderPhone,
                        })}
                        phone={task.phone ? getSecondaryPhone({ phone: task.phone }) : getSecondaryPhone({
                          contact: task.senderName ? { name: task.senderName, phone: task.senderPhone } : undefined,
                          phone: task.senderPhone,
                        })}
                        className="text-sm font-medium"
                      />
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {task.summary || "—"}
                      </p>
                    </div>
                    {task.riskLevel && (
                      <span
                        className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                          task.riskLevel === "HIGH"
                            ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                            : task.riskLevel === "MEDIUM"
                            ? "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400"
                            : "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                        }`}
                      >
                        {task.riskLevel}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatTime(task.createdAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-lg border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold text-foreground">Recent Messages</h3>
          {!stats ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : recentConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8">
              <p className="text-sm font-medium text-foreground mb-1">No conversations</p>
              <p className="text-xs text-muted-foreground">No messages have been exchanged yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentConversations.map((conv) => (
                <div key={conv.conversationId} className="border-b pb-3 last:border-0 last:pb-0">
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex-1 min-w-0">
                      <PersonLabel
                        primary={conv.participantDisplayName || getPrimaryDisplay({ phone: conv.participantPhone })}
                        phone={getSecondaryPhone({ phone: conv.participantPhone })}
                        subtitle={conv.state === "PAUSED" ? "Paused" : null}
                        className="text-sm font-medium"
                      />
                      {conv.lastMessageSnippet && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {conv.lastMessageSnippet}
                        </p>
                      )}
                    </div>
                    {conv.state === "PAUSED" && (
                      <span className="ml-2 px-1.5 py-0.5 text-xs bg-yellow-50 text-yellow-800 rounded dark:bg-yellow-900/20 dark:text-yellow-400">
                        Paused
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatTime(conv.updatedAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

