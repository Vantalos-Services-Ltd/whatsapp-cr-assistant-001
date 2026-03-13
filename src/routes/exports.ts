/**
 * CSV Export Routes
 * 
 * Provides CSV export endpoints for candidates and job pipeline data.
 * All exports are agency-scoped and stream data to avoid memory issues.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db/prisma.ts";
import { requireAgencyId } from "../utils/agencyContext.ts";
import { scopeWhere } from "../db/tenantScope.ts";
import { writeCsvResponse } from "../utils/csv.ts";
import { listJobPipeline } from "../services/jobPipelineService.ts";

/**
 * Build candidate search where clause from query params
 * Reuses logic from candidates.ts performCandidateSearch
 */
function buildCandidateSearchWhere(
  agencyId: string,
  queryParams: {
    q?: string;
    location?: string;
    role?: string;
    availability?: string;
    minSalary?: string;
    maxSalary?: string;
    skills?: string;
    lastSeen?: string;
  }
): any {
  const where: any = scopeWhere(agencyId, {});

  const { q, location, role, availability, minSalary, maxSalary, skills, lastSeen } = queryParams;

  // Keyword search (q parameter)
  if (q && q.trim().length > 0) {
    const keywords = q.trim().split(/\s+/).filter((k) => k.length > 0);
    const keywordConditions = keywords.map((keyword) => ({
      OR: [
        { name: { contains: keyword, mode: "insensitive" as const } },
        { phone: { contains: keyword, mode: "insensitive" as const } },
        { desiredRole: { contains: keyword, mode: "insensitive" as const } },
        { location: { contains: keyword, mode: "insensitive" as const } },
        { skills: { hasSome: [keyword.toLowerCase()] } },
      ],
    }));
    where.AND = keywordConditions;
  }

  // Location filter
  if (location && location.trim().length > 0) {
    where.location = { contains: location.trim(), mode: "insensitive" as const };
  }

  // Role filter
  if (role && role.trim().length > 0) {
    where.desiredRole = { contains: role.trim(), mode: "insensitive" as const };
  }

  // Availability filter (searches in availabilityNotes)
  if (availability && availability.trim().length > 0) {
    where.availabilityNotes = { contains: availability.trim(), mode: "insensitive" as const };
  }

  // Salary filters
  // For minSalary: candidate's max salary should be >= min (range overlaps)
  // For maxSalary: candidate's min salary should be <= max (range overlaps)
  if (minSalary || maxSalary) {
    const salaryConditions: any[] = [];
    if (minSalary) {
      const min = parseInt(minSalary, 10);
      if (!isNaN(min)) {
        salaryConditions.push({ salaryMax: { gte: min } });
      }
    }
    if (maxSalary) {
      const max = parseInt(maxSalary, 10);
      if (!isNaN(max)) {
        salaryConditions.push({ salaryMin: { lte: max } });
      }
    }
    if (salaryConditions.length > 0) {
      // Combine salary conditions with AND (both must be true if both provided)
      if (salaryConditions.length === 1) {
        Object.assign(where, salaryConditions[0]);
      } else {
        where.AND = where.AND || [];
        where.AND.push(...salaryConditions);
      }
    }
  }

  // Skills filter (comma-separated)
  if (skills && skills.trim().length > 0) {
    const skillList = skills
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);
    if (skillList.length > 0) {
      where.skills = { hasSome: skillList };
    }
  }

  // Last seen filter (e.g., "7d" for last 7 days, "30d" for last 30 days)
  if (lastSeen && lastSeen.trim().length > 0) {
    const match = lastSeen.trim().match(/^(\d+)d$/i);
    if (match) {
      const days = parseInt(match[1], 10);
      if (!isNaN(days) && days > 0) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        where.lastSeenAt = { gte: cutoffDate };
      }
    }
  }

  return where;
}

/**
 * Extract memory summary from memoryPack (1 line)
 */
function extractMemorySummary(memoryPack: any): string {
  if (!memoryPack || typeof memoryPack !== "object") {
    return "";
  }

  // Try to extract a summary from memoryPack
  // Common fields: facts, summary, notes
  if (memoryPack.summary && typeof memoryPack.summary === "string") {
    return memoryPack.summary.substring(0, 200); // Limit to 200 chars
  }

  // Build summary from facts if available
  if (memoryPack.facts && typeof memoryPack.facts === "object") {
    const factParts: string[] = [];
    if (memoryPack.facts.trade) factParts.push(`Trade: ${memoryPack.facts.trade}`);
    if (memoryPack.facts.location) factParts.push(`Location: ${memoryPack.facts.location}`);
    if (memoryPack.facts.availability) factParts.push(`Available: ${memoryPack.facts.availability}`);
    if (factParts.length > 0) {
      return factParts.join("; ");
    }
  }

  return "";
}

/**
 * Extract next action from progressData
 */
function extractNextAction(progressData: any): string {
  if (!progressData || typeof progressData !== "object") {
    return "";
  }

  if (progressData.nextAction && typeof progressData.nextAction === "string") {
    return progressData.nextAction;
  }

  return "";
}

/**
 * GET /api/exports/candidates.csv
 * Export candidates search results to CSV
 * 
 * Query params (same as candidates search):
 * - q: keyword search
 * - location: filter by location
 * - role: filter by desired role
 * - availability: filter by availability notes
 * - minSalary: minimum salary filter
 * - maxSalary: maximum salary filter
 * - skills: comma-separated skills filter
 * - lastSeen: days filter (e.g., "7d", "30d")
 */
export async function exportCandidatesHandler(
  request: FastifyRequest<{
    Querystring: {
      q?: string;
      location?: string;
      role?: string;
      availability?: string;
      minSalary?: string;
      maxSalary?: string;
      skills?: string;
      lastSeen?: string;
    };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    // Build search where clause from query params
    const where = buildCandidateSearchWhere(agencyId, request.query);

    // CSV headers (in specified order)
    const headers = [
      "Candidate ID",
      "Name",
      "Desired Role",
      "Location",
      "Skills",
      "Years Experience",
      "Availability",
      "Salary Min",
      "Salary Max",
      "Progress Stage",
      "Next Action",
      "Memory Summary",
      "Last Activity At",
      "Created At",
    ];

    // Generator function to stream candidates in chunks
    async function* generateCandidateRows(): AsyncGenerator<string[], void, unknown> {
      const CHUNK_SIZE = 500;
      let skip = 0;
      let hasMore = true;

      // Map to cache conversation data by candidate phone
      const conversationCache = new Map<string, {
        progressStage: string | null;
        progressData: any;
        memoryPack: any;
        lastMessageAt: Date | null;
      }>();

      while (hasMore) {
        // Fetch chunk of candidates
        const candidates = await prisma.candidate.findMany({
          where,
          select: {
            id: true,
            name: true,
            desiredRole: true,
            location: true,
            skills: true,
            yearsExperience: true,
            availabilityNotes: true,
            salaryMin: true,
            salaryMax: true,
            phone: true,
            lastSeenAt: true,
            createdAt: true,
          },
          orderBy: {
            lastSeenAt: "desc",
          },
          take: CHUNK_SIZE,
          skip,
        });

        if (candidates.length === 0) {
          hasMore = false;
          break;
        }

        // Batch load conversations for this chunk
        const candidatePhones = candidates.map((c) => c.phone);
        const contacts = await prisma.contact.findMany({
          where: scopeWhere(agencyId, {
            phone: { in: candidatePhones },
          }),
          select: {
            id: true,
            phone: true,
          },
        });

        const phoneToContactId = new Map(contacts.map((c) => [c.phone, c.id]));
        const contactIds = Array.from(phoneToContactId.values());

        if (contactIds.length > 0) {
          const conversations = await prisma.conversation.findMany({
            where: scopeWhere(agencyId, {
              contactId: { in: contactIds },
            }),
            select: {
              contactId: true,
              progressStage: true,
              progressData: true,
              memoryPack: true,
              lastMessageAt: true,
            },
            orderBy: {
              lastMessageAt: "desc",
            },
          });

          // Group by contactId (get most recent per contact)
          const conversationByContactId = new Map<string, typeof conversations[0]>();
          for (const conv of conversations) {
            if (!conversationByContactId.has(conv.contactId)) {
              conversationByContactId.set(conv.contactId, conv);
            }
          }

          // Map conversations to candidate phones
          for (const contact of contacts) {
            const conv = conversationByContactId.get(contact.id);
            if (conv) {
              conversationCache.set(contact.phone, {
                progressStage: conv.progressStage,
                progressData: conv.progressData,
                memoryPack: conv.memoryPack,
                lastMessageAt: conv.lastMessageAt,
              });
            }
          }
        }

        // Yield rows for this chunk
        for (const candidate of candidates) {
          const conversation = conversationCache.get(candidate.phone);

          const row: string[] = [
            candidate.id,
            candidate.name || "",
            candidate.desiredRole || "",
            candidate.location || "",
            (candidate.skills || []).join(", "),
            candidate.yearsExperience?.toString() || "",
            candidate.availabilityNotes || "",
            candidate.salaryMin?.toString() || "",
            candidate.salaryMax?.toString() || "",
            conversation?.progressStage || "",
            extractNextAction(conversation?.progressData),
            extractMemorySummary(conversation?.memoryPack),
            conversation?.lastMessageAt?.toISOString() || candidate.lastSeenAt?.toISOString() || "",
            candidate.createdAt.toISOString(),
          ];

          yield row;
        }

        // Check if there are more candidates
        if (candidates.length < CHUNK_SIZE) {
          hasMore = false;
        } else {
          skip += CHUNK_SIZE;
        }
      }
    }

    // Generate filename with date
    const dateStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const filename = `candidates-export-${dateStr}`;

    // Stream CSV response
    await writeCsvResponse(reply, filename, headers, generateCandidateRows());

    logger.info({ agencyId, queryParams: request.query }, "Exported candidates to CSV");
  } catch (error) {
    logger.error({ error, queryParams: request.query }, "Failed to export candidates");
    return reply.status(500).send({ error: "Failed to export candidates" });
  }
}

/**
 * GET /api/exports/job-pipeline.csv
 * Export job pipeline items to CSV
 * 
 * Query params:
 * - jobId: filter by specific job (optional, if not provided exports all)
 */
export async function exportJobPipelineHandler(
  request: FastifyRequest<{
    Querystring: {
      jobId?: string;
    };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    const { jobId } = request.query;

    // CSV headers (in specified order)
    const headers = [
      "Job Title",
      "Candidate Name",
      "Stage",
      "Start Date",
      "Pay Rate",
      "Match Score",
      "Notes",
      "Last Activity",
      "Progress Stage",
    ];

    // Generator function to stream pipeline items in chunks
    async function* generatePipelineRows(): AsyncGenerator<string[], void, unknown> {
      const CHUNK_SIZE = 500;
      let skip = 0;
      let hasMore = true;

      while (hasMore) {
        // Build where clause
        const where: any = scopeWhere(agencyId, {});
        if (jobId) {
          where.jobId = jobId;
        }

        // Fetch chunk of pipeline items with related data
        const pipelineItems = await prisma.jobPipelineItem.findMany({
          where,
          include: {
            job: {
              select: {
                title: true,
              },
            },
            candidate: {
              select: {
                name: true,
                phone: true,
              },
            },
          },
          orderBy: {
            updatedAt: "desc",
          },
          take: CHUNK_SIZE,
          skip,
        });

        if (pipelineItems.length === 0) {
          hasMore = false;
          break;
        }

        // Batch load job matches for match scores
        const candidateIds = pipelineItems.map((item) => item.candidateId);
        const jobIds = pipelineItems.map((item) => item.jobId);
        const jobMatches = await prisma.jobCandidateMatch.findMany({
          where: scopeWhere(agencyId, {
            candidateId: { in: candidateIds },
            jobId: { in: jobIds },
          }),
          select: {
            jobId: true,
            candidateId: true,
            score: true,
          },
        });

        const matchMap = new Map<string, number>();
        for (const match of jobMatches) {
          const key = `${match.jobId}:${match.candidateId}`;
          matchMap.set(key, match.score);
        }

        // Batch load conversations for progress stage
        const candidatePhones = pipelineItems.map((item) => item.candidate.phone);
        const contacts = await prisma.contact.findMany({
          where: scopeWhere(agencyId, {
            phone: { in: candidatePhones },
          }),
          select: {
            id: true,
            phone: true,
          },
        });

        const phoneToContactId = new Map(contacts.map((c) => [c.phone, c.id]));
        const contactIds = Array.from(phoneToContactId.values());

        const conversationMap = new Map<string, { progressStage: string | null }>();
        if (contactIds.length > 0) {
          const conversations = await prisma.conversation.findMany({
            where: scopeWhere(agencyId, {
              contactId: { in: contactIds },
            }),
            select: {
              contactId: true,
              progressStage: true,
              lastMessageAt: true,
            },
            orderBy: {
              lastMessageAt: "desc",
            },
          });

          // Group by contactId (get most recent per contact)
          for (const conv of conversations) {
            if (!conversationMap.has(conv.contactId)) {
              conversationMap.set(conv.contactId, { progressStage: conv.progressStage });
            }
          }
        }

        // Yield rows for this chunk
        for (const item of pipelineItems) {
          const matchKey = `${item.jobId}:${item.candidateId}`;
          const matchScore = matchMap.get(matchKey)?.toString() || "";

          const contactId = phoneToContactId.get(item.candidate.phone);
          const conversation = contactId ? conversationMap.get(contactId) : null;

          const row: string[] = [
            item.job.title,
            item.candidate.name || "",
            item.stage,
            item.startDate?.toISOString() || "",
            item.payRate?.toString() || "",
            matchScore,
            item.notes || "",
            item.updatedAt.toISOString(),
            conversation?.progressStage || "",
          ];

          yield row;
        }

        // Check if there are more items
        if (pipelineItems.length < CHUNK_SIZE) {
          hasMore = false;
        } else {
          skip += CHUNK_SIZE;
        }
      }
    }

    // Generate filename with date
    const dateStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const filename = jobId ? `job-${jobId}-pipeline-${dateStr}` : `job-pipeline-${dateStr}`;

    // Stream CSV response
    await writeCsvResponse(reply, filename, headers, generatePipelineRows());

    logger.info({ agencyId, jobId }, "Exported job pipeline to CSV");
  } catch (error) {
    logger.error({ error, jobId: request.query.jobId }, "Failed to export job pipeline");
    return reply.status(500).send({ error: "Failed to export job pipeline" });
  }
}

/**
 * GET /api/exports/jobs/:id/pipeline.csv
 * Export job pipeline items for a specific job to CSV
 * 
 * Uses listJobPipeline service to get enriched pipeline data.
 * Returns 404 if job not found or doesn't belong to agency.
 */
export async function exportJobPipelineByIdHandler(
  request: FastifyRequest<{
    Params: { id: string };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const { id: jobId } = request.params;

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    // Load job by id and agencyId, 404 if not found
    const job = await prisma.job.findFirst({
      where: scopeWhere(agencyId, { id: jobId }),
      select: {
        id: true,
        title: true,
        city: true,
        postcode: true,
        siteName: true,
        addressLine1: true,
        addressLine2: true,
      },
    });

    if (!job) {
      return reply.status(404).send({ error: "Job not found" });
    }

    // Build job location string
    const locationParts: string[] = [];
    if (job.siteName) locationParts.push(job.siteName);
    if (job.city) locationParts.push(job.city);
    if (job.postcode) locationParts.push(job.postcode);
    if (job.addressLine1) locationParts.push(job.addressLine1);
    const jobLocation = locationParts.join(", ");

    // Load pipeline items via listJobPipeline service
    const pipelineItems = await listJobPipeline(agencyId, jobId);

    // CSV headers (in specified order)
    const headers = [
      "Job ID",
      "Job Title",
      "Job Location",
      "Candidate ID",
      "Candidate Name",
      "Candidate Trade",
      "Candidate Location",
      "Pipeline Stage",
      "Start Date",
      "Pay Rate",
      "Match Score",
      "Progress Stage",
      "Last Activity",
      "Memory Summary",
      "Notes",
      "Updated At",
    ];

    // Generator function to stream pipeline rows
    async function* generatePipelineRows(): AsyncGenerator<string[], void, unknown> {
      for (const item of pipelineItems) {
        const row: string[] = [
          job.id,
          job.title,
          jobLocation,
          item.candidateId,
          item.candidate.name || "",
          item.candidate.desiredRole || "",
          item.candidate.location || "",
          item.stage,
          item.startDate?.toISOString() || "",
          item.payRate?.toString() || "",
          item.matchScore?.toString() || "",
          item.conversation?.progressStage || "",
          item.conversation?.lastMessageAt?.toISOString() || item.updatedAt.toISOString(),
          extractMemorySummary(item.conversation?.memoryPack),
          item.notes || "", // Notes are sanitized by toCsvRow
          item.updatedAt.toISOString(),
        ];

        yield row;
      }
    }

    // Generate filename with date
    const dateStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const filename = `job-${jobId}-pipeline-${dateStr}`;

    // Stream CSV response
    await writeCsvResponse(reply, filename, headers, generatePipelineRows());

    logger.info({ agencyId, jobId }, "Exported job pipeline to CSV");
  } catch (error) {
    logger.error({ error, jobId }, "Failed to export job pipeline");
    if (error instanceof Error && error.message.includes("not found")) {
      return reply.status(404).send({ error: "Job not found" });
    }
    return reply.status(500).send({ error: "Failed to export job pipeline" });
  }
}

/**
 * Register export routes
 */
export function exportRoutes(fastify: FastifyInstance) {
  fastify.get("/exports/candidates.csv", exportCandidatesHandler);
  fastify.get("/exports/job-pipeline.csv", exportJobPipelineHandler);
  fastify.get("/exports/jobs/:id/pipeline.csv", exportJobPipelineByIdHandler);
}

