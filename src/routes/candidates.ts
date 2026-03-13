/**
 * Candidate search routes
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db/prisma.ts";
import { requireAuth } from "../middleware/auth.ts";
import { parseSearchQuery, searchCandidates, type SearchResult } from "../services/candidateSearch.ts";
import { generateOutreachMessage, type CandidateOutreachPreview } from "../services/outreachGenerator.ts";
import { TaskType, TaskStatus, TaskApprovalStatus, MessageSenderRole, MessageDirection } from "@prisma/client";
import type { CandidateDetailDTO } from "../dto/operator.ts";
import { extractFirstMediaUrl } from "../services/twilioMedia.ts";
import { fetchJobSnapshot } from "../services/jobSnapshot.ts";
import { getPlaybook } from "../services/playbook/playbookService.ts";
import { requireAgencyId } from "../utils/agencyContext.ts";

interface SearchBody {
  candidateIds: string[];
  jobDescription: string;
}

interface PreviewBody {
  candidateIds: string[];
  jobDescription: string;
}

interface SubmitBody {
  candidateIds: string[];
  jobDescription: string;
  suggestedMessages?: Record<string, string>; // candidateId -> message
  jobId?: string; // Optional jobId for job snapshot in payload
}

/**
 * Internal helper function to perform candidate search
 * Reused by both GET and POST search endpoints
 */
async function performCandidateSearch(
  query: string,
  limit: number,
  logger: any
): Promise<{
  query: string;
  filters: {};
  results: SearchResult[];
  count: number;
}> {
  // Allow empty query - return all candidates
  const trimmedQuery = query ? query.trim() : "";
  const searchLimit = Math.min(limit || 50, 100);

  // Get agency (assuming single agency for now)
  const agency = await prisma.agency.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (!agency) {
    throw new Error("No agency found");
  }

  let candidates;
  let results: SearchResult[];

  // If query is empty, return all candidates
  if (trimmedQuery.length === 0) {
    logger.info({ limit: searchLimit }, "Returning all candidates (empty query)");
    
    candidates = await prisma.candidate.findMany({
      where: {
        agencyId: agency.id,
      },
      take: searchLimit,
      orderBy: {
        lastSeenAt: "desc",
      },
    });

    results = candidates.map((c) => ({
      candidateId: c.id,
      phone: c.phone,
      name: c.name,
      desiredRole: c.desiredRole,
      skills: c.skills || [],
      yearsExperience: c.yearsExperience,
      location: c.location,
      salary: {
        min: c.salaryMin,
        max: c.salaryMax,
        currency: c.currency,
      },
      matchScore: 1, // Default score for "all results"
      reasons: ["Matches all candidates"],
    }));
  } else {
    // Split query by spaces into keywords
    const keywords = trimmedQuery.split(/\s+/).filter((k) => k.length > 0);
    logger.info({ query: trimmedQuery, keywords, keywordCount: keywords.length }, "Searching candidates by keywords");

    // Build OR conditions for each keyword
    // Each keyword must match ANY of: name, phone, desiredRole, location, skills
    const keywordConditions = keywords.map((keyword) => ({
      OR: [
        // Name match (case-insensitive partial)
        {
          name: {
            contains: keyword,
            mode: "insensitive" as const,
          },
        },
        // Phone match (case-insensitive partial)
        {
          phone: {
            contains: keyword,
            mode: "insensitive" as const,
          },
        },
        // Role/trade match (case-insensitive partial)
        {
          desiredRole: {
            contains: keyword,
            mode: "insensitive" as const,
          },
        },
        // Location match (case-insensitive partial)
        {
          location: {
            contains: keyword,
            mode: "insensitive" as const,
          },
        },
        // Skills match (array contains keyword, case-insensitive)
        // Note: Prisma hasSome is case-sensitive, so we assume skills are stored lowercase
        {
          skills: {
            hasSome: [keyword.toLowerCase()],
          },
        },
      ],
    }));

    // All keywords must match (AND between keywords, OR within each keyword)
    const whereClause: any = {
      agencyId: agency.id,
      AND: keywordConditions,
    };

    candidates = await prisma.candidate.findMany({
      where: whereClause,
      take: searchLimit * 2, // Fetch more to calculate scores, then limit
      orderBy: {
        lastSeenAt: "desc",
      },
    });

    // Calculate match scores based on how many keywords matched and where
    results = candidates.map((c) => {
      let score = 0;
      const reasons: string[] = [];

      const candidateNameLower = (c.name || "").toLowerCase();
      const candidatePhoneLower = c.phone.toLowerCase();
      const candidateRoleLower = (c.desiredRole || "").toLowerCase();
      const candidateLocationLower = (c.location || "").toLowerCase();
      const candidateSkillsLower = (c.skills || []).map((s) => s.toLowerCase());

      keywords.forEach((keyword) => {
        const keywordLower = keyword.toLowerCase();
        
        // Name match (5 points)
        if (candidateNameLower.includes(keywordLower)) {
          score += 5;
          if (!reasons.includes("Name matches")) {
            reasons.push("Name matches");
          }
        }
        
        // Phone match (4 points)
        if (candidatePhoneLower.includes(keywordLower)) {
          score += 4;
          if (!reasons.includes("Phone matches")) {
            reasons.push("Phone matches");
          }
        }
        
        // Role match (3 points)
        if (candidateRoleLower.includes(keywordLower)) {
          score += 3;
          if (!reasons.includes("Role matches")) {
            reasons.push(`Role matches: ${c.desiredRole}`);
          }
        }
        
        // Location match (2 points)
        if (candidateLocationLower.includes(keywordLower)) {
          score += 2;
          if (!reasons.includes("Location matches")) {
            reasons.push(`Location matches: ${c.location}`);
          }
        }
        
        // Skills match (1 point per matching skill)
        const matchingSkills = candidateSkillsLower.filter((skill) => skill.includes(keywordLower));
        if (matchingSkills.length > 0) {
          score += matchingSkills.length;
          if (!reasons.some((r) => r.startsWith("Skills match"))) {
            reasons.push(`Skills match: ${matchingSkills.join(", ")}`);
          }
        }
      });

      return {
        candidateId: c.id,
        phone: c.phone,
        name: c.name,
        desiredRole: c.desiredRole,
        skills: c.skills || [],
        yearsExperience: c.yearsExperience,
        location: c.location,
        salary: {
          min: c.salaryMin,
          max: c.salaryMax,
          currency: c.currency,
        },
        matchScore: score || 1, // Minimum score of 1 if matched
        reasons: reasons.length > 0 ? reasons : ["Matches search keywords"],
      };
    });

    // Sort by match score (descending) and limit
    results.sort((a, b) => b.matchScore - a.matchScore);
    results = results.slice(0, searchLimit);
  }

  logger.info(
    {
      query: trimmedQuery,
      resultCount: results.length,
      limit: searchLimit,
    },
    "Candidate keyword search completed"
  );

  return {
    query: trimmedQuery,
    filters: {},
    results,
    count: results.length,
  };
}

/**
 * GET /api/candidates/search
 * Read-only GET endpoint for candidate search (demo stability)
 * Query params: q (string, optional), limit (number, optional, default 50)
 */
export async function searchCandidatesGetHandler(
  request: FastifyRequest<{
    Querystring: { q?: string; limit?: string };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const { q, limit } = request.query;

  const query = q || "";
  const limitNum = limit ? parseInt(limit, 10) : 50;

  try {
    const searchResult = await performCandidateSearch(query, limitNum, logger);
    return reply.status(200).send(searchResult);
  } catch (error: any) {
    if (error.message === "No agency found") {
      return reply.status(404).send({ error: error.message });
    }
    logger.error({ error, query }, "Failed to search candidates");
    return reply.status(500).send({ error: "Failed to search candidates" });
  }
}

/**
 * POST /api/candidates/search
 * Keyword-based search across candidate fields (name, phone, role, location, skills, etc.)
 * Supports multi-keyword queries (splits by spaces) and returns all candidates if query is empty
 */
export async function searchCandidatesHandler(
  request: FastifyRequest<{
    Body: { query: string; limit?: number };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const { query, limit = 50 } = request.body;

  try {
    const searchResult = await performCandidateSearch(query, limit, logger);
    return reply.status(200).send(searchResult);
  } catch (error: any) {
    if (error.message === "No agency found") {
      return reply.status(404).send({ error: error.message });
    }
    const trimmedQuery = query ? query.trim() : "";
    logger.error({ error, query: trimmedQuery }, "Failed to search candidates");
    return reply.status(500).send({ error: "Failed to search candidates" });
  }
}

/**
 * GET /api/candidates/:candidateId
 * Get candidate detail with profile and recent messages
 */
export async function getCandidateDetailHandler(
  request: FastifyRequest<{
    Params: { candidateId: string };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const { candidateId } = request.params;

  try {
    const candidate = await prisma.candidate.findUnique({
      where: { id: candidateId },
      include: {
        lastConversation: {
          include: {
            messages: {
              orderBy: { createdAt: "desc" },
              take: 20,
              select: {
                id: true,
                direction: true,
                text: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!candidate) {
      return reply.status(404).send({ error: "Candidate not found" });
    }

    // Get last contacted date (most recent outbound message)
    const lastOutboundMessage = await prisma.message.findFirst({
      where: {
        candidateId: candidate.id,
        direction: "OUTBOUND",
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    const dto: CandidateDetailDTO = {
      candidateId: candidate.id,
      phone: candidate.phone,
      name: candidate.name,
      location: candidate.location,
      desiredRole: candidate.desiredRole,
      skills: candidate.skills || [],
      yearsExperience: candidate.yearsExperience,
      salary: {
        min: candidate.salaryMin,
        max: candidate.salaryMax,
        currency: candidate.currency,
      },
      availabilityNotes: candidate.availabilityNotes,
      lastSeenAt: candidate.lastSeenAt,
      lastContactedAt: lastOutboundMessage?.createdAt || null,
      recentMessages: candidate.lastConversation?.messages.map((msg) => ({
        messageId: msg.id,
        direction: msg.direction,
        text: msg.text,
        createdAt: msg.createdAt,
      })) || [],
    };

    logger.info({ candidateId }, "Retrieved candidate detail");

    return reply.status(200).send(dto);
  } catch (error) {
    logger.error({ error, candidateId }, "Failed to get candidate detail");
    return reply.status(500).send({ error: "Failed to get candidate detail" });
  }
}

/**
 * POST /api/candidates/outreach/preview
 * Preview outreach messages for selected candidates
 */
export async function previewOutreachHandler(
  request: FastifyRequest<{
    Body: PreviewBody;
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const { candidateIds, jobDescription } = request.body;

  if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
    return reply.status(400).send({ error: "candidateIds array is required" });
  }

  if (!jobDescription || typeof jobDescription !== "string" || jobDescription.trim().length === 0) {
    return reply.status(400).send({ error: "jobDescription is required" });
  }

  try {
    const agencyId = await requireAgencyId(request);
    
    // Get agency
    const agency = await prisma.agency.findFirst({
      where: { id: agencyId },
    });

    if (!agency) {
      return reply.status(404).send({ error: "No agency found" });
    }

    // Load playbook once for all candidates
    const playbook = await getPlaybook(agencyId);

    // Fetch candidates
    const candidates = await prisma.candidate.findMany({
      where: {
        id: { in: candidateIds },
        agencyId: agency.id,
      },
    });

    if (candidates.length !== candidateIds.length) {
      return reply.status(400).send({ error: "Some candidate IDs not found" });
    }

    // Generate preview messages
    const previews: CandidateOutreachPreview[] = await Promise.all(
      candidates.map(async (candidate) => {
        const message = await generateOutreachMessage(
          {
            candidateId: candidate.id,
            phone: candidate.phone,
            name: candidate.name,
            desiredRole: candidate.desiredRole,
            skills: candidate.skills || [],
            yearsExperience: candidate.yearsExperience,
            location: candidate.location,
          },
          jobDescription,
          playbook
        );

        return {
          candidateId: candidate.id,
          phone: candidate.phone,
          suggestedMessage: message,
        };
      })
    );

    logger.info(
      {
        candidateCount: previews.length,
      },
      "Outreach preview generated"
    );

    return reply.status(200).send({ previews });
  } catch (error) {
    logger.error({ error, candidateIds }, "Failed to generate outreach preview");
    return reply.status(500).send({ error: "Failed to generate outreach preview" });
  }
}

/**
 * GET /api/candidates/:candidateId/latest-media
 * Get the latest media message (image) from a candidate
 * Returns the most recent message with media from the candidate's phone
 */
export async function getCandidateLatestMediaHandler(
  request: FastifyRequest<{
    Params: { candidateId: string };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const { candidateId } = request.params;
  const operatorId = (request as any).operatorId;

  if (!operatorId) {
    logger.warn({ candidateId, action: "getCandidateLatestMedia" }, "No operatorId in session");
    return reply.status(401).send({ error: "Authentication required" });
  }

  try {
    // Get agency
    const agency = await prisma.agency.findFirst({
      orderBy: { createdAt: "asc" },
    });

    if (!agency) {
      return reply.status(404).send({ error: "No agency found" });
    }

    // Load candidate and verify agencyId matches
    const candidate = await prisma.candidate.findFirst({
      where: {
        id: candidateId,
        agencyId: agency.id,
      },
      select: {
        id: true,
        phone: true,
      },
    });

    if (!candidate) {
      logger.warn({ candidateId, agencyId: agency.id, action: "getCandidateLatestMedia" }, "Candidate not found or does not belong to agency");
      return reply.status(404).send({ error: "Candidate not found" });
    }

    // Determine candidate phone (handle whatsapp: prefix variants)
    // Messages might be stored with or without whatsapp: prefix
    const candidatePhone = candidate.phone;
    const phoneVariants = [
      candidatePhone,
      candidatePhone.startsWith("whatsapp:") 
        ? candidatePhone.replace(/^whatsapp:/i, "") 
        : `whatsapp:${candidatePhone}`,
    ].filter((v, i, arr) => arr.indexOf(v) === i); // Remove duplicates

    // Find the latest HUMAN INBOUND messages for this candidate's phone
    // Query up to 20 most recent messages, then filter for media
    const messages = await prisma.message.findMany({
      where: {
        agencyId: agency.id,
        phone: { in: phoneVariants }, // Match both variants
        senderRole: MessageSenderRole.HUMAN,
        direction: MessageDirection.INBOUND,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 20, // Check up to 20 most recent messages
      select: {
        id: true,
        rawPayload: true,
        createdAt: true,
      },
    });

    // For each message in order, run extractFirstMediaUrl and return first found
    for (const message of messages) {
      const mediaUrl = extractFirstMediaUrl(message.rawPayload);
      if (mediaUrl) {
        logger.info(
          {
            candidateId,
            messageId: message.id,
            action: "getCandidateLatestMedia",
          },
          "Found latest media message for candidate"
        );

        return reply.status(200).send({
          messageId: message.id,
          mediaUrl: mediaUrl,
        });
      }
    }

    // No media found
    logger.info({ candidateId, action: "getCandidateLatestMedia" }, "No WhatsApp media found for candidate");
    return reply.status(404).send({ error: "No WhatsApp media found for candidate" });
  } catch (error) {
    logger.error(
      {
        error,
        candidateId,
        action: "getCandidateLatestMedia",
      },
      "Failed to get candidate latest media"
    );

    if (error instanceof Error) {
      return reply.status(500).send({ error: error.message });
    }

    return reply.status(500).send({ error: "Internal server error" });
  }
}

/**
 * POST /api/candidates/outreach/submit
 * Submit outreach request and create tasks
 */
export async function submitOutreachHandler(
  request: FastifyRequest<{
    Body: SubmitBody;
  }>,
  reply: FastifyReply
) {
    const logger = request.log;
    const { candidateIds, jobDescription, suggestedMessages = {}, jobId } = request.body;
  const operatorId = (request as any).operatorId;

  if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
    return reply.status(400).send({ error: "candidateIds array is required" });
  }

  if (!jobDescription || typeof jobDescription !== "string" || jobDescription.trim().length === 0) {
    return reply.status(400).send({ error: "jobDescription is required" });
  }

  try {
    const agencyId = await requireAgencyId(request);
    
    // Get agency
    const agency = await prisma.agency.findFirst({
      where: { id: agencyId },
    });

    if (!agency) {
      return reply.status(404).send({ error: "No agency found" });
    }

    // Load playbook once for all candidates
    const playbook = await getPlaybook(agencyId);

    // Fetch candidates
    const candidates = await prisma.candidate.findMany({
      where: {
        id: { in: candidateIds },
        agencyId: agency.id,
      },
    });

    if (candidates.length !== candidateIds.length) {
      return reply.status(400).send({ error: "Some candidate IDs not found" });
    }

    // Fetch job snapshot if jobId is provided
    let jobSnapshot = null;
    if (jobId) {
      try {
        jobSnapshot = await fetchJobSnapshot(jobId, agency.id);
      } catch (error) {
        logger.warn({ jobId, error }, "Failed to fetch job snapshot for outreach task");
      }
    }

    // Create one task per candidate (simplest approach)
    const tasks = await Promise.all(
      candidates.map(async (candidate) => {
        const message = suggestedMessages[candidate.id] || await generateOutreachMessage(
          {
            candidateId: candidate.id,
            phone: candidate.phone,
            name: candidate.name,
            desiredRole: candidate.desiredRole,
            skills: candidate.skills || [],
            yearsExperience: candidate.yearsExperience,
            location: candidate.location,
          },
          jobDescription,
          playbook
        );

        const payload: any = {
          reason: "Candidate outreach",
          candidateId: candidate.id,
          phone: candidate.phone,
          jobDescription: jobDescription,
        };

        // Add job snapshot if available
        if (jobSnapshot) {
          payload.job = jobSnapshot;
        }

        return prisma.task.create({
          data: {
            agencyId: agency.id,
            type: TaskType.OUTREACH,
            status: TaskStatus.OPEN,
            approvalStatus: TaskApprovalStatus.PENDING,
            proposedAction: {
              actionType: "SEND_MESSAGE",
              candidateId: candidate.id,
              phone: candidate.phone,
              message: message,
              jobDescription: jobDescription,
            },
            payload: payload as any,
          } as any,
        });
      })
    );

    logger.info(
      {
        taskCount: tasks.length,
        candidateIds,
        operatorId,
      },
      "Outreach tasks created"
    );

    return reply.status(200).send({
      tasks: tasks.map((t) => ({
        taskId: t.id,
        candidateId: (t.payload as any).candidateId,
      })),
      count: tasks.length,
    });
  } catch (error) {
    logger.error({ error, candidateIds }, "Failed to submit outreach");
    return reply.status(500).send({ error: "Failed to submit outreach" });
  }
}

export async function candidateRoutes(fastify: FastifyInstance) {
  fastify.get("/search", searchCandidatesGetHandler);
  fastify.post("/search", searchCandidatesHandler);
  fastify.get("/:candidateId", getCandidateDetailHandler);
  fastify.get("/:candidateId/latest-media", getCandidateLatestMediaHandler);
  fastify.post("/outreach/preview", previewOutreachHandler);
  fastify.post("/outreach/submit", submitOutreachHandler);
}
