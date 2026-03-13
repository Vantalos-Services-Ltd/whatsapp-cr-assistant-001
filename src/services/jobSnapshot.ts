/**
 * Job Snapshot Service
 * Extracts job snapshot data for task payloads
 */

import { prisma } from "../db/prisma.ts";

export interface JobSnapshot {
  jobId: string;
  title: string;
  payRate: number | null;
  chargeRate: number | null;
  currency: string;
  durationWeeks: number | null;
  startDate: string | null;
}

/**
 * Extract job snapshot from jobMatches (top match)
 * Returns null if no matches or job data unavailable
 */
export function extractJobSnapshotFromMatches(
  jobMatches: any
): JobSnapshot | null {
  if (!jobMatches || !jobMatches.matches || !Array.isArray(jobMatches.matches) || jobMatches.matches.length === 0) {
    return null;
  }

  const topMatch = jobMatches.matches[0];
  if (!topMatch || !topMatch.jobId) {
    return null;
  }

  return {
    jobId: topMatch.jobId,
    title: topMatch.title || "Unknown Job",
    payRate: topMatch.payRate ?? null,
    chargeRate: null, // JobMatch doesn't include chargeRate, will need to fetch from DB
    currency: topMatch.currency || "GBP",
    durationWeeks: topMatch.durationWeeks ?? null,
    startDate: topMatch.startDate || null,
  };
}

/**
 * Fetch full job snapshot from database
 * Includes chargeRate which is not in jobMatches
 */
export async function fetchJobSnapshot(
  jobId: string,
  agencyId: string
): Promise<JobSnapshot | null> {
  try {
    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        agencyId,
      },
      select: {
        id: true,
        title: true,
        payRate: true,
        chargeRate: true,
        currency: true,
        durationWeeks: true,
        startDate: true,
      },
    });

    if (!job) {
      return null;
    }

    return {
      jobId: job.id,
      title: job.title,
      payRate: job.payRate ?? null,
      chargeRate: job.chargeRate ?? null,
      currency: job.currency || "GBP",
      durationWeeks: job.durationWeeks ?? null,
      startDate: job.startDate?.toISOString() || null,
    };
  } catch (error) {
    console.error("Failed to fetch job snapshot:", error);
    return null;
  }
}

/**
 * Enrich payload with job snapshot
 * Tries to extract from jobMatches first, then fetches from DB if needed
 */
export async function enrichPayloadWithJobSnapshot(
  payload: any,
  agencyId: string
): Promise<any> {
  // Don't overwrite existing payload.job if it already exists
  if (payload.job && payload.job.jobId) {
    return payload;
  }

  // Try to extract from jobMatches
  if (payload.jobMatches && payload.jobMatches.matches && payload.jobMatches.matches.length > 0) {
    const topMatch = payload.jobMatches.matches[0];
    if (topMatch.jobId) {
      // Fetch full job data (including chargeRate)
      const jobSnapshot = await fetchJobSnapshot(topMatch.jobId, agencyId);
      if (jobSnapshot) {
        return {
          ...payload,
          job: jobSnapshot,
        };
      }
    }
  }

  return payload;
}



