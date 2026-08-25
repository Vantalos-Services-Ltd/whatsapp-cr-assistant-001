"use client";

import { useEffect, useState } from "react";
import { getAllTasks, type TaskListItemDTO } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ActionPanel } from "@/components/operator/ActionPanel";
import { CscsVerificationTaskDetail } from "@/components/tasks/CscsVerificationTaskDetail";
import { useToast } from "@/components/toast";
import { PersonLabel } from "@/components/common/PersonLabel";
import { getPrimaryDisplay, getSecondaryPhone } from "@/lib/displayName";

type SortMode = "priority" | "recent";

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskListItemDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "approved" | "failed" | "all">("all");
  const [selectedTask, setSelectedTask] = useState<TaskListItemDTO | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const { pushToast } = useToast();
  
  // Load sort mode from localStorage, default to "priority"
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("taskSortMode");
      return (saved === "recent" || saved === "priority") ? saved : "priority";
    }
    return "priority";
  });

  useEffect(() => {
    async function loadTasks() {
      try {
        setIsLoading(true);
        setError(null);
        const data = await getAllTasks(filter);
        setTasks(data.tasks);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load tasks");
      } finally {
        setIsLoading(false);
      }
    }

    loadTasks();
  }, [filter, refreshKey]);

  const handleActionComplete = async (actionType: "approved" | "rejected") => {
    // Refresh tasks list
    setRefreshKey((prev) => prev + 1);
    // Clear selected task
    setSelectedTask(null);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const handleSortModeChange = (mode: SortMode) => {
    setSortMode(mode);
    if (typeof window !== "undefined") {
      localStorage.setItem("taskSortMode", mode);
    }
  };

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
    <div className="flex h-full">
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-8">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">Tasks</h2>
            <p className="text-muted-foreground mt-1">
              View actionable tasks: approvals, follow-ups, and outreach
            </p>
          </div>

          <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <div className="flex items-center justify-between">
              <TabsList>
                <TabsTrigger value="pending">Requires Approval</TabsTrigger>
                <TabsTrigger value="approved">Completed</TabsTrigger>
                <TabsTrigger value="failed">Rejected</TabsTrigger>
                <TabsTrigger value="all">All Tasks</TabsTrigger>
              </TabsList>
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
            <TabsContent value={filter} className="mt-6">
              <div className="rounded-lg border bg-card">
            {isLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Loading tasks...
              </div>
            ) : error ? (
              <div className="p-8 text-center text-sm text-destructive">
                {error}
              </div>
            ) : sortedTasks.filter((task) => {
                // Apply same filter as table
                if (filter === "all") {
                  return (
                    task.type === "APPROVAL_REQUIRED" ||
                    task.approvalStatus === "PENDING" ||
                    task.approvalStatus === "APPROVED" ||
                    task.approvalStatus === "REJECTED"
                  );
                }
                return true;
              }).length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm font-medium text-foreground mb-1">No tasks found</p>
                <p className="text-xs text-muted-foreground">
                  {filter === "pending"
                    ? "No tasks require approval at this time"
                    : filter === "approved"
                    ? "No completed tasks"
                    : filter === "failed"
                    ? "No rejected tasks"
                    : "No actionable tasks"}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sender</TableHead>
                    <TableHead>Summary</TableHead>
                    <TableHead>Risk</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedTasks
                    .filter((task) => {
                      // Filter out non-actionable informational tasks from "all" view
                      if (filter === "all") {
                        // Show only actionable tasks: APPROVAL_REQUIRED, or tasks with approval status
                        return (
                          task.type === "APPROVAL_REQUIRED" ||
                          task.approvalStatus === "PENDING" ||
                          task.approvalStatus === "APPROVED" ||
                          task.approvalStatus === "REJECTED"
                        );
                      }
                      return true;
                    })
                    .map((task) => (
                      <TableRow 
                        key={task.taskId}
                        onClick={() => setSelectedTask(task)}
                        className="cursor-pointer hover:bg-muted/50"
                      >
                        <TableCell className="font-medium">
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
                        <TableCell className="max-w-md">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <div className="truncate">{task.summary || "—"}</div>
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
                            {task.approvalReason && (
                              <div className="text-xs text-muted-foreground">
                                {task.approvalReason}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {task.riskLevel ? (
                            <span
                              className={
                                task.riskLevel === "HIGH"
                                  ? "text-red-600"
                                  : task.riskLevel === "MEDIUM"
                                  ? "text-amber-800"
                                  : "text-green-600"
                              }
                            >
                              {task.riskLevel}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span className="text-sm">{task.status}</span>
                            {task.approvalStatus !== "NOT_REQUIRED" && (
                              <span className="text-xs text-muted-foreground">
                                {task.approvalStatus}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDate(task.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Task Detail Panel */}
      {selectedTask ? (
        <>
          {selectedTask.approvalStatus === "PENDING" && (
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
          {selectedTask.approvalStatus !== "PENDING" && (
            <div className="flex w-96 flex-col items-center justify-center border-l bg-background p-6">
              <p className="text-sm font-medium text-foreground mb-1">Task Details</p>
              <p className="text-xs text-muted-foreground text-center max-w-sm mb-4">
                {selectedTask.summary || "No summary available"}
              </p>
              <p className="text-xs text-muted-foreground">
                Status: {selectedTask.status} | Approval: {selectedTask.approvalStatus}
              </p>
              <button
                onClick={() => setSelectedTask(null)}
                className="mt-4 text-xs text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="flex w-96 flex-col items-center justify-center border-l bg-background p-6">
          <p className="text-sm font-medium text-foreground mb-1">No task selected</p>
          <p className="text-xs text-muted-foreground text-center max-w-sm">
            Select a task from the list to view details and approve or reject.
          </p>
        </div>
      )}
    </div>
  );
}
