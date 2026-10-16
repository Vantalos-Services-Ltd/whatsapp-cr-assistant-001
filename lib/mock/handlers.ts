/**
 * Fake backend for demo mode.
 *
 * mockFetch() takes the same (endpoint, options) as apiFetch() and returns a
 * real Response built from the in-browser demo data, so every page and
 * component works unchanged. Nothing leaves the browser.
 *
 * To make the console feel live:
 *   - outbound messages move QUEUED → SENT → DELIVERED → READ over ~10s
 *   - approving a reply to certain candidates triggers a scripted reply a few
 *     seconds later, sometimes with a fresh AI draft queued for approval
 */
import { getDb, nextId, resetDemoDb, saveDb } from "./db";
import type { MockCandidate, MockConversation, MockMessage, MockTask, MockJob, Risk } from "./seed";
import {
  labelForActionType,
  labelForIntent,
  labelForOpportunity,
  labelForTaskType,
  buildApprovalReason,
} from "@/src/shared/taskLabels";

// ---------------------------------------------------------------------------
// plumbing
// ---------------------------------------------------------------------------

const AUTH_KEY = "vantalos-demo-auth";
const REPLY_DELAY_MS = 6_000;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

const nowIso = () => new Date().toISOString();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isAuthed(): boolean {
  try {
    return window.localStorage.getItem(AUTH_KEY) === "1";
  } catch {
    return true;
  }
}

function setAuthed(value: boolean) {
  try {
    if (value) window.localStorage.setItem(AUTH_KEY, "1");
    else window.localStorage.removeItem(AUTH_KEY);
  } catch {
    // ignore
  }
}

function parseBody(options: RequestInit): any {
  if (!options.body || typeof options.body !== "string") return {};
  try {
    return JSON.parse(options.body);
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// lookups
// ---------------------------------------------------------------------------

function candidateById(id: string | null | undefined): MockCandidate | undefined {
  return getDb().candidates.find((c) => c.id === id);
}

function conversationById(id: string | null | undefined): MockConversation | undefined {
  return getDb().conversations.find((c) => c.id === id);
}

function jobById(id: string): MockJob {
  const job = getDb().jobs.find((j) => j.id === id);
  if (!job) throw new HttpError(404, "Job not found");
  return job;
}

function taskById(id: string): MockTask {
  const task = getDb().tasks.find((t) => t.id === id);
  if (!task) throw new HttpError(404, "Task not found");
  return task;
}

const stripPhone = (p: string) => p.replace(/^whatsapp:/i, "");
const displayName = (c?: MockCandidate) => (c ? `${c.name} - ${c.trade}` : "Unknown contact");

function messagesFor(conversationId: string): MockMessage[] {
  return getDb()
    .messages.filter((m) => m.conversationId === conversationId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// ---------------------------------------------------------------------------
// simulated activity
// ---------------------------------------------------------------------------

/** Delivery status for an outbound message sent during the demo. */
function liveDeliveryStatus(m: MockMessage): MockMessage["deliveryStatus"] {
  if (m.deliveryStatus !== "SIMULATED") return m.deliveryStatus;
  const age = Date.now() - new Date(m.createdAt).getTime();
  if (age < 1_500) return "QUEUED";
  if (age < 3_500) return "SENT";
  if (age < 10_000) return "DELIVERED";
  return "READ";
}

function addTimeline(conv: MockConversation, type: string, actorRole: "SYSTEM" | "AI" | "OPERATOR", summary: string, data: Record<string, unknown> | null = null) {
  getDb().timeline.push({
    id: nextId("evt"),
    conversationId: conv.id,
    candidateId: conv.candidateId,
    type,
    actorRole,
    summary,
    data,
    createdAt: nowIso(),
  });
}

function sendOutbound(conv: MockConversation, text: string, senderRole: "AI" | "OPERATOR", taskId: string | null) {
  const db = getDb();
  const createdAt = nowIso();
  const message: MockMessage = {
    id: nextId("msg"),
    conversationId: conv.id,
    candidateId: conv.candidateId,
    direction: "OUTBOUND",
    senderRole,
    text,
    createdAt,
    deliveryStatus: "SIMULATED",
    linkedTaskId: taskId,
  };
  db.messages.push(message);
  conv.lastMessageAt = createdAt;
  if (conv.state === "PAUSED_FOR_APPROVAL") {
    conv.state = "ACTIVE";
    conv.pausedReason = null;
  }
  const cand = candidateById(conv.candidateId);
  if (cand) cand.lastContactedAt = createdAt;
  addTimeline(conv, "OUTREACH_SENT", senderRole, `Sent: ${text.slice(0, 150)}`, { messageId: message.id, taskId });

  // Arm the scripted reply for this conversation, if there is one waiting.
  const reply = db.scriptedReplies.find((r) => r.conversationId === conv.id && !r.dueAt);
  if (reply) reply.dueAt = new Date(Date.now() + REPLY_DELAY_MS).toISOString();
}

/** Deliver any scripted candidate replies whose time has come. */
function tick() {
  const db = getDb();
  const now = Date.now();
  const due = db.scriptedReplies.filter((r) => r.dueAt && new Date(r.dueAt).getTime() <= now);
  if (due.length === 0) return;

  for (const reply of due) {
    const conv = conversationById(reply.conversationId);
    const cand = conv && candidateById(conv.candidateId);
    if (!conv || !cand) continue;

    const at = reply.dueAt!;
    const inbound: MockMessage = {
      id: nextId("msg"),
      conversationId: conv.id,
      candidateId: cand.id,
      direction: "INBOUND",
      senderRole: "HUMAN",
      text: reply.text,
      createdAt: at,
      deliveryStatus: "SENT",
    };
    db.messages.push(inbound);
    conv.lastMessageAt = at;
    cand.lastSeenAt = at;
    db.timeline.push({
      id: nextId("evt"), conversationId: conv.id, candidateId: cand.id,
      type: "INBOUND_MESSAGE_RECEIVED", actorRole: "SYSTEM",
      summary: `Inbound: ${reply.text}`, data: { messageId: inbound.id }, createdAt: at,
    });

    if (reply.draft) {
      const taskId = nextId("task");
      const highRisk = reply.draftRisk === "HIGH";
      db.tasks.push({
        id: taskId,
        type: "APPROVAL_REQUIRED",
        status: "OPEN",
        approvalStatus: "PENDING",
        candidateId: cand.id,
        conversationId: conv.id,
        relatedMessageId: inbound.id,
        createdAt: new Date(new Date(at).getTime() + 2_000).toISOString(),
        priorityScore: highRisk ? 90 : 65,
        payload: {
          conversationId: conv.id,
          contactPhone: cand.phone,
          intent: reply.intent,
          pendingReplyText: reply.draft,
          lastMessageText: reply.text,
          approvalReason: highRisk
            ? "Draft mentions a pay rate — pay figures require operator approval"
            : "Agency policy: every reply needs approval",
        },
        proposedAction: {
          actionType: "SEND_MESSAGE",
          suggestedMessage: reply.draft,
          riskLevel: reply.draftRisk,
          explainability: {
            riskLevel: reply.draftRisk,
            rationale: [
              "Candidate replied to the last message",
              highRisk ? "Reply quotes a rate, which the playbook escalates" : "Moves the conversation to the next required step",
            ],
            usedFacts: [`Trade: ${cand.trade}`, `Location: ${cand.location}`, `${cand.years} years experience`, `Latest message: "${reply.text}"`],
            uncertainty: null,
            missingInfo: [],
            alternatives: [],
            confidence: highRisk ? 0.74 : 0.9,
            generatedBy: "AI",
            generatedAt: at,
          },
        },
      });
      db.timeline.push({
        id: nextId("evt"), conversationId: conv.id, candidateId: cand.id,
        type: "AI_SUGGESTION_CREATED", actorRole: "AI",
        summary: "AI drafted a reply for approval", data: { taskId, taskType: "APPROVAL_REQUIRED" }, createdAt: at,
      });
      conv.state = "PAUSED_FOR_APPROVAL";
      conv.pausedReason = "Reply drafted — waiting for operator approval";
    }
  }

  db.scriptedReplies = db.scriptedReplies.filter((r) => !due.includes(r));
  saveDb();
}

// ---------------------------------------------------------------------------
// DTO builders
// ---------------------------------------------------------------------------

function toMessageDTO(m: MockMessage) {
  const cand = candidateById(m.candidateId);
  const dto: any = {
    messageId: m.id,
    direction: m.direction,
    body: m.text,
    displayText: m.text,
    createdAt: m.createdAt,
    contactPhone: cand ? stripPhone(cand.phone) : null,
    contactName: cand?.name ?? null,
    linkedTaskId: m.linkedTaskId ?? getDb().tasks.find((t) => t.relatedMessageId === m.id)?.id ?? null,
    metadata: m.metadata ?? null,
  };
  if (m.direction === "OUTBOUND") dto.deliveryStatus = liveDeliveryStatus(m);
  return dto;
}

function summaryFor(t: MockTask): string | null {
  const p = t.payload ?? {};
  let summary: string | null = null;
  if (typeof p.opportunityType === "string") {
    summary = Array.isArray(p.reasons) && typeof p.reasons[0] === "string" ? p.reasons[0] : labelForOpportunity(p.opportunityType);
  } else if (t.type === "CSCS_VERIFICATION") {
    summary = "CSCS card photo received — check and approve";
  } else if (t.type === "FOLLOW_UP" && typeof p.reason === "string") {
    summary = p.reason;
  } else {
    const action = labelForActionType(t.proposedAction?.actionType);
    const intent = labelForIntent(p.intent);
    summary = action && intent ? `${action} — ${intent.toLowerCase()}` : action || intent;
  }
  const reason = buildApprovalReason(p);
  if (summary && reason && summary.trim() === reason.trim()) return labelForTaskType(t.type);
  return summary;
}

function toTaskDTO(t: MockTask) {
  const cand = candidateById(t.candidateId);
  const riskLevel: Risk | null = t.proposedAction?.riskLevel ?? null;
  const job = t.payload?.jobId ? getDb().jobs.find((j) => j.id === t.payload.jobId) : undefined;
  const margin = job?.payRate != null && job?.chargeRate != null ? job.chargeRate - job.payRate : null;
  const hours = job?.hoursPerDay && job?.daysPerWeek && job?.durationWeeks ? job.hoursPerDay * job.daysPerWeek * job.durationWeeks : null;
  return {
    taskId: t.id,
    type: t.type,
    approvalStatus: t.approvalStatus,
    status: t.status,
    riskLevel,
    createdAt: t.createdAt,
    conversationId: t.conversationId,
    senderPhone: cand ? stripPhone(cand.phone) : null,
    senderName: cand?.name ?? null,
    displayName: displayName(cand),
    trade: cand?.trade ?? null,
    phone: cand ? stripPhone(cand.phone) : "",
    summary: summaryFor(t),
    suggestedMessage: t.proposedAction?.suggestedMessage ?? t.payload?.suggestedMessage ?? null,
    approvalReason: buildApprovalReason(t.payload),
    payload: t.payload,
    priority: {
      score: t.priorityScore,
      label: t.priorityScore >= 85 ? "High value" : t.priorityScore >= 65 ? "Worth doing soon" : null,
      marginPerHour: margin,
      expectedHours: hours,
    },
    proposedAction: t.proposedAction
      ? { explainability: t.proposedAction.explainability ?? null, riskLevel, usedFactsSnapshot: null }
      : null,
  };
}

function toConversationListItem(c: MockConversation) {
  const cand = candidateById(c.candidateId);
  const msgs = messagesFor(c.id);
  const last = msgs[msgs.length - 1];
  return {
    conversationId: c.id,
    participantPhone: cand ? stripPhone(cand.phone) : "",
    participantDisplayName: displayName(cand),
    updatedAt: c.lastMessageAt,
    state: c.state,
    pausedReason: c.pausedReason,
    lastMessageSnippet: last ? last.text.slice(0, 120) : null,
    progressStage: c.progressStage,
    nextAction: c.progressData?.nextAction ?? c.memoryPack?.nextAction ?? null,
    followUpAt: c.progressData?.followUpAt ?? null,
    memorySummary: c.memoryPack?.summary ?? null,
  };
}

function toConversationDTO(c: MockConversation) {
  const cand = candidateById(c.candidateId);
  return {
    conversationId: c.id,
    participantPhone: cand ? stripPhone(cand.phone) : "",
    participantDisplayName: displayName(cand),
    updatedAt: c.lastMessageAt,
    state: c.state,
    pausedReason: c.pausedReason,
    messages: messagesFor(c.id).map(toMessageDTO),
    progressStage: c.progressStage,
    progressUpdatedAt: c.progressUpdatedAt,
    progressData: c.progressData,
    memoryPack: c.memoryPack,
    memoryUpdatedAt: c.memoryUpdatedAt,
  };
}

function toCandidateDetail(c: MockCandidate) {
  return {
    candidateId: c.id,
    phone: stripPhone(c.phone),
    name: c.name,
    location: c.location,
    desiredRole: c.trade,
    skills: c.skills,
    yearsExperience: c.years,
    salary: c.payMin != null ? { min: c.payMin, max: c.payMax, currency: "GBP" } : null,
    availabilityNotes: c.availabilityNotes,
    lastSeenAt: c.lastSeenAt,
    lastContactedAt: c.lastContactedAt,
    recentMessages: messagesFor(c.conversationId)
      .slice(-10)
      .reverse()
      .map((m) => ({ messageId: m.id, direction: m.direction, text: m.text, createdAt: m.createdAt })),
  };
}

function margins(j: MockJob) {
  const marginPerHour = j.payRate != null && j.chargeRate != null ? Math.round((j.chargeRate - j.payRate) * 100) / 100 : null;
  const weeklyMargin = marginPerHour != null && j.hoursPerDay && j.daysPerWeek ? Math.round(marginPerHour * j.hoursPerDay * j.daysPerWeek * 100) / 100 : null;
  const projectMargin = weeklyMargin != null && j.durationWeeks ? Math.round(weeklyMargin * j.durationWeeks * 100) / 100 : null;
  return { marginPerHour, weeklyMargin, projectMargin };
}

function toJobListItem(j: MockJob) {
  return {
    id: j.id, title: j.title, status: j.status, positionsOpen: j.positionsOpen, positionsFilled: j.positionsFilled,
    tradeRequired: j.tradeRequired, startDate: j.startDate, postcode: j.postcode, city: j.city, updatedAt: j.updatedAt,
  };
}

function toPipelineDTO(p: ReturnType<typeof getDb>["pipeline"][number]) {
  const cand = candidateById(p.candidateId);
  const conv = cand && conversationById(cand.conversationId);
  const m = getDb().matches.find((x) => x.jobId === p.jobId && x.candidateId === p.candidateId);
  return {
    ...p,
    updatedByOperatorId: "op_demo",
    candidate: {
      name: cand?.name ?? null,
      desiredRole: cand?.trade ?? null,
      location: cand?.location ?? null,
      availabilityNotes: cand?.availabilityNotes ?? null,
      phone: cand ? stripPhone(cand.phone) : "",
    },
    matchScore: m?.score ?? null,
    matchTier: m?.tier ?? null,
    conversation: conv
      ? { progressStage: conv.progressStage, memorySummary: conv.memoryPack?.summary ?? null, lastActivityAt: conv.lastMessageAt }
      : null,
  };
}

function toReviewDTO(s: ReturnType<typeof getDb>["reviewSamples"][number]) {
  const db = getDb();
  const task = db.tasks.find((t) => t.id === s.taskId);
  const cand = candidateById(s.candidateId);
  const job = s.jobId ? db.jobs.find((j) => j.id === s.jobId) : undefined;
  const a = s.proposedText;
  const b = s.finalText;
  const aw = a.split(/\s+/);
  const bw = b.split(/\s+/);
  return {
    ...s,
    reviewedByOperatorId: s.reviewedAt ? "op_demo" : null,
    editMetrics: {
      charDiffRatio: Math.round((Math.abs(b.length - a.length) / Math.max(a.length, 1)) * 100) / 100,
      wordDiffCount: Math.abs(bw.length - aw.length) + aw.slice(0, bw.length).filter((w, i) => bw[i] !== w).length,
      wasShortened: b.length < a.length,
      wasExpanded: b.length > a.length,
    },
    task: task ? { type: task.type, createdAt: task.createdAt } : undefined,
    candidate: cand ? { name: cand.name, desiredRole: cand.trade, phone: stripPhone(cand.phone) } : undefined,
    job: job ? { title: job.title, city: job.city } : undefined,
    conversationSnippet: s.conversationId
      ? messagesFor(s.conversationId)
          .filter((m) => m.createdAt <= s.createdAt)
          .slice(-4)
          .map((m) => ({ messageId: m.id, direction: m.direction, text: m.text, createdAt: m.createdAt }))
      : [],
  };
}

// ---------------------------------------------------------------------------
// domain actions
// ---------------------------------------------------------------------------

function approve(taskId: string, body: any) {
  const db = getDb();
  const t = taskById(taskId);
  if (t.status !== "OPEN") throw new HttpError(409, "Task has already been actioned");
  const conv = conversationById(t.conversationId);
  const suggested: string | null = t.proposedAction?.suggestedMessage ?? t.payload?.suggestedMessage ?? t.payload?.pendingReplyText ?? null;
  const override: string | undefined = typeof body.messageOverride === "string" && body.messageOverride.trim() ? body.messageOverride.trim() : undefined;

  let finalText: string | null = override ?? suggested;
  if (t.type === "CSCS_VERIFICATION") {
    finalText = t.payload?.nextSteps?.approveText ?? null;
    if (conv) {
      conv.progressStage = "READY_TO_PLACE";
      conv.progressUpdatedAt = nowIso();
      conv.progressData = { ...conv.progressData, nextAction: "Send site details and confirm start date" };
      addTimeline(conv, "CSCS_APPROVED", "OPERATOR", "CSCS card approved by operator", { taskId: t.id });
      addTimeline(conv, "PROGRESS_STAGE_CHANGED", "SYSTEM", "Progress stage set to ready to place", { newStage: "READY_TO_PLACE" });
    }
  }

  t.status = "APPROVED";
  t.approvalStatus = "APPROVED";
  t.payload = {
    ...t.payload,
    proposedMessageText: suggested,
    approvedMessageText: finalText,
    wasEdited: !!override && override !== suggested,
    editSummary: override && override !== suggested ? "Operator edited the draft before sending" : "Sent unchanged",
    approvedAt: nowIso(),
  };

  if (conv) {
    addTimeline(conv, "TASK_APPROVED", "OPERATOR", override && override !== suggested ? "Task approved (edited)" : "Task approved", { taskId: t.id, taskType: t.type });
    if (finalText) sendOutbound(conv, finalText, "OPERATOR", t.id);
  }

  if (override && override !== suggested && suggested) {
    db.reviewSamples.push({
      id: nextId("rev"), taskId: t.id, conversationId: t.conversationId, candidateId: t.candidateId,
      jobId: t.payload?.jobId ?? null, createdAt: nowIso(), sampledReason: "EDITED",
      proposedText: suggested, finalText: override, verdict: null, reviewedAt: null, notes: null,
    });
  }
  saveDb();
  return toTaskDTO(t);
}

function reject(taskId: string, body: any) {
  const t = taskById(taskId);
  if (t.status !== "OPEN") throw new HttpError(409, "Task has already been actioned");
  const reason = body.rejectionReason || body.reason || null;
  t.status = "REJECTED";
  t.approvalStatus = "REJECTED";
  t.payload = { ...t.payload, rejectionReason: reason, rejectedAt: nowIso() };
  const conv = conversationById(t.conversationId);
  if (conv) {
    addTimeline(conv, t.type === "CSCS_VERIFICATION" ? "CSCS_REJECTED" : "TASK_REJECTED", "OPERATOR",
      reason ? `Task rejected: ${reason}` : "Task rejected", { taskId: t.id, taskType: t.type });
    if (t.type === "CSCS_VERIFICATION" && t.payload?.nextSteps?.rejectText) {
      sendOutbound(conv, t.payload.nextSteps.rejectText, "OPERATOR", t.id);
    }
    if (conv.state === "PAUSED_FOR_APPROVAL") {
      conv.state = "ACTIVE";
      conv.pausedReason = null;
    }
  }
  saveDb();
  return toTaskDTO(t);
}

function dashboardStats() {
  const db = getDb();
  const open = db.tasks.filter((t) => t.status === "OPEN");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isToday = (iso: string) => new Date(iso) >= today;
  const approvedToday = db.tasks.filter((t) => t.status === "APPROVED" && t.payload?.approvedAt && isToday(t.payload.approvedAt));
  const editedToday = approvedToday.filter((t) => t.payload?.wasEdited);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const recent = db.reviewSamples.filter((s) => s.reviewedAt && new Date(s.reviewedAt).getTime() > weekAgo);
  return {
    activeTasks: open.length,
    pendingApproval: open.filter((t) => t.approvalStatus === "PENDING").length,
    stuckTasks: 0,
    oldestStuckAgeMinutes: 0,
    messagesToday: db.messages.filter((m) => isToday(m.createdAt)).length,
    activeContacts: db.conversations.filter((c) => Date.now() - new Date(c.lastMessageAt).getTime() < 7 * 86_400_000).length,
    approvalsEditedToday: editedToday.length,
    approvalsToday: approvedToday.length,
    percentEdited: approvedToday.length ? Math.round((editedToday.length / approvedToday.length) * 100) : 0,
    unsafeReviews7d: recent.filter((s) => s.verdict === "UNSAFE").length,
    needsImprovement7d: recent.filter((s) => s.verdict === "NEEDS_IMPROVEMENT").length,
  };
}

function dashboardEarnings() {
  const db = getDb();
  const settings = db.earningsSettings;
  const d = new Date();
  const revenue = db.monthlyEarnings[`${d.getFullYear()}-${d.getMonth() + 1}`];
  if (!settings || revenue == null) return { configured: false };
  const brackets = [...settings.commissionBrackets].sort((a: any, b: any) => a.minRevenue - b.minRevenue);
  const current = brackets.filter((b: any) => revenue >= b.minRevenue).pop() ?? brackets[0];
  const next = brackets.find((b: any) => b.minRevenue > revenue) ?? null;
  const toNext = next ? next.minRevenue - revenue : null;
  const fmt = (n: number) => `£${n.toLocaleString("en-GB")}`;
  return {
    configured: true,
    revenueTotal: revenue,
    currency: settings.currency,
    currentBracketRatePct: current.ratePct,
    amountToNextBracket: toNext,
    nextBracketRatePct: next?.ratePct ?? null,
    summaryText: next
      ? `${fmt(revenue)} billed this month. ${fmt(toNext!)} more moves you from ${current.ratePct}% to ${next.ratePct}% commission.`
      : `${fmt(revenue)} billed this month — you're in the top ${current.ratePct}% bracket.`,
    opportunities: [
      { label: "Fill 2 more Salford Quays electricians", estMonthlyMargin: 4290, currency: "GBP", why: "Urgent premium job, £10.50/hr margin", jobId: db.jobs[1]?.id },
      { label: "Place Marek on Liverpool Waters", estMonthlyMargin: 1170, currency: "GBP", why: "91% match, waiting on a rate reply", jobId: db.jobs[2]?.id },
    ],
  };
}

function opportunities() {
  const db = getDb();
  const salford = db.jobs.find((j) => j.title.startsWith("Salford"));
  const maidstone = db.jobs.find((j) => j.title.startsWith("Maidstone"));
  const created = (key: string) => db.createdOpportunityKeys.includes(key);
  const items = [
    {
      opportunityKey: `UNDERFILLED_URGENT_JOB:${salford?.id}`,
      type: "UNDERFILLED_URGENT_JOB",
      title: "Salford Quays Commercial Fit-Out is 5 electricians short",
      priority: 95,
      reasonBullets: ["Status URGENT, starts in 2 days", "1 of 6 positions filled", "£10.50/hr margin — premium client"],
      recommendedAction: { taskType: "OUTREACH" as const, count: 2, description: "Message the 2 best-matched candidates not yet contacted" },
      relatedJobId: salford?.id ?? null,
      relatedCandidateIdsCount: 2,
    },
    {
      opportunityKey: `FOLLOW_UP_AFTER_OFFER:${maidstone?.id}`,
      type: "FOLLOW_UP_AFTER_OFFER",
      title: "Offer to Jason Pike unanswered for 20 hours",
      priority: 70,
      reasonBullets: ["Offer sent for Maidstone Residential", "Start date in 4 days"],
      recommendedAction: { taskType: "FOLLOW_UP" as const, count: 1, description: "Send a friendly chase message" },
      relatedJobId: maidstone?.id ?? null,
      relatedCandidateIdsCount: 1,
    },
  ];
  const createdAt = db.builtAt;
  const expiresAt = new Date(new Date(createdAt).getTime() + 3 * 86_400_000).toISOString();
  return { items: items.map((o) => ({ ...o, createdAt, expiresAt, alreadyCreated: created(o.opportunityKey) })) };
}

function createOpportunity(body: any) {
  const db = getDb();
  const key: string = body.opportunityKey;
  if (body.dryRun) return { createdCount: 0, skippedCount: 0, taskIds: [], wouldCreateCount: body.limit ?? 1 };
  if (db.createdOpportunityKeys.includes(key)) return { createdCount: 0, skippedCount: body.limit ?? 1, taskIds: [] };
  db.createdOpportunityKeys.push(key);
  const [type, jobId] = key.split(":");
  const job = db.jobs.find((j) => j.id === jobId);
  const taskIds: string[] = [];
  const targets =
    type === "UNDERFILLED_URGENT_JOB"
      ? db.matches.filter((m) => m.jobId === jobId).sort((a, b) => b.score - a.score).map((m) => candidateById(m.candidateId)!)
          .filter((c) => !db.tasks.some((t) => t.candidateId === c.id && t.status === "OPEN" && t.payload?.jobId === jobId))
          .slice(0, body.limit ?? 2)
      : db.pipeline.filter((p) => p.jobId === jobId && p.stage === "OFFER_SENT").map((p) => candidateById(p.candidateId)!).slice(0, 1);
  for (const cand of targets) {
    const first = cand.name.split(" ")[0];
    const msg = type === "UNDERFILLED_URGENT_JOB"
      ? `Hi ${first}, it's Vantalos — urgent ${job?.tradeRequired.toLowerCase()} work at ${job?.siteName ?? job?.title}, ${job?.city}. Starts this week, good rates. Interested?`
      : `Hi ${first}, just checking you got the ${job?.city} details? Let me know either way 👍`;
    const id = nextId("task");
    taskIds.push(id);
    db.tasks.push({
      id,
      type: type === "UNDERFILLED_URGENT_JOB" ? "OUTREACH" : "FOLLOW_UP",
      status: "OPEN",
      approvalStatus: type === "UNDERFILLED_URGENT_JOB" ? "PENDING" : "NOT_REQUIRED",
      candidateId: cand.id,
      conversationId: cand.conversationId,
      relatedMessageId: null,
      createdAt: nowIso(),
      priorityScore: 85,
      payload: {
        conversationId: cand.conversationId, contactPhone: cand.phone, opportunityType: type,
        reasons: [type === "UNDERFILLED_URGENT_JOB" ? `Matches urgent ${job?.title}` : "Offer unanswered"],
        suggestedMessage: msg, jobId, jobTitle: job?.title,
      },
      proposedAction: { actionType: "SEND_MESSAGE", suggestedMessage: msg, riskLevel: "MEDIUM" },
    });
    const conv = conversationById(cand.conversationId);
    if (conv) addTimeline(conv, "OPPORTUNITY_TASK_CREATED", "OPERATOR", "Task created from opportunity", { taskId: id });
  }
  saveDb();
  return { createdCount: taskIds.length, skippedCount: 0, taskIds };
}

function searchCandidates(q: string, limit: number) {
  const db = getDb();
  const terms = q.toLowerCase().split(/[\s,]+/).filter((t) => t.length > 1 && !["in", "with", "and", "the", "for"].includes(t));
  const results = db.candidates
    .map((c) => {
      const fields: Array<[string, string]> = [
        ["trade", c.trade], ["location", c.location], ...c.skills.map((s) => ["skill", s] as [string, string]),
        ...c.tickets.map((t) => ["ticket", t] as [string, string]), ["name", c.name],
      ];
      const reasons: string[] = [];
      let score = terms.length ? 0 : 50;
      for (const term of terms) {
        const hit = fields.find(([, v]) => v.toLowerCase().includes(term));
        if (hit) {
          score += hit[0] === "trade" ? 40 : hit[0] === "location" ? 30 : 15;
          reasons.push(`${hit[0][0].toUpperCase()}${hit[0].slice(1)}: ${hit[1]}`);
        }
      }
      score = Math.min(99, score + Math.min(c.years, 10));
      return {
        candidateId: c.id, phone: stripPhone(c.phone), name: c.name, desiredRole: c.trade, skills: c.skills,
        yearsExperience: c.years, location: c.location,
        salary: c.payMin != null ? { min: c.payMin, max: c.payMax, currency: "GBP" } : null,
        matchScore: score, reasons: reasons.length ? reasons : [`${c.years} years experience`],
      };
    })
    .filter((r) => !terms.length || r.reasons.some((x) => !x.endsWith("years experience")))
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);
  return { query: q, filters: { terms }, results, count: results.length };
}

function outreachDraft(c: MockCandidate, jobDescription: string) {
  const first = c.name.split(" ")[0];
  const what = jobDescription.trim() ? jobDescription.trim().replace(/\.$/, "") : `${c.trade.toLowerCase()} work`;
  return `Hi ${first}, it's Vantalos 👋 We've got ${what} coming up near ${c.location}. Interested?`;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

/**
 * Demo-mode replacement for the CSV export links: builds the file in the
 * browser and downloads it.
 */
export function downloadMockExport(path: string): void {
  const url = new URL(path, "http://demo.local");
  let rows: Array<Record<string, unknown>> = [];
  let filename = "export.csv";
  const pipelineMatch = url.pathname.match(/^\/api\/exports\/jobs\/([^/]+)\/pipeline\.csv$/);
  if (url.pathname === "/api/exports/candidates.csv") {
    rows = searchCandidates(url.searchParams.get("q") ?? "", 500).results.map((r) => ({
      name: r.name, trade: r.desiredRole, location: r.location, phone: r.phone, years: r.yearsExperience,
      skills: r.skills.join("; "), matchScore: r.matchScore,
    }));
    filename = "candidates.csv";
  } else if (pipelineMatch) {
    rows = getDb().pipeline.filter((p) => p.jobId === pipelineMatch[1]).map(toPipelineDTO).map((p) => ({
      name: p.candidate.name, trade: p.candidate.desiredRole, phone: p.candidate.phone, stage: p.stage,
      payRate: p.payRate, startDate: p.startDate, notes: p.notes, updatedAt: p.updatedAt,
    }));
    filename = "pipeline.csv";
  }
  const blob = new Blob([toCsv(rows)], { type: "text/csv" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(href), 1_000);
}

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------

type Handler = (ctx: { params: string[]; query: URLSearchParams; body: any }) => unknown | Response;
const routes: Array<[string, RegExp, Handler]> = [];
const route = (method: string, pattern: string, handler: Handler) =>
  routes.push([method, new RegExp("^" + pattern.replace(/:[a-zA-Z]+/g, "([^/]+)") + "$"), handler]);

// -- auth ---------------------------------------------------------------------
route("POST", "/auth/login", ({ body }) => {
  if (!body.email || !body.password) return json({ error: "Email and password are required" }, 400);
  setAuthed(true);
  return { ok: true, operator: { id: "op_demo", email: body.email } };
});
route("POST", "/auth/logout", () => {
  setAuthed(false);
  return { ok: true };
});
route("GET", "/auth/me", () =>
  isAuthed() ? { operator: { id: "op_demo", email: "admin@example.com" } } : json({ error: "Not authenticated" }, 401)
);

// -- health -------------------------------------------------------------------
route("GET", "/api/health", () => ({ ok: true, serverTime: nowIso() }));

// -- tasks --------------------------------------------------------------------
route("GET", "/api/tasks", ({ query }) => {
  const bucket = query.get("bucket") ?? "pending";
  const tasks = getDb().tasks.filter((t) =>
    bucket === "pending" ? t.status === "OPEN"
      : bucket === "completed" ? t.status === "APPROVED"
      : bucket === "failed" ? t.status === "REJECTED" || t.approvalStatus === "REJECTED" || t.status === "FAILED"
      : true
  );
  return tasks
    .sort((a, b) => (bucket === "pending" ? b.priorityScore - a.priorityScore : 0) || b.createdAt.localeCompare(a.createdAt))
    .map(toTaskDTO);
});
route("GET", "/api/tasks/all", ({ query }) => {
  const filter = query.get("filter") ?? "all";
  const tasks = getDb()
    .tasks.filter((t) =>
      filter === "pending" ? t.status === "OPEN" && t.approvalStatus === "PENDING"
        : filter === "approved" ? t.status === "APPROVED"
        : filter === "failed" ? t.status === "FAILED"
        : true
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toTaskDTO);
  return { tasks, pagination: { limit: 100, offset: 0, total: tasks.length } };
});
route("POST", "/api/tasks/cscs-verification/create", ({ body }) => {
  const db = getDb();
  const cand = candidateById(body.candidateId);
  if (!cand) throw new HttpError(404, "Candidate not found");
  const job = jobById(body.jobId);
  const id = nextId("task");
  db.tasks.push({
    id, type: "CSCS_VERIFICATION", status: "OPEN", approvalStatus: "PENDING",
    candidateId: cand.id, conversationId: cand.conversationId, relatedMessageId: body.sourceMessageId ?? null,
    createdAt: nowIso(), priorityScore: 70,
    payload: {
      conversationId: cand.conversationId,
      candidate: { candidateId: cand.id, name: cand.name, phone: cand.phone, desiredRole: cand.trade, location: cand.location },
      job: { jobId: job.id, title: job.title, status: job.status, clientName: job.clientName ?? undefined, city: job.city ?? undefined, payRate: job.payRate ?? undefined, chargeRate: job.chargeRate ?? undefined, currency: job.currency, ...margins(job) },
      cscs: {
        imageUrl: body.imageUrl, source: body.sourceMessageId ? "WHATSAPP" : "OPERATOR_UPLOAD", uploadedAt: nowIso(),
        checks: { overall: "UNKNOWN", issues: [] },
      },
      nextSteps: {
        approveText: `Thanks ${cand.name.split(" ")[0]} — your CSCS card checks out 👍`,
        rejectText: `Hi ${cand.name.split(" ")[0]}, we couldn't verify your CSCS card from that photo. Could you send a clearer one?`,
      },
    },
    proposedAction: { actionType: "REQUEST_INFO", riskLevel: "MEDIUM" },
  });
  saveDb();
  return { id, summary: `CSCS verification for ${cand.name} - ${job.title}` };
});
route("POST", "/api/tasks/:id/approve", ({ params, body }) => approve(params[0], body));
route("POST", "/api/tasks/:id/reject", ({ params, body }) => reject(params[0], body));
route("POST", "/api/tasks/:id/cscs/verify", ({ params, body }) => {
  const t = taskById(params[0]);
  const { extracted = {}, checks = {} } = body;
  const issues: string[] = [];
  if (!checks.nameMatchOk) issues.push("Name on card does not match candidate");
  if (!checks.expiryValidOk) issues.push("Card is expired or expiry unreadable");
  if (!checks.requiredLevelOk) issues.push("Card level does not meet job requirement");
  t.payload = {
    ...t.payload,
    cscs: {
      ...t.payload.cscs,
      extracted,
      checks: {
        nameMatch: { ok: !!checks.nameMatchOk, value: extracted.holderName },
        expiryValid: { ok: !!checks.expiryValidOk, value: extracted.expiryDate },
        requiredLevel: { ok: !!checks.requiredLevelOk, value: extracted.cardType },
        overall: issues.length ? "INVALID" : "VALID",
        issues,
      },
    },
  };
  saveDb();
  return { payload: t.payload };
});

// -- conversations ------------------------------------------------------------
route("GET", "/api/conversations", ({ query }) => {
  const limit = Number(query.get("limit") ?? 50);
  return [...getDb().conversations]
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
    .slice(0, limit)
    .map(toConversationListItem);
});
route("GET", "/api/conversations/:id", ({ params }) => {
  const c = conversationById(params[0]);
  if (!c) throw new HttpError(404, "Conversation not found");
  return toConversationDTO(c);
});
route("GET", "/api/conversations/:id/pending-approval", ({ params }) => {
  const t = getDb().tasks
    .filter((x) => x.conversationId === params[0] && x.status === "OPEN" && x.approvalStatus === "PENDING")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!t) return { task: null };
  const rel = getDb().messages.find((m) => m.id === t.relatedMessageId);
  return {
    task: {
      id: t.id, type: t.type, status: t.status, approvalStatus: t.approvalStatus,
      proposedAction: t.proposedAction, payload: t.payload, relatedMessageId: t.relatedMessageId,
      relatedMessage: rel ? { id: rel.id, text: rel.text, createdAt: rel.createdAt, conversationId: rel.conversationId } : null,
      candidateId: t.candidateId, createdAt: t.createdAt,
    },
  };
});
route("GET", "/api/conversations/:id/timeline", ({ params, query }) => {
  const c = conversationById(params[0]);
  if (!c) throw new HttpError(404, "Conversation not found");
  const limit = Number(query.get("limit") ?? 50);
  const offset = Number(query.get("cursor") ?? 0);
  const all = getDb().timeline.filter((e) => e.conversationId === c.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const page = all.slice(offset, offset + limit);
  return {
    items: page.map((e) => ({
      eventId: e.id, type: e.type, actorRole: e.actorRole,
      actorName: e.actorRole === "OPERATOR" ? "admin@example.com" : e.actorRole === "AI" ? "AI" : "System",
      operatorId: e.actorRole === "OPERATOR" ? "op_demo" : null, summary: e.summary, data: e.data,
      createdAt: e.createdAt, conversationId: e.conversationId, contactId: e.candidateId, candidateId: e.candidateId,
    })),
    nextCursor: offset + limit < all.length ? String(offset + limit) : null,
  };
});
route("POST", "/api/conversations/:id/refresh-memory", async ({ params }) => {
  const c = conversationById(params[0]);
  if (!c) throw new HttpError(404, "Conversation not found");
  await wait(900); // feels like the AI is thinking
  const last = messagesFor(c.id).filter((m) => m.direction === "INBOUND").pop();
  c.memoryPack = {
    ...c.memoryPack,
    version: (c.memoryPack?.version ?? 0) + 1,
    lastUpdatedAt: nowIso(),
    summary: last && !c.memoryPack.summary.includes(last.text)
      ? `${c.memoryPack.summary} Latest: "${last.text.slice(0, 80)}".`
      : c.memoryPack.summary,
  };
  c.memoryUpdatedAt = nowIso();
  addTimeline(c, "MEMORY_PACK_UPDATED", "AI", "Memory refreshed from conversation", { memoryPackVersion: c.memoryPack.version });
  saveDb();
  return noContent();
});

// -- messages / contacts ------------------------------------------------------
route("GET", "/api/operator/messages", () => {
  const messages = [...getDb().messages].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(toMessageDTO);
  return { messages, pagination: { limit: 200, offset: 0, total: messages.length } };
});
route("GET", "/api/contacts", () => {
  const db = getDb();
  const contacts = db.candidates.map((c) => {
    const conv = conversationById(c.conversationId)!;
    const last = messagesFor(c.conversationId).pop();
    return {
      id: c.id,
      candidateId: c.id,
      phone: stripPhone(c.phone),
      name: c.name,
      candidateName: c.name,
      desiredRole: c.trade,
      lastSeenAt: c.lastSeenAt,
      lastConversationId: c.conversationId,
      lastMessageSnippet: last?.text.slice(0, 120) ?? null,
      conversationState: conv.state,
      hasPendingApproval: db.tasks.some((t) => t.conversationId === conv.id && t.status === "OPEN" && t.approvalStatus === "PENDING"),
      progressStage: conv.progressStage,
      progressUpdatedAt: conv.progressUpdatedAt,
      memorySummary: conv.memoryPack?.summary ?? null,
      followUpAt: conv.progressData?.followUpAt ?? null,
      waitingForOperator: conv.progressData?.flags?.waitingForOperator ?? false,
    };
  }).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  return { contacts, pagination: { limit: 100, offset: 0, total: contacts.length } };
});

// -- candidates ---------------------------------------------------------------
route("GET", "/api/candidates/search", ({ query }) => searchCandidates(query.get("q") ?? "", Number(query.get("limit") ?? 25)));
route("POST", "/api/candidates/outreach/preview", ({ body }) => ({
  previews: (body.candidateIds ?? []).map((id: string) => {
    const c = candidateById(id);
    if (!c) throw new HttpError(404, "Candidate not found");
    return { candidateId: c.id, phone: stripPhone(c.phone), suggestedMessage: outreachDraft(c, body.jobDescription ?? "") };
  }),
}));
route("POST", "/api/candidates/outreach/submit", ({ body }) => {
  const db = getDb();
  const tasks = (body.candidateIds ?? []).map((cid: string) => {
    const c = candidateById(cid);
    if (!c) throw new HttpError(404, "Candidate not found");
    const msg = body.suggestedMessages?.[cid] ?? outreachDraft(c, body.jobDescription ?? "");
    const id = nextId("task");
    db.tasks.push({
      id, type: "OUTREACH", status: "OPEN", approvalStatus: "PENDING", candidateId: c.id, conversationId: c.conversationId,
      relatedMessageId: null, createdAt: nowIso(), priorityScore: 72,
      payload: { conversationId: c.conversationId, contactPhone: c.phone, pendingReplyText: msg, jobDescription: body.jobDescription, approvalReason: "Outreach messages are always approved by an operator" },
      proposedAction: { actionType: "SEND_MESSAGE", suggestedMessage: msg, riskLevel: "LOW" },
    });
    const conv = conversationById(c.conversationId);
    if (conv) addTimeline(conv, "OUTREACH_TASK_CREATED", "OPERATOR", "Outreach drafted for approval", { taskId: id });
    return { taskId: id, candidateId: c.id };
  });
  saveDb();
  return { tasks, count: tasks.length };
});
route("GET", "/api/candidates/:id/latest-media", ({ params }) => {
  const c = candidateById(params[0]);
  const m = c && messagesFor(c.conversationId).filter((x) => x.metadata?.media?.length).pop();
  if (!m) return json({ error: "No media found for this candidate" }, 404);
  return { messageId: m.id, mediaUrl: m.metadata.media[0].url };
});
route("GET", "/api/candidates/:id", ({ params }) => {
  const c = candidateById(params[0]);
  if (!c) throw new HttpError(404, "Candidate not found");
  return toCandidateDetail(c);
});

// -- jobs ---------------------------------------------------------------------
route("GET", "/api/jobs", ({ query }) => {
  const q = (query.get("q") ?? "").toLowerCase();
  const status = query.get("status");
  const items = getDb()
    .jobs.filter((j) => (!status || j.status === status) && (!q || [j.title, j.city, j.tradeRequired, j.clientName].some((v) => v?.toLowerCase().includes(q))))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { items: items.map(toJobListItem), total: items.length };
});
route("POST", "/api/jobs", ({ body }) => {
  if (!body.title || !body.tradeRequired) return json({ error: "Title and trade are required" }, 400);
  const job: MockJob = {
    id: nextId("job"), title: body.title, status: body.status ?? "ACTIVE", tradeRequired: body.tradeRequired,
    startDate: body.startDate ? new Date(body.startDate).toISOString() : null, durationWeeks: body.durationWeeks ?? null,
    hoursPerDay: body.hoursPerDay ?? null, daysPerWeek: body.daysPerWeek ?? null,
    positionsOpen: Number(body.positionsOpen ?? 1), positionsFilled: 0, siteName: body.siteName ?? null,
    addressLine1: body.addressLine1 ?? null, addressLine2: null, postcode: body.postcode ?? null, city: body.city ?? null,
    clientName: body.clientName ?? null, clientType: body.clientType ?? null, siteManagerName: null, siteManagerPhone: null,
    isPremiumClient: false, payRate: body.payRate ?? null, chargeRate: body.chargeRate ?? null, currency: "GBP",
    requirementsJson: null, notes: body.notes ?? null, createdAt: nowIso(), updatedAt: nowIso(),
  };
  const db = getDb();
  db.jobs.push(job);
  // Instant matches so the new job's page isn't empty
  const trade = job.tradeRequired.toLowerCase();
  for (const c of db.candidates) {
    const tradeHit = c.trade.toLowerCase().includes(trade) || trade.includes(c.trade.toLowerCase());
    const placeHit = job.city && c.location.toLowerCase() === job.city.toLowerCase();
    if (!tradeHit && !placeHit) continue;
    const score = (tradeHit ? 60 : 20) + (placeHit ? 25 : 0) + Math.min(c.years, 10);
    db.matches.push({
      jobId: job.id, candidateId: c.id, score, tier: score >= 85 ? "EXCELLENT" : score >= 60 ? "GOOD" : "WEAK",
      highlights: [tradeHit ? `Trade: ${c.trade}` : `Different trade (${c.trade})`, placeHit ? `Based in ${c.location}` : `Based in ${c.location}`],
    });
  }
  saveDb();
  return { id: job.id, title: job.title, status: job.status };
});
route("GET", "/api/jobs/:id", ({ params }) => {
  const j = jobById(params[0]);
  return { ...j, ...margins(j) };
});
route("GET", "/api/jobs/:id/matches", ({ params, query }) => {
  const j = jobById(params[0]);
  const all = getDb().matches.filter((m) => m.jobId === j.id).sort((a, b) => b.score - a.score);
  const limit = Number(query.get("limit") ?? 20);
  return {
    jobId: j.id,
    totalAvailable: all.length,
    matches: all.slice(0, limit).map((m) => {
      const c = candidateById(m.candidateId)!;
      return {
        candidateId: c.id, name: c.name, phone: stripPhone(c.phone), desiredRole: c.trade, displayName: displayName(c),
        trade: c.trade, location: c.location, availabilityNotes: c.availabilityNotes, score: m.score, tier: m.tier,
        highlights: m.highlights,
      };
    }),
  };
});
route("POST", "/api/jobs/:id/mark-filled", ({ params, body }) => {
  const j = jobById(params[0]);
  j.status = "FILLED";
  if (body.setPositionsFilled !== false) j.positionsFilled = j.positionsOpen;
  j.updatedAt = nowIso();
  saveDb();
  return { ok: true };
});
route("GET", "/api/jobs/:id/pipeline", ({ params }) =>
  getDb().pipeline.filter((p) => p.jobId === params[0]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(toPipelineDTO)
);
route("POST", "/api/jobs/:id/pipeline", ({ params, body }) => {
  const db = getDb();
  const job = jobById(params[0]);
  const cand = candidateById(body.candidateId);
  if (!cand) throw new HttpError(404, "Candidate not found");
  let item = db.pipeline.find((p) => p.jobId === job.id && p.candidateId === cand.id);
  const previous = item?.stage;
  if (!item) {
    item = {
      id: nextId("pipe"), jobId: job.id, candidateId: cand.id, stage: body.stage, notes: null, startDate: null,
      payRate: null, shiftInfo: null, noShowReason: null, droppedReason: null, createdAt: nowIso(), updatedAt: nowIso(),
    };
    db.pipeline.push(item);
  }
  for (const k of ["stage", "notes", "startDate", "payRate", "shiftInfo", "noShowReason", "droppedReason"] as const) {
    if (body[k] !== undefined) (item as any)[k] = body[k];
  }
  item.updatedAt = nowIso();
  if (item.stage === "START_CONFIRMED" && previous !== "START_CONFIRMED") {
    job.positionsFilled = Math.min(job.positionsOpen, job.positionsFilled + 1);
  }
  const conv = conversationById(cand.conversationId);
  if (conv) addTimeline(conv, "JOB_PIPELINE_UPDATED", "OPERATOR", `${job.title}: ${item.stage.replace(/_/g, " ").toLowerCase()}`, { jobId: job.id, stage: item.stage });
  saveDb();
  return toPipelineDTO(item);
});
route("DELETE", "/api/jobs/:id/pipeline/:candidateId", ({ params }) => {
  const db = getDb();
  db.pipeline = db.pipeline.filter((p) => !(p.jobId === params[0] && p.candidateId === params[1]));
  saveDb();
  return noContent();
});

// -- dashboard / earnings -----------------------------------------------------
route("GET", "/api/dashboard/stats", () => dashboardStats());
route("GET", "/api/dashboard/earnings", () => dashboardEarnings());
route("GET", "/api/dashboard/opportunities", () => opportunities());
route("POST", "/api/dashboard/opportunities/create", ({ body }) => createOpportunity(body));
route("GET", "/api/earnings/settings", () => getDb().earningsSettings ?? { basePayMonthly: null, currency: "GBP", commissionBrackets: [] });
route("POST", "/api/earnings/settings", ({ body }) => {
  getDb().earningsSettings = { basePayMonthly: body.basePayMonthly ?? null, currency: body.currency ?? "GBP", commissionBrackets: body.commissionBrackets ?? [] };
  saveDb();
  return getDb().earningsSettings;
});
route("GET", "/api/earnings/monthly", ({ query }) => {
  const d = new Date();
  const year = Number(query.get("year") ?? d.getFullYear());
  const month = Number(query.get("month") ?? d.getMonth() + 1);
  const revenueTotal = getDb().monthlyEarnings[`${year}-${month}`];
  return { year, month, revenueTotal: revenueTotal ?? null, currency: "GBP" };
});
route("POST", "/api/earnings/monthly", ({ body }) => {
  getDb().monthlyEarnings[`${body.year}-${body.month}`] = Number(body.revenueTotal);
  saveDb();
  return { year: body.year, month: body.month, revenueTotal: Number(body.revenueTotal), currency: body.currency ?? "GBP" };
});

// -- review -------------------------------------------------------------------
route("GET", "/api/review/samples", ({ query }) => {
  const bucket = query.get("bucket") ?? "pending";
  const limit = Number(query.get("limit") ?? 25);
  const samples = getDb()
    .reviewSamples.filter((s) => (bucket === "pending" ? !s.verdict : !!s.verdict))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { samples: samples.slice(0, limit).map(toReviewDTO), nextCursor: null, hasMore: false };
});
route("GET", "/api/review/samples/:id", ({ params }) => {
  const s = getDb().reviewSamples.find((x) => x.id === params[0]);
  if (!s) throw new HttpError(404, "Review sample not found");
  return toReviewDTO(s);
});
route("POST", "/api/review/samples/:id/verdict", ({ params, body }) => {
  const s = getDb().reviewSamples.find((x) => x.id === params[0]);
  if (!s) throw new HttpError(404, "Review sample not found");
  s.verdict = body.verdict;
  s.notes = body.notes ?? null;
  s.reviewedAt = nowIso();
  saveDb();
  return toReviewDTO(s);
});

// -- settings -----------------------------------------------------------------
route("GET", "/api/settings/playbook", () => getDb().playbook);
route("POST", "/api/settings/playbook", ({ body }) => {
  const db = getDb();
  db.playbook = { ...db.playbook, ...body, updatedAt: nowIso() };
  saveDb();
  return db.playbook;
});

// -- demo control -------------------------------------------------------------
route("POST", "/demo/reset", () => {
  resetDemoDb();
  return { ok: true };
});

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

export async function mockFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const method = (options.method ?? "GET").toUpperCase();
  const url = new URL(endpoint, "http://demo.local");

  // Small, variable latency so loading states render as they would for real.
  await wait(120 + Math.random() * 180);

  try {
    tick();
    for (const [m, re, handler] of routes) {
      if (m !== method) continue;
      const match = url.pathname.match(re);
      if (!match) continue;
      // Only /auth/me reflects the login state; the operator layout uses it
      // to redirect to the login page. Data routes stay open so a page that
      // mounts during that redirect doesn't flash an error.
      const result = await handler({ params: match.slice(1).map(decodeURIComponent), query: url.searchParams, body: parseBody(options) });
      return result instanceof Response ? result : json(result);
    }
    return json({ error: `Demo mode: no fake handler for ${method} ${url.pathname}` }, 404);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error("[demo] handler error", error);
    return json({ error: error instanceof Error ? error.message : "Demo handler failed" }, 500);
  }
}
