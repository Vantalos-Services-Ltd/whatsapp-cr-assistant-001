import "./bootstrap/env.ts";
import Fastify from "fastify";
import fastifyCookie from "fastify-cookie";
import fastifySession from "fastify-session";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import { env } from "./config/env.ts";
import { requireAuth } from "./middleware/auth.ts";

// Import route handlers directly (not as plugins)
import { healthRoutes, authenticatedHealthHandler } from "./routes/health.ts";
import { whatsappWebhookRoutes } from "./routes/webhooks/whatsapp.ts";
import { authRoutes } from "./routes/auth.ts";
import {
  approveTaskHandler,
  rejectTaskHandler,
  createCscsVerificationHandler,
  verifyCscsHandler,
} from "./routes/tasks.ts";
import {
  listTasksHandler,
  getConversationHandler,
  listConversationsHandler,
  listMessagesHandler,
  getPendingApprovalHandler,
} from "./routes/operator.ts";
import { dashboardRoutes } from "./routes/dashboard.ts";
import { allTasksRoutes } from "./routes/tasksAll.ts";
import { contactsRoutes } from "./routes/contacts.ts";
import { devRoutes, debugRoutes } from "./routes/dev.ts";
import { candidateRoutes } from "./routes/candidates.ts";
import { jobRoutes } from "./routes/jobs.ts";
import { earningsRoutes } from "./routes/earnings.ts";
import { memoryRefreshRoutes } from "./routes/memoryRefresh.ts";
import { reviewRoutes } from "./routes/review.ts";
import { exportRoutes } from "./routes/exports.ts";
import { devReplayRoutes } from "./routes/devReplay.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { conversationRoutes } from "./routes/conversations.ts";

// Create Fastify instance with Pino logger
// CRITICAL: This is the ONLY Fastify instance in the entire application.
const fastify = Fastify({
  // Twilio (and other webhook providers) often hit us through a reverse proxy.
  // Enabling trustProxy ensures `request.protocol` and related fields respect
  // `x-forwarded-*` headers when present.
  trustProxy: true,
  logger: {
    transport:
      env.NODE_ENV === "development"
        ? {
            target: "pino-pretty",
            options: {
              translateTime: "HH:MM:ss Z",
              ignore: "pid,hostname",
            },
          }
        : undefined,
    level: env.NODE_ENV === "production" ? "info" : "debug",
  },
});

// ============================================================================
// CRITICAL: Cookie and Session MUST be registered FIRST, immediately after
// Fastify instance creation, at ROOT level with NO encapsulation.
// ============================================================================
// These plugins MUST be registered:
// 1. BEFORE any other plugins (formbody, routes, etc.)
// 2. Directly on the root fastify instance (not in any fastify.register wrapper)
// 3. In the correct order: cookie first, then session
// 4. With the secret option passed to cookie plugin
//
// Why this order matters:
// - fastify-session depends on fastify-cookie being available
// - Fastify's plugin system checks for dependencies in the SAME encapsulation scope
// - If registered in different scopes or after other plugins, session cannot find cookie
// ============================================================================

await fastify.register(fastifyCookie);

// Cookie configuration: different settings for development vs production
const isDevelopment = env.NODE_ENV !== "production";

await fastify.register(fastifySession, {
  secret: env.SESSION_SECRET,
  cookie: {
    path: "/", // Cookie available for all paths
    httpOnly: true, // Prevent XSS attacks
    sameSite: "lax", // Allow cross-site requests with credentials
    secure: false, // Set to false for HTTP (localhost)
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    // Do NOT set domain explicitly - let browser handle it
  },
});

// ============================================================================
// All other plugins and routes registered AFTER cookie/session
// ============================================================================

// Register CORS BEFORE routes to handle preflight OPTIONS requests
// This allows the frontend (port 3000) and ngrok domains to communicate with the backend (port 3001)
await fastify.register(cors, {
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g., mobile apps, Postman)
    if (!origin) {
      return callback(null, true);
    }

    // Allow localhost:3000 (development)
    if (origin === "http://localhost:3000") {
      return callback(null, true);
    }

    // Allow specific ngrok domain
    if (origin === "https://webpage.ngrok-free.app") {
      return callback(null, true);
    }

    // Allow any *.ngrok-free.app subdomain
    if (origin.match(/^https:\/\/.*\.ngrok-free\.app$/)) {
      return callback(null, true);
    }

    // Reject all other origins
    return callback(new Error("Not allowed by CORS"), false);
  },
  credentials: true, // Allow cookies to be sent cross-origin
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

// Enable parsing for application/x-www-form-urlencoded (Twilio webhooks)
// Must be registered AFTER cookie/session but BEFORE routes.
// Note: Fastify automatically parses JSON bodies (application/json) by default.
await fastify.register(formbody);

// For now we run BullMQ workers in the same Node.js process as the HTTP server.
// This keeps deployment simple (single service) while we iterate; we can split
// workers into a separate process/service later.
await import("./workers/index.ts");

// ============================================================================
// Register routes - ALL routes registered DIRECTLY on main Fastify instance
// ============================================================================
// CRITICAL: To eliminate scope splits, ALL routes are registered directly
// on the main Fastify instance. This ensures request.session is accessible
// in all routes without any encapsulation issues.
// ============================================================================

// Public routes (no authentication required)
await fastify.register(healthRoutes);
await fastify.register(authRoutes, { prefix: "/auth" });
await fastify.register(whatsappWebhookRoutes, { prefix: "/webhooks" });

// Protected routes (require authentication)
// CRITICAL: Routes are registered DIRECTLY on main instance, not as plugins
// This eliminates all scope splits and ensures session is accessible
fastify.addHook("preHandler", async (request, reply) => {
  // Only apply auth to /api/* routes (not /auth, /webhooks, /health)
  if (request.url.startsWith("/api")) {
    await requireAuth(request, reply);
  }
});

// Inline all /api routes directly on main Fastify instance
// Health check (authenticated - used for status pill heartbeat)
fastify.get("/api/health", authenticatedHealthHandler);

// Task routes
fastify.post("/api/tasks/:taskId/approve", approveTaskHandler);
fastify.post("/api/tasks/:taskId/reject", rejectTaskHandler);
fastify.post("/api/tasks/cscs-verification/create", { preHandler: [requireAuth] }, createCscsVerificationHandler as any);
fastify.post("/api/tasks/:taskId/cscs/verify", verifyCscsHandler);

// Operator routes
// NOTE: /api/operator/tasks and /api/operator/conversations/:id were removed —
// they bound the same handlers as /api/tasks and /api/conversations/:id and no
// client called them. /api/operator/messages is still used by lib/api.ts.
fastify.get("/api/operator/messages", listMessagesHandler);

// Dashboard routes
await fastify.register(dashboardRoutes, { prefix: "/api/dashboard" });

// All Tasks routes (all tasks with filters) - must be registered before /api/tasks
await fastify.register(allTasksRoutes, { prefix: "/api/tasks" });

// Contacts routes
await fastify.register(contactsRoutes, { prefix: "/api/contacts" });

// Candidate routes
await fastify.register(candidateRoutes, { prefix: "/api/candidates" });

// Jobs routes
await fastify.register(jobRoutes, { prefix: "/api" });

// Earnings routes
await fastify.register(earningsRoutes, { prefix: "/api/earnings" });

// Dev routes (development only)
await fastify.register(devRoutes, { prefix: "/api/dev" });
await fastify.register(debugRoutes, { prefix: "/api/debug" });
await fastify.register(memoryRefreshRoutes, { prefix: "/api" });

// Review routes
reviewRoutes(fastify);

// Export routes
exportRoutes(fastify);

// Dev replay routes (dev only, guarded by NODE_ENV)
devReplayRoutes(fastify);

// Settings routes
await fastify.register(settingsRoutes, { prefix: "/api/settings" });

// Conversation routes
await fastify.register(conversationRoutes, { prefix: "/api/conversations" });

// Inbox routes (approval-required tasks only)
// Note: /api/tasks is for inbox (approval-required), /api/tasks/all is for all tasks
fastify.get("/api/tasks", listTasksHandler);
fastify.get("/api/conversations", listConversationsHandler);
fastify.get("/api/conversations/:conversationId", getConversationHandler as any);
fastify.get("/api/conversations/:conversationId/pending-approval", { preHandler: [requireAuth] }, getPendingApprovalHandler as any);

// ============================================================================
// Request logging hook - clean one-line logs, skip noisy endpoints
// ============================================================================
fastify.addHook("onResponse", async (request, reply) => {
  const method = request.method;
  const url = request.url;
  const statusCode = reply.statusCode;
  const responseTime = reply.getResponseTime();

  // Skip logging for noisy endpoints
  const shouldSkip =
    url === "/health" ||
    method === "OPTIONS" ||
    (url.startsWith("/api/conversations") && url.includes("?limit=")) ||
    url.includes("/pending-approval") ||
    url.includes("/timeline");

  // Always log errors (status >= 500) even for skipped endpoints
  if (shouldSkip && statusCode < 500) {
    return;
  }

  // Log one concise line: method url statusCode responseTime
  fastify.log.info({
    method,
    url,
    statusCode,
    responseTime: `${responseTime.toFixed(0)}ms`,
  });
});

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: env.PORT, host: "0.0.0.0" });
    fastify.log.info(`🚀 Server listening on port ${env.PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  fastify.log.info("Shutting down gracefully...");
  await fastify.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

start();

