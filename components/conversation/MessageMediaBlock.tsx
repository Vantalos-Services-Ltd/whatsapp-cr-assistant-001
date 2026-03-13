"use client";

import { useState } from "react";
import type { MessageMediaDTO, MessageTranscriptDTO } from "@/shared/dto/operator";
import { ZoomIn, FileText, Volume2 } from "lucide-react";

interface MessageMediaBlockProps {
  media?: MessageMediaDTO[] | null;
  transcript?: MessageTranscriptDTO | null;
}

export function MessageMediaBlock({ media, transcript }: MessageMediaBlockProps) {
  const [expandedImage, setExpandedImage] = useState<string | null>(null);

  if (!media || media.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 mt-2">
      {/* Media Items */}
      {media.map((item) => {
        if (item.kind === "image") {
          return (
            <div key={item.sid} className="relative group">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg border border-border overflow-hidden bg-muted/30 hover:bg-muted/50 transition-colors"
                onClick={(e) => {
                  e.preventDefault();
                  setExpandedImage(item.url);
                }}
              >
                <img
                  src={item.url}
                  alt="Image attachment"
                  className="w-full max-w-xs max-h-48 object-contain cursor-pointer"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                  <ZoomIn className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </a>
            </div>
          );
        }

        if (item.kind === "audio") {
          return (
            <div key={item.sid} className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <Volume2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Audio message</span>
              {item.durationSeconds && (
                <span className="text-xs text-muted-foreground">
                  ({Math.round(item.durationSeconds)}s)
                </span>
              )}
            </div>
          );
        }

        // Document
        return (
          <div key={item.sid} className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              Document
            </a>
            <span className="text-xs text-muted-foreground">({item.contentType})</span>
          </div>
        );
      })}

      {/* Transcript for audio */}
      {transcript?.text && (
        <div className="mt-2 rounded-lg border border-border bg-blue-50 dark:bg-blue-900/20 px-3 py-2">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-xs font-medium text-blue-700 dark:text-blue-400">
              Transcribed
            </span>
            {transcript.language && (
              <span className="text-xs text-muted-foreground">({transcript.language})</span>
            )}
          </div>
          <p className="text-sm text-foreground whitespace-pre-wrap break-words">
            {transcript.text}
          </p>
        </div>
      )}

      {/* Image Modal */}
      {expandedImage && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setExpandedImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] bg-white rounded-lg overflow-hidden">
            <button
              onClick={() => setExpandedImage(null)}
              className="absolute top-4 right-4 z-10 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors"
              aria-label="Close"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
            <img
              src={expandedImage}
              alt="Expanded image"
              className="w-full h-full object-contain max-h-[90vh]"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
}

