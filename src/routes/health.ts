import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/health", async (request, reply) => {
    return {
      ok: true,
      service: "vantalos-recruiter",
    };
  });
}

/**
 * Authenticated health check endpoint for status pill heartbeat
 * GET /api/health
 * Requires authentication (via preHandler in index.ts)
 */
export async function authenticatedHealthHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  return reply.status(200).send({
    ok: true,
    serverTime: new Date().toISOString(),
  });
}

