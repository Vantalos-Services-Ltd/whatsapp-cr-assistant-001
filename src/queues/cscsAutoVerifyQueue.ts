import { Queue } from "bullmq";
import pino from "pino";
import { connectionOptions } from "./queue.ts";

const log = pino({ name: "cscsAutoVerifyQueue" });

export const cscsAutoVerifyQueue = new Queue<{ taskId: string }>("cscs-auto-verify", {
  connection: connectionOptions,
});

export async function enqueueCscsAutoVerify(
  taskId: string,
  delay?: number
): Promise<void> {
  try {
    await cscsAutoVerifyQueue.add(
      "auto-verify-cscs",
      { taskId },
      {
        attempts: 3, // Retry up to 3 times
        backoff: { type: "exponential", delay: 5_000 },
        delay: delay || 0,
      }
    );
    log.debug({ taskId, delay }, "Enqueued CSCS auto verification");
  } catch (error) {
    log.error({ error, taskId }, "Failed to enqueue CSCS auto verification");
    throw error;
  }
}

