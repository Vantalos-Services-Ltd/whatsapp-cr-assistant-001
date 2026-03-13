import { Queue } from "bullmq";
import pino from "pino";
import { connectionOptions } from "./queue.ts";

const log = pino({ name: "approvedTasksQueue" });

export const approvedTasksQueue = new Queue<{ taskId: string }>("approved-tasks", {
  connection: connectionOptions,
});

export async function enqueueApprovedTask(
  taskId: string,
  delay?: number
): Promise<void> {
  try {
    await approvedTasksQueue.add(
      "process-approved-task",
      { taskId },
      {
        attempts: 1, // We handle retries manually via task.retryCount
        delay: delay || 0,
      }
    );
    log.debug({ taskId, delay }, "Enqueued approved task");
  } catch (error) {
    log.error({ error, taskId }, "Failed to enqueue approved task");
    throw error;
  }
}

