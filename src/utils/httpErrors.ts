/**
 * HTTP Error Helpers
 * 
 * Provides consistent error handling for unauthorized access.
 * Returns 404 "Not found" to avoid leaking whether a resource exists in another agency.
 */

import { FastifyReply } from "fastify";

/**
 * Custom 404 error class for consistent error handling
 */
export class NotFoundError extends Error {
  constructor(message: string = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Throw 404 error if resource is null/undefined
 * 
 * This ensures consistent error behavior: if a resource is not found
 * (either doesn't exist or belongs to another agency), throw NotFoundError.
 * This prevents information leakage about resource existence.
 * 
 * @param resource The resource to check (can be null/undefined)
 * @param message Optional error message (default: "Not found")
 * @returns The resource if it exists (type guard)
 * @throws NotFoundError if resource is null/undefined
 * 
 * @example
 * const task = await prisma.task.findFirst({ where: { id, agencyId } });
 * notFoundIfNull(task); // Throws NotFoundError if task is null
 */
export function notFoundIfNull<T>(
  resource: T | null | undefined,
  message: string = "Not found"
): asserts resource is T {
  if (resource === null || resource === undefined) {
    throw new NotFoundError(message);
  }
}

/**
 * Create a 404 error response
 * 
 * Helper to create consistent 404 responses without leaking information
 * about whether a resource exists in another agency.
 * 
 * @param reply Fastify reply object
 * @param message Optional custom error message (default: "Not found")
 * @returns Fastify reply with 404 status
 */
export function notFound(reply: FastifyReply, message: string = "Not found"): FastifyReply {
  return reply.status(404).send({ error: message });
}
