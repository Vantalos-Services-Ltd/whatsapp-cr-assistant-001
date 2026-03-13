import { Queue, QueueOptions, ConnectionOptions } from "bullmq";
import { env } from "../config/env.ts";
import Redis from "ioredis";

// Parse Redis URL for connection options
function parseRedisUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || "6379"),
    password: parsed.password || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

// Create Redis connection for BullMQ
const connectionOptions = parseRedisUrl(env.REDIS_URL);
// ioredis accepts URL string directly, not ConnectionOptions
const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// Default queue options
const defaultQueueOptions: QueueOptions = {
  connection: connectionOptions,
};

// Export connection for use in workers
export { connection as redisConnection, connectionOptions };

// Queue factory function
export function createQueue<T = any>(name: string, options?: QueueOptions) {
  return new Queue<T>(name, {
    ...defaultQueueOptions,
    ...options,
  });
}

// Example: Create queues here as needed
// export const emailQueue = createQueue("email");
// export const notificationQueue = createQueue("notification");

