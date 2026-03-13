/**
 * Authentication routes for operator login/logout
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../db/prisma.ts";
import bcrypt from "bcryptjs";

interface LoginBody {
  email: string;
  password: string;
}

/**
 * POST /auth/login
 * Login operator with email/password, sets session cookie
 */
export async function loginHandler(
  request: FastifyRequest<{ Body: LoginBody }>,
  reply: FastifyReply
) {
  const logger = request.log;
  const { email, password } = request.body;

  if (!email || !password) {
    return reply.status(400).send({ error: "Email and password required" });
  }

  try {
    // Query Operator table (NOT User table)
    const operator = await prisma.operator.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!operator) {
      logger.warn({ email }, "Login attempt with invalid email");
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    // Compare plaintext password with hashed password
    const isValid = await bcrypt.compare(password, operator.passwordHash);
    if (!isValid) {
      logger.warn({ email, operatorId: operator.id }, "Login attempt with invalid password");
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    // Set session data
    (request.session as any).operatorId = operator.id;
    (request.session as any).operatorEmail = operator.email;
    (request.session as any).userId = operator.id; // Also set userId for compatibility
    (request.session as any).role = "OPERATOR"; // Set role

    logger.info({ operatorId: operator.id, email: operator.email }, "Operator logged in");

    return reply.status(200).send({
      success: true,
      operator: {
        id: operator.id,
        email: operator.email,
      },
    });
  } catch (error) {
    logger.error({ error, email }, "Login error");
    return reply.status(500).send({ error: "Login failed" });
  }
}

/**
 * POST /auth/logout
 * Clear session cookie
 */
export async function logoutHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const logger = request.log;

  try {
    await request.session.destroy();
    logger.info({ operatorId: (request.session as any).operatorId }, "Operator logged out");
    return reply.status(200).send({ success: true });
  } catch (error) {
    logger.error({ error }, "Logout error");
    return reply.status(500).send({ error: "Logout failed" });
  }
}

/**
 * GET /auth/me
 * Get current operator from session
 */
export async function meHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  // TEMPORARY DEBUG: Log session state
  request.log.warn({
    msg: "DEBUG: auth/me session state",
    endpoint: request.url,
    cookieKeys: Object.keys(request.cookies ?? {}),
    hasCookieHeader: Boolean(request.headers.cookie),
    hasSession: Boolean((request as any).session),
    sessionKeys: Object.keys(((request as any).session ?? {}) as any),
    operatorId: (request as any).session?.operatorId,
    userId: (request as any).session?.userId,
    operator: (request as any).session?.operator,
  });

  const operatorId = (request.session as any)?.operatorId;
  const operatorEmail = (request.session as any)?.operatorEmail;

  if (!operatorId) {
    return reply.status(401).send({ error: "Not authenticated" });
  }

  return reply.status(200).send({
    operator: {
      id: operatorId,
      email: operatorEmail,
    },
  });
}

/**
 * Register auth routes
 */
export async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/login", loginHandler);
  fastify.post("/logout", logoutHandler);
  fastify.get("/me", meHandler);
}

