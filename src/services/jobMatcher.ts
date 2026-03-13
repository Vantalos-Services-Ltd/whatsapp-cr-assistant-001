import pino from "pino";
import { prisma } from "../db/prisma.ts";
import { JobStatus } from "@prisma/client";

const log = pino({ name: "jobMatcher" });

export interface JobMatch {
  jobId: string;
  title: string;
  status: string;
  startDate: string | null;
  durationWeeks: number | null;
  payRate: number | null;
  currency: string;
  scorePct: number;
  reasons: Array<{ label: string; points: number }>;
  highlights: string[];
}

export interface ExcludedJob {
  jobId: string;
  title: string;
  reason: string;
}

export interface MatchJobsResult {
  matches: JobMatch[];
  excluded: ExcludedJob[];
}

interface MatchJobsInput {
  agencyId: string;
  candidateId: string;
  limit?: number;
}

/**
 * Match jobs for a candidate based on trade, location, availability, and salary
 */
export async function matchJobsForCandidate(
  input: MatchJobsInput
): Promise<MatchJobsResult> {
  const { agencyId, candidateId, limit = 3 } = input;

  try {
    // Load candidate
    const candidate = await prisma.candidate.findUnique({
      where: {
        id: candidateId,
        agencyId, // Ensure candidate belongs to agency
      },
      select: {
        id: true,
        desiredRole: true,
        location: true,
        skills: true,
        availabilityNotes: true,
        salaryMin: true,
        salaryMax: true,
        currency: true,
      },
    });

    if (!candidate) {
      log.warn({ candidateId, agencyId }, "Candidate not found");
      return { matches: [], excluded: [] };
    }

    // Load active/urgent jobs for agency
    const jobs = await prisma.job.findMany({
      where: {
        agencyId,
        status: {
          in: [JobStatus.ACTIVE, JobStatus.URGENT],
        },
      },
      select: {
        id: true,
        title: true,
        status: true,
        tradeRequired: true,
        startDate: true,
        durationWeeks: true,
        payRate: true,
        currency: true,
        city: true,
        postcode: true,
      },
      take: 50, // Limit to 50 jobs for performance
    });

    if (jobs.length === 0) {
      return { matches: [], excluded: [] };
    }

    // Score each job
    const scoredJobs = jobs.map((job) => {
      let score = 0;
      const reasons: Array<{ label: string; points: number }> = [];
      const highlights: string[] = [];

      // +45: Trade match
      const tradeMatch = checkTradeMatch(candidate, job.tradeRequired);
      if (tradeMatch.matched) {
        score += 45;
        reasons.push({ label: `Trade match: ${tradeMatch.reason}`, points: 45 });
        highlights.push(`Trade: ${job.tradeRequired}`);
      }

      // +20: Location match
      const locationMatch = checkLocationMatch(candidate.location, job.city, job.postcode);
      if (locationMatch.matched) {
        score += 20;
        reasons.push({ label: `Location match: ${locationMatch.reason}`, points: 20 });
        highlights.push(`Location: ${locationMatch.reason}`);
      }

      // +10: Urgent status
      if (job.status === JobStatus.URGENT) {
        score += 10;
        reasons.push({ label: "Urgent job", points: 10 });
        highlights.push("Urgent");
      }

      // +15: Availability match
      const availabilityMatch = checkAvailabilityMatch(
        candidate.availabilityNotes,
        job.startDate
      );
      if (availabilityMatch.matched) {
        score += 15;
        reasons.push({ label: `Availability match: ${availabilityMatch.reason}`, points: 15 });
        highlights.push(`Available: ${availabilityMatch.reason}`);
      }

      // +10: Salary fit
      const salaryMatch = checkSalaryFit(
        candidate.salaryMin,
        candidate.salaryMax,
        candidate.currency,
        job.payRate,
        job.currency
      );
      if (salaryMatch.matched) {
        score += 10;
        reasons.push({ label: `Salary fit: ${salaryMatch.reason}`, points: 10 });
        highlights.push(`Pay: ${salaryMatch.reason}`);
      }

      return {
        job,
        score,
        reasons,
        highlights,
      };
    });

    // Separate matches from excluded
    const matches: JobMatch[] = [];
    const excluded: ExcludedJob[] = [];

    // Sort by score (descending) and take top matches
    const sorted = scoredJobs.sort((a, b) => b.score - a.score);

    for (const item of sorted) {
      if (item.score > 0 && matches.length < limit) {
        matches.push({
          jobId: item.job.id,
          title: item.job.title,
          status: item.job.status,
          startDate: item.job.startDate?.toISOString() || null,
          durationWeeks: item.job.durationWeeks,
          payRate: item.job.payRate,
          currency: item.job.currency || "GBP",
          scorePct: item.score,
          reasons: item.reasons,
          highlights: item.highlights,
        });
      } else if (item.score === 0) {
        excluded.push({
          jobId: item.job.id,
          title: item.job.title,
          reason: "No matching criteria",
        });
      }
    }

    log.info(
      {
        candidateId,
        agencyId,
        totalJobs: jobs.length,
        matchesCount: matches.length,
        excludedCount: excluded.length,
      },
      "Matched jobs for candidate"
    );

    return { matches, excluded };
  } catch (error) {
    log.error({ error, candidateId, agencyId }, "Failed to match jobs for candidate");
    throw error;
  }
}

/**
 * Check if candidate's trade matches job's tradeRequired
 * +45 points if matched
 */
function checkTradeMatch(
  candidate: {
    desiredRole: string | null;
    skills: string[];
  },
  jobTrade: string
): { matched: boolean; reason: string } {
  if (!jobTrade) {
    return { matched: false, reason: "" };
  }

  const jobTradeLower = jobTrade.toLowerCase().trim();

  // Check desiredRole
  if (candidate.desiredRole) {
    const desiredRoleLower = candidate.desiredRole.toLowerCase();
    if (desiredRoleLower.includes(jobTradeLower) || jobTradeLower.includes(desiredRoleLower)) {
      return { matched: true, reason: `${candidate.desiredRole} matches ${jobTrade}` };
    }
  }

  // Check skills
  for (const skill of candidate.skills) {
    const skillLower = skill.toLowerCase();
    if (skillLower.includes(jobTradeLower) || jobTradeLower.includes(skillLower)) {
      return { matched: true, reason: `Skill "${skill}" matches ${jobTrade}` };
    }
  }

  return { matched: false, reason: "" };
}

/**
 * Check if candidate's location matches job's city/postcode
 * +20 points if matched
 */
function checkLocationMatch(
  candidateLocation: string | null,
  jobCity: string | null,
  jobPostcode: string | null
): { matched: boolean; reason: string } {
  if (!candidateLocation) {
    return { matched: false, reason: "" };
  }

  const candidateLocLower = candidateLocation.toLowerCase().trim();

  // Check city
  if (jobCity) {
    const cityLower = jobCity.toLowerCase().trim();
    if (candidateLocLower.includes(cityLower) || cityLower.includes(candidateLocLower)) {
      return { matched: true, reason: `${candidateLocation} matches ${jobCity}` };
    }
  }

  // Check postcode (partial match on first part, e.g., "ME14" matches "ME14 1XX")
  if (jobPostcode) {
    const postcodeLower = jobPostcode.toLowerCase().trim();
    // Extract first part of postcode (e.g., "ME14" from "ME14 1XX")
    const postcodeFirstPart = postcodeLower.split(/\s+/)[0];
    const candidatePostcodePart = candidateLocLower.split(/\s+/)[0];

    if (
      candidateLocLower.includes(postcodeFirstPart) ||
      postcodeFirstPart.includes(candidatePostcodePart) ||
      candidatePostcodePart.includes(postcodeFirstPart)
    ) {
      return { matched: true, reason: `${candidateLocation} matches ${jobPostcode}` };
    }
  }

  return { matched: false, reason: "" };
}

/**
 * Check if candidate's availability matches job's start date
 * +15 points if matched
 */
function checkAvailabilityMatch(
  availabilityNotes: string | null,
  startDate: Date | null
): { matched: boolean; reason: string } {
  if (!availabilityNotes || !startDate) {
    return { matched: false, reason: "" };
  }

  const notesLower = availabilityNotes.toLowerCase();
  const hasImmediate = notesLower.includes("immediate") || notesLower.includes("from monday");

  if (!hasImmediate) {
    return { matched: false, reason: "" };
  }

  // Check if startDate is within 14 days
  const now = new Date();
  const daysDiff = Math.floor((startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysDiff >= 0 && daysDiff <= 14) {
    const startDateStr = startDate.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
    return { matched: true, reason: `Available immediately, job starts ${startDateStr}` };
  }

  return { matched: false, reason: "" };
}

/**
 * Check if candidate's salary range fits job's pay rate
 * +10 points if matched
 */
function checkSalaryFit(
  candidateMin: number | null,
  candidateMax: number | null,
  candidateCurrency: string | null,
  jobPayRate: number | null,
  jobCurrency: string
): { matched: boolean; reason: string } {
  if (!jobPayRate || !candidateMin) {
    return { matched: false, reason: "" };
  }

  // Only compare if currencies match (or candidate currency is null/GBP)
  const currenciesMatch =
    !candidateCurrency ||
    candidateCurrency.toUpperCase() === "GBP" ||
    candidateCurrency.toUpperCase() === jobCurrency.toUpperCase();

  if (!currenciesMatch) {
    return { matched: false, reason: "" };
  }

  // Check if job pay rate is within candidate's range
  const withinRange = candidateMax
    ? jobPayRate >= candidateMin && jobPayRate <= candidateMax
    : jobPayRate >= candidateMin;

  if (withinRange) {
    const rangeStr = candidateMax
      ? `£${candidateMin}-${candidateMax}`
      : `£${candidateMin}+`;
    return { matched: true, reason: `Job pay £${jobPayRate} fits range ${rangeStr}` };
  }

  // Check if job pay is close (within 10% of min)
  const tolerance = candidateMin * 0.1;
  if (jobPayRate >= candidateMin - tolerance && jobPayRate < candidateMin) {
    return { matched: true, reason: `Job pay £${jobPayRate} is close to minimum £${candidateMin}` };
  }

  return { matched: false, reason: "" };
}

