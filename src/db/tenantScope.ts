/**
 * Tenant Scoping Helpers for Prisma Queries
 * 
 * These utilities ensure all queries are properly scoped by agencyId
 * for multi-tenant safety while maintaining single-tenant behavior.
 * 
 * IMPORTANT: These helpers do NOT wrap Prisma client. They provide
 * utilities that can be incrementally adopted across routes.
 */

import { PrismaClient } from "@prisma/client";

/**
 * Scope a where clause with agencyId
 * 
 * Ensures agencyId is always included in Prisma where clauses.
 * 
 * @param agencyId The agency ID to scope by
 * @param where Existing where clause (optional)
 * @returns Where clause with agencyId included
 * 
 * @example
 * const where = scopeWhere(agencyId, { status: "OPEN" });
 * // Returns: { agencyId, status: "OPEN" }
 */
export function scopeWhere<T extends Record<string, unknown>>(
  agencyId: string,
  where?: T
): T & { agencyId: string } {
  return {
    ...where,
    agencyId,
  } as T & { agencyId: string };
}

/**
 * Scope a unique constraint with agencyId
 * 
 * For models with composite unique constraints like @@unique([agencyId, id]),
 * this returns the scoped unique constraint.
 * 
 * For models with only id unique (no agencyId in unique), use findFirst
 * with { id, agencyId } instead of findUnique.
 * 
 * @param agencyId The agency ID to scope by
 * @param id The record ID
 * @returns Unique constraint object
 * 
 * @example
 * // For models with @@unique([agencyId, phone])
 * const unique = scopeUnique(agencyId, phone);
 * // Returns: { agencyId, phone }
 */
export function scopeUnique(
  agencyId: string,
  id: string
): { agencyId: string; id: string } {
  return {
    agencyId,
    id,
  };
}

/**
 * Find first record or throw 404 error
 * 
 * Utility to find a record scoped by agencyId and throw a 404 error
 * if not found. This is safer than findUnique when id is globally unique
 * but not tenant-scoped in the schema.
 * 
 * @param model Prisma model delegate (e.g., prisma.task)
 * @param params Object with agencyId and where clause
 * @returns The found record
 * @throws Error with 404 message if not found
 * 
 * @example
 * const task = await findFirstOr404(prisma.task, {
 *   agencyId,
 *   where: { id: taskId }
 * });
 */
export async function findFirstOr404<T>(
  model: {
    findFirst: (args: { where: { agencyId: string; [key: string]: unknown } }) => Promise<T | null>;
  },
  params: {
    agencyId: string;
    where: Record<string, unknown>;
  }
): Promise<T> {
  const where = scopeWhere(params.agencyId, params.where);
  const record = await model.findFirst({
    where,
  });

  if (!record) {
    throw new Error("Record not found");
  }

  return record;
}

/**
 * Verify ownership before update/delete
 * 
 * For models where Prisma update/delete cannot include agencyId in where,
 * first verify ownership with findFirst, then perform the operation.
 * 
 * @param model Prisma model delegate
 * @param agencyId The agency ID to verify
 * @param id The record ID
 * @returns The found record (throws if not found or wrong agency)
 * @throws Error if record not found or doesn't belong to agency
 * 
 * @example
 * // Verify ownership before update
 * const task = await verifyOwnership(prisma.task, agencyId, taskId);
 * await prisma.task.update({ where: { id: taskId }, data: {...} });
 */
export async function verifyOwnership<T>(
  model: {
    findFirst: (args: { where: { agencyId: string; id: string } }) => Promise<T | null>;
  },
  agencyId: string,
  id: string
): Promise<T> {
  const record = await model.findFirst({
    where: {
      agencyId,
      id,
    },
  });

  if (!record) {
    throw new Error("Record not found or access denied");
  }

  return record;
}

/**
 * Wrap Prisma client with tenant scope
 * 
 * This can be expanded later to auto-apply agency filters.
 * For now, it returns the prisma client as-is.
 * 
 * @param prisma The Prisma client instance
 * @param agencyId The agency ID to scope by
 * @returns The Prisma client (can be enhanced later to auto-apply filters)
 * 
 * @example
 * const scopedPrisma = withTenantScope(prisma, agencyId);
 * const jobs = await scopedPrisma.job.findMany();
 */
export function withTenantScope(prisma: PrismaClient, agencyId: string): PrismaClient {
  // This can be expanded later to auto-apply agency filters
  return prisma;
}

/**
 * When to use findFirst vs findUnique:
 * 
 * Use findUnique when:
 * - The model has a composite unique constraint including agencyId
 *   Example: @@unique([agencyId, phone]) -> findUnique({ where: { agencyId_phone: { agencyId, phone } } })
 * 
 * Use findFirst when:
 * - The model only has id as unique (no agencyId in unique constraint)
 *   Example: model Task { id @id, agencyId } -> findFirst({ where: { id, agencyId } })
 * 
 * Why: findUnique only works with unique constraints defined in schema.
 * If id is globally unique but not scoped by agencyId in the unique constraint,
 * we must use findFirst with both id and agencyId to ensure tenant isolation.
 */
