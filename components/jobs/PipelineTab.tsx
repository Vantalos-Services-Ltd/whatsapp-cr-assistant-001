"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getJobPipeline, upsertPipelineItem, removePipelineItem, type PipelineItem, type UpsertPipelineItemRequest } from "@/lib/api";
import { useToast } from "@/components/toast";
import { PipelineStageDropdown } from "./PipelineStageDropdown";
import { PipelineNotesEditor } from "./PipelineNotesEditor";
import { Edit2, Trash2, Download } from "lucide-react";
import { getApiBaseUrl } from "@/lib/getApiBaseUrl";

function getProgressStageBadgeVariant(stage: string | null): "default" | "secondary" | "destructive" | "outline" {
  if (!stage) return "outline";
  switch (stage) {
    case "NEW":
    case "PROFILE_INCOMPLETE":
      return "outline";
    case "LOOKING_FOR_WORK":
    case "MATCHED_TO_JOBS":
      return "default";
    case "READY_TO_PLACE":
      return "default";
    case "PLACED":
    case "AFTERCARE":
      return "secondary";
    case "DORMANT":
    case "CLOSED":
      return "outline";
    default:
      return "outline";
  }
}

interface PipelineTabProps {
  jobId: string;
}

export function PipelineTab({ jobId }: PipelineTabProps) {
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<PipelineItem | null>(null);
  const [updatingStage, setUpdatingStage] = useState<Set<string>>(new Set());
  const { pushToast } = useToast();

  const loadPipeline = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getJobPipeline(jobId);
      setItems(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to load pipeline";
      setError(errorMessage);
      pushToast({
        variant: "error",
        title: "Failed to load pipeline",
        confirmation: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (jobId) {
      loadPipeline();
    }
  }, [jobId]);

  const handleStageChange = async (item: PipelineItem, newStage: PipelineItem["stage"]) => {
    // Optimistic update
    const previousStage = item.stage;
    const optimisticItems = items.map((i) =>
      i.id === item.id ? { ...i, stage: newStage } : i
    );
    setItems(optimisticItems);
    setUpdatingStage((prev) => new Set(prev).add(item.id));

    try {
      const update: UpsertPipelineItemRequest = {
        candidateId: item.candidateId,
        stage: newStage,
        notes: item.notes,
        startDate: item.startDate,
        payRate: item.payRate,
        shiftInfo: item.shiftInfo,
        noShowReason: item.noShowReason,
        droppedReason: item.droppedReason,
      };

      // Guardrail: START_CONFIRMED requires startDate
      if (newStage === "START_CONFIRMED" && !item.startDate) {
        // Rollback
        setItems(items);
        pushToast({
          variant: "error",
          title: "Start date required",
          confirmation: "Please set a start date in the notes editor before moving to START_CONFIRMED",
        });
        return;
      }

      // Guardrail: NO_SHOW requires noShowReason
      if (newStage === "NO_SHOW" && !item.noShowReason) {
        // Rollback
        setItems(items);
        // Open notes editor to set noShowReason
        setEditingItem({ ...item, noShowReason: null });
        pushToast({
          variant: "error",
          title: "No-show reason required",
          confirmation: "Please select a reason in the editor before moving to NO_SHOW",
        });
        return;
      }

      const updated = await upsertPipelineItem(jobId, update);
      
      // Update with server response
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? updated : i))
      );

      pushToast({
        variant: "success",
        title: "Pipeline updated",
        confirmation: `Moved ${item.candidate.name || "candidate"} to ${newStage}`,
      });
    } catch (err) {
      // Rollback on error
      setItems(items);
      const errorMessage = err instanceof Error ? err.message : "Failed to update pipeline";
      pushToast({
        variant: "error",
        title: "Failed to update pipeline",
        confirmation: errorMessage,
      });
    } finally {
      setUpdatingStage((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const handleEditNotes = (item: PipelineItem) => {
    setEditingItem(item);
  };

  const handleSaveNotes = async (updates: Partial<UpsertPipelineItemRequest>) => {
    if (!editingItem) return;

    try {
      const update: UpsertPipelineItemRequest = {
        candidateId: editingItem.candidateId,
        stage: editingItem.stage,
        notes: updates.notes ?? editingItem.notes,
        startDate: updates.startDate ?? editingItem.startDate,
        payRate: updates.payRate ?? editingItem.payRate,
        shiftInfo: updates.shiftInfo ?? editingItem.shiftInfo,
        noShowReason: editingItem.noShowReason,
        droppedReason: editingItem.droppedReason,
      };

      const updated = await upsertPipelineItem(jobId, update);
      setItems((prev) =>
        prev.map((i) => (i.id === editingItem.id ? updated : i))
      );
      setEditingItem(null);

      pushToast({
        variant: "success",
        title: "Notes updated",
        confirmation: "Pipeline item updated successfully",
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to update notes";
      pushToast({
        variant: "error",
        title: "Failed to update notes",
        confirmation: errorMessage,
      });
    }
  };

  const handleRemove = async (item: PipelineItem) => {
    if (!confirm(`Remove ${item.candidate.name || "candidate"} from pipeline?`)) {
      return;
    }

    try {
      await removePipelineItem(jobId, item.candidateId);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      pushToast({
        variant: "success",
        title: "Removed from pipeline",
        confirmation: `${item.candidate.name || "Candidate"} removed`,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to remove from pipeline";
      pushToast({
        variant: "error",
        title: "Failed to remove",
        confirmation: errorMessage,
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive bg-destructive/10 p-4">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Pipeline</h3>
        {items.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const apiBaseUrl = getApiBaseUrl();
              const exportUrl = `${apiBaseUrl}/api/exports/jobs/${jobId}/pipeline.csv`;
              // Create a temporary anchor element to trigger download
              const link = document.createElement("a");
              link.href = exportUrl;
              link.download = "";
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            }}
            disabled={isLoading || items.length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        )}
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Candidate</TableHead>
              <TableHead>Match</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Pipeline Stage</TableHead>
              <TableHead>Last Activity</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No candidates in pipeline
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-medium text-foreground">
                        {item.candidate.name || item.candidate.phone}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {item.candidate.desiredRole && (
                          <span>{item.candidate.desiredRole}</span>
                        )}
                        {item.candidate.desiredRole && item.candidate.location && " · "}
                        {item.candidate.location && <span>{item.candidate.location}</span>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {item.matchScore !== null ? (
                      <div className="space-y-1">
                        <div className="font-semibold text-foreground">{item.matchScore}%</div>
                        {item.matchTier && (
                          <Badge variant="outline" className="text-xs">
                            {item.matchTier}
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {item.conversation?.progressStage ? (
                      <Badge variant={getProgressStageBadgeVariant(item.conversation.progressStage)}>
                        {item.conversation.progressStage}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <PipelineStageDropdown
                      value={item.stage}
                      onChange={(newStage) => handleStageChange(item, newStage)}
                      disabled={updatingStage.has(item.id)}
                      item={item}
                    />
                  </TableCell>
                  <TableCell>
                    {item.conversation?.lastActivityAt ? (
                      <span className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(item.conversation.lastActivityAt), {
                          addSuffix: true,
                        })}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditNotes(item)}
                        className="h-8 w-8 p-0"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemove(item)}
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {editingItem && (
        <PipelineNotesEditor
          item={editingItem}
          onSave={handleSaveNotes}
          onClose={() => setEditingItem(null)}
        />
      )}
    </>
  );
}

