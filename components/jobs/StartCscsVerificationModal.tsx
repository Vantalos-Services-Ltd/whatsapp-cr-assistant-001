"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createCscsVerification, getCandidateLatestMedia, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/toast";

interface StartCscsVerificationModalProps {
  jobId: string;
  candidateId: string;
  candidateName: string;
  onClose: () => void;
}

export function StartCscsVerificationModal({
  jobId,
  candidateId,
  candidateName,
  onClose,
}: StartCscsVerificationModalProps) {
  const router = useRouter();
  const { pushToast } = useToast();
  
  const [source, setSource] = useState<"whatsapp" | "url">("url");
  const [imageUrl, setImageUrl] = useState("");
  const [sourceMessageId, setSourceMessageId] = useState<string | null>(null);
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Reset state when source changes
  useEffect(() => {
    if (source === "url") {
      setImageUrl("");
      setSourceMessageId(null);
      setImageError(null);
    } else {
      // Don't auto-fetch, wait for button click
      setImageUrl("");
      setSourceMessageId(null);
      setImageError(null);
    }
  }, [source]);

  const handleFetchWhatsAppImage = async () => {
    setIsLoadingImage(true);
    setImageError(null);
    
    try {
      const media = await getCandidateLatestMedia(candidateId);
      setImageUrl(media.mediaUrl);
      setSourceMessageId(media.messageId);
      setImageError(null);
    } catch (err) {
      console.error("Failed to fetch latest media:", err);
      const errorMessage = err instanceof ApiError && err.status === 404
        ? "No WhatsApp image found"
        : err instanceof ApiError
        ? err.message
        : "No WhatsApp image found";
      setImageError(errorMessage);
      setImageUrl("");
      setSourceMessageId(null);
    } finally {
      setIsLoadingImage(false);
    }
  };

  const handleCreate = async () => {
    // Validate
    if (source === "whatsapp" && (!imageUrl.trim() || !sourceMessageId)) {
      if (!imageUrl.trim()) {
        alert("Please fetch the latest WhatsApp image first");
      }
      return;
    }

    if (source === "url" && !imageUrl.trim()) {
      alert("Please enter an image URL");
      return;
    }

    setIsCreating(true);
    try {
      const result = await createCscsVerification({
        candidateId,
        jobId,
        ...(source === "whatsapp" && sourceMessageId
          ? { sourceMessageId }
          : { imageUrl: imageUrl.trim() }),
      });

      // Navigate to Inbox with taskId query param (Inbox will auto-open the task)
      router.push(`/operator/inbox?taskId=${result.id}`);
      
      // Show simple success toast
      pushToast({
        variant: "success",
        title: "CSCS verification task created",
        confirmation: "✓ Task created successfully",
        outcome: "Task opened in Inbox",
        nextAction: "Review and approve the task",
      });
    } catch (err) {
      console.error("Failed to create CSCS verification task:", err);
      
      let errorMessage = "An unexpected error occurred";
      if (err instanceof ApiError) {
        errorMessage = err.message || "Failed to create CSCS verification task";
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }
      
      pushToast({
        variant: "error",
        title: "Failed to create task",
        confirmation: "✗ Confirmation: Could not create task",
        outcome: `📋 Outcome: ${errorMessage}`,
        nextAction: {
          label: "→ Next: Retry",
          onClick: () => {
            handleCreate();
          },
        },
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-y-auto p-4">
      <div className="bg-background border rounded-lg p-6 max-w-2xl w-full mx-4 shadow-lg my-8">
        <h3 className="text-lg font-semibold mb-4 text-foreground">
          Verify CSCS + Confirm Placement
        </h3>
        
        <div className="space-y-4 mb-6">
          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              Candidate
            </label>
            <div className="text-sm text-muted-foreground bg-muted/30 rounded-md p-3">
              {candidateName}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground mb-1.5 block">
              CSCS Source
            </label>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  id="cscs-source-url"
                  name="cscs-source"
                  value="url"
                  checked={source === "url"}
                  onChange={() => setSource("url")}
                  className="w-4 h-4 text-green-600 border-gray-300 focus:ring-green-500"
                />
                <label htmlFor="cscs-source-url" className="text-sm text-foreground cursor-pointer">
                  Paste image URL
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  id="cscs-source-whatsapp"
                  name="cscs-source"
                  value="whatsapp"
                  checked={source === "whatsapp"}
                  onChange={() => setSource("whatsapp")}
                  className="w-4 h-4 text-green-600 border-gray-300 focus:ring-green-500"
                />
                <label htmlFor="cscs-source-whatsapp" className="text-sm text-foreground cursor-pointer">
                  Use latest WhatsApp image
                </label>
              </div>
            </div>
          </div>

          {source === "url" && (
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">
                Image URL
              </label>
              <Input
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://example.com/image.jpg"
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Paste a publicly accessible image URL
              </p>
              {imageUrl && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-foreground mb-2">Preview:</p>
                  <div className="border rounded-lg overflow-hidden bg-white">
                    <img
                      src={imageUrl}
                      alt="CSCS Card Preview"
                      className="w-full max-h-48 object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                        const parent = (e.target as HTMLImageElement).parentElement;
                        if (parent) {
                          parent.innerHTML = '<p class="text-xs text-red-600 p-2">Failed to load image. Please check the URL.</p>';
                        }
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {source === "whatsapp" && (
            <div>
              <label className="text-sm font-medium text-foreground mb-1.5 block">
                Latest WhatsApp Image
              </label>
              <div className="space-y-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleFetchWhatsAppImage}
                  disabled={isLoadingImage}
                >
                  {isLoadingImage ? "Loading..." : "Fetch latest image"}
                </Button>

                {isLoadingImage && (
                  <div className="text-sm text-muted-foreground bg-muted/30 rounded-md p-3 text-center">
                    Loading latest image...
                  </div>
                )}

                {imageError && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3">
                    <p className="text-sm text-red-600 dark:text-red-400 font-medium mb-1">
                      No image found
                    </p>
                    <p className="text-xs text-red-600 dark:text-red-400">
                      {imageError}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      Please use "Paste image URL" option instead.
                    </p>
                  </div>
                )}

                {imageUrl && !imageError && (
                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground bg-muted/30 rounded-md p-3">
                      Image loaded from latest WhatsApp message
                    </div>
                    <div className="border rounded-lg overflow-hidden bg-white">
                      <img
                        src={imageUrl}
                        alt="CSCS Card Preview"
                        className="w-full max-h-48 object-contain"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                          const parent = (e.target as HTMLImageElement).parentElement;
                          if (parent) {
                            parent.innerHTML = '<p class="text-xs text-red-600 p-2">Failed to load image.</p>';
                          }
                        }}
                      />
                    </div>
                  </div>
                )}

                {!isLoadingImage && !imageUrl && !imageError && (
                  <div className="text-sm text-muted-foreground bg-muted/30 rounded-md p-3">
                    Click "Fetch latest image" to load the image from the candidate's latest WhatsApp message
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isCreating}
          >
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={handleCreate}
            disabled={
              isCreating || 
              (source === "url" && !imageUrl.trim()) ||
              (source === "whatsapp" && (!imageUrl.trim() || !sourceMessageId || isLoadingImage))
            }
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {isCreating ? "Creating..." : "Create Verification Task"}
          </Button>
        </div>
      </div>
    </div>
  );
}

