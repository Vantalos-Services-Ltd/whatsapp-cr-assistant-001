/**
 * Demo data for the in-browser fake backend.
 *
 * Mirrors the cast in prisma/demo-seed.ts so the console looks the same with
 * or without a real database. All timestamps are relative to the moment the
 * data is first built. Phone numbers are in Ofcom's reserved drama range
 * (07700 900xxx) and cannot reach a real person.
 */

// ---------------------------------------------------------------------------
// record types (the fake "tables")
// ---------------------------------------------------------------------------

export type Risk = "LOW" | "MEDIUM" | "HIGH";

export interface MockCandidate {
  id: string;
  phone: string; // "whatsapp:+44..."
  name: string;
  trade: string;
  location: string;
  years: number;
  skills: string[];
  tickets: string[];
  payMin: number | null;
  payMax: number | null;
  availabilityNotes: string | null;
  lastSeenAt: string;
  lastContactedAt: string | null;
  createdAt: string;
  conversationId: string;
}

export interface MockConversation {
  id: string;
  candidateId: string;
  state: "ACTIVE" | "PAUSED_FOR_APPROVAL" | "PAUSED" | "CLOSED";
  pausedReason: string | null;
  lastMessageAt: string;
  progressStage: string;
  progressData: any;
  progressUpdatedAt: string;
  memoryPack: any;
  memoryUpdatedAt: string;
}

export interface MockMessage {
  id: string;
  conversationId: string;
  candidateId: string;
  direction: "INBOUND" | "OUTBOUND";
  senderRole: "HUMAN" | "AI" | "OPERATOR";
  text: string;
  createdAt: string;
  // Outbound messages created during the demo progress QUEUED → SENT →
  // DELIVERED → READ over a few seconds; seeded ones are already delivered.
  deliveryStatus: "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "SIMULATED";
  metadata?: any;
  linkedTaskId?: string | null;
}

export interface MockTask {
  id: string;
  type: "APPROVAL_REQUIRED" | "FOLLOW_UP" | "ESCALATION" | "OUTREACH" | "CSCS_VERIFICATION";
  status: "OPEN" | "APPROVED" | "REJECTED" | "DONE" | "FAILED";
  approvalStatus: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";
  candidateId: string | null;
  conversationId: string | null;
  relatedMessageId: string | null;
  createdAt: string;
  payload: any;
  proposedAction: any;
  priorityScore: number;
}

export interface MockTimelineEvent {
  id: string;
  conversationId: string;
  candidateId: string;
  type: string;
  actorRole: "SYSTEM" | "AI" | "OPERATOR";
  summary: string;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export interface MockJob {
  id: string;
  title: string;
  status: string;
  tradeRequired: string;
  startDate: string | null;
  durationWeeks: number | null;
  hoursPerDay: number | null;
  daysPerWeek: number | null;
  positionsOpen: number;
  positionsFilled: number;
  siteName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postcode: string | null;
  city: string | null;
  clientName: string | null;
  clientType: string | null;
  siteManagerName: string | null;
  siteManagerPhone: string | null;
  isPremiumClient: boolean;
  payRate: number | null;
  chargeRate: number | null;
  currency: string;
  requirementsJson: any;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MockMatch {
  jobId: string;
  candidateId: string;
  score: number;
  tier: "PROVEN" | "EXCELLENT" | "GOOD" | "WEAK";
  highlights: string[];
}

export interface MockPipelineItem {
  id: string;
  jobId: string;
  candidateId: string;
  stage: "SHORTLISTED" | "OFFER_SENT" | "START_CONFIRMED" | "NO_SHOW" | "DROPPED";
  notes: string | null;
  startDate: string | null;
  payRate: number | null;
  shiftInfo: string | null;
  noShowReason: any;
  droppedReason: any;
  createdAt: string;
  updatedAt: string;
}

export interface MockReviewSample {
  id: string;
  taskId: string;
  conversationId: string | null;
  candidateId: string | null;
  jobId: string | null;
  createdAt: string;
  sampledReason: "EDITED" | "HIGH_RISK" | "RANDOM";
  proposedText: string;
  finalText: string;
  verdict: "GOOD" | "NEEDS_IMPROVEMENT" | "UNSAFE" | null;
  reviewedAt: string | null;
  notes: string | null;
}

/** A candidate reply that will "arrive" a few seconds after an operator sends something. */
export interface MockScriptedReply {
  conversationId: string;
  text: string;
  draft: string | null; // next AI draft to queue for approval, if any
  draftRisk: Risk;
  intent: string;
  dueAt?: string; // set when armed
}

export interface MockDb {
  version: number;
  builtAt: string;
  seq: number;
  candidates: MockCandidate[];
  conversations: MockConversation[];
  messages: MockMessage[];
  tasks: MockTask[];
  timeline: MockTimelineEvent[];
  jobs: MockJob[];
  matches: MockMatch[];
  pipeline: MockPipelineItem[];
  reviewSamples: MockReviewSample[];
  playbook: any;
  earningsSettings: any | null;
  monthlyEarnings: Record<string, number>; // "YYYY-M" -> revenue
  createdOpportunityKeys: string[];
  scriptedReplies: MockScriptedReply[];
}

export const DB_VERSION = 1;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Placeholder CSCS card image, drawn inline so nothing is fetched. */
export const CSCS_CARD_IMAGE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
<rect width="640" height="400" rx="24" fill="#c9a227"/>
<rect x="24" y="24" width="592" height="70" rx="10" fill="#1f2937"/>
<text x="48" y="70" font-family="Arial, sans-serif" font-size="30" font-weight="bold" fill="#fff">CSCS</text>
<text x="150" y="70" font-family="Arial, sans-serif" font-size="20" fill="#fde68a">Gold Card — Advanced Craft</text>
<rect x="48" y="120" width="150" height="190" rx="8" fill="#e5e7eb"/>
<circle cx="123" cy="190" r="40" fill="#9ca3af"/>
<rect x="73" y="240" width="100" height="60" rx="30" fill="#9ca3af"/>
<text x="230" y="150" font-family="Arial, sans-serif" font-size="16" fill="#1f2937">Name</text>
<text x="230" y="178" font-family="Arial, sans-serif" font-size="24" font-weight="bold" fill="#111827">THOMAS ASHWORTH</text>
<text x="230" y="220" font-family="Arial, sans-serif" font-size="16" fill="#1f2937">Card number</text>
<text x="230" y="246" font-family="Arial, sans-serif" font-size="22" fill="#111827">JH 4471 9920</text>
<text x="230" y="288" font-family="Arial, sans-serif" font-size="16" fill="#1f2937">Expires</text>
<text x="230" y="314" font-family="Arial, sans-serif" font-size="22" fill="#111827">30/04/2028</text>
<text x="48" y="370" font-family="Arial, sans-serif" font-size="14" fill="#1f2937">DEMO IMAGE — NOT A REAL CARD</text>
</svg>`);

function explain(opts: {
  risk: Risk;
  rationale: string[];
  usedFacts: string[];
  uncertainty?: string | null;
  missingInfo?: string[];
  alternatives?: Array<{ action: string; reason: string }>;
  confidence?: number;
  at: string;
}) {
  return {
    riskLevel: opts.risk,
    rationale: opts.rationale.slice(0, 4),
    usedFacts: opts.usedFacts.slice(0, 8),
    uncertainty: opts.uncertainty ?? null,
    missingInfo: (opts.missingInfo ?? []).slice(0, 6),
    alternatives: (opts.alternatives ?? []).slice(0, 2),
    confidence: opts.confidence ?? 0.78,
    generatedBy: "AI" as const,
    generatedAt: opts.at,
  };
}

// ---------------------------------------------------------------------------
// the cast
// ---------------------------------------------------------------------------

type Beat = { dir: "IN" | "OUT"; text: string; hoursAgo: number; ai?: boolean; image?: boolean };

interface Persona {
  key: string;
  name: string;
  phone: string;
  trade: string;
  location: string;
  years: number;
  stage: string;
  skills: string[];
  tickets: string[];
  payMin?: number;
  payMax?: number;
  summary: string;
  goal: string;
  nextAction: string;
  missingFields: string[];
  openQuestions: string[];
  script: Beat[];
  lastSeenDaysAgo?: number;
}

const PEOPLE: Persona[] = [
  {
    key: "danny", name: "Danny Whelan", phone: "+447700900101", trade: "Bricklayer", location: "Manchester",
    years: 12, stage: "PROFILE_INCOMPLETE", skills: ["Blockwork", "Brickwork", "Pointing"], tickets: [],
    summary: "Experienced bricklayer in Manchester, 12 years. Availability not yet confirmed.",
    goal: "Find steady bricklaying work in the North West",
    nextAction: "Confirm availability and CSCS status",
    missingFields: ["availability", "tickets"],
    openQuestions: ["When are you free to start?", "Have you got a valid CSCS card?"],
    script: [
      { dir: "IN", text: "Hi mate, saw you had brickwork going", hoursAgo: 5 },
      { dir: "OUT", text: "Hey 👋 Yeah we've got a fair bit on. What trade you in?", hoursAgo: 4.9, ai: true },
      { dir: "IN", text: "Bricklayer, been doing it 12 years", hoursAgo: 4.6 },
      { dir: "OUT", text: "Brilliant, always need good brickies. What area you based in?", hoursAgo: 4.5, ai: true },
      { dir: "IN", text: "Manchester, south side. Free from next week", hoursAgo: 3.6 },
    ],
  },
  {
    key: "marek", name: "Marek Kowalski", phone: "+447700900102", trade: "Groundworker", location: "Liverpool",
    years: 8, stage: "MATCHED_TO_JOBS", skills: ["Drainage", "Kerbing", "Groundworks"], tickets: ["CSCS Blue"],
    payMin: 20, payMax: 24,
    summary: "Groundworker, Liverpool, 8 years. CSCS Blue held. Asking about day rate.",
    goal: "Move to a better-paid groundworks contract",
    nextAction: "Operator to confirm rate before replying",
    missingFields: [],
    openQuestions: ["What day rate are you looking for?"],
    script: [
      { dir: "IN", text: "Alright, looking for groundworks in Liverpool", hoursAgo: 30 },
      { dir: "OUT", text: "Hey 👋 We've got groundworks coming up. How many years you got?", hoursAgo: 29.9, ai: true },
      { dir: "IN", text: "8 years. Got my CSCS blue card too", hoursAgo: 29.4 },
      { dir: "OUT", text: "Perfect, that's what we need. Drainage and kerbing experience?", hoursAgo: 29.3, ai: true },
      { dir: "IN", text: "Yeah both. What's the day rate on it?", hoursAgo: 1.2 },
    ],
  },
  {
    key: "tom", name: "Tom Ashworth", phone: "+447700900103", trade: "Carpenter", location: "Leeds",
    years: 6, stage: "CSCS_VERIFICATION", skills: ["1st Fix", "2nd Fix", "Formwork"], tickets: ["CSCS Gold"],
    summary: "Carpenter, Leeds, 6 years. CSCS card photo received, awaiting verification.",
    goal: "Get on a long-term fit-out contract",
    nextAction: "Verify CSCS card details",
    missingFields: [],
    openQuestions: [],
    script: [
      { dir: "IN", text: "Hiya, after carpentry work around Leeds", hoursAgo: 52 },
      { dir: "OUT", text: "Hey 👋 What sort — 1st fix, 2nd fix, formwork?", hoursAgo: 51.9, ai: true },
      { dir: "IN", text: "All three really, 6 years in", hoursAgo: 51.2 },
      { dir: "OUT", text: "Sound. Can you send a photo of your CSCS card?", hoursAgo: 51.1, ai: true },
      { dir: "IN", text: "📷 Image received", hoursAgo: 3.5, image: true },
    ],
  },
  {
    key: "jason", name: "Jason Pike", phone: "+447700900104", trade: "Labourer", location: "Maidstone",
    years: 3, stage: "READY_TO_PLACE", skills: ["General labouring", "Traffic marshalling"], tickets: ["CSCS Green"],
    payMin: 14, payMax: 16,
    summary: "Labourer, Maidstone, 3 years, CSCS Green. Offer sent for Maidstone Residential.",
    goal: "Start on site as soon as possible",
    nextAction: "Awaiting response to offer",
    missingFields: [],
    openQuestions: ["Can you start Monday?"],
    script: [
      { dir: "IN", text: "Any labouring going in Maidstone?", hoursAgo: 74 },
      { dir: "OUT", text: "Yes mate, got a residential site. Got a CSCS card?", hoursAgo: 73.9, ai: true },
      { dir: "IN", text: "Green card yeah", hoursAgo: 73.1 },
      { dir: "OUT", text: "Perfect. I'll get you details over shortly.", hoursAgo: 20, ai: true },
    ],
  },
  {
    key: "errol", name: "Errol Barnes", phone: "+447700900105", trade: "Scaffolder", location: "Manchester",
    years: 15, stage: "PLACED", skills: ["Advanced scaffolding", "System scaffold"], tickets: ["CISRS Advanced"],
    payMin: 22, payMax: 26,
    summary: "Advanced scaffolder, 15 years, CISRS Advanced. Placed at Trafford Park, started this week.",
    goal: "Long-term scaffolding contract",
    nextAction: "Day-one aftercare check-in",
    missingFields: [],
    openQuestions: [],
    script: [
      { dir: "IN", text: "Looking for scaffolding work, CISRS advanced", hoursAgo: 200 },
      { dir: "OUT", text: "Great timing, got a Trafford Park job. 15 years experience?", hoursAgo: 199, ai: true },
      { dir: "IN", text: "Yeah 15 years", hoursAgo: 198 },
      { dir: "OUT", text: "You're all set — start Monday at Trafford Park, 7:30am. Bring your CISRS card and own PPE.", hoursAgo: 100 },
      { dir: "IN", text: "Started today, all good 👍", hoursAgo: 6 },
    ],
  },
  {
    key: "kieran", name: "Kieran Doyle", phone: "+447700900106", trade: "Plasterer", location: "Bolton",
    years: 9, stage: "DORMANT", skills: ["Skimming", "Rendering"], tickets: ["CSCS Blue"],
    lastSeenDaysAgo: 47,
    summary: "Plasterer, Bolton, 9 years. Went quiet 47 days ago — good match for urgent Salford job.",
    goal: "Local plastering work",
    nextAction: "Re-engage — matches urgent Salford Quays job",
    missingFields: ["availability"],
    openQuestions: ["Are you still looking?"],
    script: [
      { dir: "IN", text: "Do you have plastering work in Bolton?", hoursAgo: 47 * 24 },
      { dir: "OUT", text: "We do from time to time. How many years you got?", hoursAgo: 47 * 24 - 1, ai: true },
      { dir: "IN", text: "9 years, skimming and rendering", hoursAgo: 47 * 24 - 2 },
    ],
  },
  {
    key: "sam", name: "Sam Iqbal", phone: "+447700900107", trade: "Electrician", location: "Salford",
    years: 11, stage: "LOOKING_FOR_WORK", skills: ["Commercial", "Testing & Inspection"], tickets: ["JIB Gold", "18th Edition"],
    payMin: 26, payMax: 30,
    summary: "Commercial electrician, Salford, 11 years. JIB Gold and 18th Edition.",
    goal: "Commercial fit-out work close to home",
    nextAction: "Match to Salford Quays fit-out",
    missingFields: ["availability"],
    openQuestions: ["When can you start?"],
    script: [
      { dir: "IN", text: "Sparky here, any commercial work in Salford?", hoursAgo: 26 },
      { dir: "OUT", text: "Hey 👋 We've got a fit-out coming up. JIB carded?", hoursAgo: 25.9, ai: true },
      { dir: "IN", text: "JIB gold and 18th edition, 11 years", hoursAgo: 25.2 },
      { dir: "OUT", text: "Spot on. What's your availability looking like?", hoursAgo: 25.1 },
    ],
  },
  {
    key: "ricky", name: "Ricky Nunes", phone: "+447700900108", trade: "Plant Operator", location: "Warrington",
    years: 7, stage: "DOCS_NEEDED", skills: ["360 Excavator", "Dumper"], tickets: ["CPCS 360"],
    summary: "Plant operator, Warrington, 7 years, CPCS 360. Awaiting right-to-work documents.",
    goal: "Plant operating work in the North West",
    nextAction: "Chase right-to-work documents",
    missingFields: ["rightToWork"],
    openQuestions: ["Can you send your right to work documents?"],
    script: [
      { dir: "IN", text: "360 ticket, looking for work", hoursAgo: 40 },
      { dir: "OUT", text: "Nice. CPCS or NPORS? And what area you covering?", hoursAgo: 39.9, ai: true },
      { dir: "IN", text: "CPCS, Warrington way", hoursAgo: 39.2 },
      { dir: "OUT", text: "Got it. Can you send over your right to work docs?", hoursAgo: 12 },
    ],
  },
];

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

export function buildSeed(): MockDb {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const hoursAgo = (h: number) => iso(now - h * 3_600_000);
  const minsAgo = (m: number) => iso(now - m * 60_000);
  const daysAgo = (d: number) => iso(now - d * 86_400_000);
  const inDays = (d: number) => iso(now + d * 86_400_000);
  const nowIso = iso(now);

  let seq = 0;
  const id = (prefix: string) => `${prefix}_${(++seq).toString(36).padStart(4, "0")}`;

  const db: MockDb = {
    version: DB_VERSION,
    builtAt: nowIso,
    seq: 0,
    candidates: [],
    conversations: [],
    messages: [],
    tasks: [],
    timeline: [],
    jobs: [],
    matches: [],
    pipeline: [],
    reviewSamples: [],
    playbook: {
      toneStyle: "UK recruiter, friendly, direct",
      maxQuestionsPerMessage: 2,
      greetingStyle: "SHORT",
      forbiddenPhrases: ["we'll get back to you", "thank you for your interest"],
      requiredChecks: { confirmLocation: true, confirmAvailability: true, confirmTickets: true },
      escalationRules: { unknownIntentAlwaysApproval: true, salaryTalkRequiresApproval: true },
      signatureStyle: "NONE",
      createdAt: daysAgo(30),
      updatedAt: daysAgo(3),
    },
    earningsSettings: null,
    monthlyEarnings: {},
    createdOpportunityKeys: [],
    scriptedReplies: [],
  };

  // -- jobs -------------------------------------------------------------------
  const job = (j: Partial<MockJob> & Pick<MockJob, "title" | "status" | "tradeRequired">): MockJob => {
    const record: MockJob = {
      id: id("job"),
      startDate: null, durationWeeks: null, hoursPerDay: null, daysPerWeek: null,
      positionsOpen: 1, positionsFilled: 0, siteName: null, addressLine1: null, addressLine2: null,
      postcode: null, city: null, clientName: null, clientType: null, siteManagerName: null,
      siteManagerPhone: null, isPremiumClient: false, payRate: null, chargeRate: null,
      currency: "GBP", requirementsJson: null, notes: null,
      createdAt: daysAgo(10), updatedAt: daysAgo(1),
      ...j,
    };
    db.jobs.push(record);
    return record;
  };

  const jobMaidstone = job({
    title: "Maidstone Residential Development", status: "ACTIVE", tradeRequired: "Labourer",
    startDate: inDays(4), durationWeeks: 16, hoursPerDay: 9, daysPerWeek: 5, positionsOpen: 4, positionsFilled: 1,
    siteName: "Bearsted Green Phase 2", addressLine1: "Ashford Road", postcode: "ME14 5AA", city: "Maidstone",
    clientName: "Kentwood Homes", clientType: "Housebuilder", siteManagerName: "Paul Deakin",
    siteManagerPhone: "+447700900201", payRate: 15.5, chargeRate: 21.0,
    requirementsJson: { cscs: "Green or above", ppe: "Own boots and hat" },
    notes: "Steady 16-week programme. Client prefers local labour.",
  });
  const jobSalford = job({
    title: "Salford Quays Commercial Fit-Out", status: "URGENT", tradeRequired: "Electrician",
    startDate: inDays(2), durationWeeks: 10, hoursPerDay: 10, daysPerWeek: 5, positionsOpen: 6, positionsFilled: 1,
    siteName: "MediaCity Block C", addressLine1: "Broadway", postcode: "M50 2EQ", city: "Salford",
    clientName: "Northgate Construction", clientType: "Main Contractor", siteManagerName: "Lisa Trent",
    siteManagerPhone: "+447700900202", isPremiumClient: true, payRate: 28.0, chargeRate: 38.5,
    requirementsJson: { jib: "Gold", edition: "18th" },
    notes: "URGENT — client needs 5 more on site within the week. Premium rates.",
    updatedAt: hoursAgo(3),
  });
  const jobLiverpool = job({
    title: "Liverpool Waters Groundworks", status: "ACTIVE", tradeRequired: "Groundworker",
    startDate: inDays(9), durationWeeks: 22, hoursPerDay: 9, daysPerWeek: 5, positionsOpen: 3, positionsFilled: 0,
    siteName: "Central Docks Plot 4", addressLine1: "Regent Road", postcode: "L3 0AN", city: "Liverpool",
    clientName: "Merseybuild Ltd", clientType: "Main Contractor", siteManagerName: "Gary Naylor",
    siteManagerPhone: "+447700900203", payRate: 22.0, chargeRate: 29.5,
    requirementsJson: { cscs: "Blue or above" }, notes: "Drainage and kerbing focus.",
  });
  const jobTrafford = job({
    title: "Trafford Park Warehouse Extension", status: "ACTIVE", tradeRequired: "Scaffolder",
    startDate: daysAgo(1), durationWeeks: 8, hoursPerDay: 9, daysPerWeek: 5, positionsOpen: 2, positionsFilled: 1,
    siteName: "Europa Way Unit 7", postcode: "M17 1DA", city: "Manchester",
    clientName: "Halewood Industrial", clientType: "Main Contractor", payRate: 24.0, chargeRate: 32.0,
    requirementsJson: { cisrs: "Advanced" },
  });
  job({
    title: "Leeds Dock Office Refurbishment", status: "FILLED", tradeRequired: "Carpenter",
    startDate: daysAgo(20), durationWeeks: 6, hoursPerDay: 8, daysPerWeek: 5, positionsOpen: 2, positionsFilled: 2,
    siteName: "Armouries Way", postcode: "LS10 1LT", city: "Leeds", clientName: "Aire Interiors",
    clientType: "Fit-out Contractor", payRate: 21.0, chargeRate: 28.0,
    createdAt: daysAgo(35), updatedAt: daysAgo(18),
  });

  // -- people -----------------------------------------------------------------
  const byKey: Record<string, { candidate: MockCandidate; conversation: MockConversation; lastInboundId: string | null }> = {};

  for (const p of PEOPLE) {
    const candidateId = id("cand");
    const conversationId = id("conv");
    const lastBeat = p.script[p.script.length - 1];
    const lastOut = [...p.script].reverse().find((b) => b.dir === "OUT");

    const candidate: MockCandidate = {
      id: candidateId,
      phone: `whatsapp:${p.phone}`,
      name: p.name,
      trade: p.trade,
      location: p.location,
      years: p.years,
      skills: p.skills,
      tickets: p.tickets,
      payMin: p.payMin ?? null,
      payMax: p.payMax ?? null,
      availabilityNotes: p.missingFields.includes("availability") ? null : "Available now",
      lastSeenAt: hoursAgo(lastBeat.hoursAgo),
      lastContactedAt: lastOut ? hoursAgo(lastOut.hoursAgo) : null,
      createdAt: daysAgo(p.lastSeenDaysAgo ?? 5),
      conversationId,
    };

    const conversation: MockConversation = {
      id: conversationId,
      candidateId,
      state: p.stage === "MATCHED_TO_JOBS" ? "PAUSED_FOR_APPROVAL" : "ACTIVE",
      pausedReason: p.stage === "MATCHED_TO_JOBS" ? "Candidate asked about day rate — needs operator approval" : null,
      lastMessageAt: hoursAgo(lastBeat.hoursAgo),
      progressStage: p.stage,
      progressUpdatedAt: hoursAgo(4),
      progressData: {
        missingFields: p.missingFields,
        nextAction: p.nextAction,
        followUpAt: p.stage === "DORMANT" ? null : inDays(2),
        lastDecision: { at: hoursAgo(4), by: "SYSTEM", reason: "Stage computed from profile completeness" },
        flags: { waitingForOperator: p.stage === "MATCHED_TO_JOBS", highPriority: p.stage === "MATCHED_TO_JOBS" },
        confidence: 82,
      },
      memoryPack: {
        summary: p.summary,
        facts: {
          trade: p.trade,
          location: p.location,
          availability: p.missingFields.includes("availability") ? null : "Available now",
          salary: p.payMin ? { min: p.payMin, max: p.payMax, currency: "GBP" } : null,
          skills: p.skills,
          tickets: p.tickets,
          preferredAreas: [p.location],
          transport: "Own transport",
          startDate: null,
          lastClient: null,
        },
        goal: p.goal,
        openQuestions: p.openQuestions,
        structuredOpenQuestions: [],
        lastJobDiscussed: null,
        nextAction: p.nextAction,
        lastUpdatedAt: hoursAgo(4),
        version: 3,
      },
      memoryUpdatedAt: hoursAgo(4),
    };

    db.candidates.push(candidate);
    db.conversations.push(conversation);

    let lastInboundId: string | null = null;
    for (const beat of p.script) {
      const messageId = id("msg");
      const createdAt = hoursAgo(beat.hoursAgo);
      db.messages.push({
        id: messageId,
        conversationId,
        candidateId,
        direction: beat.dir === "IN" ? "INBOUND" : "OUTBOUND",
        senderRole: beat.dir === "IN" ? "HUMAN" : beat.ai ? "AI" : "OPERATOR",
        text: beat.text,
        createdAt,
        deliveryStatus: beat.dir === "IN" ? "SENT" : "READ",
        metadata: beat.image
          ? {
              media: [{
                sid: `ME${messageId}`, url: CSCS_CARD_IMAGE, contentType: "image/svg+xml",
                kind: "image", sizeBytes: 182_000, durationSeconds: null, receivedAt: createdAt,
              }],
              transcript: null,
              textForAI: null,
            }
          : undefined,
      });
      if (beat.dir === "IN") lastInboundId = messageId;

      db.timeline.push({
        id: id("evt"),
        conversationId,
        candidateId,
        type: beat.dir === "IN" ? (beat.image ? "MEDIA_RECEIVED" : "INBOUND_MESSAGE_RECEIVED") : "OUTREACH_SENT",
        actorRole: beat.dir === "IN" ? "SYSTEM" : beat.ai ? "AI" : "OPERATOR",
        summary: (beat.dir === "IN" ? "Inbound: " : "Sent: ") + beat.text.slice(0, 150),
        data: { messageId, messageSnippet: beat.text.slice(0, 100) },
        createdAt,
      });
    }

    db.timeline.push({
      id: id("evt"),
      conversationId,
      candidateId,
      type: "MEMORY_PACK_UPDATED",
      actorRole: "AI",
      summary: "Memory updated from latest messages",
      data: { memoryPackVersion: 3 },
      createdAt: hoursAgo(4.05),
    });
    db.timeline.push({
      id: id("evt"),
      conversationId,
      candidateId,
      type: "PROGRESS_STAGE_CHANGED",
      actorRole: "SYSTEM",
      summary: `Progress stage set to ${p.stage.replace(/_/g, " ").toLowerCase()}`,
      data: { newStage: p.stage, nextAction: p.nextAction },
      createdAt: hoursAgo(4),
    });

    byKey[p.key] = { candidate, conversation, lastInboundId };
  }

  // -- matches ----------------------------------------------------------------
  const match = (key: string, j: MockJob, score: number, tier: MockMatch["tier"], highlights: string[]) =>
    db.matches.push({ jobId: j.id, candidateId: byKey[key].candidate.id, score, tier, highlights });

  match("sam", jobSalford, 94, "EXCELLENT", ["JIB Gold matches requirement", "18th Edition current", "Lives 3 miles from site"]);
  match("kieran", jobSalford, 61, "GOOD", ["Available in region", "Dormant 47 days — re-engagement candidate"]);
  match("danny", jobSalford, 38, "WEAK", ["Based in Manchester", "Different trade — brickwork not electrical"]);
  match("marek", jobLiverpool, 91, "EXCELLENT", ["Drainage and kerbing experience", "CSCS Blue held", "Based in Liverpool"]);
  match("ricky", jobLiverpool, 72, "GOOD", ["CPCS 360 — useful on groundworks", "Warrington, 20 miles from site"]);
  match("jason", jobMaidstone, 88, "EXCELLENT", ["CSCS Green held", "Local to Maidstone", "Available immediately"]);
  match("tom", jobMaidstone, 55, "WEAK", ["Different trade — carpentry not labouring"]);
  match("errol", jobTrafford, 96, "PROVEN", ["CISRS Advanced", "15 years experience", "Previously placed successfully"]);

  // -- pipeline ---------------------------------------------------------------
  const pipe = (key: string, j: MockJob, item: Partial<MockPipelineItem> & Pick<MockPipelineItem, "stage">, hrs: number) =>
    db.pipeline.push({
      id: id("pipe"), jobId: j.id, candidateId: byKey[key].candidate.id,
      notes: null, startDate: null, payRate: null, shiftInfo: null, noShowReason: null, droppedReason: null,
      createdAt: hoursAgo(hrs + 24), updatedAt: hoursAgo(hrs), ...item,
    });

  pipe("jason", jobMaidstone, { stage: "OFFER_SENT", notes: "Offer sent, awaiting confirmation.", payRate: 15.5, shiftInfo: "7:30am start, 9hr days" }, 20);
  pipe("errol", jobTrafford, { stage: "START_CONFIRMED", notes: "Started Monday, all good.", startDate: daysAgo(1), payRate: 24.0, shiftInfo: "7:30am start" }, 30);
  pipe("sam", jobSalford, { stage: "SHORTLISTED", notes: "Strong match — awaiting availability." }, 25);
  pipe("marek", jobLiverpool, { stage: "SHORTLISTED", notes: "Asking about rate before proceeding." }, 2);

  // -- tasks ------------------------------------------------------------------
  const task = (t: Partial<MockTask> & Pick<MockTask, "type" | "status" | "approvalStatus">): MockTask => {
    const record: MockTask = {
      id: id("task"), candidateId: null, conversationId: null, relatedMessageId: null,
      createdAt: nowIso, payload: {}, proposedAction: null, priorityScore: 50, ...t,
    };
    db.tasks.push(record);
    return record;
  };

  // 1. Rate question — the headline task
  const marek = byKey.marek;
  const marekMsg = "Rates on that one depend on the shift pattern — let me confirm with the site and come straight back to you. You after weekdays only or weekends too?";
  task({
    type: "APPROVAL_REQUIRED", status: "OPEN", approvalStatus: "PENDING",
    candidateId: marek.candidate.id, conversationId: marek.conversation.id, relatedMessageId: marek.lastInboundId,
    createdAt: minsAgo(70), priorityScore: 92,
    payload: {
      conversationId: marek.conversation.id, contactPhone: marek.candidate.phone, intent: "JOB_QUERY",
      pendingReplyText: marekMsg, lastMessageText: "Yeah both. What's the day rate on it?",
      approvalReason: "Candidate asked about day rate — pay figures require operator approval",
      jobSnapshot: { jobId: jobLiverpool.id, title: jobLiverpool.title, payRate: 22.0, chargeRate: 29.5 },
    },
    proposedAction: {
      actionType: "SEND_MESSAGE", suggestedMessage: marekMsg, riskLevel: "HIGH",
      reasoning: "Candidate asked a direct pay question. Policy requires operator approval before any rate is discussed.",
      explainability: explain({
        risk: "HIGH", at: minsAgo(70), confidence: 0.86,
        rationale: ["Candidate asked directly about day rate", "Playbook escalation rule: salary/rate figures require approval", "Draft deliberately avoids quoting a number"],
        usedFacts: ["Trade: Groundworker", "Location: Liverpool", "8 years experience", "CSCS Blue held", "Matched to Liverpool Waters (score 91)"],
        uncertainty: "Shift pattern unknown — affects which rate band applies",
        missingInfo: ["Preferred shift pattern", "Weekend availability"],
        alternatives: [
          { action: "Escalate", reason: "Hand straight to operator without a draft" },
          { action: "Ask for more info", reason: "Ask about shift pattern before mentioning rates at all" },
        ],
      }),
    },
  });

  // 2. Availability — low risk
  const danny = byKey.danny;
  const dannyMsg = "Nice one 👍 Got a couple of brickwork packages starting soon. Have you got a valid CSCS card?";
  task({
    type: "APPROVAL_REQUIRED", status: "OPEN", approvalStatus: "PENDING",
    candidateId: danny.candidate.id, conversationId: danny.conversation.id, relatedMessageId: danny.lastInboundId,
    createdAt: minsAgo(215), priorityScore: 61,
    payload: {
      conversationId: danny.conversation.id, contactPhone: danny.candidate.phone, intent: "LOOKING_FOR_WORK",
      pendingReplyText: dannyMsg, lastMessageText: "Manchester, south side. Free from next week",
      approvalReason: "Agency policy: every reply needs approval",
    },
    proposedAction: {
      actionType: "SEND_MESSAGE", suggestedMessage: dannyMsg, riskLevel: "LOW",
      reasoning: "Profile is incomplete; CSCS status is the next required field.",
      explainability: explain({
        risk: "LOW", at: minsAgo(215), confidence: 0.91,
        rationale: ["Trade and location already captured", "CSCS status is the next required check", "No commercial terms discussed"],
        usedFacts: ["Trade: Bricklayer", "Location: Manchester", "12 years experience", "Free from next week"],
        missingInfo: ["CSCS card status"],
        alternatives: [{ action: "Ask for more info", reason: "Ask for exact start date first instead" }],
      }),
    },
  });

  // 3. CSCS verification
  const tom = byKey.tom;
  task({
    type: "CSCS_VERIFICATION", status: "OPEN", approvalStatus: "PENDING",
    candidateId: tom.candidate.id, conversationId: tom.conversation.id, relatedMessageId: tom.lastInboundId,
    createdAt: hoursAgo(3.4), priorityScore: 70,
    payload: {
      conversationId: tom.conversation.id,
      candidate: {
        candidateId: tom.candidate.id, name: tom.candidate.name, phone: tom.candidate.phone,
        desiredRole: "Carpenter", location: "Leeds", availabilityNotes: "Available now",
      },
      job: {
        jobId: jobMaidstone.id, title: jobMaidstone.title, status: jobMaidstone.status,
        clientName: jobMaidstone.clientName ?? undefined, siteName: jobMaidstone.siteName ?? undefined,
        city: jobMaidstone.city ?? undefined, postcode: jobMaidstone.postcode ?? undefined,
        startDate: jobMaidstone.startDate ?? undefined, durationWeeks: 16, payRate: 15.5, chargeRate: 21,
        currency: "GBP", marginPerHour: 5.5, weeklyMargin: 247.5, projectMargin: 3960,
      },
      cscs: {
        imageUrl: CSCS_CARD_IMAGE, source: "WHATSAPP", uploadedAt: hoursAgo(3.5),
        extracted: { holderName: "THOMAS ASHWORTH", cardType: "Gold — Advanced Craft", expiryDate: "2028-04-30", cardNumber: "JH 4471 9920" },
        checks: {
          nameMatch: { ok: true, value: "THOMAS ASHWORTH ≈ Tom Ashworth" },
          expiryValid: { ok: true, value: "2028-04-30" },
          requiredLevel: { ok: true, value: "Gold meets Green or above" },
          overall: "VALID",
          issues: [],
        },
        autoVerified: true,
        autoVerifiedAt: hoursAgo(3.4),
      },
      nextSteps: {
        approveText: "Great news Tom — your CSCS card checks out. I'll send over site details shortly.",
        rejectText: "Hi Tom, we couldn't verify your CSCS card from that photo. Could you send a clearer one?",
      },
    },
    proposedAction: {
      actionType: "REQUEST_INFO", riskLevel: "MEDIUM",
      explainability: explain({
        risk: "MEDIUM", at: hoursAgo(3.4), confidence: 0.93,
        rationale: ["Card image read with 93% confidence", "Name matches candidate record", "Expiry 2028 — valid"],
        usedFacts: ["Trade: Carpenter", "Location: Leeds", "Card: Gold Advanced Craft", "Expires 2028-04-30"],
        uncertainty: "Card number partially obscured by glare in bottom-right",
        missingInfo: ["Second form of ID"],
      }),
    },
  });

  // 4. Follow-up on an unanswered offer
  const jason = byKey.jason;
  const jasonMsg = "Hi Jason, just checking you got the Maidstone details? Start is Monday, 7:30am. Let me know if you're in 👍";
  task({
    type: "FOLLOW_UP", status: "OPEN", approvalStatus: "NOT_REQUIRED",
    candidateId: jason.candidate.id, conversationId: jason.conversation.id,
    createdAt: hoursAgo(20), priorityScore: 74,
    payload: {
      conversationId: jason.conversation.id, contactPhone: jason.candidate.phone,
      reason: "Offer sent 20 hours ago with no response", suggestedMessage: jasonMsg,
      jobId: jobMaidstone.id, jobTitle: jobMaidstone.title,
    },
    proposedAction: { actionType: "SEND_MESSAGE", suggestedMessage: jasonMsg, riskLevel: "LOW" },
  });

  // 5. Outreach — dormant candidate matched to urgent job
  const kieran = byKey.kieran;
  const kieranMsg = "Hi Kieran, it's Vantalos — we've got a plastering package starting in Salford this week. You still looking?";
  task({
    type: "OUTREACH", status: "OPEN", approvalStatus: "PENDING",
    candidateId: kieran.candidate.id, conversationId: kieran.conversation.id,
    createdAt: minsAgo(95), priorityScore: 80,
    payload: {
      conversationId: kieran.conversation.id, contactPhone: kieran.candidate.phone,
      pendingReplyText: kieranMsg, opportunityType: "DORMANT_CANDIDATES_MATCH_URGENT_JOB",
      reasons: ["Dormant 47 days — matches urgent Salford Quays job"],
      jobId: jobSalford.id, jobTitle: jobSalford.title,
    },
    proposedAction: {
      actionType: "SEND_MESSAGE", suggestedMessage: kieranMsg, riskLevel: "MEDIUM",
      explainability: explain({
        risk: "MEDIUM", at: minsAgo(95), confidence: 0.71,
        rationale: ["Salford Quays is URGENT and 5 positions short", "Candidate dormant 47 days", "Trade and region both match"],
        usedFacts: ["Trade: Plasterer", "Location: Bolton", "Last contact 47 days ago", "Job status: URGENT"],
        uncertainty: "Candidate may have found work elsewhere in the interim",
        missingInfo: ["Current availability"],
        alternatives: [{ action: "No action", reason: "Leave dormant candidates undisturbed" }],
      }),
    },
  });

  // 6. Aftercare check-in
  const errol = byKey.errol;
  const errolMsg = "Glad to hear it Errol 👍 Anything you need on site, just shout. I'll check in again Friday.";
  task({
    type: "FOLLOW_UP", status: "OPEN", approvalStatus: "NOT_REQUIRED",
    candidateId: errol.candidate.id, conversationId: errol.conversation.id,
    createdAt: hoursAgo(8), priorityScore: 55,
    payload: {
      conversationId: errol.conversation.id, contactPhone: errol.candidate.phone,
      reason: "Day-one aftercare check-in", opportunityType: "DAY1_AFTERCARE_CHECKIN",
      reasons: ["Started at Trafford Park today"], suggestedMessage: errolMsg,
      jobId: jobTrafford.id, jobTitle: jobTrafford.title,
    },
    proposedAction: { actionType: "SEND_MESSAGE", suggestedMessage: errolMsg, riskLevel: "LOW" },
  });

  // 7-10. Completed tasks (history + review samples)
  const completed = [
    { key: "errol", proposed: "You're all set — start Monday at Trafford Park, 7:30am.", final: "You're all set — start Monday at Trafford Park, 7:30am. Bring your CISRS card and own PPE.", edited: true, hrs: 100, job: jobTrafford },
    { key: "jason", proposed: "Perfect. I'll get you details over shortly.", final: "Perfect. I'll get you details over shortly.", edited: false, hrs: 20, job: jobMaidstone },
    { key: "sam", proposed: "Spot on. What's your availability looking like?", final: "Spot on. What's your availability looking like?", edited: false, hrs: 25.1, job: jobSalford },
    { key: "ricky", proposed: "Got it. Can you send over your right to work docs? Need them before Friday or you lose the slot.", final: "Got it. Can you send over your right to work docs?", edited: true, hrs: 12, job: jobLiverpool },
  ];
  for (const c of completed) {
    const who = byKey[c.key];
    const t = task({
      type: "APPROVAL_REQUIRED", status: "APPROVED", approvalStatus: "APPROVED",
      candidateId: who.candidate.id, conversationId: who.conversation.id,
      createdAt: hoursAgo(c.hrs + 0.5), priorityScore: 40,
      payload: {
        conversationId: who.conversation.id, contactPhone: who.candidate.phone, intent: "FOLLOW_UP",
        proposedMessageText: c.proposed, approvedMessageText: c.final, wasEdited: c.edited,
        editSummary: c.edited ? "Operator edited the draft before sending" : "Sent unchanged",
        approvedAt: hoursAgo(c.hrs),
      },
      proposedAction: {
        actionType: "SEND_MESSAGE", suggestedMessage: c.proposed, riskLevel: "LOW",
        explainability: explain({ risk: "LOW", at: hoursAgo(c.hrs + 0.5), rationale: ["Routine next step"], usedFacts: ["Conversation context"], confidence: 0.88 }),
      },
    });
    db.reviewSamples.push({
      id: id("rev"), taskId: t.id, conversationId: who.conversation.id, candidateId: who.candidate.id,
      jobId: c.job.id, createdAt: hoursAgo(c.hrs - 0.2), sampledReason: c.edited ? "EDITED" : "RANDOM",
      proposedText: c.proposed, finalText: c.final,
      verdict: c.key === "errol" ? "NEEDS_IMPROVEMENT" : null,
      reviewedAt: c.key === "errol" ? hoursAgo(c.hrs - 2) : null,
      notes: c.key === "errol" ? "Draft omitted PPE requirements — should be standard for first-day messages." : null,
    });
  }

  // A rejected one, for the tasks history filter
  task({
    type: "APPROVAL_REQUIRED", status: "REJECTED", approvalStatus: "REJECTED",
    candidateId: byKey.ricky.candidate.id, conversationId: byKey.ricky.conversation.id,
    createdAt: hoursAgo(38), priorityScore: 30,
    payload: {
      conversationId: byKey.ricky.conversation.id, contactPhone: byKey.ricky.candidate.phone, intent: "JOB_QUERY",
      rejectionReason: "Quoted a rate before the client confirmed it",
    },
    proposedAction: { actionType: "SEND_MESSAGE", suggestedMessage: "The Liverpool job pays £24/hr, can you start Monday?", riskLevel: "HIGH" },
  });

  // -- extra timeline events for pending tasks --------------------------------
  for (const t of db.tasks.filter((x) => x.status === "OPEN" && x.conversationId)) {
    db.timeline.push({
      id: id("evt"), conversationId: t.conversationId!, candidateId: t.candidateId!,
      type: t.type === "CSCS_VERIFICATION" ? "CSCS_AUTO_VERIFIED" : "AI_SUGGESTION_CREATED",
      actorRole: "AI",
      summary: t.type === "CSCS_VERIFICATION" ? "CSCS card read automatically — looks valid" : "AI drafted a reply for approval",
      data: { taskId: t.id, taskType: t.type },
      createdAt: t.createdAt,
    });
  }

  // -- scripted replies (make the demo feel alive) ----------------------------
  db.scriptedReplies = [
    {
      conversationId: marek.conversation.id,
      text: "Weekdays only mate. If it's over £22 an hour I'm in",
      draft: "Sound — weekdays it is. Rate's £22/hr on this one, 9 hour days, starting in about a week. Want me to put you forward?",
      draftRisk: "HIGH", intent: "JOB_QUERY",
    },
    {
      conversationId: danny.conversation.id,
      text: "Yeah got my blue card, in date till 2027",
      draft: "Perfect 👍 Can you send a quick photo of it so we can get you on the books?",
      draftRisk: "LOW", intent: "AVAILABILITY_UPDATE",
    },
    {
      conversationId: kieran.conversation.id,
      text: "Yeah still looking actually! Whereabouts in Salford?",
      draft: "MediaCity, Block C — 10 week job, starts this week. Are you free from Wednesday?",
      draftRisk: "MEDIUM", intent: "JOB_QUERY",
    },
    {
      conversationId: jason.conversation.id,
      text: "Yeah sorry mate, I'm in. See you Monday",
      draft: null, draftRisk: "LOW", intent: "AVAILABILITY_UPDATE",
    },
    {
      conversationId: errol.conversation.id,
      text: "Cheers 👍",
      draft: null, draftRisk: "LOW", intent: "FOLLOW_UP",
    },
  ];

  // -- earnings ---------------------------------------------------------------
  db.earningsSettings = {
    basePayMonthly: 3200,
    currency: "GBP",
    commissionBrackets: [
      { minRevenue: 0, maxRevenue: 15000, ratePct: 5 },
      { minRevenue: 15000, maxRevenue: 30000, ratePct: 8 },
      { minRevenue: 30000, maxRevenue: 50000, ratePct: 12 },
      { minRevenue: 50000, maxRevenue: null, ratePct: 15 },
    ],
  };
  const d = new Date(now);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  db.monthlyEarnings[`${y}-${m}`] = 27450;
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  db.monthlyEarnings[`${prev.y}-${prev.m}`] = 41200;

  db.seq = seq;
  return db;
}
