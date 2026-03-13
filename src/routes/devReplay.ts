/**
 * Dev-only Replay Endpoint
 * 
 * Allows developers to safely replay inbound message processing without:
 * - Creating duplicate tasks
 * - Creating duplicate timeline events
 * - Sending duplicate outbound messages
 * 
 * Guarded by NODE_ENV check and requires authentication.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db/prisma.ts";
import { requireAuth } from "../middleware/auth.ts";
import { requireAgencyId } from "../utils/agencyContext.ts";
import { scopeWhere } from "../db/tenantScope.ts";
import { enqueueInboundMessage } from "../queues/inboundQueue.ts";
import { TaskType, TaskStatus, TaskApprovalStatus, MessageSenderRole, MessageDirection } from "@prisma/client";
import { env } from "../config/env.ts";

/**
 * POST /api/dev/replay-inbound
 * Replay inbound message processing (dev only)
 * 
 * Body:
 * - messageId: string (required) - Message ID to replay
 * - twilioSid: string (optional) - Alternative: Twilio SID to lookup message
 * - options:
 *   - dryRun: boolean (default: true) - If true, do not send anything, but log what would happen
 *   - allowSendOutbound: boolean (default: false) - Allow sending outbound messages
 *   - forceRecomputeMemory: boolean (default: true) - Force recompute memory pack
 *   - forceRecomputeProgress: boolean (default: true) - Force recompute progress
 * 
 * Idempotency:
 * - Checks for existing tasks with same conversationId + type + relatedMessageId
 * - Skips task creation if duplicate found, updates existing task instead
 * - Uses timeline dedupe keys to prevent duplicate events
 */
export async function replayInboundHandler(
  request: FastifyRequest<{
    Body: {
      messageId?: string;
      twilioSid?: string;
      options?: {
        dryRun?: boolean;
        allowSendOutbound?: boolean;
        forceRecomputeMemory?: boolean;
        forceRecomputeProgress?: boolean;
      };
    };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;

  // Guard: Only allow in development
  if (env.NODE_ENV !== "development") {
    logger.warn({ path: request.url }, "Replay endpoint called in non-dev environment - returning 404");
    return reply.status(404).send({ error: "Not found" });
  }

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    const { messageId, twilioSid, options = {} } = request.body;
    const {
      dryRun = true,
      allowSendOutbound = false,
      forceRecomputeMemory = true,
      forceRecomputeProgress = true,
    } = options;

    // Must provide either messageId or twilioSid
    if (!messageId && !twilioSid) {
      return reply.status(400).send({ error: "Either messageId or twilioSid is required" });
    }

    // Load message and verify it belongs to agency
    let message;
    if (messageId) {
      message = await prisma.message.findFirst({
        where: scopeWhere(agencyId, { id: messageId }),
        include: {
          contact: {
            select: {
              phone: true,
            },
          },
          conversation: {
            select: {
              id: true,
              state: true,
            },
          },
        },
      });
    } else if (twilioSid) {
      message = await prisma.message.findFirst({
        where: scopeWhere(agencyId, { providerMessageId: twilioSid }),
        include: {
          contact: {
            select: {
              phone: true,
            },
          },
          conversation: {
            select: {
              id: true,
              state: true,
            },
          },
        },
      });
    }

    if (!message) {
      return reply.status(404).send({ error: "Message not found" });
    }

    // Verify message is inbound HUMAN message
    if (message.direction !== MessageDirection.INBOUND) {
      return reply.status(400).send({ error: "Message must be an inbound message" });
    }

    const senderRole = (message as any).senderRole as MessageSenderRole | undefined;
    if (senderRole !== MessageSenderRole.HUMAN) {
      return reply.status(400).send({ error: "Message must be from a HUMAN sender" });
    }

    logger.info(
      {
        messageId: message.id,
        agencyId,
        dryRun,
        allowSendOutbound,
        forceRecomputeMemory,
        forceRecomputeProgress,
      },
      "Replaying inbound message processing"
    );

    // Enqueue with replay options
    const job = await enqueueInboundMessage(
      agencyId,
      message.id,
      {
        replay: true,
        dryRun,
        allowSendOutbound,
        forceRecomputeMemory,
        forceRecomputeProgress,
      }
    );

    logger.info(
      { messageId: message.id, agencyId, jobId: job.id },
      "Message re-enqueued for replay processing"
    );

    return reply.status(200).send({
      success: true,
      messageId: message.id,
      jobId: job.id,
      message: "Message re-enqueued for replay processing",
      options: {
        dryRun,
        allowSendOutbound,
        forceRecomputeMemory,
        forceRecomputeProgress,
      },
    });
  } catch (error) {
    logger.error({ error, messageId: request.body?.messageId }, "Failed to replay inbound message");
    return reply.status(500).send({ error: "Failed to replay inbound message" });
  }
}

/**
 * Register dev replay routes
 * Only registered in development mode
 */
export function devReplayRoutes(fastify: FastifyInstance) {
  // Guard: Only register in development
  if (env.NODE_ENV === "production") {
    return;
  }

  fastify.post(
    "/dev/replay-inbound",
    { preHandler: [requireAuth] },
    replayInboundHandler
  );
}

