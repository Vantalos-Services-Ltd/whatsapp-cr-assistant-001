/**
 * Agency Context - Single source of truth for agency resolution
 * 
 * This module provides centralized agency ID resolution for all requests,
 * ensuring consistent agency scoping across the application.
 * 
 * Behavior:
 * - If session contains agencyId, use it (future multi-tenant support)
 * - Else fallback to the first agency in DB (current single-tenant assumption)
 * - Cache per request to avoid multiple DB queries
 */

import { FastifyRequest } from "fastify";
import { prisma } from "../db/prisma.ts";

/**
 * Request context key for caching agencyId per request
 * Using string key for testability and simplicity
 */
const AGENCY_ID_CONTEXT_KEY = "__agencyId__";

/**
 * Get agencyId from request with caching
 * 
 * Checks:
 * 1. Request context cache (if already resolved in this request)
 * 2. Session agencyId (if present - future multi-tenant support)
 * 3. Fallback to first agency in DB (current single-tenant assumption)
 * 
 * @param request Fastify request object
 * @returns Agency ID string
 */
export async function getAgencyIdFromRequest(
  request: FastifyRequest
): Promise<string> {
  // Check request context cache first (avoid multiple DB queries per request)
  const cached = (request as any)[AGENCY_ID_CONTEXT_KEY];
  if (cached) {
    return cached;
  }

  // Check session for agencyId (future multi-tenant support)
  // Note: We don't add this to session in this prompt, but we check for it
  const session = (request as any).session;
  const sessionAgencyId = session?.agencyId;
  if (sessionAgencyId && typeof sessionAgencyId === "string") {
    // Cache it for this request
    (request as any)[AGENCY_ID_CONTEXT_KEY] = sessionAgencyId;
    return sessionAgencyId;
  }

  // Fallback: Get first agency (current single-tenant assumption)
  // This matches existing behavior across the codebase
  const agency = await prisma.agency.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!agency) {
    throw new Error("No agency found. Please seed an agency first.");
  }

  // Cache for this request
  (request as any)[AGENCY_ID_CONTEXT_KEY] = agency.id;
  return agency.id;
}

/**
 * Require agencyId from request (throws if cannot resolve)
 * 
 * Same as getAgencyIdFromRequest but throws a controlled error
 * if no agency can be resolved.
 * 
 * @param request Fastify request object
 * @returns Agency ID string (never null/undefined)
 * @throws Error if no agency can be resolved
 */
export async function requireAgencyId(
  request: FastifyRequest
): Promise<string> {
  try {
    return await getAgencyIdFromRequest(request);
  } catch (error) {
    // Re-throw with clear message
    if (error instanceof Error) {
      throw new Error(`Failed to resolve agency: ${error.message}`);
    }
    throw new Error("Failed to resolve agency: Unknown error");
  }
}

/**
 * Require operatorId from request session
 * 
 * Gets the operator ID from the request session and throws an error
 * if it's not present.
 * 
 * @param request Fastify request object
 * @returns Operator ID string (never null/undefined)
 * @throws Error if operatorId is missing from session
 */
export function requireOperatorId(request: FastifyRequest): string {
  const session = (request as any).session;
  if (!session?.operatorId) {
    throw new Error("Operator ID missing from session");
  }
  return session.operatorId;
}

/**
 * Get agencyId for webhook requests (no session available)
 * 
 * For webhook requests that don't have a session, this provides
 * a deterministic way to get the agency ID.
 * 
 * Currently uses the same fallback logic (first agency),
 * but can be extended to use webhook-specific logic (e.g., phone number mapping).
 * 
 * @returns Agency ID string
 */
export async function getAgencyIdForWebhook(): Promise<string> {
  const agency = await prisma.agency.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!agency) {
    throw new Error("No agency found. Please seed an agency first.");
  }

  return agency.id;
}

