"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getTasks, getConversation, ApiError } from "@/lib/api";
import type { TaskListItemDTO, ConversationDTO } from "@/shared/dto/operator";
import { ConversationView } from "@/components/conversation/ConversationView";
import { ActionPanel } from "@/components/operator/ActionPanel";
import { CscsVerificationTaskDetail } from "@/components/tasks/CscsVerificationTaskDetail";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/toast";
import { PersonLabel } from "@/components/common/PersonLabel";
import { getPrimaryDisplay, getSecondaryPhone } from "@/lib/displayName";

type Bucket = "pending" | "completed" | "failed" | "reminders" | "stuck";
type SortMode = "priority" | "recent";

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


function getRiskBadgeColor(riskLevel: "LOW" | "MEDIUM" | "HIGH" | null): string {
  if (!riskLevel) return "text-muted-foreground";
  switch (riskLevel) {
    case "LOW":
      return "text-green-600";
    case "MEDIUM":
      return "text-yellow-600";
    case "HIGH":
      return "text-red-600";
    default:
      return "text-muted-foreground";
  }
}

function TaskTable({
  bucket,
  onTaskSelect,
  selectedTaskId,
  refreshKey,
  onTasksLoaded,
  sortMode,
}: {
  bucket: Bucket;
  onTaskSelect: (task: TaskListItemDTO) => void;
  selectedTaskId: string | null;
  refreshKey: number;
  onTasksLoaded?: (count: number) => void;
  sortMode: SortMode;
}) {
  const [tasks, setTasks] = useState<TaskListItemDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadTasks() {
      setLoading(true);
      setError(null);
      try {
        if (bucket === "stuck") {
          // Stuck tasks feature is not available - show empty state
          setTasks([]);
        } else {
          const data = await getTasks(bucket);
          setTasks(data);
          // Notify parent of task count for pending bucket
          if (bucket === "pending" && onTasksLoaded) {
            onTasksLoaded(data.length);
          }
        }
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("Failed to load tasks");
        }
      } finally {
        setLoading(false);
      }
    }

    loadTasks();
  }, [bucket, refreshKey]); // Refresh when refreshKey changes (after approval/rejection)

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b pb-3">
            <Skeleton className="h-4 w-[200px]" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-[100px]" />
            <Skeleton className="h-4 w-[120px]" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <p className="text-sm text-muted-foreground mb-1">Failed to load tasks</p>
        <p className="text-xs text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-6">
        <p className="text-sm font-medium text-foreground mb-1">
          {bucket === "pending" && "No pending tasks"}
          {bucket === "stuck" && "No stuck tasks"}
          {bucket === "completed" && "No completed tasks"}
          {bucket === "failed" && "No failed tasks"}
        </p>
        <p className="text-xs text-muted-foreground text-center max-w-sm">
          {bucket === "pending" &&
            "Inbound candidate messages requiring approval will appear here. AI auto-replies do not appear in the inbox."}
          {bucket === "stuck" &&
            "Tasks that have been stuck in approval workflow for more than 20 minutes. These need operator attention."}
          {bucket === "completed" &&
            "Approved and completed tasks will appear here after they have been processed."}
          {bucket === "failed" &&
            "Tasks that failed during execution will appear here. Check failure reasons for details."}
        </p>
      </div>
    );
  }

  // Sort tasks based on selected mode
  const sortedTasks = [...tasks].sort((a, b) => {
    if (sortMode === "recent") {
      // Sort by createdAt desc (newest first)
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    } else {
      // Sort by priority score (highest first), then by createdAt (newest first)
      const aScore = a.priority?.score ?? 0;
      const bScore = b.priority?.score ?? 0;
      if (aScore !== bScore) {
        return bScore - aScore;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
  });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[200px]">Sender</TableHead>
          <TableHead>Summary</TableHead>
          <TableHead className="w-[100px]">Risk</TableHead>
          <TableHead className="w-[120px]">Time</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedTasks.map((task) => (
          <TableRow
            key={task.taskId}
            onClick={() => onTaskSelect(task)}
            className={`cursor-pointer ${
              selectedTaskId === task.taskId ? "bg-muted" : ""
            }`}
          >
            <TableCell className="font-medium text-sm">
              <PersonLabel
                primary={task.displayName || getPrimaryDisplay({
                  contact: task.senderName ? { name: task.senderName, phone: task.senderPhone } : undefined,
                  phone: task.senderPhone,
                })}
                phone={task.phone ? getSecondaryPhone({ phone: task.phone }) : getSecondaryPhone({
                  contact: task.senderName ? { name: task.senderName, phone: task.senderPhone } : undefined,
                  phone: task.senderPhone,
                })}
              />
            </TableCell>
            <TableCell>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <div className="text-sm text-foreground">{task.summary || "No summary"}</div>
                  {task.priority?.marginPerHour !== null && task.priority?.marginPerHour !== undefined && 
                   task.priority.marginPerHour * 160 >= 500 && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                      High value
                    </span>
                  )}
                </div>
                {task.priority?.label && (
                  <div className="text-xs text-muted-foreground">
                    {task.priority.label}
                  </div>
                )}
                {task.approvalStatus === "PENDING" && task.approvalReason && (
                  <div className="text-xs text-muted-foreground">
                    {task.approvalReason}
                  </div>
                )}
                {task.approvalStatus === "PENDING" && !task.approvalReason && (
                  <div className="text-xs text-muted-foreground">
                    Pending approval
                  </div>
                )}
              </div>
            </TableCell>
            <TableCell>
              <span className={`text-xs ${getRiskBadgeColor(task.riskLevel)}`}>
                {task.riskLevel || "—"}
              </span>
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {formatTime(task.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ConversationPanel({
  conversationId,
  onClose,
  refreshKey,
}: {
  conversationId: string | null;
  onClose: () => void;
  refreshKey: number;
}) {
  const [conversation, setConversation] = useState<ConversationDTO | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setConversation(null);
      setLoading(false);
      setError(null);
      return;
    }

    async function loadConversation() {
      if (!conversationId) return;
      
      setLoading(true);
      setError(null);
      try {
        const data = await getConversation(conversationId);
        setConversation(data);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("Failed to load conversation");
        }
      } finally {
        setLoading(false);
      }
    }

    loadConversation();
  }, [conversationId, refreshKey]);

  if (!conversationId) {
    return null;
  }

  return (
    <div className="flex w-96 flex-col border-l bg-background">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <h3 className="text-lg font-semibold">Conversation</h3>
        <button
          onClick={onClose}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>
      {loading && (
        <div className="flex flex-1 flex-col gap-3 p-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="h-16 w-3/4 rounded-lg" />
            </div>
          ))}
        </div>
      )}
      {error && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-1">Failed to load conversation</p>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        </div>
      )}
      {conversation && (
        <ConversationView
          messages={conversation.messages}
          participantPhone={conversation.participantPhone}
          participantDisplayName={conversation.participantDisplayName}
          state={conversation.state}
          pausedReason={conversation.pausedReason}
        />
      )}
    </div>
  );
}

export default function InboxPage() {
  const [selectedTask, setSelectedTask] = useState<TaskListItemDTO | null>(
    null
  );
  const [activeTab, setActiveTab] = useState<Bucket>(() => {
    // Check for tab query parameter
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get("tab");
      if (tab === "stuck") return "stuck";
    }
    return "pending";
  });
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingTasksCount, setPendingTasksCount] = useState(0);
  const { pushToast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Load sort mode from localStorage, default to "priority"
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("taskSortMode");
      return (saved === "recent" || saved === "priority") ? saved : "priority";
    }
    return "priority";
  });

  const handleSortModeChange = (mode: SortMode) => {
    setSortMode(mode);
    if (typeof window !== "undefined") {
      localStorage.setItem("taskSortMode", mode);
    }
  };
  
  // Check for taskId query parameter to auto-select a task
  useEffect(() => {
    const taskId = searchParams.get("taskId");
    if (taskId && !selectedTask) {
      // Load tasks and find the matching one
      getTasks("pending")
        .then((tasks) => {
          const task = tasks.find((t) => t.taskId === taskId);
          if (task) {
            setSelectedTask(task);
            setActiveTab("pending");
            // Remove taskId from URL without reloading
            router.replace("/operator/inbox", { scroll: false });
          }
        })
        .catch((err) => {
          console.error("Failed to load task:", err);
        });
    }
  }, [searchParams, selectedTask, router]);

  const handleTaskSelect = (task: TaskListItemDTO) => {
    setSelectedTask(task);
  };

  const handleCloseConversation = () => {
    setSelectedTask(null);
  };

  const handleActionComplete = (actionType: "approved" | "rejected") => {
    const candidateName = selectedTask 
      ? (selectedTask.displayName || getPrimaryDisplay({
          contact: selectedTask.senderName ? { name: selectedTask.senderName, phone: selectedTask.senderPhone } : undefined,
          phone: selectedTask.senderPhone,
        }))
      : "Candidate";
    const wasApproved = actionType === "approved";
    
    // Optimistic UI update: remove task from pending list
    setSelectedTask(null);
    
    // Trigger refresh first
    setRefreshKey((prev) => prev + 1);
    
    // Show toast after a short delay to allow refresh to complete and get accurate count
    // The count will be updated via onTasksLoaded callback, but we use optimistic count for immediate feedback
    setTimeout(() => {
      const remainingCount = Math.max(0, pendingTasksCount - 1);
      
      if (wasApproved) {
        pushToast({
          variant: "success",
          title: `Message sent to ${candidateName}`,
          confirmation: "✓ Confirmation: Action completed successfully",
          outcome: "📋 Outcome: Task moved to completed queue",
          nextAction: {
            label: `→ Next: Review next task (${remainingCount} remaining)`,
            onClick: () => {
              // Navigate to Inbox and refresh
              router.push("/operator/inbox");
              setRefreshKey((prev) => prev + 1);
            },
          },
        });
      } else {
        pushToast({
          variant: "info",
          title: "Task rejected",
          confirmation: "✓ Confirmation: Message discarded",
          outcome: "📋 Outcome: Rejected task moved to review queue",
          nextAction: {
            label: `→ Next: Review next task (${remainingCount} remaining)`,
            onClick: () => {
              // Navigate to Inbox and refresh
              router.push("/operator/inbox");
              setRefreshKey((prev) => prev + 1);
            },
          },
        });
      }
    }, 200); // Small delay to allow refresh to start
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">Inbox</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Review and approve inbound messages requiring human attention
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Sort:</span>
            <div className="inline-flex rounded-md border border-input bg-background">
              <button
                onClick={() => handleSortModeChange("priority")}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  sortMode === "priority"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Priority
              </button>
              <button
                onClick={() => handleSortModeChange("recent")}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-input ${
                  sortMode === "recent"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Recent
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 gap-6 overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <Tabs
            value={activeTab}
            onValueChange={(value) => {
              setActiveTab(value as Bucket);
              setSelectedTask(null);
            }}
            className="flex h-full flex-col"
          >
            <TabsList className="mb-4">
              <TabsTrigger value="pending">Pending</TabsTrigger>
              <TabsTrigger value="stuck">Stuck</TabsTrigger>
              <TabsTrigger value="reminders">Reminders</TabsTrigger>
              <TabsTrigger value="completed">Completed</TabsTrigger>
              <TabsTrigger value="failed">Failed</TabsTrigger>
            </TabsList>

            <TabsContent value="pending" className="flex-1 overflow-auto">
              <TaskTable
                bucket="pending"
                onTaskSelect={handleTaskSelect}
                selectedTaskId={selectedTask?.taskId || null}
                refreshKey={refreshKey}
                onTasksLoaded={setPendingTasksCount}
                sortMode={sortMode}
              />
            </TabsContent>

            <TabsContent value="stuck" className="flex-1 overflow-auto">
              <TaskTable
                bucket="stuck"
                onTaskSelect={handleTaskSelect}
                selectedTaskId={selectedTask?.taskId || null}
                refreshKey={refreshKey}
                sortMode={sortMode}
              />
            </TabsContent>

            <TabsContent value="completed" className="flex-1 overflow-auto">
              <TaskTable
                bucket="completed"
                onTaskSelect={handleTaskSelect}
                selectedTaskId={selectedTask?.taskId || null}
                refreshKey={refreshKey}
                sortMode={sortMode}
              />
            </TabsContent>

            <TabsContent value="reminders" className="flex-1 overflow-auto">
              <TaskTable
                bucket="reminders"
                onTaskSelect={handleTaskSelect}
                selectedTaskId={selectedTask?.taskId || null}
                refreshKey={refreshKey}
                sortMode={sortMode}
              />
            </TabsContent>

            <TabsContent value="failed" className="flex-1 overflow-auto">
              <TaskTable
                bucket="failed"
                onTaskSelect={handleTaskSelect}
                selectedTaskId={selectedTask?.taskId || null}
                refreshKey={refreshKey}
                sortMode={sortMode}
              />
            </TabsContent>
          </Tabs>
        </div>

        {selectedTask ? (
          <>
            {selectedTask.conversationId && (
              <ConversationPanel
                conversationId={selectedTask.conversationId}
                onClose={handleCloseConversation}
                refreshKey={refreshKey}
              />
            )}
            {(selectedTask.approvalStatus === "PENDING" || selectedTask.type === "FOLLOW_UP" || selectedTask.type === "OUTREACH") && (
              <>
                {selectedTask.type === "CSCS_VERIFICATION" ? (
                  <CscsVerificationTaskDetail
                    task={selectedTask}
                    onActionComplete={handleActionComplete}
                    onTaskUpdate={(updatedTask) => {
                      setSelectedTask(updatedTask);
                    }}
                  />
                ) : (
                  <ActionPanel
                    task={selectedTask}
                    onActionComplete={handleActionComplete}
                  />
                )}
              </>
            )}
          </>
        ) : (
          <div className="flex w-96 flex-col items-center justify-center border-l bg-background p-6">
            <p className="text-sm font-medium text-foreground mb-1">No task selected</p>
            <p className="text-xs text-muted-foreground text-center max-w-sm">
              Select a task from the list to view conversation history, suggested actions, and approve or reject.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

