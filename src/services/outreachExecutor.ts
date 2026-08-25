/**
 * Outreach Executor
 * Handles sending outreach messages to candidates
 */

import pino from "pino";
import twilio from "twilio";
import { MessageDirection, MessageChannel, MessageDeliveryStatus, ContactType, MessageSenderRole } from "@prisma/client";
import { env } from "../config/env.ts";
import type { Task } from "@prisma/client";

const log = pino({ name: "outreachExecutor" });
import { prisma } from "../db/prisma.ts";
import { sendWhatsAppMessage } from "./whatsappSender.ts";

// Initialize Twilio client
const twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

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
 * Send outreach message to candidate
 * Creates contact/conversation if needed, sends message, and persists it
 */
export async function sendOutreachMessage(
  taskId: string,
  candidateId: string,
  phone: string,
  messageText: string
): Promise<string> {
  log.info(
    {
      taskId,
      candidateId,
      phone,
      messageLength: messageText.length,
    },
    "Sending outreach message"
  );

  // Fetch task and candidate
  const task = await prisma.task.findUnique({
    where: { id: taskId },
  });

  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
  });

  if (!candidate) {
    throw new Error(`Candidate not found: ${candidateId}`);
  }

  // Check idempotency: if message already exists for this task, skip
  const existingMessage = await prisma.message.findFirst({
    where: {
      candidateId: candidateId,
      direction: MessageDirection.OUTBOUND,
      text: messageText,
      createdAt: {
        gte: new Date(Date.now() - 60000), // Within last minute
      },
    },
  });

  if (existingMessage) {
    log.info(
      {
        taskId,
        candidateId,
        existingMessageId: existingMessage.id,
      },
      "Outreach message already sent (idempotency check)"
    );
    return existingMessage.providerMessageId || "";
  }

  const agencyId = task.agencyId;

  // Upsert contact
  let contact = await prisma.contact.findFirst({
    where: {
      agencyId,
      phone,
    },
  });

  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        agencyId,
        phone,
        name: candidate.name,
        type: ContactType.CANDIDATE,
      },
    });
    log.info({ contactId: contact.id, phone }, "Created contact for outreach");
  }

  // Find or create conversation
  let conversation = await prisma.conversation.findFirst({
    where: {
      agencyId,
      contactId: contact.id,
    },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        agencyId,
        contactId: contact.id,
        lastMessageAt: new Date(),
      },
    });
    log.info({ conversationId: conversation.id }, "Created conversation for outreach");
  }

  // Normalize phone numbers
  const normalizedTo = normalizeWhatsAppNumber(phone);
  const normalizedFrom = normalizeWhatsAppNumber(env.TWILIO_WHATSAPP_NUMBER);

  // Build status callback URL
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
      body: messageText,
    };

    if (statusCallbackUrl) {
      messageOptions.statusCallback = statusCallbackUrl;
    }

    twilioMessage = await sendWhatsAppMessage(twilioClient, messageOptions);

    log.info(
      {
        taskId,
        candidateId,
        twilioSid: twilioMessage.sid,
        to: normalizedTo,
      },
      "Outreach message sent via Twilio"
    );
  } catch (error) {
    sendError = error instanceof Error ? error : new Error(String(error));
    log.error(
      {
        taskId,
        candidateId,
        error: sendError,
        to: normalizedTo,
      },
      "Failed to send outreach message via Twilio"
    );
    throw sendError;
  }

  // Persist outbound message to database
  try {
    const outboundMessage = await prisma.message.create({
      data: {
        agencyId,
        contactId: contact.id,
        conversationId: conversation.id,
        candidateId: candidateId,
        direction: MessageDirection.OUTBOUND,
        channel: MessageChannel.WHATSAPP,
        senderRole: MessageSenderRole.OPERATOR, // Outreach messages are operator-initiated
        text: messageText,
        providerMessageId: twilioMessage.sid,
        deliveryStatus: sendError ? MessageDeliveryStatus.FAILED : MessageDeliveryStatus.SENT,
        failedAt: sendError ? new Date() : null,
        failureReason: sendError ? sendError.message : null,
        rawPayload: sendError
          ? {
              error: sendError.message,
              taskId,
              candidateId,
              attemptedAt: new Date().toISOString(),
            }
          : (twilioMessage as any),
      },
    });

    // Update conversation lastMessageAt
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    log.info(
      {
        taskId,
        candidateId,
        messageId: outboundMessage.id,
        twilioSid: twilioMessage.sid,
        conversationId: conversation.id,
      },
      "Outreach message persisted to database"
    );

    return twilioMessage.sid;
  } catch (error) {
    log.error(
      {
        taskId,
        candidateId,
        error,
        twilioSid: twilioMessage.sid,
      },
      "Failed to persist outreach message; message was sent but not tracked"
    );
    // Don't throw - message was sent successfully, just tracking failed
    return twilioMessage.sid;
  }
}

