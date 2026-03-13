import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import twilio from "twilio";
import { env } from "../../config/env.ts";
import { prisma } from "../../db/prisma.ts";
import { enqueueInboundMessage } from "../../queues/inboundQueue.ts";
import { getAgencyIdForWebhook } from "../../utils/agencyContext.ts";
import { extractInboundMediaFromTwilio } from "../../services/twilioMedia.ts";
import { serializeError } from "../../utils/errors.ts";
import { createTimelineEvent } from "../../services/timelineService.ts";
import {
  ContactType,
  MessageDirection,
  MessageChannel,
  MessageDeliveryStatus,
  MessageSenderRole,
} from "@prisma/client";

/**
 * Twilio WhatsApp webhook payload (form-urlencoded)
 */
interface TwilioWebhookPayload {
  From: string;
  To: string;
  Body: string;
  MessageSid: string;
  ProfileName?: string;
  [key: string]: string | undefined;
}

/**
 * Generate a UI snippet for messages with media but no text body
 */
function generateMediaSnippet(mediaItems: ReturnType<typeof extractInboundMediaFromTwilio>): string {
  if (mediaItems.length === 0) {
    return "";
  }

  const hasAudio = mediaItems.some((m) => m.kind === "audio");
  const hasImage = mediaItems.some((m) => m.kind === "image");
  const hasDocument = mediaItems.some((m) => m.kind === "document");

  if (hasAudio) {
    return "🎤 Audio message";
  }
  if (hasImage) {
    return "📷 Image received";
  }
  if (hasDocument) {
    return "📎 Document received";
  }

  // Fallback for mixed or unknown
  return `📎 ${mediaItems.length} media file${mediaItems.length > 1 ? "s" : ""}`;
}

/**
 * Normalize Twilio payload into internal message format
 */
function normalizeTwilioPayload(payload: TwilioWebhookPayload) {
  // Extract media items
  const mediaItems = extractInboundMediaFromTwilio(payload);

  // Get text body, or generate snippet if empty but has media
  let text = payload.Body || "";
  if (!text.trim() && mediaItems.length > 0) {
    text = generateMediaSnippet(mediaItems);
  }

  return {
    fromPhone: payload.From,
    toPhone: payload.To,
    text,
    providerMessageId: payload.MessageSid,
    rawPayload: payload as Record<string, string | undefined>,
    mediaItems,
  };
}

/**
 * Determine sender role based on phone number
 * If From == business Twilio number → AI
 * Otherwise → HUMAN
 */
function determineSenderRole(fromPhone: string): MessageSenderRole {
  // Normalize phone numbers for comparison (remove whatsapp: prefix if present)
  const normalizedFrom = fromPhone.replace(/^whatsapp:/i, "").trim();
  const normalizedTwilioNumber = env.TWILIO_WHATSAPP_NUMBER.replace(/^whatsapp:/i, "").trim();
  
  if (normalizedFrom === normalizedTwilioNumber) {
    return MessageSenderRole.AI;
  }
  return MessageSenderRole.HUMAN;
}

// Removed getDefaultAgency() - use getAgencyIdForWebhook() from agencyContext instead

/**
 * Upsert contact by agency + phone
 * ONLY creates contacts for HUMAN messages (not AI/system)
 */
async function upsertContact(
  agencyId: string,
  phone: string,
  profileName?: string,
  senderRole?: MessageSenderRole
) {
  // CRITICAL: Only create contacts for HUMAN messages
  // AI/system messages should never create contacts
  if (senderRole === MessageSenderRole.AI || senderRole === MessageSenderRole.OPERATOR) {
    // For AI/OPERATOR messages, find existing contact if it exists, but don't create
    const existing = await prisma.contact.findUnique({
      where: {
        agencyId_phone: {
          agencyId,
          phone,
        },
      },
    });
    if (!existing) {
      throw new Error(`Cannot create contact for AI/OPERATOR message. Phone: ${phone}`);
    }
    return existing;
  }

  return prisma.contact.upsert({
    where: {
      agencyId_phone: {
        agencyId,
        phone,
      },
    },
    update: {
      ...(profileName ? { name: profileName.trim() } : {}),
    },
    create: {
      agencyId,
      phone,
      name: profileName?.trim() || null,
      type: ContactType.UNKNOWN,
      optedOut: false,
    },
  });
}

/**
 * Find or create conversation
 * ONLY creates conversations for HUMAN contacts
 * AI messages attach to existing conversations but never create new ones
 */
async function findOrCreateConversation(
  agencyId: string,
  contactId: string,
  senderRole?: MessageSenderRole
) {
  const now = new Date();

  const existing = await prisma.conversation.findFirst({
    where: { agencyId, contactId },
  });

  if (existing) {
    return prisma.conversation.update({
      where: { id: existing.id },
      data: { lastMessageAt: now },
    });
  }

  // CRITICAL: Only create conversations for HUMAN messages
  // AI/system messages should attach to existing conversations only
  if (senderRole === MessageSenderRole.AI || senderRole === MessageSenderRole.OPERATOR) {
    throw new Error(`Cannot create conversation for AI/OPERATOR message. ContactId: ${contactId}`);
  }

  return prisma.conversation.create({
    data: {
      agencyId,
      contactId,
      lastMessageAt: now,
    },
  });
}

/**
 * Create inbound message (append-only)
 */
async function createInboundMessage(
  agencyId: string,
  contactId: string,
  conversationId: string,
  normalized: ReturnType<typeof normalizeTwilioPayload>,
  senderRole: MessageSenderRole
) {
  // Note: metadata is not stored in Message model - it's added later via updates if needed
  // Media info is available in rawPayload if needed

  return prisma.message.create({
    data: {
      agencyId,
      contactId,
      conversationId,
      direction: MessageDirection.INBOUND,
      channel: MessageChannel.WHATSAPP,
      senderRole,
      text: normalized.text,
      providerMessageId: normalized.providerMessageId,
      deliveryStatus: MessageDeliveryStatus.SENT,
      rawPayload: normalized.rawPayload as any,
    },
  });
}

/**
 * WhatsApp webhook handler
 */
async function whatsappWebhookHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const logger = request.log;

  // ---- 1. Validate Twilio signature ----
  const signature = request.headers["x-twilio-signature"] as
    | string
    | undefined;

  if (!signature) {
    logger.warn("Missing Twilio signature");
    return reply.status(401).send({ error: "Invalid signature" });
  }

  const proto =
    (request.headers["x-forwarded-proto"] as string)?.split(",")[0] ??
    request.protocol;

  const host = request.headers.host;
  const url = `${proto}://${host}${request.raw.url}`;

  const params = request.body as Record<string, string>;

  const isValid = twilio.validateRequest(
    env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    params
  );

  if (!isValid) {
    logger.warn({ url }, "Invalid Twilio signature");
    return reply.status(401).send({ error: "Invalid signature" });
  }

  // ---- 2. Parse & normalize payload ----
  const body = request.body as TwilioWebhookPayload;
  const normalized = normalizeTwilioPayload(body);

  // ---- 3. Determine sender role ----
  // If From == business Twilio number → AI
  // Otherwise → HUMAN
  const senderRole = determineSenderRole(normalized.fromPhone);

  logger.info(
    {
      fromPhone: normalized.fromPhone,
      twilioNumber: env.TWILIO_WHATSAPP_NUMBER,
      senderRole,
    },
    "Determined sender role for inbound message"
  );

  // ---- 4. Persist data safely ----
  // Get agencyId for tenant scoping (single tenant: first agency, future: map by Twilio number)
  const agencyId = await getAgencyIdForWebhook();

  // CRITICAL: Only create contacts for HUMAN messages
  // If this is an AI message, it should not create a contact
  let contact;
  try {
    contact = await upsertContact(
      agencyId,
      normalized.fromPhone,
      body.ProfileName,
      senderRole
    );
  } catch (error) {
    // If AI message tries to create contact, log and return early
    logger.warn(
      {
        fromPhone: normalized.fromPhone,
        senderRole,
        error: serializeError(error),
      },
      "AI message received - skipping contact/conversation creation"
    );
    return reply.status(200).send({ ok: true, skipped: "AI message" });
  }

  // CRITICAL: Only create conversations for HUMAN messages
  // AI messages attach to existing conversations only
  let conversation;
  try {
    conversation = await findOrCreateConversation(
      agencyId,
      contact.id,
      senderRole
    );
  } catch (error) {
    // If AI message tries to create conversation, log and return early
    logger.warn(
      {
        contactId: contact.id,
        senderRole,
        error: serializeError(error),
      },
      "AI message received - cannot create new conversation"
    );
    return reply.status(200).send({ ok: true, skipped: "AI message" });
  }

  let message;
  try {
    message = await createInboundMessage(
    agencyId,
    contact.id,
    conversation.id,
    normalized,
    senderRole
  );
  } catch (error) {
    logger.error(
      { error: serializeError(error), contactId: contact.id, conversationId: conversation.id },
      "Failed to create inbound message"
    );
    // Return 200 to Twilio to prevent retries, but log the error
    return reply.status(200).send({ ok: false, error: "Failed to store message" });
  }

  // Create MEDIA_RECEIVED timeline event if media was detected
  // CRITICAL: Use timeline service (not direct Prisma) to ensure enum validation and non-blocking error handling
  if (normalized.mediaItems.length > 0 && senderRole === MessageSenderRole.HUMAN) {
    try {
      await createTimelineEvent({
          agencyId,
          conversationId: conversation.id,
          contactId: contact.id,
        type: "MEDIA_RECEIVED",
        actorRole: "SYSTEM",
          summary: `${normalized.mediaItems.length} media file${normalized.mediaItems.length > 1 ? "s" : ""} received`,
          data: {
            messageId: message.id,
            mediaCount: normalized.mediaItems.length,
            mediaTypes: normalized.mediaItems.map((m) => m.kind),
        },
        dedupeKey: `media_${message.id}`,
      });
    } catch (error) {
      // Timeline service never throws, but guard against unexpected errors
      logger.warn({ messageId: message.id, error: serializeError(error) }, "Failed to create MEDIA_RECEIVED timeline event (non-blocking)");
    }
  }

  // CRITICAL: Only enqueue HUMAN messages for processing
  // AI messages should never create tasks or trigger processing
  if (senderRole === MessageSenderRole.HUMAN) {
    const queueName = "inbound-messages";
    try {
      // Enqueue async processing with agencyId for tenant scoping
      await enqueueInboundMessage(agencyId, message.id);
      logger.debug({ messageId: message.id, agencyId, queueName }, "Enqueued inbound message job");
    } catch (error) {
      logger.error(
        { error: serializeError(error), messageId: message.id, agencyId, queueName },
        "Failed to enqueue inbound message job"
      );
    }
  } else {
    logger.info(
      { messageId: message.id, senderRole },
      "AI/OPERATOR message received - skipping processing queue"
    );
  }

  // Structured logging: inbound message received
  logger.info(
    {
      messageId: message.id,
      conversationId: conversation.id,
      deliveryStatus: message.deliveryStatus,
      providerMessageId: normalized.providerMessageId,
      contactId: contact.id,
    },
    "Inbound message received"
  );

  // ---- 4. Respond immediately (no reply to user) ----
  return reply.status(200).send({ ok: true });
}

/**
 * Twilio WhatsApp status callback payload (form-urlencoded)
 */
interface TwilioStatusCallbackPayload {
  MessageSid: string;
  MessageStatus: string;
  ErrorCode?: string;
  ErrorMessage?: string;
  [key: string]: string | undefined;
}

/**
 * Map Twilio MessageStatus to our MessageDeliveryStatus enum
 */
function mapTwilioStatusToDeliveryStatus(
  twilioStatus: string
): MessageDeliveryStatus {
  const normalized = twilioStatus.toLowerCase().trim();

  switch (normalized) {
    case "sent":
      return MessageDeliveryStatus.SENT;
    case "delivered":
      return MessageDeliveryStatus.DELIVERED;
    case "read":
      return MessageDeliveryStatus.READ;
    case "failed":
    case "undelivered":
      return MessageDeliveryStatus.FAILED;
    case "queued":
      return "QUEUED" as MessageDeliveryStatus;
    default:
      // Default to SENT for unknown statuses to avoid breaking the flow
      return MessageDeliveryStatus.SENT;
  }
}

/**
 * WhatsApp status callback handler
 */
async function whatsappStatusCallbackHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const logger = request.log;

  // ---- 1. Validate Twilio signature ----
  const signature = request.headers["x-twilio-signature"] as
    | string
    | undefined;

  if (!signature) {
    logger.warn("Missing Twilio signature in status callback");
    return reply.status(401).send({ error: "Invalid signature" });
  }

  const proto =
    (request.headers["x-forwarded-proto"] as string)?.split(",")[0] ??
    request.protocol;

  const host = request.headers.host;
  const url = `${proto}://${host}${request.raw.url}`;

  const params = request.body as Record<string, string>;

  const isValid = twilio.validateRequest(
    env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    params
  );

  if (!isValid) {
    logger.warn({ url }, "Invalid Twilio signature in status callback");
    return reply.status(401).send({ error: "Invalid signature" });
  }

  // ---- 2. Parse payload ----
  const body = request.body as TwilioStatusCallbackPayload;
  const messageSid = body.MessageSid;
  const messageStatus = body.MessageStatus;
  const errorCode = body.ErrorCode;
  const errorMessage = body.ErrorMessage;

  // Structured logging: status callback received (before message lookup)
  logger.info(
    {
      messageSid,
      messageStatus,
      errorCode,
      errorMessage,
      rawPayload: body,
    },
    "Status callback received"
  );

  if (!messageSid) {
    logger.warn({ body }, "Missing MessageSid in status callback");
    return reply.status(400).send({ error: "Missing MessageSid" });
  }

  if (!messageStatus) {
    logger.warn({ body }, "Missing MessageStatus in status callback");
    return reply.status(400).send({ error: "Missing MessageStatus" });
  }

  // ---- 3. Find message by providerMessageId ----
  const message = await prisma.message.findFirst({
    where: {
      providerMessageId: messageSid,
    },
  });

  if (!message) {
    logger.warn(
      { messageSid, messageStatus },
      "Message not found for status callback"
    );
    return reply.status(404).send({ error: "Message not found" });
  }

  // ---- 4. Map status and prepare update data ----
  const deliveryStatus = mapTwilioStatusToDeliveryStatus(messageStatus);
  const now = new Date();

  const updateData: {
    deliveryStatus: MessageDeliveryStatus;
    deliveredAt?: Date;
    readAt?: Date;
    failedAt?: Date;
    failureReason?: string;
  } = {
    deliveryStatus,
  };

  // Set timestamps based on status
  if (deliveryStatus === MessageDeliveryStatus.DELIVERED) {
    updateData.deliveredAt = now;
  } else if (deliveryStatus === MessageDeliveryStatus.READ) {
    // Ensure deliveredAt is set if not already set (message might not have deliveredAt field yet)
    const messageWithDates = message as any;
    if (!messageWithDates.deliveredAt) {
      updateData.deliveredAt = now;
    }
    updateData.readAt = now;
  } else if (deliveryStatus === MessageDeliveryStatus.FAILED) {
    updateData.failedAt = now;
    if (errorCode || errorMessage) {
      updateData.failureReason = [errorCode, errorMessage]
        .filter(Boolean)
        .join(": ");
    }
  }

  // ---- 5. Update message ----
  try {
    const updated = await prisma.message.update({
      where: { id: message.id },
      data: updateData,
    });

    // Structured logging: status callback processed
    logger.info(
      {
        messageId: message.id,
        conversationId: message.conversationId,
        deliveryStatus: deliveryStatus,
        previousStatus: message.deliveryStatus,
        messageSid,
        deliveredAt: updateData.deliveredAt,
        readAt: updateData.readAt,
        failedAt: updateData.failedAt,
        failureReason: updateData.failureReason,
      },
      "Status callback processed"
    );

    return reply.status(200).send({ ok: true, messageId: updated.id });
  } catch (error) {
    logger.error(
      {
        error,
        messageId: message.id,
        messageSid,
        messageStatus,
      },
      "Failed to update message delivery status"
    );
    return reply.status(500).send({ error: "Failed to update message" });
  }
}

/**
 * Register routes
 */
export async function whatsappWebhookRoutes(fastify: FastifyInstance) {
  fastify.post("/whatsapp", whatsappWebhookHandler);
  fastify.post("/whatsapp/status", whatsappStatusCallbackHandler);
}
