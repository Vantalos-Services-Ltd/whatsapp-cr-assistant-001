"use client";

import { useEffect, useState } from "react";
import { getPlaybook, updatePlaybook, ApiError, type PlaybookDTO } from "@/lib/api";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
// Default playbook values (matching src/shared/playbook.ts)
const DEFAULT_PLAYBOOK = {
  toneStyle: "UK recruiter, friendly, direct",
  maxQuestionsPerMessage: 2,
  greetingStyle: "SHORT" as const,
  forbiddenPhrases: [] as string[],
  requiredChecks: {} as Record<string, boolean>,
  escalationRules: {} as Record<string, boolean>,
  signatureStyle: "NONE" as const,
};
import { X } from "lucide-react";

export default function SettingsPage() {
  const [playbook, setPlaybook] = useState<PlaybookDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [forbiddenPhraseInput, setForbiddenPhraseInput] = useState("");
  const { pushToast } = useToast();

  // Form state
  const [formData, setFormData] = useState<Partial<PlaybookDTO>>({});

  useEffect(() => {
    loadPlaybook();
  }, []);

  const loadPlaybook = async () => {
    try {
      setLoading(true);
      const data = await getPlaybook();
      setPlaybook(data);
      setFormData({
        toneStyle: data.toneStyle,
        maxQuestionsPerMessage: data.maxQuestionsPerMessage,
        greetingStyle: data.greetingStyle,
        forbiddenPhrases: [...data.forbiddenPhrases],
        requiredChecks: { ...data.requiredChecks },
        escalationRules: { ...data.escalationRules },
        signatureStyle: data.signatureStyle,
      });
    } catch (error) {
      console.error("Failed to load playbook:", error);
      pushToast({
        variant: "error",
        title: "Failed to load playbook",
        confirmation: "✗ Confirmation: Could not load playbook settings",
        outcome: error instanceof ApiError ? error.message : "Unknown error",
        nextAction: "→ Next: Try refreshing the page",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!playbook) return;

    try {
      setSaving(true);
      const updated = await updatePlaybook(formData);
      setPlaybook(updated);
      pushToast({
        variant: "success",
        title: "Playbook updated!",
        confirmation: "✓ Confirmation: Playbook settings saved successfully",
        outcome: "📋 Outcome: AI behavior will use these settings",
        nextAction: "→ Next: Changes will apply to new messages",
      });
    } catch (error) {
      console.error("Failed to update playbook:", error);
      let errorMessage = "Failed to update playbook";
      if (error instanceof ApiError) {
        errorMessage = error.message;
        if (error.data && typeof error.data === "object" && "details" in error.data) {
          errorMessage = String(error.data.details);
        }
      }
      pushToast({
        variant: "error",
        title: "Failed to update playbook",
        confirmation: "✗ Confirmation: Could not save playbook settings",
        outcome: `📋 Outcome: ${errorMessage}`,
        nextAction: "→ Next: Check validation errors and try again",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefaults = () => {
    if (!playbook) return;
    const defaults = {
      toneStyle: DEFAULT_PLAYBOOK.toneStyle,
      maxQuestionsPerMessage: DEFAULT_PLAYBOOK.maxQuestionsPerMessage,
      greetingStyle: DEFAULT_PLAYBOOK.greetingStyle,
      forbiddenPhrases: [],
      requiredChecks: {},
      escalationRules: {},
      signatureStyle: DEFAULT_PLAYBOOK.signatureStyle,
    };
    setFormData(defaults);
  };

  const handleAddForbiddenPhrase = () => {
    const phrase = forbiddenPhraseInput.trim();
    if (!phrase) return;
    if (formData.forbiddenPhrases && formData.forbiddenPhrases.length >= 30) {
      pushToast({
        variant: "error",
        title: "Too many phrases",
        confirmation: "✗ Confirmation: Maximum 30 forbidden phrases allowed",
        outcome: "📋 Outcome: Remove some phrases before adding more",
        nextAction: "→ Next: Remove existing phrases first",
      });
      return;
    }
    if (phrase.length > 40) {
      pushToast({
        variant: "error",
        title: "Phrase too long",
        confirmation: "✗ Confirmation: Each phrase must be 40 characters or less",
        outcome: "📋 Outcome: Please shorten the phrase",
        nextAction: "→ Next: Use a shorter phrase",
      });
      return;
    }
    setFormData({
      ...formData,
      forbiddenPhrases: [...(formData.forbiddenPhrases || []), phrase],
    });
    setForbiddenPhraseInput("");
  };

  const handleRemoveForbiddenPhrase = (index: number) => {
    const phrases = [...(formData.forbiddenPhrases || [])];
    phrases.splice(index, 1);
    setFormData({
      ...formData,
      forbiddenPhrases: phrases,
    });
  };

  if (loading) {
    return (
      <div className="container mx-auto py-8">
        <h1 className="text-2xl font-bold mb-6">Settings</h1>
        <div className="text-sm text-muted-foreground">Loading playbook settings...</div>
      </div>
    );
  }

  if (!playbook) {
    return (
      <div className="container mx-auto py-8">
        <h1 className="text-2xl font-bold mb-6">Settings</h1>
        <div className="text-sm text-destructive">Failed to load playbook settings</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleResetToDefaults} disabled={saving}>
            Reset to Defaults
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      <div className="space-y-8">
        {/* Playbook Section */}
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold mb-4">AI Playbook</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Configure how the AI speaks and what constraints it follows.
          </p>

          <div className="space-y-6">
            {/* Tone Style */}
            <div>
              <label className="block text-sm font-medium mb-2">Tone Style</label>
              <Textarea
                value={formData.toneStyle || ""}
                onChange={(e) => setFormData({ ...formData, toneStyle: e.target.value })}
                placeholder="e.g., UK recruiter, friendly, direct"
                rows={3}
                maxLength={200}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Describe the tone and style for AI messages (max 200 characters)
              </p>
            </div>

            {/* Max Questions Per Message */}
            <div>
              <label className="block text-sm font-medium mb-2">Max Questions Per Message</label>
              <Input
                type="number"
                min={0}
                max={3}
                value={formData.maxQuestionsPerMessage ?? 2}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    maxQuestionsPerMessage: parseInt(e.target.value, 10) || 0,
                  })
                }
                className="w-32"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Maximum number of questions the AI should ask in a single message (0-3)
              </p>
            </div>

            {/* Greeting Style */}
            <div>
              <label className="block text-sm font-medium mb-2">Greeting Style</label>
              <select
                value={formData.greetingStyle || "SHORT"}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    greetingStyle: e.target.value as "SHORT" | "NONE" | "NORMAL",
                  })
                }
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="SHORT">Short</option>
                <option value="NORMAL">Normal</option>
                <option value="NONE">None</option>
              </select>
            </div>

            {/* Signature Style */}
            <div>
              <label className="block text-sm font-medium mb-2">Signature Style</label>
              <select
                value={formData.signatureStyle || "NONE"}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    signatureStyle: e.target.value as "NONE" | "NAME" | "AGENCY",
                  })
                }
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="NONE">None</option>
                <option value="NAME">Name</option>
                <option value="AGENCY">Agency</option>
              </select>
            </div>

            {/* Forbidden Phrases */}
            <div>
              <label className="block text-sm font-medium mb-2">Forbidden Phrases</label>
              <div className="flex gap-2 mb-2">
                <Input
                  value={forbiddenPhraseInput}
                  onChange={(e) => setForbiddenPhraseInput(e.target.value)}
                  placeholder="Enter phrase to forbid (max 40 chars)"
                  maxLength={40}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddForbiddenPhrase();
                    }
                  }}
                />
                <Button type="button" onClick={handleAddForbiddenPhrase} variant="outline">
                  Add
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Phrases the AI should never use (max 30 phrases, 40 chars each)
              </p>
              <div className="flex flex-wrap gap-2">
                {(formData.forbiddenPhrases || []).map((phrase, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-1 px-2 py-1 bg-muted rounded-md text-sm"
                  >
                    <span>{phrase}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveForbiddenPhrase(index)}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Required Checks */}
            <div>
              <label className="block text-sm font-medium mb-2">Required Checks</label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="confirmLocation"
                    checked={formData.requiredChecks?.confirmLocation || false}
                    onCheckedChange={(checked) =>
                      setFormData({
                        ...formData,
                        requiredChecks: {
                          ...formData.requiredChecks,
                          confirmLocation: checked === true,
                        },
                      })
                    }
                  />
                  <label htmlFor="confirmLocation" className="text-sm cursor-pointer">
                    Confirm Location
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="confirmAvailability"
                    checked={formData.requiredChecks?.confirmAvailability || false}
                    onCheckedChange={(checked) =>
                      setFormData({
                        ...formData,
                        requiredChecks: {
                          ...formData.requiredChecks,
                          confirmAvailability: checked === true,
                        },
                      })
                    }
                  />
                  <label htmlFor="confirmAvailability" className="text-sm cursor-pointer">
                    Confirm Availability
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="confirmTickets"
                    checked={formData.requiredChecks?.confirmTickets || false}
                    onCheckedChange={(checked) =>
                      setFormData({
                        ...formData,
                        requiredChecks: {
                          ...formData.requiredChecks,
                          confirmTickets: checked === true,
                        },
                      })
                    }
                  />
                  <label htmlFor="confirmTickets" className="text-sm cursor-pointer">
                    Confirm Tickets
                  </label>
                </div>
              </div>
            </div>

            {/* Escalation Rules */}
            <div>
              <label className="block text-sm font-medium mb-2">Escalation Rules</label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="unknownIntentAlwaysApproval"
                    checked={formData.escalationRules?.unknownIntentAlwaysApproval || false}
                    onCheckedChange={(checked) =>
                      setFormData({
                        ...formData,
                        escalationRules: {
                          ...formData.escalationRules,
                          unknownIntentAlwaysApproval: checked === true,
                        },
                      })
                    }
                  />
                  <label htmlFor="unknownIntentAlwaysApproval" className="text-sm cursor-pointer">
                    Unknown Intent Always Requires Approval
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="salaryTalkRequiresApproval"
                    checked={formData.escalationRules?.salaryTalkRequiresApproval || false}
                    onCheckedChange={(checked) =>
                      setFormData({
                        ...formData,
                        escalationRules: {
                          ...formData.escalationRules,
                          salaryTalkRequiresApproval: checked === true,
                        },
                      })
                    }
                  />
                  <label htmlFor="salaryTalkRequiresApproval" className="text-sm cursor-pointer">
                    Salary Talk Requires Approval
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

