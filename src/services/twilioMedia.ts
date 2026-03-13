/**
 * Helper functions for extracting media from Twilio WhatsApp payloads
 */

/**
 * Media item extracted from Twilio payload
 */
export interface MediaItem {
  sid: string; // Media SID (extracted from URL or generated)
  url: string; // Media URL
  contentType: string; // MIME type (e.g., "audio/ogg", "image/jpeg", "application/pdf")
  kind: "image" | "audio" | "document"; // Media type derived from contentType
  sizeBytes?: number | null; // File size in bytes (if available)
  durationSeconds?: number | null; // Duration for audio/video (if available)
  receivedAt: string; // ISO date string
}

/**
 * Derive media kind from content type
 */
function deriveMediaKind(contentType: string): "image" | "audio" | "document" {
  const normalized = contentType.toLowerCase().trim();
  if (normalized.startsWith("audio/") || normalized.startsWith("video/")) {
    return "audio";
  }
  if (normalized.startsWith("image/")) {
    return "image";
  }
  return "document";
}

/**
 * Extract media SID from Twilio media URL
 * Twilio media URLs format: https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages/{MessageSid}/Media/{MediaSid}
 */
function extractMediaSidFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split("/");
    const mediaIndex = pathParts.indexOf("Media");
    if (mediaIndex >= 0 && mediaIndex < pathParts.length - 1) {
      return pathParts[mediaIndex + 1] || null;
    }
    // Fallback: use a hash of the URL as SID
    return `media_${Buffer.from(url).toString("base64url").substring(0, 16)}`;
  } catch {
    // If URL parsing fails, generate a fallback SID
    return `media_${Buffer.from(url).toString("base64url").substring(0, 16)}`;
  }
}

/**
 * Extract all media items from a Twilio WhatsApp inbound payload
 * 
 * Twilio sends media in the following format:
 * - NumMedia: number of media items (0, 1, 2, ...) - can be string or number
 * - MediaUrl0, MediaUrl1, ...: URLs for each media item
 * - MediaContentType0, MediaContentType1, ...: MIME types for each media item
 * 
 * @param rawPayload - The raw payload from Twilio (can be null, stringified JSON, or object)
 * @returns Array of media items, empty array if no media
 */
export function extractInboundMediaFromTwilio(rawPayload: unknown): MediaItem[] {
  // Handle null or undefined
  if (rawPayload === null || rawPayload === undefined) {
    return [];
  }

  // Try to parse if it's a string (might be stringified JSON)
  let payload: any;
  if (typeof rawPayload === "string") {
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      // If parsing fails, it's not valid JSON, return empty array
      return [];
    }
  } else if (typeof rawPayload === "object") {
    payload = rawPayload;
  } else {
    // Not a string or object, can't extract media
    return [];
  }

  // Check if NumMedia exists
  const numMedia = payload.NumMedia;
  if (numMedia === null || numMedia === undefined) {
    return [];
  }

  // NumMedia can be a string or number - convert to number for comparison
  const numMediaValue = typeof numMedia === "string" 
    ? parseInt(numMedia, 10) 
    : typeof numMedia === "number" 
    ? numMedia 
    : null;

  // Check if NumMedia > 0
  if (numMediaValue === null || isNaN(numMediaValue) || numMediaValue <= 0) {
    return [];
  }

  const mediaItems: MediaItem[] = [];
  const receivedAt = new Date().toISOString();

  // Extract each media item (0-indexed)
  for (let i = 0; i < numMediaValue; i++) {
    const mediaUrl = payload[`MediaUrl${i}`];
    const mediaContentType = payload[`MediaContentType${i}`] || "application/octet-stream";

    // Skip if URL is missing or empty
    if (typeof mediaUrl !== "string" || mediaUrl.trim().length === 0) {
      continue;
    }

    // Extract or generate media SID
    const sid = extractMediaSidFromUrl(mediaUrl) || `media_${i}_${Date.now()}`;

    // Derive kind from content type
    const kind = deriveMediaKind(mediaContentType);

    mediaItems.push({
      sid,
      url: mediaUrl.trim(),
      contentType: mediaContentType.trim(),
      kind,
      sizeBytes: null, // Twilio doesn't provide size in webhook
      durationSeconds: null, // Twilio doesn't provide duration in webhook
      receivedAt,
    });
  }

  return mediaItems;
}

/**
 * Extract the first media URL from a Twilio WhatsApp inbound payload
 * 
 * @deprecated Use extractInboundMediaFromTwilio instead for full media extraction
 * @param rawPayload - The raw payload from Twilio (can be null, stringified JSON, or object)
 * @returns The first media URL if available, null otherwise
 */
export function extractFirstMediaUrl(rawPayload: unknown): string | null {
  const mediaItems = extractInboundMediaFromTwilio(rawPayload);
  return mediaItems.length > 0 ? mediaItems[0].url : null;
}

