"use client";

import { useState, useEffect } from "react";
import { upsertEarningsSettings, upsertMonthlyEarnings, getEarningsSettings, getMonthlyEarnings, ApiError } from "@/lib/api";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface CommissionBracket {
  minRevenue: number;
  maxRevenue: number | null;
  ratePct: number;
}

interface EarningsSetupModalProps {
  onClose: () => void;
  onSave: () => void;
  initialSettings?: {
    basePayMonthly?: number | null;
    currency: string;
    commissionBrackets: CommissionBracket[];
  };
  initialRevenue?: number;
}

export function EarningsSetupModal({
  onClose,
  onSave,
  initialSettings,
  initialRevenue,
}: EarningsSetupModalProps) {
  const { pushToast } = useToast();

  const [basePayMonthly, setBasePayMonthly] = useState<string>(
    initialSettings?.basePayMonthly?.toString() || ""
  );
  const [revenueTotal, setRevenueTotal] = useState<string>(
    initialRevenue?.toString() || "0"
  );
  const [brackets, setBrackets] = useState<CommissionBracket[]>(
    initialSettings?.commissionBrackets || [
      { minRevenue: 0, maxRevenue: null, ratePct: 5 },
    ]
  );
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load existing data if not provided
  useEffect(() => {
    async function loadData() {
      if (!initialSettings) {
        try {
          const settings = await getEarningsSettings();
          if (settings.commissionBrackets.length > 0) {
            setBrackets(settings.commissionBrackets as CommissionBracket[]);
            if (settings.basePayMonthly !== null && settings.basePayMonthly !== undefined) {
              setBasePayMonthly(settings.basePayMonthly.toString());
            }
          }
        } catch (err) {
          // Ignore errors, use defaults
        }
      }

      if (initialRevenue === undefined) {
        try {
          const now = new Date();
          const monthly = await getMonthlyEarnings(now.getFullYear(), now.getMonth() + 1);
          if (monthly.revenueTotal !== null) {
            setRevenueTotal(monthly.revenueTotal.toString());
          }
        } catch (err) {
          // Ignore errors, use defaults
        }
      }
    }
    loadData();
  }, [initialSettings, initialRevenue]);

  const validateBrackets = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (brackets.length === 0) {
      newErrors.brackets = "At least one commission bracket is required";
      setErrors(newErrors);
      return false;
    }

    // Validate each bracket
    for (let i = 0; i < brackets.length; i++) {
      const bracket = brackets[i];
      const prefix = `bracket-${i}`;

      if (typeof bracket.minRevenue !== "number" || bracket.minRevenue < 0) {
        newErrors[`${prefix}-minRevenue`] = "Min revenue must be a non-negative number";
      }

      if (bracket.maxRevenue !== null) {
        if (typeof bracket.maxRevenue !== "number" || bracket.maxRevenue < 0) {
          newErrors[`${prefix}-maxRevenue`] = "Max revenue must be a non-negative number or empty";
        } else if (bracket.maxRevenue <= bracket.minRevenue) {
          newErrors[`${prefix}-maxRevenue`] = "Max revenue must be greater than min revenue";
        }
      }

      if (typeof bracket.ratePct !== "number" || bracket.ratePct < 0 || bracket.ratePct > 100) {
        newErrors[`${prefix}-ratePct`] = "Rate must be between 0 and 100";
      }
    }

    // Validate sorted by minRevenue
    for (let i = 1; i < brackets.length; i++) {
      if (brackets[i].minRevenue < brackets[i - 1].minRevenue) {
        newErrors.brackets = "Brackets must be sorted by min revenue in ascending order";
        break;
      }
    }

    // Validate no overlaps
    for (let i = 1; i < brackets.length; i++) {
      const prev = brackets[i - 1];
      const curr = brackets[i];

      if (prev.maxRevenue !== null && curr.minRevenue < prev.maxRevenue) {
        newErrors.brackets = "Brackets must not overlap";
        break;
      }
    }

    // Validate only last bracket can have maxRevenue = null
    for (let i = 0; i < brackets.length - 1; i++) {
      if (brackets[i].maxRevenue === null) {
        newErrors.brackets = "Only the last bracket can have max revenue empty (infinity)";
        break;
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleAddBracket = () => {
    const lastBracket = brackets[brackets.length - 1];
    const newMinRevenue = lastBracket.maxRevenue !== null ? lastBracket.maxRevenue : lastBracket.minRevenue + 10000;
    
    setBrackets([
      ...brackets,
      {
        minRevenue: newMinRevenue,
        maxRevenue: null,
        ratePct: lastBracket.ratePct,
      },
    ]);
  };

  const handleRemoveBracket = (index: number) => {
    if (brackets.length <= 1) {
      pushToast({
        variant: "error",
        title: "Cannot remove bracket",
        confirmation: "At least one bracket is required",
      });
      return;
    }
    setBrackets(brackets.filter((_, i) => i !== index));
  };

  const handleBracketChange = (
    index: number,
    field: keyof CommissionBracket,
    value: string
  ) => {
    const newBrackets = [...brackets];
    const bracket = { ...newBrackets[index] };

    if (field === "minRevenue" || field === "ratePct") {
      const numValue = parseFloat(value);
      bracket[field] = isNaN(numValue) ? 0 : numValue;
    } else if (field === "maxRevenue") {
      if (value.trim() === "" || value === "null") {
        bracket.maxRevenue = null;
      } else {
        const numValue = parseFloat(value);
        bracket.maxRevenue = isNaN(numValue) ? null : numValue;
      }
    }

    newBrackets[index] = bracket;
    setBrackets(newBrackets);
  };

  const handleSave = async () => {
    // Validate revenue
    const revenueNum = parseFloat(revenueTotal);
    if (isNaN(revenueNum) || revenueNum < 0) {
      pushToast({
        variant: "error",
        title: "Invalid revenue",
        confirmation: "Revenue must be a non-negative number",
      });
      return;
    }

    // Validate brackets
    if (!validateBrackets()) {
      pushToast({
        variant: "error",
        title: "Validation failed",
        confirmation: errors.brackets || "Please check your commission brackets",
      });
      return;
    }

    setIsLoading(true);
    try {
      // Save settings
      await upsertEarningsSettings({
        basePayMonthly: basePayMonthly.trim() === "" ? null : parseFloat(basePayMonthly) || null,
        currency: "GBP",
        commissionBrackets: brackets,
      });

      // Save monthly earnings
      const now = new Date();
      await upsertMonthlyEarnings({
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        revenueTotal: Math.round(revenueNum),
        currency: "GBP",
      });

      pushToast({
        variant: "success",
        title: "Earnings settings saved",
        confirmation: "✓ Settings updated successfully",
      });

      onSave();
      onClose();
    } catch (err) {
      console.error("Failed to save earnings settings:", err);
      const errorMessage =
        err instanceof ApiError
          ? err.message
          : "Failed to save earnings settings";

      pushToast({
        variant: "error",
        title: "Failed to save",
        confirmation: `✗ ${errorMessage}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-y-auto p-4">
      <div className="bg-background border rounded-lg p-6 max-w-3xl w-full mx-4 shadow-lg my-8">
        <h3 className="text-lg font-semibold mb-4 text-foreground">
          Earnings Settings
        </h3>

        <div className="space-y-4 mb-6">
          {/* Base Pay Monthly */}
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              Base Pay Monthly (optional)
            </label>
            <Input
              type="number"
              value={basePayMonthly}
              onChange={(e) => setBasePayMonthly(e.target.value)}
              placeholder="0"
              className="w-full"
              min="0"
            />
          </div>

          {/* Current Month Revenue */}
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              Current Month Revenue Total <span className="text-destructive">*</span>
            </label>
            <Input
              type="number"
              value={revenueTotal}
              onChange={(e) => setRevenueTotal(e.target.value)}
              placeholder="0"
              className="w-full"
              min="0"
              required
            />
          </div>

          {/* Commission Brackets */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-foreground">
                Commission Brackets <span className="text-destructive">*</span>
              </label>
              <Button
                type="button"
                onClick={handleAddBracket}
                variant="outline"
                size="sm"
              >
                Add Row
              </Button>
            </div>

            {errors.brackets && (
              <p className="text-sm text-destructive mb-2">{errors.brackets}</p>
            )}

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2 font-medium text-foreground">Min Revenue</th>
                    <th className="text-left p-2 font-medium text-foreground">Max Revenue</th>
                    <th className="text-left p-2 font-medium text-foreground">Rate %</th>
                    <th className="text-left p-2 font-medium text-foreground w-20">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {brackets.map((bracket, index) => (
                    <tr key={index} className="border-t">
                      <td className="p-2">
                        <Input
                          type="number"
                          value={bracket.minRevenue}
                          onChange={(e) =>
                            handleBracketChange(index, "minRevenue", e.target.value)
                          }
                          className="w-full"
                          min="0"
                        />
                        {errors[`bracket-${index}-minRevenue`] && (
                          <p className="text-xs text-destructive mt-0.5">
                            {errors[`bracket-${index}-minRevenue`]}
                          </p>
                        )}
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          value={bracket.maxRevenue === null ? "" : bracket.maxRevenue}
                          onChange={(e) =>
                            handleBracketChange(index, "maxRevenue", e.target.value)
                          }
                          placeholder="∞ (infinity)"
                          className="w-full"
                          min="0"
                        />
                        {errors[`bracket-${index}-maxRevenue`] && (
                          <p className="text-xs text-destructive mt-0.5">
                            {errors[`bracket-${index}-maxRevenue`]}
                          </p>
                        )}
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          value={bracket.ratePct}
                          onChange={(e) =>
                            handleBracketChange(index, "ratePct", e.target.value)
                          }
                          className="w-full"
                          min="0"
                          max="100"
                          step="0.1"
                        />
                        {errors[`bracket-${index}-ratePct`] && (
                          <p className="text-xs text-destructive mt-0.5">
                            {errors[`bracket-${index}-ratePct`]}
                          </p>
                        )}
                      </td>
                      <td className="p-2">
                        <Button
                          type="button"
                          onClick={() => handleRemoveBracket(index)}
                          variant="ghost"
                          size="sm"
                          disabled={brackets.length <= 1}
                          className="text-destructive hover:text-destructive"
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Leave max revenue empty for the last bracket to indicate infinity. Brackets must be sorted by min revenue and not overlap.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose} variant="outline" disabled={isLoading}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={isLoading}>
            {isLoading ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}



