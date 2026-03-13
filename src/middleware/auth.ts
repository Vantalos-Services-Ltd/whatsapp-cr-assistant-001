/**
 * Authentication middleware to protect /api/* routes
 */

import { FastifyRequest, FastifyReply } from "fastify";

/**
 * Middleware to check if operator is authenticated
 * Returns 401 if not authenticated
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
) {
  // DEBUG: Log session state only when DEBUG_AUTH env flag is set
  if (process.env.DEBUG_AUTH === "1") {
    request.log.warn({
      msg: "DEBUG: requireAuth middleware auth state",
      endpoint: request.url,
      cookieKeys: Object.keys(request.cookies ?? {}),
      hasCookieHeader: Boolean(request.headers.cookie),
      hasSession: Boolean((request as any).session),
      sessionKeys: Object.keys(((request as any).session ?? {}) as any),
      operatorId: (request as any).session?.operatorId,
      userId: (request as any).session?.userId,
      operator: (request as any).session?.operator,
    });
  }

  const operatorId = (request.session as any)?.operatorId;

  if (!operatorId) {
    return reply.status(401).send({ error: "Authentication required" });
  }

  // Attach operatorId to request for use in handlers
  (request as any).operatorId = operatorId;
}

