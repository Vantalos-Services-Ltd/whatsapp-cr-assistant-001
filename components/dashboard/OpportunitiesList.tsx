"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getDashboardOpportunities, createOpportunityTasks, type OpportunityDTO } from "@/lib/api";
import { useToast } from "@/components/toast";

interface OpportunitiesListProps {
  initialOpportunities?: OpportunityDTO[];
}

export function OpportunitiesList({ initialOpportunities = [] }: OpportunitiesListProps) {
  const [opportunities, setOpportunities] = useState<OpportunityDTO[]>(initialOpportunities);
  const [isLoading, setIsLoading] = useState(false);
  const [creatingKeys, setCreatingKeys] = useState<Set<string>>(new Set());
  const { pushToast } = useToast();

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      const response = await getDashboardOpportunities();
      setOpportunities(response.items);
    } catch (error) {
      console.error("Failed to refresh opportunities:", error);
      pushToast({
        variant: "error",
        title: "Failed to refresh",
        confirmation: "✗ Confirmation: Could not load opportunities",
        outcome: "📋 Outcome: Please try again",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateTasks = async (opportunity: OpportunityDTO) => {
    if (opportunity.alreadyCreated || creatingKeys.has(opportunity.opportunityKey)) {
      return;
    }

    setCreatingKeys((prev) => new Set(prev).add(opportunity.opportunityKey));

    try {
      const result = await createOpportunityTasks({
        opportunityKey: opportunity.opportunityKey,
        limit: opportunity.recommendedAction.count,
      });

      pushToast({
        variant: "success",
        title: "Tasks created",
        confirmation: `✓ Confirmation: ${result.createdCount} task${result.createdCount !== 1 ? "s" : ""} created`,
        outcome: `📋 Outcome: ${result.skippedCount > 0 ? `${result.skippedCount} skipped (already created)` : "All tasks created successfully"}`,
        nextAction: "→ Continue reviewing",
      });

      // Refresh opportunities to update alreadyCreated status
      await handleRefresh();
    } catch (error) {
      console.error("Failed to create tasks:", error);
      pushToast({
        variant: "error",
        title: "Failed to create tasks",
        confirmation: "✗ Confirmation: Could not create tasks",
        outcome: "📋 Outcome: Please try again",
      });
    } finally {
      setCreatingKeys((prev) => {
        const next = new Set(prev);
        next.delete(opportunity.opportunityKey);
        return next;
      });
    }
  };

  const getPriorityColor = (priority: number): string => {
    if (priority >= 80) return "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400";
    if (priority >= 60) return "bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400";
    return "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400";
  };

  if (opportunities.length === 0 && !isLoading) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Revenue Opportunities</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading}
          >
            {isLoading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
        <div className="flex flex-col items-center justify-center py-8">
          <p className="text-sm font-medium text-foreground mb-1">No opportunities found</p>
          <p className="text-xs text-muted-foreground">Check back later for revenue opportunities</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">Revenue Opportunities</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isLoading}
        >
          {isLoading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      <div className="space-y-4">
        {opportunities.map((opp) => (
          <div
            key={opp.opportunityKey}
            className="border rounded-lg p-4 space-y-3"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="text-sm font-semibold text-foreground">{opp.title}</h4>
                  <Badge className={getPriorityColor(opp.priority)}>
                    Priority {opp.priority}
                  </Badge>
                </div>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  {opp.reasonBullets.map((reason, idx) => (
                    <li key={idx}>{reason}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <div className="text-xs text-muted-foreground">
                {opp.recommendedAction.description}
              </div>
              {opp.alreadyCreated ? (
                <Badge variant="outline" className="bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400">
                  Created
                </Badge>
              ) : (
                <Button
                  size="sm"
                  onClick={() => handleCreateTasks(opp)}
                  disabled={creatingKeys.has(opp.opportunityKey)}
                >
                  {creatingKeys.has(opp.opportunityKey) ? "Creating..." : "Create tasks"}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

