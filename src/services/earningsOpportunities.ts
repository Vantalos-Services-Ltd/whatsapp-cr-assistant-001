/**
 * Earnings Opportunities Service
 * Finds priority opportunities for operators to maximize earnings
 */

import { prisma } from "../db/prisma.ts";
import { TaskStatus, TaskType, PlacementStatus, MatchTier } from "@prisma/client";

export interface EarningsOpportunity {
  label: string;
  jobId?: string;
  candidateId?: string;
  estMonthlyMargin?: number;
  currency: "GBP";
  why: string;
}

/**
 * Calculate estimated monthly margin from job rates
 */
function calculateMonthlyMargin(
  chargeRate: number | null | undefined,
  payRate: number | null | undefined
): number | null {
  if (!chargeRate || !payRate) {
    return null;
  }

  const marginPerHour = chargeRate - payRate;
  // 8 hours/day * 5 days/week * 4 weeks/month = 160 hours/month
  const estMonthlyMargin = marginPerHour * 8 * 5 * 4;
  
  return Math.round(estMonthlyMargin);
}

/**
 * Generate label for opportunity
 */
function generateLabel(jobTitle: string, location?: string | null): string {
  if (location) {
    return `Close ${location} ${jobTitle}`;
  }
  return `Close ${jobTitle}`;
}

/**
 * Get priority opportunities for an operator
 */
export async function getPriorityOpportunities({
  agencyId,
  operatorId,
  limit = 3,
}: {
  agencyId: string;
  operatorId: string;
  limit?: number;
}): Promise<EarningsOpportunity[]> {
  const opportunities: EarningsOpportunity[] = [];

  try {
    // 1) Placements with status=PENDING for this agency
    // Note: Placements don't have operatorId, so we query all PENDING placements for the agency
    const pendingPlacements = await prisma.placement.findMany({
      where: {
        agencyId,
        status: PlacementStatus.PENDING,
      },
      include: {
        job: {
          select: {
            id: true,
            title: true,
            city: true,
            chargeRate: true,
            payRate: true,
            currency: true,
          },
        },
        candidate: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      take: limit * 2, // Get more than needed in case some don't have margin data
    });

    const seenPlacements = new Set<string>();

    for (const placement of pendingPlacements) {
      // Deduplicate by job-candidate pair
      const key = `${placement.job.id}:${placement.candidate.id}`;
      if (seenPlacements.has(key)) {
        continue;
      }
      seenPlacements.add(key);

      const estMonthlyMargin = calculateMonthlyMargin(
        placement.job.chargeRate,
        placement.job.payRate
      );

      opportunities.push({
        label: generateLabel(placement.job.title, placement.job.city),
        jobId: placement.job.id,
        candidateId: placement.candidate.id,
        estMonthlyMargin: estMonthlyMargin ?? undefined,
        currency: "GBP",
        why: estMonthlyMargin
          ? `High margin role (${placement.job.currency === "GBP" ? "£" : ""}${estMonthlyMargin.toLocaleString()}/month), ready for confirmation`
          : "Placement pending confirmation",
      });
    }

    // 2) OPEN tasks where type = CSCS_VERIFICATION OR APPROVAL_REQUIRED
    // and payload has job info or can be linked to jobId
    if (opportunities.length < limit) {
      const openTasks = await prisma.task.findMany({
        where: {
          agencyId,
          status: TaskStatus.OPEN,
          type: {
            in: [TaskType.CSCS_VERIFICATION, TaskType.APPROVAL_REQUIRED],
          },
        },
        select: {
          id: true,
          type: true,
          candidateId: true,
          payload: true,
        },
        take: limit * 2,
      });

      const seenTasks = new Set<string>();

      for (const task of openTasks) {
        // Try to extract jobId from payload
        let jobId: string | undefined;
        let jobTitle: string | undefined;
        let jobCity: string | null | undefined;
        let chargeRate: number | null | undefined;
        let payRate: number | null | undefined;
        let currency: string = "GBP";

        try {
          const payload = task.payload as any;
          if (payload?.job?.jobId) {
            jobId = payload.job.jobId;
            jobTitle = payload.job.title;
            jobCity = payload.job.city;
            
            // Fetch job to get rates
            if (jobId) {
              const job = await prisma.job.findFirst({
                where: {
                  id: jobId,
                  agencyId,
                },
                select: {
                  title: true,
                  city: true,
                  chargeRate: true,
                  payRate: true,
                  currency: true,
                },
              });
              if (job) {
                // Use job data if available (more reliable than payload)
                jobTitle = job.title;
                jobCity = job.city;
                chargeRate = job.chargeRate;
                payRate = job.payRate;
                currency = job.currency || "GBP";
              }
            }
          }
        } catch (error) {
          // Payload parsing failed, skip this task
          continue;
        }

        // Skip if we don't have job info
        if (!jobId || !jobTitle) {
          continue;
        }

        const candidateId = task.candidateId || undefined;
        
        // Deduplicate by job-candidate pair (skip if already exists from placements)
        const key = `${jobId}:${candidateId || "no-candidate"}`;
        if (seenTasks.has(key) || opportunities.some(
          (opp) => opp.jobId === jobId && opp.candidateId === candidateId
        )) {
          continue;
        }
        seenTasks.add(key);

        const estMonthlyMargin = calculateMonthlyMargin(chargeRate, payRate);

        opportunities.push({
          label: generateLabel(jobTitle, jobCity),
          jobId,
          candidateId,
          estMonthlyMargin: estMonthlyMargin ?? undefined,
          currency: "GBP",
          why:
            task.type === TaskType.CSCS_VERIFICATION
              ? estMonthlyMargin
                ? `CSCS verification pending, high margin role`
                : `CSCS verification pending, ready for approval`
              : estMonthlyMargin
              ? `High margin role, ready for approval`
              : "Task pending approval",
        });
      }
    }

    // 3) Top tier JobCandidateMatch for jobs with highest margin (fallback)
    if (opportunities.length < limit) {
      const topMatches = await prisma.jobCandidateMatch.findMany({
        where: {
          agencyId,
          tier: {
            in: [MatchTier.PROVEN, MatchTier.EXCELLENT],
          },
        },
        include: {
          job: {
            select: {
              id: true,
              title: true,
              city: true,
              chargeRate: true,
              payRate: true,
              currency: true,
            },
          },
          candidate: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: [
          {
            tier: "asc", // PROVEN first, then EXCELLENT
          },
          {
            score: "desc", // Higher score first
          },
        ],
        take: limit * 2,
      });

      for (const match of topMatches) {
        // Skip if we already have this job-candidate combination
        const alreadyExists = opportunities.some(
          (opp) => opp.jobId === match.job.id && opp.candidateId === match.candidate.id
        );

        if (alreadyExists) {
          continue;
        }

        const estMonthlyMargin = calculateMonthlyMargin(
          match.job.chargeRate,
          match.job.payRate
        );

        opportunities.push({
          label: generateLabel(match.job.title, match.job.city),
          jobId: match.job.id,
          candidateId: match.candidate.id,
          estMonthlyMargin: estMonthlyMargin ?? undefined,
          currency: "GBP",
          why: estMonthlyMargin
            ? `${match.tier} match, high margin opportunity`
            : `${match.tier} match, ready for outreach`,
        });
      }
    }

    // Sort by estMonthlyMargin (highest first), null margins go to bottom
    opportunities.sort((a, b) => {
      // If both have margins, sort by margin descending
      if (a.estMonthlyMargin !== undefined && b.estMonthlyMargin !== undefined) {
        return b.estMonthlyMargin - a.estMonthlyMargin;
      }
      // If only a has margin, a comes first
      if (a.estMonthlyMargin !== undefined) {
        return -1;
      }
      // If only b has margin, b comes first
      if (b.estMonthlyMargin !== undefined) {
        return 1;
      }
      // Both have no margin, maintain original order
      return 0;
    });

    // Return top N
    return opportunities.slice(0, limit);
  } catch (error) {
    // Log error but return empty array rather than failing
    console.error("Error fetching earnings opportunities:", error);
    return [];
  }
}

