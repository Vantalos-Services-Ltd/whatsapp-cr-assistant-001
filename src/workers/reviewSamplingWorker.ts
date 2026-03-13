/**
 * Review Sampling Worker
 * 
 * Runs daily at 9am local server time to create MessageReviewSample rows
 * for quality control and governance.
 * 
 * In dev mode, also runs on server start.
 */

import pino from "pino";
import { prisma } from "../db/prisma.ts";
import { createReviewSamplesForDay } from "../services/reviewSamplingService.ts";
import { env } from "../config/env.ts";

const log = pino({ name: "reviewSamplingWorker" });

/**
 * Calculate next 9am in local server time
 */
function getNext9AM(): Date {
  const now = new Date();
  const next9AM = new Date(now);
  next9AM.setHours(9, 0, 0, 0);

  // If it's already past 9am today, schedule for tomorrow
  if (now.getTime() >= next9AM.getTime()) {
    next9AM.setDate(next9AM.getDate() + 1);
  }

  return next9AM;
}

/**
 * Process review sampling for all agencies
 */
async function processReviewSampling() {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  const today = new Date(now);
  today.setHours(23, 59, 59, 999);

  log.info(
    {
      timestamp: now.toISOString(),
      dateRange: {
        start: yesterday.toISOString(),
        end: today.toISOString(),
      },
    },
    "Starting daily review sampling"
  );

  try {
    // Get all agencies
    const agencies = await prisma.agency.findMany({
      select: {
        id: true,
      },
    });

    log.info({ agencyCount: agencies.length }, "Processing review sampling for agencies");

    let totalCreated = 0;
    let totalSkipped = 0;

    for (const agency of agencies) {
      try {
        const result = await createReviewSamplesForDay(
          agency.id,
          {
            start: yesterday,
            end: today,
          }
        );

        totalCreated += result.totalCreated;
        totalSkipped += result.totalSkipped;

        log.info(
          {
            agencyId: agency.id,
            ...result,
          },
          "Review sampling completed for agency"
        );
      } catch (error) {
        log.error(
          {
            agencyId: agency.id,
            error,
          },
          "Failed to process review sampling for agency"
        );
      }
    }

    log.info(
      {
        totalCreated,
        totalSkipped,
        agencyCount: agencies.length,
      },
      "Daily review sampling completed for all agencies"
    );
  } catch (error) {
    log.error({ error }, "Failed to process review sampling");
    throw error;
  }
}

/**
 * Start the review sampling worker
 * 
 * In production: runs daily at 9am local server time
 * In dev: also runs on server start
 */
export function startReviewSamplingWorker() {
  log.info("Starting review sampling worker");

  // In dev mode, run immediately on startup
  if (env.NODE_ENV === "development") {
    log.info("Dev mode: running review sampling on startup");
    processReviewSampling().catch((error) => {
      log.error({ error }, "Error in initial review sampling");
    });
  }

  // Calculate time until next 9am
  const next9AM = getNext9AM();
  const msUntil9AM = next9AM.getTime() - Date.now();

  log.info(
    {
      nextRun: next9AM.toISOString(),
      msUntilNextRun: msUntil9AM,
    },
    "Scheduled next review sampling run"
  );

  // Schedule first run at 9am
  setTimeout(() => {
    // Run immediately
    processReviewSampling().catch((error) => {
      log.error({ error }, "Error in scheduled review sampling");
    });

    // Then run every 24 hours
    const interval = setInterval(() => {
      processReviewSampling().catch((error) => {
        log.error({ error }, "Error in scheduled review sampling");
      });
    }, 24 * 60 * 60 * 1000); // 24 hours

    // Cleanup on process exit
    process.on("SIGTERM", () => {
      clearInterval(interval);
      log.info("Review sampling worker stopped");
    });

    process.on("SIGINT", () => {
      clearInterval(interval);
      log.info("Review sampling worker stopped");
    });
  }, msUntil9AM);
}

