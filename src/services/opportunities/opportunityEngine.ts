/**
 * Opportunity Engine Service
 * Identifies high-value revenue opportunities and converts them into actionable tasks
 */

import pino from "pino";
import { PrismaClient, JobStatus, JobPipelineStage } from "@prisma/client";
import { createHash } from "crypto";
import { scopeWhere } from "../../db/tenantScope.ts";
import type { Opportunity, OpportunityType, RecommendedAction } from "./types.ts";

const log = pino({ name: "opportunityEngine" });
const prisma = new PrismaClient();

/**
 * Generate stable deterministic hash for opportunity key
 */
function generateOpportunityKey(
  type: OpportunityType,
  jobId: string | undefined,
  candidateIds: string[] | undefined,
  dateBucket: string
): string {
  const parts = [
    type,
    jobId || "",
    (candidateIds || []).sort().join(","),
    dateBucket,
  ].join("|");
  return createHash("sha1").update(parts).digest("hex");
}

/**
 * Get date bucket (YYYY-MM-DD) for opportunity expiration
 */
function getDateBucket(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Score an opportunity (0-100)
 */
export function scoreOpportunity(opportunity: Opportunity): number {
  let score = opportunity.priority;

  // Boost underfilled urgent jobs
  if (opportunity.type === "UNDERFILLED_URGENT_JOB") {
    score += 20;
  }

  // Boost if high match scores (if candidateIds exist)
  if (opportunity.relatedEntities.candidateIds && opportunity.relatedEntities.candidateIds.length > 0) {
    score += Math.min(15, opportunity.relatedEntities.candidateIds.length * 3);
  }

  // Cap at 100
  return Math.min(100, Math.max(0, score));
}

/**
 * Dedupe opportunities by stable ID
 */
export function dedupeOpportunities(opportunities: Opportunity[]): Opportunity[] {
  const seen = new Map<string, Opportunity>();
  for (const opp of opportunities) {
    if (!seen.has(opp.id) || seen.get(opp.id)!.priority < opp.priority) {
      seen.set(opp.id, opp);
    }
  }
  return Array.from(seen.values());
}

/**
 * Get opportunities for an agency
 */
export async function getOpportunities(input: {
  agencyId: string;
  now?: Date;
}): Promise<Opportunity[]> {
  const { agencyId, now = new Date() } = input;
  const dateBucket = getDateBucket(now);
  const opportunities: Opportunity[] = [];

  try {
    // 1. UNDERFILLED_URGENT_JOB
    const urgentJobs = await prisma.job.findMany({
      where: scopeWhere(agencyId, {
        status: {
          in: [JobStatus.URGENT, JobStatus.ACTIVE],
        },
      }),
      include: {
        pipelineItems: {
          where: {
            stage: {
              in: [JobPipelineStage.SHORTLISTED, JobPipelineStage.OFFER_SENT],
            },
          },
        },
        candidateMatches: {
          orderBy: { score: "desc" },
          take: 20,
        },
      },
    });

    for (const job of urgentJobs) {
      const positionsNeeded = job.positionsOpen - job.positionsFilled;
      const inPipeline = job.pipelineItems.length;
      const shortfall = positionsNeeded - inPipeline;

      if (shortfall > 0) {
        // Calculate priority based on urgency, margin, and shortfall
        let priority = 50;
        if (job.status === JobStatus.URGENT) priority += 20;
        if (job.chargeRate && job.payRate) {
          const margin = job.chargeRate - job.payRate;
          if (margin > 0) priority += Math.min(20, Math.floor(margin / 5));
        }
        priority += Math.min(10, shortfall * 2);

        // Get top matching candidates
        const topMatches = job.candidateMatches
          .filter((m) => m.score >= 70)
          .slice(0, Math.min(shortfall, 10))
          .map((m) => m.candidateId);

        if (topMatches.length > 0) {
          const oppKey = generateOpportunityKey("UNDERFILLED_URGENT_JOB", job.id, topMatches, dateBucket);
          opportunities.push({
            id: oppKey,
            type: "UNDERFILLED_URGENT_JOB",
            title: `${job.title} - ${shortfall} position${shortfall > 1 ? "s" : ""} needed`,
            priority,
            reasons: [
              `Job is ${job.status === JobStatus.URGENT ? "URGENT" : "ACTIVE"}`,
              `${shortfall} position${shortfall > 1 ? "s" : ""} unfilled`,
              `${topMatches.length} strong candidate${topMatches.length > 1 ? "s" : ""} available`,
            ],
            recommendedAction: {
              taskType: "OUTREACH",
              count: topMatches.length,
              description: `Create outreach tasks to ${topMatches.length} top matching candidates`,
            },
            relatedEntities: {
              jobId: job.id,
              candidateIds: topMatches,
            },
            expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), // 24 hours
            createdAt: now,
          });
        }
      }
    }

    // 2. DORMANT_CANDIDATES_MATCH_URGENT_JOB
    const dormantThreshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
    const urgentJobIds = urgentJobs.map((j) => j.id);

    if (urgentJobIds.length > 0) {
      const dormantCandidates = await prisma.candidate.findMany({
        where: scopeWhere(agencyId, {
          lastSeenAt: {
            lt: dormantThreshold,
          },
        }),
        include: {
          jobMatches: {
            where: {
              jobId: { in: urgentJobIds },
              score: { gte: 80 }, // Strong match
            },
            include: {
              job: true,
            },
            orderBy: { score: "desc" },
            take: 1, // Best match per candidate
          },
        },
      });

      // Group by job
      const jobToCandidates = new Map<string, string[]>();
      for (const candidate of dormantCandidates) {
        if (candidate.jobMatches.length > 0) {
          const match = candidate.jobMatches[0];
          const jobId = match.jobId;
          if (!jobToCandidates.has(jobId)) {
            jobToCandidates.set(jobId, []);
          }
          jobToCandidates.get(jobId)!.push(candidate.id);
        }
      }

      for (const [jobId, candidateIds] of jobToCandidates.entries()) {
        const topCandidates = candidateIds.slice(0, 10);
        if (topCandidates.length > 0) {
          const job = urgentJobs.find((j) => j.id === jobId);
          if (job) {
            const oppKey = generateOpportunityKey("DORMANT_CANDIDATES_MATCH_URGENT_JOB", jobId, topCandidates, dateBucket);
            opportunities.push({
              id: oppKey,
              type: "DORMANT_CANDIDATES_MATCH_URGENT_JOB",
              title: `Reactivate ${topCandidates.length} dormant candidate${topCandidates.length > 1 ? "s" : ""} for ${job.title}`,
              priority: 60 + Math.min(20, topCandidates.length * 2),
              reasons: [
                `${topCandidates.length} dormant candidate${topCandidates.length > 1 ? "s" : ""} match urgent job`,
                `Match score ≥80`,
                `Last seen >7 days ago`,
              ],
              recommendedAction: {
                taskType: "OUTREACH",
                count: topCandidates.length,
                description: `Create reactivation outreach tasks for ${topCandidates.length} candidates`,
              },
              relatedEntities: {
                jobId,
                candidateIds: topCandidates,
              },
              expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
              createdAt: now,
            });
          }
        }
      }
    }

    // 3. FOLLOW_UP_AFTER_OFFER
    const offerFollowUpHours = 24; // Follow up after 24 hours
    const offerFollowUpThreshold = new Date(now.getTime() - offerFollowUpHours * 60 * 60 * 1000);

    const offersPending = await prisma.jobPipelineItem.findMany({
      where: scopeWhere(agencyId, {
        stage: JobPipelineStage.OFFER_SENT,
        updatedAt: {
          lt: offerFollowUpThreshold,
        },
      }),
      include: {
        job: true,
        candidate: {
          include: {
            lastConversation: {
              select: { id: true },
            },
          },
        },
      },
    });

    for (const offer of offersPending) {
      const hoursSinceOffer = Math.floor((now.getTime() - offer.updatedAt.getTime()) / (60 * 60 * 1000));
      const oppKey = generateOpportunityKey("FOLLOW_UP_AFTER_OFFER", offer.jobId, [offer.candidateId], dateBucket);
      
      opportunities.push({
        id: oppKey,
        type: "FOLLOW_UP_AFTER_OFFER",
        title: `Follow up: ${offer.candidate.name || "Candidate"} - ${offer.job.title}`,
        priority: 70 + Math.min(20, hoursSinceOffer / 24),
        reasons: [
          `Offer sent ${hoursSinceOffer}h ago`,
          `No response from candidate`,
          `Job: ${offer.job.title}`,
        ],
        recommendedAction: {
          taskType: "FOLLOW_UP",
          count: 1,
          description: "Create follow-up task with suggested message",
        },
        relatedEntities: {
          jobId: offer.jobId,
          candidateIds: [offer.candidateId],
          conversationIds: offer.candidate.lastConversation?.id ? [offer.candidate.lastConversation.id] : undefined,
        },
        expiresAt: new Date(now.getTime() + 48 * 60 * 60 * 1000), // 48 hours
        createdAt: now,
      });
    }

    // 4. DAY1_AFTERCARE_CHECKIN
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const today = new Date(now);
    today.setHours(23, 59, 59, 999);

    const recentStarts = await prisma.jobPipelineItem.findMany({
      where: scopeWhere(agencyId, {
        stage: JobPipelineStage.START_CONFIRMED,
        startDate: {
          gte: yesterday,
          lte: today,
        },
      }),
      include: {
        job: true,
        candidate: {
          include: {
            lastConversation: {
              select: { id: true },
            },
          },
        },
      },
    });

    for (const start of recentStarts) {
      const oppKey = generateOpportunityKey("DAY1_AFTERCARE_CHECKIN", start.jobId, [start.candidateId], dateBucket);
      
      opportunities.push({
        id: oppKey,
        type: "DAY1_AFTERCARE_CHECKIN",
        title: `Day 1 check-in: ${start.candidate.name || "Candidate"} - ${start.job.title}`,
        priority: 65,
        reasons: [
          `Start confirmed ${start.startDate ? new Date(start.startDate).toLocaleDateString() : "today"}`,
          `First day on site`,
          `Ensure smooth onboarding`,
        ],
        recommendedAction: {
          taskType: "FOLLOW_UP",
          count: 1,
          description: "Create morning check-in task",
        },
        relatedEntities: {
          jobId: start.jobId,
          candidateIds: [start.candidateId],
          conversationIds: start.candidate.lastConversation?.id ? [start.candidate.lastConversation.id] : undefined,
        },
        expiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000), // 12 hours (next morning)
        createdAt: now,
      });
    }

    // Dedupe and filter expired
    const deduped = dedupeOpportunities(opportunities);
    const active = deduped.filter((opp) => opp.expiresAt > now);

    // Score all opportunities
    const scored = active.map((opp) => ({
      ...opp,
      priority: scoreOpportunity(opp),
    }));

    // Sort by priority and return top 10
    const sorted = scored.sort((a, b) => b.priority - a.priority);
    return sorted.slice(0, 10);
  } catch (error) {
    log.error({ agencyId, error }, "Failed to get opportunities");
    return [];
  }
}

