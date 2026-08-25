/**
 * WhatsApp send wrapper.
 *
 * All outbound WhatsApp sending goes through this one function so that the
 * behaviour can be varied in one place.
 *
 * DEMO_MODE=true  -> messages are NOT sent to Twilio. A synthetic message id is
 *                    returned instead, and everything downstream (persisting the
 *                    outbound message, timeline events, task completion) behaves
 *                    exactly as it would in production. This lets the whole
 *                    pipeline be demonstrated without a Twilio account.
 *
 * DEMO_MODE unset -> real Twilio send.
 */

import pino from "pino";

const log = pino({ name: "whatsappSender" });

export type SendOptions = {
  from: string;
  to: string;
  body: string;
  statusCallback?: string;
};

export type SentMessage = {
  sid: string;
  status: string;
  to: string;
  from: string;
  body: string;
  demo?: boolean;
};

export function isDemoMode(): boolean {
  return String(process.env.DEMO_MODE ?? "").toLowerCase() === "true";
}

/**
 * Send a WhatsApp message, or simulate it in demo mode.
 *
 * @param client an initialised Twilio client (ignored in demo mode)
 */
export async function sendWhatsAppMessage(
  client: { messages: { create: (o: SendOptions) => Promise<any> } },
  options: SendOptions
): Promise<SentMessage> {
  if (isDemoMode()) {
    const sid = `DEMO${Date.now().toString(16)}${Math.floor(Math.random() * 1e6).toString(16)}`.slice(0, 34);
    log.info(
      { to: options.to, bodyPreview: options.body.slice(0, 80), sid },
      "DEMO MODE — message recorded but not sent to Twilio"
    );
    return {
      sid,
      status: "delivered",
      to: options.to,
      from: options.from,
      body: options.body,
      demo: true,
    };
  }

  return client.messages.create(options);
}
