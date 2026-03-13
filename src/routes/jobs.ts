/**
 * Jobs API routes
 * Manage job postings for the operator's agency
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db/prisma.ts";
import { requireAuth } from "../middleware/auth.ts";
import { requireAgencyId } from "../utils/agencyContext.ts";
import { scopeWhere, findFirstOr404, verifyOwnership } from "../db/tenantScope.ts";
import { notFoundIfNull } from "../utils/httpErrors.ts";
import { JobStatus, MatchTier, TaskType, TaskStatus, TaskApprovalStatus, JobPipelineStage } from "@prisma/client";
import { buildDisplayName } from "../lib/displayName.ts";
import {
  upsertPipelineItem,
  listJobPipeline,
  removePipelineItem,
} from "../services/jobPipelineService.ts";
import { toPipelineItemDTO } from "../dto/transformers.ts";

// Removed getAgencyId() - use requireAgencyId(request) from agencyContext instead

/**
 * Normalize requirementsJson to standard structure
 * Accepts flexible input and returns standardized format
 */
function normalizeRequirementsJson(input: any): {
  mustHave: Array<{ label: string; value: string }>;
  preferred: Array<{ label: string; value: string }>;
  notes: string[];
} {
  // If already in correct format, return as-is
  if (
    input &&
    typeof input === "object" &&
    (Array.isArray(input.mustHave) || Array.isArray(input.preferred) || Array.isArray(input.notes))
  ) {
    return {
      mustHave: Array.isArray(input.mustHave)
        ? input.mustHave.map((item: any) => {
            if (typeof item === "string") {
              return { label: "", value: item };
            }
            return {
              label: item.label || "",
              value: item.value || String(item),
            };
          })
        : [],
      preferred: Array.isArray(input.preferred)
        ? input.preferred.map((item: any) => {
            if (typeof item === "string") {
              return { label: "", value: item };
            }
            return {
              label: item.label || "",
              value: item.value || String(item),
            };
          })
        : [],
      notes: Array.isArray(input.notes) ? input.notes.filter((n: any) => typeof n === "string") : [],
    };
  }

  // Default empty structure
  return {
    mustHave: [],
    preferred: [],
    notes: [],
  };
}

/**
 * GET /api/jobs
 * Returns list of jobs for the logged-in operator's agency
 * Supports search, filtering, and pagination
 */
export async function listJobsHandler(
  request: FastifyRequest<{
    Querystring: {
      q?: string;
      status?: string;
      limit?: string;
      offset?: string;
    };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    // Parse query parameters
    const query = request.query.q?.trim() || "";
    const statusFilter = request.query.status?.trim();
    const limit = Math.min(parseInt(request.query.limit || "50", 10), 100);
    const offset = Math.max(parseInt(request.query.offset || "0", 10), 0);

    // Build where clause
    const where: any = scopeWhere(agencyId, {});

    // Add status filter if provided
    if (statusFilter) {
      // Validate status is a valid JobStatus enum value
      const validStatuses = Object.values(JobStatus);
      if (validStatuses.includes(statusFilter as JobStatus)) {
        where.status = statusFilter as JobStatus;
      }
    }

    // Add keyword search if provided
    if (query.length > 0) {
      where.OR = [
        { title: { contains: query, mode: "insensitive" } },
        { tradeRequired: { contains: query, mode: "insensitive" } },
        { city: { contains: query, mode: "insensitive" } },
        { postcode: { contains: query, mode: "insensitive" } },
        { clientName: { contains: query, mode: "insensitive" } },
        { siteName: { contains: query, mode: "insensitive" } },
      ];
    }

    // Get total count (for pagination)
    const total = await prisma.job.count({ where });

    // Get jobs with pagination
    const jobs = await prisma.job.findMany({
      where,
      select: {
        id: true,
        title: true,
        status: true,
        positionsOpen: true,
        positionsFilled: true,
        tradeRequired: true,
        startDate: true,
        postcode: true,
        city: true,
        updatedAt: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
      take: limit,
      skip: offset,
    });

    return reply.status(200).send({
      items: jobs,
      total,
    });
  } catch (error) {
    logger.error({ error }, "Failed to list jobs");
    return reply.status(500).send({ error: "Failed to list jobs" });
  }
}

/**
 * GET /api/jobs/:id
 * Returns full job detail with computed margin fields
 */
export async function getJobHandler(
  request: FastifyRequest<{
    Params: { id: string };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const { id } = request.params;

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    const job = await prisma.job.findFirst({
      where: scopeWhere(agencyId, { id }),
    });

    if (!job) {
      return reply.status(404).send({ error: "Job not found" });
    }

    // Compute margin fields server-side
    const marginPerHour =
      job.chargeRate !== null && job.payRate !== null
        ? job.chargeRate - job.payRate
        : null;

    const weeklyMargin =
      marginPerHour !== null &&
      job.hoursPerDay !== null &&
      job.daysPerWeek !== null
        ? marginPerHour * job.hoursPerDay * job.daysPerWeek
        : null;

    const projectMargin =
      weeklyMargin !== null && job.durationWeeks !== null
        ? weeklyMargin * job.durationWeeks
        : null;

    return reply.status(200).send({
      id: job.id,
      title: job.title,
      status: job.status,
      positionsOpen: job.positionsOpen,
      positionsFilled: job.positionsFilled,
      tradeRequired: job.tradeRequired,
      startDate: job.startDate,
      durationWeeks: job.durationWeeks,
      hoursPerDay: job.hoursPerDay,
      daysPerWeek: job.daysPerWeek,
      siteName: job.siteName,
      addressLine1: job.addressLine1,
      addressLine2: job.addressLine2,
      postcode: job.postcode,
      city: job.city,
      clientName: job.clientName,
      clientType: job.clientType,
      siteManagerName: job.siteManagerName,
      siteManagerPhone: job.siteManagerPhone,
      isPremiumClient: job.isPremiumClient,
      requirementsJson: job.requirementsJson,
      notes: job.notes,
      payRate: job.payRate,
      chargeRate: job.chargeRate,
      currency: job.currency,
      marginPerHour,
      weeklyMargin,
      projectMargin,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  } catch (error) {
    logger.error({ error, jobId: id }, "Failed to get job");
    return reply.status(500).send({ error: "Failed to get job" });
  }
}

/**
 * POST /api/jobs
 * Create a new job
 */
export async function createJobHandler(
  request: FastifyRequest<{
    Body: {
      title: string;
      tradeRequired: string;
      status?: JobStatus;
      startDate?: string;
      durationWeeks?: number;
      hoursPerDay?: number;
      daysPerWeek?: number;
      positionsOpen?: number;
      positionsFilled?: number;
      siteName?: string;
      addressLine1?: string;
      addressLine2?: string;
      postcode?: string;
      city?: string;
      geoLat?: number;
      geoLng?: number;
      clientName?: string;
      clientType?: string;
      siteManagerName?: string;
      siteManagerPhone?: string;
      isPremiumClient?: boolean;
      requirementsJson?: any;
      notes?: string;
      payRate?: number;
      chargeRate?: number;
      currency?: string;
    };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);
    const body = request.body;

    // Validation: Required fields
    if (!body.title || typeof body.title !== "string" || body.title.trim().length < 2) {
      return reply.status(400).send({
        error: "title is required and must be at least 2 characters",
      });
    }

    if (!body.tradeRequired || typeof body.tradeRequired !== "string" || body.tradeRequired.trim().length === 0) {
      return reply.status(400).send({
        error: "tradeRequired is required",
      });
    }

    // Create job with defaults
    const job = await prisma.job.create({
      data: {
        agencyId,
        title: body.title.trim(),
        tradeRequired: body.tradeRequired.trim(),
        status: body.status || JobStatus.ACTIVE,
        startDate: body.startDate ? new Date(body.startDate) : null,
        durationWeeks: body.durationWeeks ?? null,
        hoursPerDay: body.hoursPerDay ?? null,
        daysPerWeek: body.daysPerWeek ?? null,
        positionsOpen: body.positionsOpen ?? 1,
        positionsFilled: body.positionsFilled ?? 0,
        siteName: body.siteName?.trim() ?? null,
        addressLine1: body.addressLine1?.trim() ?? null,
        addressLine2: body.addressLine2?.trim() ?? null,
        postcode: body.postcode?.trim() ?? null,
        city: body.city?.trim() ?? null,
        geoLat: body.geoLat ?? null,
        geoLng: body.geoLng ?? null,
        clientName: body.clientName?.trim() ?? null,
        clientType: body.clientType?.trim() ?? null,
        siteManagerName: body.siteManagerName?.trim() ?? null,
        siteManagerPhone: body.siteManagerPhone?.trim() ?? null,
        isPremiumClient: body.isPremiumClient ?? false,
        requirementsJson: body.requirementsJson ? normalizeRequirementsJson(body.requirementsJson) : {},
        notes: body.notes?.trim() ?? null,
        payRate: body.payRate ?? null,
        chargeRate: body.chargeRate ?? null,
        currency: body.currency || "GBP",
      },
    });

    // Return minimal response as requested
    return reply.status(201).send({
      id: job.id,
      title: job.title,
      status: job.status,
    });
  } catch (error) {
    logger.error({ error, body: request.body }, "Failed to create job");
    return reply.status(500).send({ error: "Failed to create job" });
  }
}

/**
 * PATCH /api/jobs/:id
 * Update job fields
 */
export async function updateJobHandler(
  request: FastifyRequest<{
    Params: { id: string };
    Body: {
      title?: string;
      status?: JobStatus;
      tradeRequired?: string;
      startDate?: string | null;
      durationWeeks?: number | null;
      hoursPerDay?: number | null;
      daysPerWeek?: number | null;
      positionsOpen?: number;
      positionsFilled?: number;
      siteName?: string | null;
      addressLine1?: string | null;
      addressLine2?: string | null;
      postcode?: string | null;
      city?: string | null;
      geoLat?: number | null;
      geoLng?: number | null;
      clientName?: string | null;
      clientType?: string | null;
      siteManagerName?: string | null;
      siteManagerPhone?: string | null;
      isPremiumClient?: boolean;
      requirementsJson?: any;
      notes?: string | null;
      payRate?: number | null;
      chargeRate?: number | null;
      currency?: string;
    };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const { id } = request.params;
  const body = request.body;

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    // Check job exists and belongs to agency
    const existing = await prisma.job.findFirst({
      where: {
        id,
        agencyId, // Enforce agency scoping
      },
    });

    if (!existing) {
      return reply.status(404).send({ error: "Job not found" });
    }

    // Build update data (only include provided fields)
    const updateData: any = {};

    if (body.title !== undefined) updateData.title = body.title;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.tradeRequired !== undefined) updateData.tradeRequired = body.tradeRequired;
    if (body.startDate !== undefined) {
      updateData.startDate = body.startDate ? new Date(body.startDate) : null;
    }
    if (body.durationWeeks !== undefined) updateData.durationWeeks = body.durationWeeks;
    if (body.hoursPerDay !== undefined) updateData.hoursPerDay = body.hoursPerDay;
    if (body.daysPerWeek !== undefined) updateData.daysPerWeek = body.daysPerWeek;
    if (body.positionsOpen !== undefined) updateData.positionsOpen = body.positionsOpen;
    if (body.positionsFilled !== undefined) updateData.positionsFilled = body.positionsFilled;
    if (body.siteName !== undefined) updateData.siteName = body.siteName;
    if (body.addressLine1 !== undefined) updateData.addressLine1 = body.addressLine1;
    if (body.addressLine2 !== undefined) updateData.addressLine2 = body.addressLine2;
    if (body.postcode !== undefined) updateData.postcode = body.postcode;
    if (body.city !== undefined) updateData.city = body.city;
    if (body.geoLat !== undefined) updateData.geoLat = body.geoLat;
    if (body.geoLng !== undefined) updateData.geoLng = body.geoLng;
    if (body.clientName !== undefined) updateData.clientName = body.clientName;
    if (body.clientType !== undefined) updateData.clientType = body.clientType;
    if (body.siteManagerName !== undefined) updateData.siteManagerName = body.siteManagerName;
    if (body.siteManagerPhone !== undefined) updateData.siteManagerPhone = body.siteManagerPhone;
    if (body.isPremiumClient !== undefined) updateData.isPremiumClient = body.isPremiumClient;
    if (body.requirementsJson !== undefined) {
      updateData.requirementsJson = normalizeRequirementsJson(body.requirementsJson);
    }
    if (body.notes !== undefined) updateData.notes = body.notes;
    if (body.payRate !== undefined) updateData.payRate = body.payRate;
    if (body.chargeRate !== undefined) updateData.chargeRate = body.chargeRate;
    if (body.currency !== undefined) updateData.currency = body.currency;

    const job = await prisma.job.update({
      where: { id },
      data: updateData,
    });

    return reply.status(200).send({ job });
  } catch (error) {
    logger.error({ error, jobId: id, body }, "Failed to update job");
    return reply.status(500).send({ error: "Failed to update job" });
  }
}

/**
 * POST /api/jobs/:id/mark-filled
 * Sets status to FILLED and optionally sets positionsFilled = positionsOpen
 */
export async function markJobFilledHandler(
  request: FastifyRequest<{
    Params: { id: string };
    Body?: {
      setPositionsFilled?: boolean; // If true, set positionsFilled = positionsOpen
    };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const { id } = request.params;
  const setPositionsFilled = request.body?.setPositionsFilled ?? true;

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    // Check job exists and belongs to agency
    const existing = await prisma.job.findFirst({
      where: {
        id,
        agencyId, // Enforce agency scoping
      },
    });

    if (!existing) {
      return reply.status(404).send({ error: "Job not found" });
    }

    const updateData: any = {
      status: JobStatus.FILLED,
    };

    if (setPositionsFilled) {
      updateData.positionsFilled = existing.positionsOpen;
    }

    const job = await prisma.job.update({
      where: { id },
      data: updateData,
    });

    return reply.status(200).send({ job });
  } catch (error) {
    logger.error({ error, jobId: id }, "Failed to mark job as filled");
    return reply.status(500).send({ error: "Failed to mark job as filled" });
  }
}

/**
 * Helper to check if requirementsJson mentions CSCS
 */
function requiresCSCS(requirementsJson: any): boolean {
  if (!requirementsJson || typeof requirementsJson !== "object") {
    return false;
  }

  const jsonStr = JSON.stringify(requirementsJson).toLowerCase();
  return jsonStr.includes("cscs");
}

/**
 * Helper to check if candidate has CSCS in skills
 */
function hasCSCS(skills: string[]): boolean {
  return skills.some(
    (skill) => skill.toLowerCase().includes("cscs")
  );
}

/**
 * Helper to check if availability suggests immediate or date <= startDate
 */
function isAvailableForStartDate(
  availabilityNotes: string | null,
  startDate: Date | null
): boolean {
  if (!availabilityNotes) {
    return false;
  }

  const notesLower = availabilityNotes.toLowerCase();
  
  // Check for immediate availability keywords
  if (
    notesLower.includes("immediate") ||
    notesLower.includes("available now") ||
    notesLower.includes("ready to start") ||
    notesLower.includes("can start")
  ) {
    return true;
  }

  // If startDate is provided, check if availability mentions a date <= startDate
  if (startDate) {
    // Simple heuristic: look for date patterns (this is basic, could be improved)
    const datePattern = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/;
    const dateMatch = availabilityNotes.match(datePattern);
    if (dateMatch) {
      try {
        const availDate = new Date(dateMatch[0]);
        if (!isNaN(availDate.getTime()) && availDate <= startDate) {
          return true;
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  return false;
}

/**
 * Helper to check if location matches (partial match on city/postcode)
 */
function locationMatches(
  candidateLocation: string | null,
  jobCity: string | null,
  jobPostcode: string | null
): boolean {
  if (!candidateLocation) {
    return false;
  }

  const candidateLocLower = candidateLocation.toLowerCase();

  if (jobCity) {
    const cityLower = jobCity.toLowerCase();
    if (candidateLocLower.includes(cityLower) || cityLower.includes(candidateLocLower)) {
      return true;
    }
  }

  if (jobPostcode) {
    const postcodeLower = jobPostcode.toLowerCase().replace(/\s+/g, "");
    const candidatePostcode = candidateLocLower.replace(/\s+/g, "");
    if (candidatePostcode.includes(postcodeLower) || postcodeLower.includes(candidatePostcode)) {
      return true;
    }
  }

  return false;
}

/**
 * Helper to check if trade matches (desiredRole or skills includes tradeRequired)
 */
function tradeMatches(
  desiredRole: string | null,
  skills: string[],
  tradeRequired: string
): boolean {
  const tradeLower = tradeRequired.toLowerCase();

  if (desiredRole) {
    const roleLower = desiredRole.toLowerCase();
    if (roleLower.includes(tradeLower) || tradeLower.includes(roleLower)) {
      return true;
    }
  }

  return skills.some((skill) => {
    const skillLower = skill.toLowerCase();
    return skillLower.includes(tradeLower) || tradeLower.includes(skillLower);
  });
}

/**
 * Calculate match score for a candidate against a job
 */
function calculateMatchScore(
  candidate: {
    desiredRole: string | null;
    skills: string[];
    location: string | null;
    availabilityNotes: string | null;
  },
  job: {
    tradeRequired: string;
    city: string | null;
    postcode: string | null;
    startDate: Date | null;
    requirementsJson: any;
  }
): number {
  let score = 0;

  // +40 if trade matches
  if (tradeMatches(candidate.desiredRole, candidate.skills, job.tradeRequired)) {
    score += 40;
  }

  // +20 if location matches
  if (locationMatches(candidate.location, job.city, job.postcode)) {
    score += 20;
  }

  // +20 if CSCS required and candidate has it
  if (requiresCSCS(job.requirementsJson) && hasCSCS(candidate.skills)) {
    score += 20;
  }

  // +10 if availability suggests immediate or date <= startDate
  if (isAvailableForStartDate(candidate.availabilityNotes, job.startDate)) {
    score += 10;
  }

  // Clamp to 0..100
  return Math.max(0, Math.min(100, score));
}

/**
 * Determine match tier from score
 */
function getMatchTier(score: number): MatchTier {
  if (score >= 95) {
    return MatchTier.PROVEN;
  } else if (score >= 90) {
    return MatchTier.EXCELLENT;
  } else if (score >= 80) {
    return MatchTier.GOOD;
  } else {
    return MatchTier.WEAK;
  }
}

/**
 * Generate highlights for a candidate match
 */
function generateHighlights(
  candidate: {
    skills: string[];
    location: string | null;
    availabilityNotes: string | null;
  },
  job: {
    requirementsJson: any;
    city: string | null;
    postcode: string | null;
  }
): string[] {
  const highlights: string[] = [];

  // CSCS highlight
  if (requiresCSCS(job.requirementsJson) && hasCSCS(candidate.skills)) {
    // Try to find the specific CSCS card type
    const cscsSkill = candidate.skills.find((s) =>
      s.toLowerCase().includes("cscs")
    );
    if (cscsSkill) {
      highlights.push(`CSCS: ${cscsSkill}`);
    } else {
      highlights.push("CSCS: Green");
    }
  }

  // Location highlight
  if (locationMatches(candidate.location, job.city, job.postcode)) {
    if (candidate.location) {
      highlights.push(`Location: ${candidate.location}`);
    } else if (job.city) {
      highlights.push(`Location: ${job.city}`);
    }
  }

  // Availability highlight
  if (candidate.availabilityNotes) {
    const notes = candidate.availabilityNotes.trim();
    if (notes.length > 0 && notes.length <= 100) {
      highlights.push(`Available: ${notes}`);
    } else if (notes.length > 100) {
      highlights.push(`Available: ${notes.substring(0, 97)}...`);
    }
  }

  return highlights;
}

/**
 * GET /api/jobs/:id/matches
 * Returns matched candidates for a job
 */
export async function getJobMatchesHandler(
  request: FastifyRequest<{
    Params: { id: string };
    Querystring: { limit?: string };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const { id } = request.params;
  const limit = Math.min(parseInt(request.query.limit || "8", 10), 50);

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    // Get job
    const job = await prisma.job.findFirst({
      where: {
        id,
        agencyId, // Enforce agency scoping
      },
    });

    if (!job) {
      return reply.status(404).send({ error: "Job not found" });
    }

    // Get all candidates for the agency
    const allCandidates = await prisma.candidate.findMany({
      where: {
        agencyId,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        desiredRole: true,
        location: true,
        skills: true,
        availabilityNotes: true,
      },
    });

    // Calculate scores for all candidates
    const candidatesWithScores = allCandidates.map((candidate) => {
      const score = calculateMatchScore(candidate, {
        tradeRequired: job.tradeRequired,
        city: job.city,
        postcode: job.postcode,
        startDate: job.startDate,
        requirementsJson: job.requirementsJson,
      });

      const tier = getMatchTier(score);
      const highlights = generateHighlights(candidate, {
        requirementsJson: job.requirementsJson,
        city: job.city,
        postcode: job.postcode,
      });

      return {
        candidate,
        score,
        tier,
        highlights,
      };
    });

    // Sort by score (descending) and filter out zero-score matches
    const validMatches = candidatesWithScores
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score);

    const totalAvailable = validMatches.length;

    // Take top N matches
    const topMatches = validMatches.slice(0, limit).map((match) => {
      const { displayName, trade, phone } = buildDisplayName({
        candidate: {
          name: match.candidate.name,
          desiredRole: match.candidate.desiredRole,
        },
        phone: match.candidate.phone,
      });

      return {
        candidateId: match.candidate.id,
        name: match.candidate.name, // Legacy field
        phone,
        desiredRole: match.candidate.desiredRole, // Legacy field
        displayName,
        trade,
        location: match.candidate.location,
        availabilityNotes: match.candidate.availabilityNotes,
        score: match.score,
        tier: match.tier,
        highlights: match.highlights,
      };
    });

    return reply.status(200).send({
      jobId: id,
      totalAvailable,
      matches: topMatches,
    });
  } catch (error) {
    logger.error({ error, jobId: id }, "Failed to get job matches");
    return reply.status(500).send({ error: "Failed to get job matches" });
  }
}

/**
 * Register jobs routes
 */
/**
 * GET /api/jobs/:id/pipeline
 * List pipeline items for a job
 */
export async function getJobPipelineHandler(
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

    // Validate job exists and belongs to agency
    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        agencyId,
      },
      select: {
        id: true,
      },
    });

    if (!job) {
      return reply.status(404).send({ error: "Job not found" });
    }

    // Get pipeline items
    const items = await listJobPipeline(agencyId, jobId);

    // Transform to DTOs
    const dtos = items.map(toPipelineItemDTO);

    return reply.status(200).send(dtos);
  } catch (error: any) {
    logger.error({ error, jobId }, "Failed to get job pipeline");
    if (error.message?.includes("not found") || error.message?.includes("does not belong")) {
      return reply.status(404).send({ error: error.message });
    }
    return reply.status(500).send({ error: "Failed to get job pipeline" });
  }
}

/**
 * POST /api/jobs/:id/pipeline
 * Create or update a pipeline item
 */
export async function upsertJobPipelineHandler(
  request: FastifyRequest<{
    Params: { id: string };
    Body: {
      candidateId: string;
      stage: JobPipelineStage;
      notes?: string | null;
      startDate?: string | null;
      payRate?: number | null;
      shiftInfo?: string | null;
      noShowReason?: string | null;
      droppedReason?: string | null;
      confirmedInterest?: boolean;
      createOutreachTask?: boolean; // Default true when moving to OFFER_SENT
    };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const { id: jobId } = request.params;
  const body = request.body;

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    // Get operator ID from session (if available)
    const operatorId = (request.session as any)?.operatorId || null;

    // Validate job exists and belongs to agency
    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        agencyId,
      },
      select: {
        id: true,
        title: true,
      },
    });

    if (!job) {
      return reply.status(404).send({ error: "Job not found" });
    }

    // Validate candidate exists and belongs to agency
    const candidate = await prisma.candidate.findFirst({
      where: {
        id: body.candidateId,
        agencyId,
      },
      select: {
        id: true,
        phone: true,
      },
    });

    if (!candidate) {
      return reply.status(404).send({ error: "Candidate not found" });
    }

    // Prepare updates
    const updates: any = {
      stage: body.stage,
      notes: body.notes ?? null,
      startDate: body.startDate ? new Date(body.startDate) : null,
      payRate: body.payRate ?? null,
      shiftInfo: body.shiftInfo ?? null,
      confirmedInterest: body.confirmedInterest ?? false,
    };

    if (body.noShowReason) {
      updates.noShowReason = body.noShowReason as any;
    }
    if (body.droppedReason) {
      updates.droppedReason = body.droppedReason as any;
    }

    // Note: Task creation is now handled inside upsertPipelineItem (Step E)
    // The createOutreachTask flag is checked there, but we pass it via updates.data
    if (body.createOutreachTask !== undefined) {
      updates.data = { ...(updates.data || {}), createOutreachTask: body.createOutreachTask };
    }

    // Upsert pipeline item (includes task creation automation)
    const result = await upsertPipelineItem({
      agencyId,
      jobId,
      candidateId: body.candidateId,
      stage: body.stage,
      updates,
      operatorId,
    });

    // Get updated item with enriched data
    const items = await listJobPipeline(agencyId, jobId);
    const updatedItem = items.find((item) => item.id === result.id);

    if (!updatedItem) {
      return reply.status(500).send({ error: "Failed to retrieve updated pipeline item" });
    }

    return reply.status(200).send(toPipelineItemDTO(updatedItem));
  } catch (error: any) {
    logger.error({ error, jobId }, "Failed to upsert pipeline item");
    
    // Return 400 for validation errors
    if (error.message?.includes("required") || error.message?.includes("Invalid stage transition")) {
      return reply.status(400).send({ error: error.message });
    }
    
    if (error.message?.includes("not found") || error.message?.includes("does not belong")) {
      return reply.status(404).send({ error: error.message });
    }
    
    return reply.status(500).send({ error: "Failed to upsert pipeline item" });
  }
}

/**
 * DELETE /api/jobs/:id/pipeline/:candidateId
 * Remove a pipeline item
 */
export async function deleteJobPipelineHandler(
  request: FastifyRequest<{
    Params: { id: string; candidateId: string };
  }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const { id: jobId, candidateId } = request.params;

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    // Get operator ID from session (if available)
    const operatorId = (request.session as any)?.operatorId || null;

    // Validate job exists and belongs to agency
    const job = await prisma.job.findFirst({
      where: {
        id: jobId,
        agencyId,
      },
      select: {
        id: true,
      },
    });

    if (!job) {
      return reply.status(404).send({ error: "Job not found" });
    }

    // Remove pipeline item
    await removePipelineItem(agencyId, jobId, candidateId, operatorId);

    return reply.status(204).send();
  } catch (error: any) {
    logger.error({ error, jobId, candidateId }, "Failed to remove pipeline item");
    
    if (error.message?.includes("not found") || error.message?.includes("does not belong")) {
      return reply.status(404).send({ error: error.message });
    }
    
    return reply.status(500).send({ error: "Failed to remove pipeline item" });
  }
}

export async function jobRoutes(fastify: FastifyInstance) {
  // Use route-level preHandler (runs AFTER session is loaded)
  // Do NOT use onRequest hook (runs BEFORE session is loaded)
  fastify.get("/jobs", { preHandler: [requireAuth] }, listJobsHandler);
  fastify.get("/jobs/:id", { preHandler: [requireAuth] }, getJobHandler);
  fastify.post("/jobs", { preHandler: [requireAuth] }, createJobHandler);
  fastify.patch("/jobs/:id", { preHandler: [requireAuth] }, updateJobHandler);
  fastify.post("/jobs/:id/mark-filled", { preHandler: [requireAuth] }, markJobFilledHandler);
  fastify.get("/jobs/:id/matches", { preHandler: [requireAuth] }, getJobMatchesHandler);
  // Pipeline routes
  fastify.get("/jobs/:id/pipeline", { preHandler: [requireAuth] }, getJobPipelineHandler);
  fastify.post("/jobs/:id/pipeline", { preHandler: [requireAuth] }, upsertJobPipelineHandler);
  fastify.delete("/jobs/:id/pipeline/:candidateId", { preHandler: [requireAuth] }, deleteJobPipelineHandler);
}

