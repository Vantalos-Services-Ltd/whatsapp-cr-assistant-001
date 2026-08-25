/**
 * Attach candidate details to tasks before they are turned into DTOs.
 *
 * A task can reference a candidate in one of two ways:
 *   - via relatedMessage.candidateId (an inbound message from that person)
 *   - via task.candidateId           (outreach / follow-up created by the
 *                                     opportunity engine, which has no
 *                                     inbound message at all)
 *
 * This lookup previously existed only in the Inbox handler. The "all tasks"
 * endpoint skipped it, which is why the same task rendered as
 * "Kieran Doyle - Plasterer" in the Inbox and "Unknown contact" on the Tasks
 * page. Both endpoints now share this function so they cannot drift again.
 */

import { prisma } from "../db/prisma.ts";
import { scopeWhere } from "../db/tenantScope.ts";

type CandidateSummary = {
  name: string | null;
  phone: string;
  desiredRole: string | null;
};

export async function enrichTasksWithCandidates<T extends { id: string; candidateId?: string | null; relatedMessage?: unknown }>(
  agencyId: string,
  tasks: T[]
): Promise<T[]> {
  if (tasks.length === 0) return tasks;

  const idsFromMessages = tasks
    .map((t) => (t.relatedMessage as { candidateId?: string | null } | null)?.candidateId)
    .filter((id): id is string => Boolean(id));

  const idsFromTasks = tasks
    .map((t) => t.candidateId)
    .filter((id): id is string => Boolean(id));

  const allIds = Array.from(new Set([...idsFromMessages, ...idsFromTasks]));
  if (allIds.length === 0) return tasks;

  const candidates = await prisma.candidate.findMany({
    where: scopeWhere(agencyId, { id: { in: allIds } }),
    select: { id: true, name: true, phone: true, desiredRole: true },
  });

  const byId = new Map<string, CandidateSummary>();
  candidates.forEach((c) =>
    byId.set(c.id, { name: c.name, phone: c.phone, desiredRole: c.desiredRole })
  );

  return tasks.map((task) => {
    const message = task.relatedMessage as (Record<string, unknown> & { candidateId?: string | null }) | null;

    // Preferred: the candidate who sent the related message.
    if (message?.candidateId && byId.has(message.candidateId)) {
      return {
        ...task,
        relatedMessage: { ...message, candidate: byId.get(message.candidateId) },
      };
    }

    // Fallback: a task created against a candidate with no inbound message.
    if (task.candidateId && byId.has(task.candidateId)) {
      const candidate = byId.get(task.candidateId);
      return {
        ...task,
        relatedMessage: message ? { ...message, candidate } : null,
        // Kept for transformers that read the candidate off the task itself.
        _candidate: candidate,
      } as T;
    }

    return task;
  });
}
