/**
 * Error serialization helper
 * Safely serializes errors including Prisma errors
 */

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  meta?: unknown;
}

/**
 * Serialize an error to a safe object for logging
 * Handles Prisma errors and other error types
 */
export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const serialized: SerializedError = {
      name: error.name,
      message: error.message,
    };

    // Include stack if available
    if (error.stack) {
      serialized.stack = error.stack;
    }

    // Handle Prisma errors (they have code and meta)
    if ("code" in error && typeof error.code === "string") {
      serialized.code = error.code;
    }

    if ("meta" in error) {
      serialized.meta = error.meta;
    }

    return serialized;
  }

  // Fallback for non-Error types
  return {
    name: "Unknown",
    message: String(error),
  };
}

