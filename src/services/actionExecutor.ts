import pino from "pino";
import twilio from "twilio";
import { MessageDirection, MessageChannel, MessageDeliveryStatus, TaskType, MessageSenderRole } from "@prisma/client";
import { env } from "../config/env.ts";
import type { Task, Message, Contact } from "@prisma/client";
import { sendOutreachMessage } from "./outreachExecutor.ts";

const log = pino({ name: "actionExecutor" });
import { prisma } from "../db/prisma.ts";
import { sendWhatsAppMessage } from "./whatsappSender.ts";

// Initialize Twilio client
const twilioClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);

type ProposedAction = {
  actionType: "SEND_MESSAGE" | "REQUEST_INFO" | "ESCALATE" | "NO_ACTION" | "SCHEDULE_FOLLOW_UP";
  suggestedMessage?: string;
  message?: string; // For OUTREACH tasks
  reasoning?: string;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH";
  candidateId?: string; // For OUTREACH tasks
  phone?: string; // For OUTREACH tasks
  [key: string]: unknown;
};

type TaskWithRelations = Task & {
  relatedMessage: (Message & { contact: Contact }) | null;
};

export type ExecuteProposedActionResult = {
  success: boolean;
  actionType: string;
  messageSid?: string;
};

/**
 * Normalize WhatsApp phone number for Twilio API
 * - If number already starts with "whatsapp:", use it as-is
 * - Otherwise, prepend "whatsapp:"
 */
function normalizeWhatsAppNumber(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.toLowerCase().startsWith("whatsapp:")) {
    return trimmed;
  }
  return `whatsapp:${trimmed}`;
}

/**
 * Send WhatsApp message via Twilio and persist to database
 */
async function sendWhatsAppMessage(
  toPhone: string,
  messageText: string,
  taskId: string
): Promise<string> {
  log.info(
    {
      taskId,
      toPhone,
      messageLength: messageText.length,
    },
    "Sending WhatsApp message via Twilio"
  );

  // Fetch task with all required relations
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      relatedMessage: {
        include: {
          contact: true,
        },
      },
    },
  });

  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  if (!task.relatedMessage) {
    throw new Error(`Task ${taskId} has no related message`);
  }

  if (!task.relatedMessage.contact) {
    throw new Error(`Task ${taskId} related message has no contact`);
  }

  if (!task.relatedMessage.conversationId) {
    throw new Error(`Task ${taskId} related message has no conversationId`);
  }

  const agencyId = task.agencyId;
  const contactId = task.relatedMessage.contact.id;
  const conversationId = task.relatedMessage.conversationId;

  // Normalize phone numbers to ensure correct format (avoid double "whatsapp:" prefix)
  const normalizedTo = normalizeWhatsAppNumber(toPhone);
  const normalizedFrom = normalizeWhatsAppNumber(env.TWILIO_WHATSAPP_NUMBER);

  log.debug(
    {
      taskId,
      originalTo: toPhone,
      normalizedTo,
      normalizedFrom,
    },
    "Normalized WhatsApp phone numbers for Twilio"
  );

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
      body: messageText,
    };

    // Add status callback URL if configured
    if (statusCallbackUrl) {
      messageOptions.statusCallback = statusCallbackUrl;
    }

    twilioMessage = await sendWhatsAppMessage(twilioClient, messageOptions);

    // Structured logging: Twilio send success
    log.info(
      {
        taskId,
        messageId: null, // Will be set after persistence
        conversationId,
        deliveryStatus: MessageDeliveryStatus.SENT,
        messageSid: twilioMessage.sid,
        status: twilioMessage.status,
        to: normalizedTo,
        from: normalizedFrom,
        statusCallbackUrl,
      },
      "Twilio send success"
    );
  } catch (error) {
    sendError = error instanceof Error ? error : new Error(String(error));
    // Structured logging: Twilio send failure
    log.error(
      {
        error: sendError,
        taskId,
        messageId: null, // Will be set after persistence
        conversationId,
        deliveryStatus: MessageDeliveryStatus.FAILED,
        toPhone,
      },
      "Twilio send failure"
    );
    // Don't throw - we'll persist a FAILED message instead
  }

  // Persist outbound message to database (SENT or FAILED)
  try {
    const errorMessage = sendError
      ? sendError.message
      : null;
    const errorCode = sendError && "code" in sendError
      ? String((sendError as any).code)
      : null;

    const outboundMessage = await prisma.message.create({
      data: {
        agencyId,
        contactId,
        conversationId,
        direction: MessageDirection.OUTBOUND,
        channel: MessageChannel.WHATSAPP,
        senderRole: MessageSenderRole.OPERATOR, // Operator-approved messages are OPERATOR
        text: messageText,
        providerMessageId: twilioMessage?.sid || null,
        deliveryStatus: sendError
          ? MessageDeliveryStatus.FAILED
          : MessageDeliveryStatus.SENT,
        failedAt: sendError ? new Date() : null,
        failureReason: sendError
          ? [errorCode, errorMessage].filter(Boolean).join(": ")
          : null,
        rawPayload: sendError
          ? {
              error: errorMessage,
              errorCode,
              taskId,
              attemptedAt: new Date().toISOString(),
            }
          : (twilioMessage as any),
      },
    });

    if (sendError) {
      // Structured logging: message persisted as FAILED
      log.error(
        {
          taskId,
          messageId: outboundMessage.id,
          conversationId,
          deliveryStatus: outboundMessage.deliveryStatus,
          failureReason: outboundMessage.failureReason,
          contactId,
        },
        "Outbound message persisted as FAILED"
      );
    } else {
      // Structured logging: message persisted as SENT
      log.info(
        {
          taskId,
          messageId: outboundMessage.id,
          conversationId,
          deliveryStatus: outboundMessage.deliveryStatus,
          messageSid: twilioMessage!.sid,
          contactId,
        },
        "Outbound message persisted as SENT"
      );
    }
  } catch (error) {
    log.error(
      {
        error,
        taskId,
        messageSid: twilioMessage?.sid,
        sendError: sendError?.message,
      },
      "Failed to persist outbound message to database"
    );
    // Re-throw if we couldn't persist - this is critical
    throw error;
  }

  // If Twilio send failed, throw error so worker can handle it
  if (sendError) {
    throw sendError;
  }

  return twilioMessage!.sid;
}

/**
 * Execute SEND_MESSAGE action
 */
async function executeSendMessage(
  task: TaskWithRelations
): Promise<ExecuteProposedActionResult> {
  const proposedAction = task.proposedAction as ProposedAction | null;
  const taskPayload = task.payload as any;

  // Resolve message text with priority:
  // 1. task.payload.sentText (messageOverride from approval)
  // 2. task.proposedAction.suggestedMessage
  // 3. task.payload.pendingReplyText (fallback)
  let messageText: string | undefined;
  
  if (taskPayload?.sentText && typeof taskPayload.sentText === "string" && taskPayload.sentText.trim() !== "") {
    messageText = taskPayload.sentText.trim();
    log.info(
      {
        taskId: task.id,
        source: "payload.sentText",
      },
      "Using messageOverride from payload.sentText"
    );
  } else if (proposedAction?.suggestedMessage && typeof proposedAction.suggestedMessage === "string") {
    messageText = proposedAction.suggestedMessage;
    log.info(
      {
        taskId: task.id,
        source: "proposedAction.suggestedMessage",
      },
      "Using suggestedMessage from proposedAction"
    );
  } else if (taskPayload?.pendingReplyText && typeof taskPayload.pendingReplyText === "string") {
    messageText = taskPayload.pendingReplyText;
    log.info(
      {
        taskId: task.id,
        source: "payload.pendingReplyText",
      },
      "Using pendingReplyText from payload"
    );
  }

  if (!messageText) {
    throw new Error("No message text available for SEND_MESSAGE action (checked sentText, suggestedMessage, pendingReplyText)");
  }

  if (!task.relatedMessage?.contact?.phone) {
    throw new Error("Contact phone is required for SEND_MESSAGE action");
  }

  // Send message via Twilio and persist to database
  // sendWhatsAppMessage handles fetching task relations and creating the Message record
  const messageSid = await sendWhatsAppMessage(
    task.relatedMessage.contact.phone,
    messageText,
    task.id
  );

  return {
    success: true,
    actionType: "SEND_MESSAGE",
    messageSid,
  };
}

/**
 * Execute REQUEST_INFO action
 */
async function executeRequestInfo(
  task: TaskWithRelations
): Promise<ExecuteProposedActionResult> {
  const proposedAction = task.proposedAction as ProposedAction | null;
  const taskPayload = task.payload as any;

  // Resolve message text with priority:
  // 1. task.payload.sentText (messageOverride from approval)
  // 2. task.proposedAction.suggestedMessage
  // 3. task.payload.pendingReplyText (fallback)
  let messageText: string | undefined;
  
  if (taskPayload?.sentText && typeof taskPayload.sentText === "string" && taskPayload.sentText.trim() !== "") {
    messageText = taskPayload.sentText.trim();
    log.info(
      {
        taskId: task.id,
        source: "payload.sentText",
      },
      "Using messageOverride from payload.sentText"
    );
  } else if (proposedAction?.suggestedMessage && typeof proposedAction.suggestedMessage === "string") {
    messageText = proposedAction.suggestedMessage;
    log.info(
      {
        taskId: task.id,
        source: "proposedAction.suggestedMessage",
      },
      "Using suggestedMessage from proposedAction"
    );
  } else if (taskPayload?.pendingReplyText && typeof taskPayload.pendingReplyText === "string") {
    messageText = taskPayload.pendingReplyText;
    log.info(
      {
        taskId: task.id,
        source: "payload.pendingReplyText",
      },
      "Using pendingReplyText from payload"
    );
  }

  if (!messageText) {
    throw new Error("No message text available for REQUEST_INFO action (checked sentText, suggestedMessage, pendingReplyText)");
  }

  if (!task.relatedMessage?.contact?.phone) {
    throw new Error("Contact phone is required for REQUEST_INFO action");
  }

  // Send message via Twilio and persist to database
  // sendWhatsAppMessage handles fetching task relations and creating the Message record
  const messageSid = await sendWhatsAppMessage(
    task.relatedMessage.contact.phone,
    messageText,
    task.id
  );

  // Fetch the created message to verify persistence and get messageId for logging
  const outboundMessage = await prisma.message.findFirst({
    where: {
      providerMessageId: messageSid,
      direction: MessageDirection.OUTBOUND,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!outboundMessage) {
    log.warn(
      {
        taskId: task.id,
        providerMessageId: messageSid,
        actionType: "REQUEST_INFO",
      },
      "Message sent but not persisted to database"
    );
    return {
      success: false,
      actionType: "REQUEST_INFO",
      messageSid,
    };
  }

  log.info(
    {
      taskId: task.id,
      messageId: outboundMessage.id,
      providerMessageId: messageSid,
      actionType: "REQUEST_INFO",
    },
    "Outbound message created for REQUEST_INFO action"
  );

  return {
    success: true,
    actionType: "REQUEST_INFO",
    messageSid,
  };
}

/**
 * Execute proposed action for a task
 */
export async function executeProposedAction(
  task: TaskWithRelations
): Promise<ExecuteProposedActionResult> {
  const proposedAction = task.proposedAction as ProposedAction | null;

  if (!proposedAction) {
    throw new Error("Task has no proposedAction");
  }

  const actionType = proposedAction.actionType;

  log.info(
    {
      taskId: task.id,
      actionType,
      riskLevel: proposedAction.riskLevel,
    },
    "Executing proposed action"
  );

  // Switch on task.proposedAction.actionType
  switch (actionType) {
    case "SEND_MESSAGE":
      // Handle OUTREACH tasks (no relatedMessage, uses candidateId)
      if (task.type === TaskType.OUTREACH) {
        return await executeOutreachMessage(task);
      }
      // Regular SEND_MESSAGE for other task types
      return await executeSendMessage(task);

    case "SCHEDULE_FOLLOW_UP":
      log.info({ taskId: task.id }, "SCHEDULE_FOLLOW_UP action not yet implemented");
      return {
        success: false,
        actionType: "SCHEDULE_FOLLOW_UP",
      };

    case "ESCALATE":
      log.info({ taskId: task.id }, "ESCALATE action not yet implemented");
      return {
        success: false,
        actionType: "ESCALATE",
      };

    case "NO_ACTION":
      log.info({ taskId: task.id }, "NO_ACTION requires no execution");
      return {
        success: true,
        actionType: "NO_ACTION",
      };

    case "REQUEST_INFO":
      return await executeRequestInfo(task);

    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }
}

/**
 * Execute OUTREACH message (for tasks without relatedMessage)
 */
async function executeOutreachMessage(
  task: TaskWithRelations
): Promise<ExecuteProposedActionResult> {
  const proposedAction = task.proposedAction as ProposedAction | null;

  if (!proposedAction?.message && !proposedAction?.suggestedMessage) {
    throw new Error("message or suggestedMessage is required for OUTREACH action");
  }

  if (!proposedAction?.candidateId) {
    throw new Error("candidateId is required for OUTREACH action");
  }

  if (!proposedAction?.phone) {
    throw new Error("phone is required for OUTREACH action");
  }

  const messageText = proposedAction.message || proposedAction.suggestedMessage || "";

  // Use outreach executor to send message
  const messageSid = await sendOutreachMessage(
    task.id,
    proposedAction.candidateId,
    proposedAction.phone,
    messageText
  );

  return {
    success: true,
    actionType: "SEND_MESSAGE",
    messageSid,
  };
}

