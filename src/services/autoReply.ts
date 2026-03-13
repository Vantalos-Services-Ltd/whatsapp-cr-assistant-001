/**
 * Auto-reply service
 * Sends WhatsApp messages automatically without approval
 */

import pino from "pino";
import twilio from "twilio";
import { PrismaClient, MessageDirection, MessageChannel, MessageDeliveryStatus, MessageSenderRole } from "@prisma/client";
import { env } from "../config/env.ts";

const log = pino({ name: "autoReply" });
const prisma = new PrismaClient();

// Initialize Twilio client
const twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

export interface SendAutoReplyInput {
  messageId: string;
  contactPhone: string;
  replyText: string;
  agencyId: string;
  conversationId: string;
  contactId: string;
}

/**
 * Normalize WhatsApp phone number for Twilio API
 */
function normalizeWhatsAppNumber(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.toLowerCase().startsWith("whatsapp:")) {
    return trimmed;
  }
  return `whatsapp:${trimmed}`;
}

/**
 * Send auto-reply WhatsApp message and persist to database
 */
export async function sendAutoReply(input: SendAutoReplyInput): Promise<string> {
  const { messageId, contactPhone, replyText, agencyId, conversationId, contactId } = input;

  log.info(
    {
      messageId,
      contactPhone,
      replyTextLength: replyText.length,
      agencyId,
    },
    "Sending auto-reply WhatsApp message"
  );

  // Normalize phone numbers
  const normalizedTo = normalizeWhatsAppNumber(contactPhone);
  const normalizedFrom = normalizeWhatsAppNumber(env.TWILIO_WHATSAPP_NUMBER);

  // Build status callback URL if base URL is configured
  const statusCallbackUrl = env.WEBHOOK_BASE_URL
    ? `${env.WEBHOOK_BASE_URL}/webhooks/whatsapp/status`
    : undefined;

  // Send message via Twilio
  let twilioMessage;
  let sendError: Error | null = null;

  try {
    const messageOptions: {
      from: string;
      to: string;
      body: string;
      statusCallback?: string;
    } = {
      from: normalizedFrom,
      to: normalizedTo,
      body: replyText,
    };

    if (statusCallbackUrl) {
      messageOptions.statusCallback = statusCallbackUrl;
    }

    twilioMessage = await twilioClient.messages.create(messageOptions);

    log.info(
      {
        messageId,
        twilioSid: twilioMessage.sid,
        to: normalizedTo,
      },
      "Auto-reply sent via Twilio"
    );
  } catch (error) {
    sendError = error instanceof Error ? error : new Error(String(error));
    log.error(
      {
        messageId,
        error: sendError,
        to: normalizedTo,
      },
      "Failed to send auto-reply via Twilio"
    );
    throw sendError;
  }

  // Persist outbound message to database
  // AI replies MUST always be stored as OUTBOUND_AI
  try {
    const outboundMessage = await prisma.message.create({
      data: {
        agencyId,
        contactId,
        conversationId,
        direction: MessageDirection.OUTBOUND,
        channel: MessageChannel.WHATSAPP,
        senderRole: MessageSenderRole.AI, // AI auto-replies are always AI
        text: replyText,
        providerMessageId: twilioMessage.sid,
        deliveryStatus: MessageDeliveryStatus.SENT,
        rawPayload: twilioMessage as any,
      },
    });

    log.info(
      {
        messageId,
        outboundMessageId: outboundMessage.id,
        twilioSid: twilioMessage.sid,
        conversationId,
      },
      "Auto-reply message persisted to database"
    );

    return twilioMessage.sid;
  } catch (error) {
    log.error(
      {
        messageId,
        error,
        twilioSid: twilioMessage.sid,
      },
      "Failed to persist auto-reply message; message was sent but not tracked"
    );
    // Don't throw - message was sent successfully, just tracking failed
    return twilioMessage.sid;
  }
}

