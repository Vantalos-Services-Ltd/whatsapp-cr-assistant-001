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
/** Internal action codes must not surface in the UI. */
function humaniseAction(code: string): string {
  const map: Record<string, string> = {
    SEND_MESSAGE: "Send the reply",
    REQUEST_INFO: "Ask for more information",
    ESCALATE: "Escalate to a colleague",
    NO_ACTION: "Do nothing for now",
  };
  if (map[code]) return map[code];
  const w = code.replace(/_/g, " ").toLowerCase().trim();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

export function ExplainabilityPanel({
  explainability,
  riskLevel,
  suggestedMessage,
}: ExplainabilityPanelProps) {
  // Auto-expand if HIGH risk or missing suggested message
  const shouldAutoExpand = true;
  const [isExpanded, setIsExpanded] = useState(true);

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
        return "bg-green-100 text-green-900 border-green-300 dark:bg-green-900/30 dark:text-green-200";
      case "MEDIUM":
        return "bg-amber-100 text-amber-950 border-amber-400 dark:bg-amber-900/30 dark:text-amber-100";
      case "HIGH":
        return "bg-red-100 text-red-950 border-red-400 dark:bg-red-900/30 dark:text-red-100";
      default:
        return "";
    }
  };

  return (
    <div className="border-t pt-4 space-y-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-label={isExpanded ? "Hide why this was suggested" : "Show why this was suggested"}
        className="w-full flex items-center justify-between text-xs font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        <span>Why this suggestion</span>
        <div className="flex items-center gap-2">
          {effectiveRiskLevel && (
            <Badge
              variant={getRiskBadgeVariant(effectiveRiskLevel)}
              className={`text-xs ${getRiskBadgeColor(effectiveRiskLevel)}`}
            >
              {effectiveRiskLevel === "HIGH" ? "● " : effectiveRiskLevel === "MEDIUM" ? "◐ " : "○ "}{effectiveRiskLevel} RISK
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
                    <div className="font-medium">{humaniseAction(alt.action)}</div>
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
