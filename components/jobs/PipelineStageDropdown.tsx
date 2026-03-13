"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PipelineItem } from "@/lib/api";

interface PipelineStageDropdownProps {
  value: PipelineItem["stage"];
  onChange: (newStage: PipelineItem["stage"]) => void;
  disabled?: boolean;
  item: PipelineItem;
}

const STAGE_LABELS: Record<PipelineItem["stage"], string> = {
  SHORTLISTED: "Shortlisted",
  OFFER_SENT: "Offer Sent",
  START_CONFIRMED: "Start Confirmed",
  NO_SHOW: "No Show",
  DROPPED: "Dropped",
};

export function PipelineStageDropdown({
  value,
  onChange,
  disabled,
  item,
}: PipelineStageDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = (newStage: PipelineItem["stage"]) => {
    // Guardrail: START_CONFIRMED requires startDate
    if (newStage === "START_CONFIRMED" && !item.startDate) {
      // Don't close dropdown, show error will be handled by parent
      return;
    }

    // Guardrail: NO_SHOW requires noShowReason
    if (newStage === "NO_SHOW" && !item.noShowReason) {
      // Don't close dropdown, show error will be handled by parent
      return;
    }

    onChange(newStage);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className="w-full justify-between"
      >
        <span>{STAGE_LABELS[value]}</span>
        <ChevronDown className="h-4 w-4 opacity-50" />
      </Button>
      {isOpen && !disabled && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute z-20 mt-1 w-full rounded-md border bg-background shadow-lg">
            <div className="p-1">
              {(Object.keys(STAGE_LABELS) as PipelineItem["stage"][]).map((stage) => (
                <button
                  key={stage}
                  type="button"
                  onClick={() => handleSelect(stage)}
                  className={`w-full text-left px-3 py-2 text-sm rounded-sm hover:bg-accent ${
                    value === stage ? "bg-accent font-medium" : ""
                  } ${
                    stage === "START_CONFIRMED" && !item.startDate
                      ? "opacity-50 cursor-not-allowed"
                      : ""
                  } ${
                    stage === "NO_SHOW" && !item.noShowReason
                      ? "opacity-50 cursor-not-allowed"
                      : ""
                  }`}
                  disabled={
                    (stage === "START_CONFIRMED" && !item.startDate) ||
                    (stage === "NO_SHOW" && !item.noShowReason)
                  }
                >
                  {STAGE_LABELS[stage]}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

