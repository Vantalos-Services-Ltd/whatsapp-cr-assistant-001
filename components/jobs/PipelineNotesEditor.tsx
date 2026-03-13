"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// Textarea component - simple textarea wrapper
const Textarea = ({ className, rows, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={className} rows={rows} {...props} />
);

// Label component - simple inline label
const Label = ({ htmlFor, className, children }: { htmlFor?: string; className?: string; children: React.ReactNode }) => (
  <label htmlFor={htmlFor} className={className}>
    {children}
  </label>
);
import type { PipelineItem, UpsertPipelineItemRequest } from "@/lib/api";

interface PipelineNotesEditorProps {
  item: PipelineItem;
  onSave: (updates: Partial<UpsertPipelineItemRequest>) => void;
  onClose: () => void;
}

export function PipelineNotesEditor({
  item,
  onSave,
  onClose,
}: PipelineNotesEditorProps) {
  const [notes, setNotes] = useState(item.notes || "");
  const [startDate, setStartDate] = useState(
    item.startDate ? new Date(item.startDate).toISOString().split("T")[0] : ""
  );
  const [payRate, setPayRate] = useState(item.payRate?.toString() || "");
  const [shiftInfo, setShiftInfo] = useState(item.shiftInfo || "");

  const handleSave = () => {
    onSave({
      notes: notes || null,
      startDate: startDate || null,
      payRate: payRate ? parseFloat(payRate) : null,
      shiftInfo: shiftInfo || null,
      noShowReason: noShowReason || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="bg-background border rounded-lg p-6 max-w-md w-full mx-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-4 text-foreground">
          Edit Pipeline Item
        </h3>

        <div className="space-y-4">
          <div>
            <Label htmlFor="notes" className="text-sm font-medium text-foreground">
              Notes
            </Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add notes about this candidate..."
              className="mt-1"
              rows={4}
            />
          </div>

          <div>
            <Label htmlFor="startDate" className="text-sm font-medium text-foreground">
              Start Date
            </Label>
            <Input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="payRate" className="text-sm font-medium text-foreground">
              Pay Rate (£/hr)
            </Label>
            <Input
              id="payRate"
              type="number"
              step="0.01"
              value={payRate}
              onChange={(e) => setPayRate(e.target.value)}
              placeholder="e.g., 18.50"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="shiftInfo" className="text-sm font-medium text-foreground">
              Shift Info
            </Label>
            <Input
              id="shiftInfo"
              type="text"
              value={shiftInfo}
              onChange={(e) => setShiftInfo(e.target.value)}
              placeholder="e.g., Mon-Fri, 8am-5pm"
              className="mt-1"
            />
          </div>

          {item.stage === "NO_SHOW" && (
            <div>
              <Label htmlFor="noShowReason" className="text-sm font-medium text-foreground">
                No-Show Reason <span className="text-destructive">*</span>
              </Label>
              <select
                id="noShowReason"
                value={noShowReason}
                onChange={(e) => setNoShowReason(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                required
              >
                <option value="">Select reason...</option>
                <option value="DID_NOT_TURN_UP">Did not turn up</option>
                <option value="CANCELLED_LAST_MINUTE">Cancelled last minute</option>
                <option value="PHONE_OFF">Phone off / No response</option>
                <option value="CLIENT_REJECTED_ON_DAY">Client rejected on day</option>
                <option value="UNKNOWN">Unknown</option>
              </select>
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end mt-6">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" onClick={handleSave}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

