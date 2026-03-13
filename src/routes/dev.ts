/**
 * Development-only routes for testing and debugging
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db/prisma.ts";
import { requireAuth } from "../middleware/auth.ts";
import { inboundQueue } from "../queues/inboundQueue.ts";

interface CandidateParams {
  phone: string;
}

/**
 * GET /api/dev/candidates/:phone
 * Inspect candidate profile by phone number
 * Dev-only route (should be disabled in production)
 */
export async function getCandidateByPhoneHandler(
  request: FastifyRequest<{
    Params: CandidateParams;
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const { phone } = request.params;

  // Only allow in development
  if (process.env.NODE_ENV === "production") {
    return reply.status(403).send({ error: "Dev routes disabled in production" });
  }

  try {
    // Find candidate by phone (assuming single agency for now)
    const agency = await prisma.agency.findFirst({
      orderBy: { createdAt: "asc" },
    });

    if (!agency) {
      return reply.status(404).send({ error: "No agency found" });
    }

    const candidate = await prisma.candidate.findFirst({
      where: {
        agencyId: agency.id,
        phone,
      },
      include: {
        lastConversation: {
          include: {
            messages: {
              orderBy: { createdAt: "desc" },
              take: 5,
              select: {
                direction: true,
                text: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!candidate) {
      return reply.status(404).send({ error: "Candidate not found" });
    }

    logger.info(
      {
        candidateId: candidate.id,
        phone,
      },
      "Retrieved candidate profile"
    );

    return reply.status(200).send({
      candidate: {
        id: candidate.id,
        phone: candidate.phone,
        name: candidate.name,
        location: candidate.location,
        desiredRole: candidate.desiredRole,
        skills: candidate.skills,
        yearsExperience: candidate.yearsExperience,
        salaryMin: candidate.salaryMin,
        salaryMax: candidate.salaryMax,
        currency: candidate.currency,
        availabilityNotes: candidate.availabilityNotes,
        lastSeenAt: candidate.lastSeenAt,
        source: candidate.source,
        rawProfile: candidate.rawProfile,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt,
        lastConversationId: candidate.lastConversationId,
        lastConversation: candidate.lastConversation
          ? {
              id: candidate.lastConversation.id,
              lastMessageAt: candidate.lastConversation.lastMessageAt,
              recentMessages: candidate.lastConversation.messages,
            }
          : null,
      },
    });
  } catch (error) {
    logger.error({ error, phone }, "Failed to retrieve candidate");
    return reply.status(500).send({ error: "Failed to retrieve candidate" });
  }
}

/**
 * GET /api/debug/queues/inbound-messages
 * Inspect inbound-messages queue state
 * Dev-only route (enabled in development or with DEBUG_QUEUES=1)
 */
export async function getInboundQueueStateHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const logger = request.log;

  // Only allow in development or with DEBUG_QUEUES=1
  if (process.env.NODE_ENV === "production" && process.env.DEBUG_QUEUES !== "1") {
    return reply.status(403).send({ error: "Queue debug routes disabled in production" });
  }

  try {
    // Get queue counts
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      inboundQueue.getWaitingCount(),
      inboundQueue.getActiveCount(),
      inboundQueue.getCompletedCount(),
      inboundQueue.getFailedCount(),
      inboundQueue.getDelayedCount(),
    ]);

    // Get recent jobs for context
    const [waitingJobs, activeJobs, failedJobs] = await Promise.all([
      inboundQueue.getWaiting(0, 5), // Get first 5 waiting jobs
      inboundQueue.getActive(0, 5), // Get first 5 active jobs
      inboundQueue.getFailed(0, 5), // Get first 5 failed jobs
    ]);

    logger.info(
      {
        waiting,
        active,
        completed,
        failed,
        delayed,
      },
      "Retrieved inbound queue state"
    );

    return reply.status(200).send({
      queue: "inbound-messages",
      counts: {
        waiting,
        active,
        completed,
        failed,
        delayed,
      },
      recent: {
        waiting: waitingJobs.map((job) => ({
          id: job.id,
          messageId: job.data?.messageId,
          agencyId: job.data?.agencyId,
          createdAt: job.timestamp,
        })),
        active: activeJobs.map((job) => ({
          id: job.id,
          messageId: job.data?.messageId,
          agencyId: job.data?.agencyId,
          processedOn: job.processedOn,
        })),
        failed: failedJobs.map((job) => ({
          id: job.id,
          messageId: job.data?.messageId,
          agencyId: job.data?.agencyId,
          failedReason: job.failedReason,
          failedAt: job.finishedOn,
        })),
      },
    });
  } catch (error) {
    logger.error({ error }, "Failed to retrieve queue state");
    return reply.status(500).send({ error: "Failed to retrieve queue state" });
  }
}

export async function devRoutes(fastify: FastifyInstance) {
  // Only register in development
  if (process.env.NODE_ENV === "production") {
    return;
  }

  fastify.addHook("onRequest", requireAuth);
  fastify.get("/candidates/:phone", getCandidateByPhoneHandler);
}

export async function debugRoutes(fastify: FastifyInstance) {
  // Only register in development or with DEBUG_QUEUES=1
  if (process.env.NODE_ENV === "production" && process.env.DEBUG_QUEUES !== "1") {
    return;
  }

  fastify.addHook("onRequest", requireAuth);
  fastify.get("/queues/inbound-messages", getInboundQueueStateHandler);
}

