"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ExplainabilityDTO } from "@/shared/dto/operator";

interface ExplainabilityPanelProps {
  explainability: ExplainabilityDTO | null | undefined;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | null;
  suggestedMessage: string | null;
}

/**
 * ExplainabilityPanel - Shows "Why" explanation for AI suggestions
 * 
 * Displays:
 * - Risk pill
 * - Rationale bullets
 * - Used facts chips
 * - Missing info chips
 * - Uncertainty sentence (if present)
 * - Alternatives list (action + reason)
 * 
 * UX:
 * - Default collapsed to avoid clutter
 * - Auto expand when riskLevel is HIGH or when suggestedMessage is missing
 */
export function ExplainabilityPanel({
  explainability,
  riskLevel,
  suggestedMessage,
}: ExplainabilityPanelProps) {
  // Auto-expand if HIGH risk or missing suggested message
  const shouldAutoExpand = riskLevel === "HIGH" || !suggestedMessage;
  const [isExpanded, setIsExpanded] = useState(shouldAutoExpand);

  // Update expanded state when auto-expand conditions change
  useEffect(() => {
    if (shouldAutoExpand) {
      setIsExpanded(true);
    }
  }, [shouldAutoExpand]);

  // Don't render if no explainability data
  if (!explainability) {
    return null;
  }

  const effectiveRiskLevel = riskLevel || explainability.riskLevel;

  // Risk level color mapping
  const getRiskBadgeVariant = (level: "LOW" | "MEDIUM" | "HIGH"): "default" | "secondary" | "destructive" => {
    switch (level) {
      case "LOW":
        return "default";
      case "MEDIUM":
        return "secondary";
      case "HIGH":
        return "destructive";
      default:
        return "secondary";
    }
  };

  const getRiskBadgeColor = (level: "LOW" | "MEDIUM" | "HIGH"): string => {
    switch (level) {
      case "LOW":
        return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-400";
      case "MEDIUM":
        return "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400";
      case "HIGH":
        return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-400";
      default:
        return "";
    }
  };

  return (
    <div className="border-t pt-4 space-y-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between text-xs font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
      >
        <span>Why</span>
        <div className="flex items-center gap-2">
          {effectiveRiskLevel && (
            <Badge
              variant={getRiskBadgeVariant(effectiveRiskLevel)}
              className={`text-xs ${getRiskBadgeColor(effectiveRiskLevel)}`}
            >
              {effectiveRiskLevel}
            </Badge>
          )}
          {isExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="mt-3 space-y-4">
          {/* Rationale */}
          {explainability.rationale && explainability.rationale.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Rationale
              </div>
              <ul className="space-y-1">
                {explainability.rationale.map((point, idx) => (
                  <li key={idx} className="text-sm text-foreground flex items-start gap-2">
                    <span className="text-muted-foreground mt-1">•</span>
                    <span className="flex-1">{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Used Facts */}
          {explainability.usedFacts && explainability.usedFacts.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Used Facts
              </div>
              <div className="flex flex-wrap gap-2">
                {explainability.usedFacts.map((fact, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs">
                    {fact}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Missing Info */}
          {explainability.missingInfo && explainability.missingInfo.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Missing Info
              </div>
              <div className="flex flex-wrap gap-2">
                {explainability.missingInfo.map((info, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400">
                    {info}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Uncertainty */}
          {explainability.uncertainty && (
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
                Uncertainty
              </div>
              <div className="text-sm text-foreground italic">
                {explainability.uncertainty}
              </div>
            </div>
          )}

          {/* Alternatives */}
          {explainability.alternatives && explainability.alternatives.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Alternatives Considered
              </div>
              <ul className="space-y-2">
                {explainability.alternatives.map((alt, idx) => (
                  <li key={idx} className="text-sm text-foreground">
                    <div className="font-medium">{alt.action}</div>
                    <div className="text-muted-foreground text-xs mt-0.5">{alt.reason}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Generated By */}
          <div className="text-xs text-muted-foreground pt-2 border-t">
            Generated by: {explainability.generatedBy === "AI" ? "AI" : "Rules"}
          </div>
        </div>
      )}
    </div>
  );
}
