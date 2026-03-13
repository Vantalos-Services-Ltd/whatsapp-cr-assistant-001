/**
 * Workers are started via **side effects**.
 *
 * Importing a worker module instantiates the BullMQ `Worker` immediately.
 * This file should only contain side-effect imports so it never blocks the main
 * thread and avoids creating duplicate workers.
 */

import "./inboundWorker.ts";
import "./approvedTaskWorker.ts";
import "./cscsAutoVerifyWorker.ts";
import { startFollowUpReminderWorker } from "./followUpReminderWorker.ts";
import { startReviewSamplingWorker } from "./reviewSamplingWorker.ts";
import { startStuckTaskMonitorWorker } from "./stuckTaskMonitorWorker.ts";

// Start follow-up reminder worker
startFollowUpReminderWorker();

// Start review sampling worker
startReviewSamplingWorker();

// Start stuck task monitor worker
startStuckTaskMonitorWorker();

