import { Queue } from "bullmq";
import pino from "pino";
import { connectionOptions } from "./queue.ts";

const log = pino({ name: "inboundQueue" });

export interface InboundJobData {
  agencyId: string;
  messageId: string;
  replay?: boolean;
  dryRun?: boolean;
  allowSendOutbound?: boolean;
  forceRecomputeMemory?: boolean;
  forceRecomputeProgress?: boolean;
}

export const inboundQueue = new Queue<InboundJobData>("inbound-messages", {
  connection: connectionOptions,
});

export async function enqueueInboundMessage(
  agencyId: string,
  messageId: string,
  options?: {
    replay?: boolean;
    dryRun?: boolean;
    allowSendOutbound?: boolean;
    forceRecomputeMemory?: boolean;
    forceRecomputeProgress?: boolean;
  }
): Promise<{ id: string }> {
  try {
    const job = await inboundQueue.add(
      "process-inbound-message",
      {
        agencyId,
        messageId,
        ...options,
      },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
      }
    );
    return { id: job.id! };
  } catch (error) {
    log.error({ error, agencyId, messageId }, "Failed to enqueue inbound message");
    throw error;
  }
}


