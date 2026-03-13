/**
 * Transcription service for voice notes
 * Handles OpenAI Whisper API transcription with cost control and idempotency
 */

import pino from "pino";
import { env } from "../config/env.ts";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createWriteStream } from "fs";

const log = pino({ name: "transcriptionService" });

/**
 * Transcription configuration
 */
export interface TranscriptionConfig {
  maxDurationSeconds?: number; // Default: 90 seconds
  maxSizeBytes?: number; // Default: 25MB (25 * 1024 * 1024)
  enabled?: boolean; // Default: true if OPENAI_API_KEY is set
}

const DEFAULT_CONFIG: Required<TranscriptionConfig> = {
  maxDurationSeconds: 90,
  maxSizeBytes: 25 * 1024 * 1024, // 25MB
  enabled: true,
};

/**
 * Media item (from message metadata)
 */
export interface MediaItem {
  sid: string;
  url: string;
  contentType: string;
  kind: "image" | "audio" | "document";
  sizeBytes?: number | null;
  durationSeconds?: number | null;
  receivedAt: string;
}

/**
 * Transcription result
 */
export interface TranscriptionResult {
  text: string;
  language?: string | null;
  duration?: number | null;
  provider: string;
  createdAt: string;
  confidence?: number | null;
}

/**
 * Transcription error result
 */
export interface TranscriptionErrorResult {
  text: null;
  error: string;
  createdAt: string;
  provider: string;
}

/**
 * Check if a media item should be transcribed
 */
export function shouldTranscribe(
  mediaItem: MediaItem,
  config: TranscriptionConfig = {}
): { should: boolean; reason?: string } {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  finalConfig.enabled = finalConfig.enabled && !!env.OPENAI_API_KEY;

  // Check if transcription is enabled
  if (!finalConfig.enabled) {
    return { should: false, reason: "Transcription disabled or OPENAI_API_KEY not set" };
  }

  // Only transcribe audio
  if (mediaItem.kind !== "audio") {
    return { should: false, reason: "Not an audio file" };
  }

  // Check duration limit
  if (mediaItem.durationSeconds !== null && mediaItem.durationSeconds !== undefined) {
    if (mediaItem.durationSeconds > finalConfig.maxDurationSeconds) {
      return {
        should: false,
        reason: `Audio too long: ${mediaItem.durationSeconds}s > ${finalConfig.maxDurationSeconds}s`,
      };
    }
  }

  // Check size limit
  if (mediaItem.sizeBytes !== null && mediaItem.sizeBytes !== undefined) {
    if (mediaItem.sizeBytes > finalConfig.maxSizeBytes) {
      return {
        should: false,
        reason: `Audio too large: ${mediaItem.sizeBytes} bytes > ${finalConfig.maxSizeBytes} bytes`,
      };
    }
  }

  return { should: true };
}

/**
 * Download audio from URL to temporary file
 */
async function downloadAudioToTempFile(url: string): Promise<string> {
  const tempDir = os.tmpdir();
  const tempFile = path.join(tempDir, `transcription_${Date.now()}_${Math.random().toString(36).substring(7)}.tmp`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download audio: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error("Response body is null");
    }

    // Convert ReadableStream to Node.js stream and write to file
    const writeStream = createWriteStream(tempFile);
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        writeStream.write(Buffer.from(value));
      }
      writeStream.end();
    } finally {
      // Wait for write stream to finish
      await new Promise<void>((resolve, reject) => {
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
      });
    }

    return tempFile;
  } catch (error) {
    // Clean up temp file on error
    try {
      await fs.unlink(tempFile);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Transcribe audio from URL using OpenAI Whisper API
 */
export async function transcribeAudioFromUrl(
  url: string,
  options: {
    language?: string | null;
    timeoutMs?: number;
  } = {}
): Promise<TranscriptionResult> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const timeoutMs = options.timeoutMs || 30000; // 30 seconds default
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let tempFile: string | null = null;

  try {
    log.info({ url }, "Starting audio transcription");

    // Download audio to temp file
    tempFile = await downloadAudioToTempFile(url);
    const fileStats = await fs.stat(tempFile);
    log.debug({ tempFile, size: fileStats.size }, "Audio downloaded to temp file");

    // Read file as buffer
    const fileBuffer = await fs.readFile(tempFile);
    const fileBlob = new Blob([fileBuffer], { type: "audio/ogg" });

    // Create form data (native FormData in Node.js 18+)
    const formData = new FormData();
    formData.append("file", fileBlob, "audio.ogg");
    formData.append("model", "whisper-1");
    if (options.language) {
      formData.append("language", options.language);
    }

    // Call OpenAI transcription API
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      log.warn(
        {
          status: response.status,
          statusText: response.statusText,
          errorBody: errorText.slice(0, 500),
        },
        "OpenAI transcription API error"
      );
      throw new Error(`OpenAI transcription failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    const transcriptText = result.text || "";

    log.info(
      {
        url,
        transcriptLength: transcriptText.length,
        language: result.language || null,
      },
      "Audio transcription completed"
    );

    return {
      text: transcriptText,
      language: result.language || null,
      duration: null, // OpenAI doesn't return duration
      provider: "openai",
      createdAt: new Date().toISOString(),
      confidence: null, // OpenAI doesn't return confidence
    };
  } catch (error: any) {
    clearTimeout(timeout);
    if (error.name === "AbortError") {
      log.warn({ url }, "Transcription timeout");
      throw new Error("Transcription timeout");
    }
    log.error({ url, error: error.message }, "Transcription failed");
    throw error;
  } finally {
    // Clean up temp file
    if (tempFile) {
      try {
        await fs.unlink(tempFile);
      } catch (error) {
        log.warn({ tempFile, error }, "Failed to delete temp file");
      }
    }
  }
}

/**
 * Check if message already has a transcript for the given media SID
 */
export async function hasExistingTranscript(
  messageId: string,
  mediaSid: string
): Promise<boolean> {
  try {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { metadata: true },
    });

    if (!message || !message.metadata) {
      return false;
    }

    const metadata = message.metadata as any;
    if (!metadata.transcript) {
      return false;
    }

    // Check if transcript exists and is not an error
    const transcript = metadata.transcript;
    if (transcript.text === null || transcript.text === undefined) {
      // Error transcript, can retry
      return false;
    }

    // Check if this transcript is for the same media SID
    // We store media SID in transcript for tracking
    if (transcript.mediaSid === mediaSid) {
      return true;
    }

    return false;
  } catch (error) {
    log.warn({ messageId, mediaSid, error }, "Failed to check existing transcript");
    return false;
  }
}

/**
 * Update message metadata with transcript
 */
export async function updateMessageTranscript(
  messageId: string,
  mediaSid: string,
  transcript: TranscriptionResult | TranscriptionErrorResult
): Promise<void> {
  try {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { metadata: true },
    });

    if (!message) {
      throw new Error(`Message not found: ${messageId}`);
    }

    const metadata = (message.metadata as any) || {};
    const updatedMetadata = {
      ...metadata,
      transcript: {
        ...transcript,
        mediaSid, // Store media SID for tracking
      },
      // Update textForAI: use transcript text if available, else keep existing or use original body
      textForAI: transcript.text || metadata.textForAI || null,
    };

    await prisma.message.update({
      where: { id: messageId },
      data: { metadata: updatedMetadata as any },
    });

    log.debug({ messageId, mediaSid, hasText: !!transcript.text }, "Message transcript updated");
  } catch (error) {
    log.error({ messageId, mediaSid, error }, "Failed to update message transcript");
    throw error;
  }
}

// Import prisma at the end to avoid circular dependencies
import { prisma } from "../db/prisma.ts";

