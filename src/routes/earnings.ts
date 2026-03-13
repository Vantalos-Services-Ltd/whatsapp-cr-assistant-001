/**
 * Earnings Tracker API routes
 * Handles earnings settings and monthly earnings data
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db/prisma.ts";
import { requireAuth } from "../middleware/auth.ts";
import { requireAgencyId } from "../utils/agencyContext.ts";
import { scopeWhere } from "../db/tenantScope.ts";

// Removed getAgencyId() - use requireAgencyId(request) from agencyContext instead

/**
 * Commission bracket validation
 */
interface CommissionBracket {
  minRevenue: number;
  maxRevenue?: number | null;
  ratePct: number;
}

function validateCommissionBrackets(brackets: unknown): CommissionBracket[] {
  if (!Array.isArray(brackets)) {
    throw new Error("commissionBrackets must be an array");
  }

  if (brackets.length === 0) {
    throw new Error("commissionBrackets must have at least one bracket");
  }

  const validated: CommissionBracket[] = [];

  for (let i = 0; i < brackets.length; i++) {
    const bracket = brackets[i];
    if (!bracket || typeof bracket !== "object") {
      throw new Error(`Bracket ${i} must be an object`);
    }

    const { minRevenue, maxRevenue, ratePct } = bracket as any;

    if (typeof minRevenue !== "number" || minRevenue < 0) {
      throw new Error(`Bracket ${i}: minRevenue must be a non-negative number`);
    }

    if (maxRevenue !== null && maxRevenue !== undefined) {
      if (typeof maxRevenue !== "number" || maxRevenue < 0) {
        throw new Error(`Bracket ${i}: maxRevenue must be a non-negative number or null`);
      }
      if (maxRevenue <= minRevenue) {
        throw new Error(`Bracket ${i}: maxRevenue must be greater than minRevenue`);
      }
    }

    if (typeof ratePct !== "number" || ratePct < 0 || ratePct > 100) {
      throw new Error(`Bracket ${i}: ratePct must be a number between 0 and 100`);
    }

    validated.push({
      minRevenue,
      maxRevenue: maxRevenue ?? null,
      ratePct,
    });
  }

  // Validate that only the last bracket can have maxRevenue = null
  for (let i = 0; i < validated.length - 1; i++) {
    if (validated[i].maxRevenue === null) {
      throw new Error("Only the last bracket can have maxRevenue = null");
    }
  }

  // Validate sorted by minRevenue and no overlaps
  for (let i = 1; i < validated.length; i++) {
    if (validated[i].minRevenue < validated[i - 1].minRevenue) {
      throw new Error("Brackets must be sorted by minRevenue in ascending order");
    }

    // Check for overlaps
    const prevBracket = validated[i - 1];
    const currentBracket = validated[i];

    // Previous bracket must have maxRevenue defined (we already checked it's not null)
    // Current bracket's minRevenue should be >= previous bracket's maxRevenue
    if (prevBracket.maxRevenue !== null && currentBracket.minRevenue < prevBracket.maxRevenue) {
      throw new Error("Brackets must not overlap");
    }
  }

  return validated;
}

/**
 * GET /api/earnings/settings
 * Get earnings settings for the current operator
 */
async function getEarningsSettingsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const logger = request.log;
  const operatorId = (request as any).operatorId;

  if (!operatorId) {
    return reply.status(401).send({ error: "Authentication required" });
  }

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);

    const settings = await prisma.earningsSettings.findUnique({
      where: {
        agencyId_operatorId: {
          agencyId,
          operatorId,
        },
      },
    });

    if (!settings) {
      return reply.status(200).send({
        basePayMonthly: null,
        currency: "GBP",
        commissionBrackets: [],
      });
    }

    return reply.status(200).send({
      basePayMonthly: settings.basePayMonthly,
      currency: settings.currency,
      commissionBrackets: settings.commissionBrackets as CommissionBracket[],
    });
  } catch (error) {
    logger.error({ error, operatorId }, "Failed to get earnings settings");
    return reply.status(500).send({ error: "Failed to get earnings settings" });
  }
}

/**
 * POST /api/earnings/settings
 * Upsert earnings settings for the current operator
 */
async function upsertEarningsSettingsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const logger = request.log;
  const operatorId = (request as any).operatorId;

  if (!operatorId) {
    return reply.status(401).send({ error: "Authentication required" });
  }

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);
    const body = request.body as {
      basePayMonthly?: number | null;
      currency?: string;
      commissionBrackets?: unknown;
    };

    // Validate commission brackets
    if (!body.commissionBrackets) {
      return reply.status(400).send({
        error: "commissionBrackets is required",
      });
    }

    const validatedBrackets = validateCommissionBrackets(body.commissionBrackets);

    // Validate basePayMonthly if provided
    if (body.basePayMonthly !== undefined && body.basePayMonthly !== null) {
      if (typeof body.basePayMonthly !== "number" || body.basePayMonthly < 0) {
        return reply.status(400).send({
          error: "basePayMonthly must be a non-negative number or null",
        });
      }
    }

    // Validate currency
    const currency = body.currency || "GBP";
    if (typeof currency !== "string" || currency.length !== 3) {
      return reply.status(400).send({
        error: "currency must be a 3-letter currency code",
      });
    }

    // Upsert settings
    const settings = await prisma.earningsSettings.upsert({
      where: {
        agencyId_operatorId: {
          agencyId,
          operatorId,
        },
      },
      create: {
        agencyId,
        operatorId,
        basePayMonthly: body.basePayMonthly ?? null,
        currency,
        commissionBrackets: validatedBrackets as any,
      },
      update: {
        basePayMonthly: body.basePayMonthly ?? null,
        currency,
        commissionBrackets: validatedBrackets as any,
        updatedAt: new Date(),
      },
    });

    logger.info({ operatorId, settingsId: settings.id }, "Earnings settings upserted");

    return reply.status(200).send({
      basePayMonthly: settings.basePayMonthly,
      currency: settings.currency,
      commissionBrackets: settings.commissionBrackets as CommissionBracket[],
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("must be")) {
      return reply.status(400).send({ error: error.message });
    }
    logger.error({ error, operatorId }, "Failed to upsert earnings settings");
    return reply.status(500).send({ error: "Failed to upsert earnings settings" });
  }
}

/**
 * GET /api/earnings/monthly?year=YYYY&month=M
 * Get monthly earnings for a specific month
 */
async function getMonthlyEarningsHandler(
  request: FastifyRequest<{ Querystring: { year?: string; month?: string } }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const operatorId = (request as any).operatorId;

  if (!operatorId) {
    return reply.status(401).send({ error: "Authentication required" });
  }

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);
    const year = parseInt(request.query.year || String(new Date().getFullYear()), 10);
    const month = parseInt(request.query.month || String(new Date().getMonth() + 1), 10);

    // Validate month
    if (month < 1 || month > 12) {
      return reply.status(400).send({
        error: "month must be between 1 and 12",
      });
    }

    // Validate year
    if (year < 2000 || year > 2100) {
      return reply.status(400).send({
        error: "year must be between 2000 and 2100",
      });
    }

    const monthlyEarnings = await prisma.monthlyEarnings.findUnique({
      where: {
        agencyId_operatorId_year_month: {
          agencyId,
          operatorId,
          year,
          month,
        },
      },
    });

    if (!monthlyEarnings) {
      return reply.status(200).send({
        year,
        month,
        revenueTotal: null,
        currency: "GBP",
      });
    }

    return reply.status(200).send({
      year: monthlyEarnings.year,
      month: monthlyEarnings.month,
      revenueTotal: monthlyEarnings.revenueTotal,
      currency: monthlyEarnings.currency,
    });
  } catch (error) {
    logger.error({ error, operatorId }, "Failed to get monthly earnings");
    return reply.status(500).send({ error: "Failed to get monthly earnings" });
  }
}

/**
 * POST /api/earnings/monthly
 * Upsert monthly earnings for a specific month
 */
async function upsertMonthlyEarningsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const logger = request.log;
  const operatorId = (request as any).operatorId;

  if (!operatorId) {
    return reply.status(401).send({ error: "Authentication required" });
  }

  try {
    // Get agencyId for tenant scoping
    const agencyId = await requireAgencyId(request);
    const body = request.body as {
      year: number;
      month: number;
      revenueTotal: number;
      currency?: string;
    };

    // Validate required fields
    if (typeof body.year !== "number") {
      return reply.status(400).send({
        error: "year is required and must be a number",
      });
    }

    if (typeof body.month !== "number") {
      return reply.status(400).send({
        error: "month is required and must be a number",
      });
    }

    if (typeof body.revenueTotal !== "number") {
      return reply.status(400).send({
        error: "revenueTotal is required and must be a number",
      });
    }

    // Validate month
    if (body.month < 1 || body.month > 12) {
      return reply.status(400).send({
        error: "month must be between 1 and 12",
      });
    }

    // Validate year
    if (body.year < 2000 || body.year > 2100) {
      return reply.status(400).send({
        error: "year must be between 2000 and 2100",
      });
    }

    // Validate revenueTotal
    if (body.revenueTotal < 0) {
      return reply.status(400).send({
        error: "revenueTotal must be a non-negative number",
      });
    }

    // Validate currency
    const currency = body.currency || "GBP";
    if (typeof currency !== "string" || currency.length !== 3) {
      return reply.status(400).send({
        error: "currency must be a 3-letter currency code",
      });
    }

    // Upsert monthly earnings
    const monthlyEarnings = await prisma.monthlyEarnings.upsert({
      where: {
        agencyId_operatorId_year_month: {
          agencyId,
          operatorId,
          year: body.year,
          month: body.month,
        },
      },
      create: {
        agencyId,
        operatorId,
        year: body.year,
        month: body.month,
        revenueTotal: body.revenueTotal,
        currency,
      },
      update: {
        revenueTotal: body.revenueTotal,
        currency,
        updatedAt: new Date(),
      },
    });

    logger.info(
      { operatorId, year: body.year, month: body.month, revenueTotal: body.revenueTotal },
      "Monthly earnings upserted"
    );

    return reply.status(200).send({
      year: monthlyEarnings.year,
      month: monthlyEarnings.month,
      revenueTotal: monthlyEarnings.revenueTotal,
      currency: monthlyEarnings.currency,
    });
  } catch (error) {
    logger.error({ error, operatorId }, "Failed to upsert monthly earnings");
    return reply.status(500).send({ error: "Failed to upsert monthly earnings" });
  }
}

/**
 * Register earnings routes
 */
export async function earningsRoutes(fastify: FastifyInstance) {
  fastify.get("/settings", { preHandler: [requireAuth] }, getEarningsSettingsHandler);
  fastify.post("/settings", { preHandler: [requireAuth] }, upsertEarningsSettingsHandler);
  fastify.get("/monthly", { preHandler: [requireAuth] }, getMonthlyEarningsHandler);
  fastify.post("/monthly", { preHandler: [requireAuth] }, upsertMonthlyEarningsHandler);
}

