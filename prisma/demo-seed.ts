/**
 * DEMO SEED
 * ---------
 * Populates the database with a realistic, self-consistent agency so that every
 * screen in the operator console has something meaningful to show.
 *
 * Safe to re-run: it clears previous demo data first (identified by the demo
 * agency) and rebuilds from scratch.
 *
 * Run with:  pnpm demo:seed
 *
 * Phone numbers use Ofcom's reserved drama/test range (07700 900xxx) so they
 * can never reach a real person.
 */

import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

dotenv.config();

const prisma = new PrismaClient();

const AGENCY_NAME = "Vantalos Demo Agency";
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "admin123";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const hoursAgo = (n: number) => new Date(now.getTime() - n * 3_600_000);
const minsAgo = (n: number) => new Date(now.getTime() - n * 60_000);
const inDays = (n: number) => new Date(now.getTime() + n * 86_400_000);

function explain(opts: {
  risk: "LOW" | "MEDIUM" | "HIGH";
  rationale: string[];
  usedFacts: string[];
  uncertainty?: string | null;
  missingInfo?: string[];
  alternatives?: Array<{ action: string; reason: string }>;
  source?: "AI" | "RULES";
  confidence?: number;
}) {
  return {
    riskLevel: opts.risk,
    rationale: opts.rationale.slice(0, 4),
    usedFacts: opts.usedFacts.slice(0, 8),
    uncertainty: opts.uncertainty ?? null,
    missingInfo: (opts.missingInfo ?? []).slice(0, 6),
    alternatives: (opts.alternatives ?? []).slice(0, 2),
    confidence: opts.confidence ?? 0.78,
    source: opts.source ?? "AI",
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// the cast
// ---------------------------------------------------------------------------

type Beat = { dir: "IN" | "OUT"; text: string; hoursAgo: number; ai?: boolean };

interface Persona {
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
    name: "Danny Whelan",
    phone: "+447700900101",
    trade: "Bricklayer",
    location: "Manchester",
    years: 12,
    stage: "PROFILE_INCOMPLETE",
    skills: ["Blockwork", "Brickwork", "Pointing"],
    tickets: [],
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
      { dir: "IN", text: "Manchester, south side", hoursAgo: 4.1 },
      { dir: "OUT", text: "Nice one. When you free to start?", hoursAgo: 4.0, ai: true },
    ],
  },
  {
    name: "Marek Kowalski",
    phone: "+447700900102",
    trade: "Groundworker",
    location: "Liverpool",
    years: 8,
    stage: "MATCHED_TO_JOBS",
    skills: ["Drainage", "Kerbing", "Groundworks"],
    tickets: ["CSCS Blue"],
    payMin: 20,
    payMax: 24,
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
    name: "Tom Ashworth",
    phone: "+447700900103",
    trade: "Carpenter",
    location: "Leeds",
    years: 6,
    stage: "CSCS_VERIFICATION",
    skills: ["1st Fix", "2nd Fix", "Formwork"],
    tickets: ["CSCS Gold"],
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
      { dir: "IN", text: "📷 Image received", hoursAgo: 3.5 },
    ],
  },
  {
    name: "Jason Pike",
    phone: "+447700900104",
    trade: "Labourer",
    location: "Maidstone",
    years: 3,
    stage: "READY_TO_PLACE",
    skills: ["General labouring", "Traffic marshalling"],
    tickets: ["CSCS Green"],
    payMin: 14,
    payMax: 16,
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
    name: "Errol Barnes",
    phone: "+447700900105",
    trade: "Scaffolder",
    location: "Manchester",
    years: 15,
    stage: "PLACED",
    skills: ["Advanced scaffolding", "System scaffold"],
    tickets: ["CISRS Advanced"],
    payMin: 22,
    payMax: 26,
    summary: "Advanced scaffolder, 15 years, CISRS Advanced. Placed at Salford Quays, started this week.",
    goal: "Long-term scaffolding contract",
    nextAction: "Day-one aftercare check-in",
    missingFields: [],
    openQuestions: [],
    script: [
      { dir: "IN", text: "Looking for scaffolding work, CISRS advanced", hoursAgo: 200 },
      { dir: "OUT", text: "Great timing, got a Salford job. 15 years experience?", hoursAgo: 199, ai: true },
      { dir: "IN", text: "Yeah 15 years", hoursAgo: 198 },
      { dir: "OUT", text: "You're all set — start Monday at Salford Quays, 7:30am.", hoursAgo: 100, ai: true },
      { dir: "IN", text: "Started today, all good 👍", hoursAgo: 6 },
    ],
  },
  {
    name: "Kieran Doyle",
    phone: "+447700900106",
    trade: "Plasterer",
    location: "Bolton",
    years: 9,
    stage: "DORMANT",
    skills: ["Skimming", "Rendering"],
    tickets: ["CSCS Blue"],
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
    name: "Sam Iqbal",
    phone: "+447700900107",
    trade: "Electrician",
    location: "Salford",
    years: 11,
    stage: "LOOKING_FOR_WORK",
    skills: ["Commercial", "Testing & Inspection"],
    tickets: ["JIB Gold", "18th Edition"],
    payMin: 26,
    payMax: 30,
    summary: "Commercial electrician, Salford, 11 years. JIB Gold and 18th Edition.",
    goal: "Commercial fit-out work close to home",
    nextAction: "Match to Salford Quays fit-out",
    missingFields: ["availability"],
    openQuestions: ["When can you start?"],
    script: [
      { dir: "IN", text: "Sparky here, any commercial work in Salford?", hoursAgo: 26 },
      { dir: "OUT", text: "Hey 👋 We've got a fit-out coming up. JIB carded?", hoursAgo: 25.9, ai: true },
      { dir: "IN", text: "JIB gold and 18th edition, 11 years", hoursAgo: 25.2 },
      { dir: "OUT", text: "Spot on. What's your availability looking like?", hoursAgo: 25.1, ai: true },
    ],
  },
  {
    name: "Ricky Nunes",
    phone: "+447700900108",
    trade: "Plant Operator",
    location: "Warrington",
    years: 7,
    stage: "DOCS_NEEDED",
    skills: ["360 Excavator", "Dumper"],
    tickets: ["CPCS 360"],
    summary: "Plant operator, Warrington, 7 years, CPCS 360. Awaiting right-to-work documents.",
    goal: "Plant operating work in the North West",
    nextAction: "Chase right-to-work documents",
    missingFields: ["rightToWork"],
    openQuestions: ["Can you send your right to work documents?"],
    script: [
      { dir: "IN", text: "360 ticket, looking for work", hoursAgo: 40 },
      { dir: "OUT", text: "Nice. CPCS or NPORS? And what area you covering?", hoursAgo: 39.9, ai: true },
      { dir: "IN", text: "CPCS, Warrington way", hoursAgo: 39.2 },
      { dir: "OUT", text: "Got it. Can you send over your right to work docs?", hoursAgo: 12, ai: true },
    ],
  },
];

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n🌱 Building demo environment...\n");

  // -- agency ---------------------------------------------------------------
  let agency = await prisma.agency.findFirst({ where: { name: AGENCY_NAME } });
  if (!agency) {
    agency = await prisma.agency.create({
      data: { name: AGENCY_NAME, messagingMode: "APPROVAL_ONLY" },
    });
  }
  const agencyId = agency.id;

  // -- wipe previous demo data (child-first) --------------------------------
  console.log("   clearing previous demo data...");
  await prisma.messageReviewSample.deleteMany({ where: { agencyId } });
  await prisma.opportunityActionLog.deleteMany({ where: { agencyId } });
  await prisma.timelineEvent.deleteMany({ where: { agencyId } });
  await prisma.task.deleteMany({ where: { agencyId } });
  await prisma.jobPipelineItem.deleteMany({ where: { agencyId } });
  await prisma.placement.deleteMany({ where: { agencyId } });
  await prisma.jobCandidateMatch.deleteMany({ where: { agencyId } });
  await prisma.message.deleteMany({ where: { agencyId } });
  await prisma.candidate.updateMany({ where: { agencyId }, data: { lastConversationId: null } });
  await prisma.conversation.deleteMany({ where: { agencyId } });
  await prisma.candidate.deleteMany({ where: { agencyId } });
  await prisma.contact.deleteMany({ where: { agencyId } });
  await prisma.job.deleteMany({ where: { agencyId } });
  await prisma.monthlyEarnings.deleteMany({ where: { agencyId } });
  await prisma.earningsSettings.deleteMany({ where: { agencyId } });

  // -- operator -------------------------------------------------------------
  const operator = await prisma.operator.upsert({
    where: { email: ADMIN_EMAIL },
    update: { passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10) },
    create: { email: ADMIN_EMAIL, passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 10) },
  });

  // -- playbook -------------------------------------------------------------
  await prisma.agencyPlaybook.upsert({
    where: { agencyId },
    update: {},
    create: {
      agencyId,
      toneStyle: "UK recruiter, friendly, direct",
      maxQuestionsPerMessage: 2,
      greetingStyle: "SHORT",
      forbiddenPhrases: ["we'll get back to you", "thank you for your interest"],
      requiredChecks: { cscs: true, rightToWork: true },
      escalationRules: { salary: true, offers: true, startDates: true },
      signatureStyle: "NONE",
    },
  });

  // -- jobs -----------------------------------------------------------------
  console.log("   creating jobs...");
  const jobMaidstone = await prisma.job.create({
    data: {
      agencyId, title: "Maidstone Residential Development", status: "ACTIVE",
      tradeRequired: "Labourer", startDate: inDays(4), durationWeeks: 16,
      hoursPerDay: 9, daysPerWeek: 5, positionsOpen: 4, positionsFilled: 1,
      siteName: "Bearsted Green Phase 2", addressLine1: "Ashford Road",
      postcode: "ME14 5AA", city: "Maidstone", clientName: "Kentwood Homes",
      clientType: "Housebuilder", siteManagerName: "Paul Deakin",
      siteManagerPhone: "+447700900201", isPremiumClient: false,
      payRate: 15.5, chargeRate: 21.0, currency: "GBP",
      requirementsJson: { cscs: "Green or above", ppe: "Own boots and hat" },
      notes: "Steady 16-week programme. Client prefers local labour.",
    },
  });

  const jobSalford = await prisma.job.create({
    data: {
      agencyId, title: "Salford Quays Commercial Fit-Out", status: "URGENT",
      tradeRequired: "Electrician", startDate: inDays(2), durationWeeks: 10,
      hoursPerDay: 10, daysPerWeek: 5, positionsOpen: 6, positionsFilled: 1,
      siteName: "MediaCity Block C", addressLine1: "Broadway",
      postcode: "M50 2EQ", city: "Salford", clientName: "Northgate Construction",
      clientType: "Main Contractor", siteManagerName: "Lisa Trent",
      siteManagerPhone: "+447700900202", isPremiumClient: true,
      payRate: 28.0, chargeRate: 38.5, currency: "GBP",
      requirementsJson: { jib: "Gold", edition: "18th" },
      notes: "URGENT — client needs 5 more on site within the week. Premium rates.",
    },
  });

  const jobLiverpool = await prisma.job.create({
    data: {
      agencyId, title: "Liverpool Waters Groundworks", status: "ACTIVE",
      tradeRequired: "Groundworker", startDate: inDays(9), durationWeeks: 22,
      hoursPerDay: 9, daysPerWeek: 5, positionsOpen: 3, positionsFilled: 0,
      siteName: "Central Docks Plot 4", addressLine1: "Regent Road",
      postcode: "L3 0AN", city: "Liverpool", clientName: "Merseybuild Ltd",
      clientType: "Main Contractor", siteManagerName: "Gary Naylor",
      siteManagerPhone: "+447700900203", isPremiumClient: false,
      payRate: 22.0, chargeRate: 29.5, currency: "GBP",
      requirementsJson: { cscs: "Blue or above" },
      notes: "Drainage and kerbing focus.",
    },
  });

  const jobTrafford = await prisma.job.create({
    data: {
      agencyId, title: "Trafford Park Warehouse Extension", status: "ACTIVE",
      tradeRequired: "Scaffolder", startDate: inDays(1), durationWeeks: 8,
      hoursPerDay: 9, daysPerWeek: 5, positionsOpen: 2, positionsFilled: 1,
      siteName: "Europa Way Unit 7", postcode: "M17 1DA", city: "Manchester",
      clientName: "Halewood Industrial", clientType: "Main Contractor",
      payRate: 24.0, chargeRate: 32.0, currency: "GBP",
      requirementsJson: { cisrs: "Advanced" },
    },
  });

  const jobs = { jobMaidstone, jobSalford, jobLiverpool, jobTrafford };

  // -- people ---------------------------------------------------------------
  console.log("   creating candidates and conversations...");
  const created: Record<string, { contactId: string; conversationId: string; candidateId: string; lastInboundId: string | null }> = {};

  for (const p of PEOPLE) {
    const contact = await prisma.contact.create({
      data: { agencyId, phone: `whatsapp:${p.phone}`, name: p.name, type: "CANDIDATE", optedOut: false, createdAt: daysAgo(p.lastSeenDaysAgo ?? 5) },
    });

    const memoryPack = {
      summary: p.summary,
      facts: {
        trade: p.trade, location: p.location,
        availability: p.missingFields.includes("availability") ? null : "Available now",
        salary: p.payMin ? { min: p.payMin, max: p.payMax, currency: "GBP" } : null,
        skills: p.skills, tickets: p.tickets, preferredAreas: [p.location],
        transport: "Own transport", startDate: null, lastClient: null,
      },
      goal: p.goal,
      openQuestions: p.openQuestions,
      structuredOpenQuestions: [],
      lastJobDiscussed: null,
      nextAction: p.nextAction,
      version: 1,
      updatedAt: new Date().toISOString(),
    };

    const progressData = {
      missingFields: p.missingFields,
      nextAction: p.nextAction,
      followUpAt: p.stage === "DORMANT" ? null : inDays(2).toISOString(),
      lastDecision: { at: hoursAgo(4).toISOString(), by: "SYSTEM", reason: `Stage computed from profile completeness` },
      flags: { waitingForOperator: p.stage === "MATCHED_TO_JOBS", highPriority: p.stage === "MATCHED_TO_JOBS" },
      confidence: 82,
      lastStageChangedAt: hoursAgo(4).toISOString(),
    };

    const lastBeat = p.script[p.script.length - 1];
    const conversation = await prisma.conversation.create({
      data: {
        agencyId, contactId: contact.id,
        createdAt: daysAgo(p.lastSeenDaysAgo ?? 5),
        lastMessageAt: hoursAgo(lastBeat.hoursAgo),
        state: p.stage === "MATCHED_TO_JOBS" ? "PAUSED_FOR_APPROVAL" : "ACTIVE",
        pausedReason: p.stage === "MATCHED_TO_JOBS" ? "Candidate asked about day rate — needs operator approval" : null,
        memoryPack, memoryUpdatedAt: hoursAgo(4),
        progressStage: p.stage, progressData, progressUpdatedAt: hoursAgo(4),
      },
    });

    const candidate = await prisma.candidate.create({
      data: {
        agencyId, phone: `whatsapp:${p.phone}`, name: p.name, location: p.location,
        desiredRole: p.trade, skills: p.skills, yearsExperience: p.years,
        salaryMin: p.payMin ?? null, salaryMax: p.payMax ?? null,
        currency: p.payMin ? "GBP" : null,
        availabilityNotes: p.missingFields.includes("availability") ? null : "Available now",
        lastSeenAt: hoursAgo(lastBeat.hoursAgo), lastConversationId: conversation.id,
        source: "WHATSAPP",
        rawProfile: { trade: p.trade, tickets: p.tickets, extractedFrom: "whatsapp_conversation" },
        createdAt: daysAgo(p.lastSeenDaysAgo ?? 5),
      },
    });

    let lastInboundId: string | null = null;
    for (const beat of p.script) {
      const msg = await prisma.message.create({
        data: {
          agencyId, contactId: contact.id, conversationId: conversation.id,
          direction: beat.dir === "IN" ? "INBOUND" : "OUTBOUND",
          channel: "WHATSAPP",
          senderRole: beat.dir === "IN" ? "HUMAN" : beat.ai ? "AI" : "OPERATOR",
          text: beat.text,
          providerMessageId: `SM${Math.abs(hashCode(p.phone + beat.text)).toString(16).padStart(24, "0")}`,
          deliveryStatus: beat.dir === "IN" ? "SENT" : "DELIVERED",
          deliveredAt: beat.dir === "OUT" ? hoursAgo(beat.hoursAgo) : null,
          rawPayload: { demo: true, from: p.phone },
          createdAt: hoursAgo(beat.hoursAgo),
          candidateId: candidate.id,
        },
      });
      if (beat.dir === "IN") lastInboundId = msg.id;

      await prisma.timelineEvent.create({
        data: {
          agencyId, conversationId: conversation.id, contactId: contact.id, candidateId: candidate.id,
          type: beat.dir === "IN" ? "INBOUND_MESSAGE_RECEIVED" : "OUTREACH_SENT",
          actorRole: beat.dir === "IN" ? "SYSTEM" : beat.ai ? "AI" : "OPERATOR",
          summary: (beat.dir === "IN" ? "Inbound: " : "Sent: ") + beat.text.slice(0, 150),
          data: { messageId: msg.id },
          createdAt: hoursAgo(beat.hoursAgo),
        },
      });
    }

    await prisma.timelineEvent.create({
      data: {
        agencyId, conversationId: conversation.id, contactId: contact.id, candidateId: candidate.id,
        type: "PROGRESS_STAGE_CHANGED", actorRole: "SYSTEM",
        summary: `Progress stage set to ${p.stage}`,
        data: { to: p.stage, reason: p.nextAction }, createdAt: hoursAgo(4),
      },
    });

    created[p.name] = { contactId: contact.id, conversationId: conversation.id, candidateId: candidate.id, lastInboundId };
  }

  // -- job/candidate matches ------------------------------------------------
  console.log("   matching candidates to jobs...");
  const matches: Array<[string, string, number, "PROVEN" | "EXCELLENT" | "GOOD" | "WEAK", string[]]> = [
    ["Sam Iqbal", jobSalford.id, 94, "EXCELLENT", ["JIB Gold matches requirement", "18th Edition current", "Lives 3 miles from site"]],
    ["Kieran Doyle", jobSalford.id, 61, "GOOD", ["Available in region", "Dormant 47 days — re-engagement candidate"]],
    ["Marek Kowalski", jobLiverpool.id, 91, "EXCELLENT", ["Drainage and kerbing experience", "CSCS Blue held", "Based in Liverpool"]],
    ["Jason Pike", jobMaidstone.id, 88, "EXCELLENT", ["CSCS Green held", "Local to Maidstone", "Available immediately"]],
    ["Errol Barnes", jobTrafford.id, 96, "PROVEN", ["CISRS Advanced", "15 years experience", "Previously placed successfully"]],
    ["Tom Ashworth", jobMaidstone.id, 55, "WEAK", ["Different trade — carpentry not labouring"]],
  ];
  for (const [name, jobId, score, tier, reasons] of matches) {
    await prisma.jobCandidateMatch.create({
      data: { agencyId, jobId, candidateId: created[name].candidateId, score, tier, reasons },
    });
  }

  // -- pipeline -------------------------------------------------------------
  console.log("   building job pipeline...");
  await prisma.jobPipelineItem.create({
    data: { agencyId, jobId: jobMaidstone.id, candidateId: created["Jason Pike"].candidateId,
      stage: "OFFER_SENT", notes: "Offer sent, awaiting confirmation.", payRate: 15.5,
      shiftInfo: "7:30am start, 9hr days", updatedByOperatorId: operator.id, updatedAt: hoursAgo(20) },
  });
  await prisma.jobPipelineItem.create({
    data: { agencyId, jobId: jobTrafford.id, candidateId: created["Errol Barnes"].candidateId,
      stage: "START_CONFIRMED", notes: "Started Monday, all good.", startDate: daysAgo(1),
      payRate: 24.0, shiftInfo: "7:30am start", updatedByOperatorId: operator.id, updatedAt: hoursAgo(30) },
  });
  await prisma.jobPipelineItem.create({
    data: { agencyId, jobId: jobSalford.id, candidateId: created["Sam Iqbal"].candidateId,
      stage: "SHORTLISTED", notes: "Strong match — awaiting availability.", updatedByOperatorId: operator.id, updatedAt: hoursAgo(25) },
  });
  await prisma.jobPipelineItem.create({
    data: { agencyId, jobId: jobLiverpool.id, candidateId: created["Marek Kowalski"].candidateId,
      stage: "SHORTLISTED", notes: "Asking about rate before proceeding.", updatedByOperatorId: operator.id, updatedAt: hoursAgo(2) },
  });

  await prisma.placement.create({
    data: { agencyId, jobId: jobTrafford.id, candidateId: created["Errol Barnes"].candidateId,
      status: "CONFIRMED", startDate: daysAgo(1), notes: "Started on site, aftercare check-in due." },
  });

  // -- tasks ----------------------------------------------------------------
  console.log("   creating operator tasks...");

  // 1. Pending approval — rate question (the headline demo task)
  const marek = created["Marek Kowalski"];
  const marekMsg = "Rates on that one depend on the shift pattern — let me confirm with the site and come straight back to you. You after weekdays only or weekends too?";
  await prisma.task.create({
    data: {
      agencyId, type: "APPROVAL_REQUIRED", status: "OPEN", approvalStatus: "PENDING",
      relatedMessageId: marek.lastInboundId, candidateId: marek.candidateId,
      createdAt: minsAgo(70),
      payload: {
        conversationId: marek.conversationId, contactPhone: "whatsapp:+447700900102",
        intent: "JOB_QUERY", pendingReplyText: marekMsg,
        approvalReason: "Candidate asked about day rate — pay figures require operator approval",
        jobSnapshot: { jobId: jobLiverpool.id, title: jobLiverpool.title, payRate: 22.0, chargeRate: 29.5 },
        proposedAction: { actionType: "SEND_MESSAGE", suggestedMessage: marekMsg, riskLevel: "HIGH" },
      },
      proposedAction: {
        actionType: "SEND_MESSAGE", suggestedMessage: marekMsg, riskLevel: "HIGH",
        reasoning: "Candidate asked a direct pay question. Policy requires operator approval before any rate is discussed.",
        explainability: explain({
          risk: "HIGH",
          rationale: [
            "Candidate asked directly about day rate",
            "Playbook escalation rule: salary/rate figures require approval",
            "Draft deliberately avoids quoting a number",
          ],
          usedFacts: ["Trade: Groundworker", "Location: Liverpool", "8 years experience", "CSCS Blue held", "Matched to Liverpool Waters (score 91)"],
          uncertainty: "Shift pattern unknown — affects which rate band applies",
          missingInfo: ["Preferred shift pattern", "Weekend availability"],
          alternatives: [
            { action: "ESCALATE", reason: "Hand straight to operator without a draft" },
            { action: "REQUEST_INFO", reason: "Ask about shift pattern before mentioning rates at all" },
          ],
          confidence: 0.86,
        }),
      },
    },
  });

  // 2. Pending approval — availability, lower risk
  const danny = created["Danny Whelan"];
  const dannyMsg = "Nice one 👍 Got a couple of brickwork packages starting soon. Have you got a valid CSCS card?";
  await prisma.task.create({
    data: {
      agencyId, type: "APPROVAL_REQUIRED", status: "OPEN", approvalStatus: "PENDING",
      relatedMessageId: danny.lastInboundId, candidateId: danny.candidateId, createdAt: minsAgo(215),
      payload: {
        conversationId: danny.conversationId, contactPhone: "whatsapp:+447700900101",
        intent: "LOOKING_FOR_WORK", pendingReplyText: dannyMsg,
        approvalReason: "Agency is in APPROVAL_ONLY mode",
        proposedAction: { actionType: "SEND_MESSAGE", suggestedMessage: dannyMsg, riskLevel: "LOW" },
      },
      proposedAction: {
        actionType: "SEND_MESSAGE", suggestedMessage: dannyMsg, riskLevel: "LOW",
        reasoning: "Profile is incomplete; CSCS status is the next required field.",
        explainability: explain({
          risk: "LOW",
          rationale: ["Trade and location already captured", "CSCS status is the next required check", "No commercial terms discussed"],
          usedFacts: ["Trade: Bricklayer", "Location: Manchester", "12 years experience"],
          uncertainty: null,
          missingInfo: ["Availability", "CSCS card status"],
          alternatives: [{ action: "REQUEST_INFO", reason: "Ask about availability first instead" }],
          confidence: 0.91,
        }),
      },
    },
  });

  // 3. CSCS verification
  const tom = created["Tom Ashworth"];
  await prisma.task.create({
    data: {
      agencyId, type: "CSCS_VERIFICATION", status: "OPEN", approvalStatus: "PENDING",
      relatedMessageId: tom.lastInboundId, candidateId: tom.candidateId, createdAt: hoursAgo(3.4),
      payload: {
        conversationId: tom.conversationId, contactPhone: "whatsapp:+447700900103",
        candidateName: "Tom Ashworth",
        mediaUrls: ["https://demo.local/cscs-card-placeholder.jpg"],
        extracted: { holderName: "THOMAS ASHWORTH", cardType: "Gold — Advanced Craft", cardNumber: "JH 4471 9920", expiryDate: "2028-04-30", level: "Advanced Craft" },
        autoVerified: true, confidence: 0.93,
        checks: { nameMatches: true, notExpired: true, cardTypeAcceptable: true },
      },
      proposedAction: {
        actionType: "REQUEST_INFO", riskLevel: "MEDIUM",
        reasoning: "CSCS card read automatically; operator confirmation required before placing.",
        explainability: explain({
          risk: "MEDIUM",
          rationale: ["Card image read with 93% confidence", "Name matches candidate record", "Expiry 2028 — valid"],
          usedFacts: ["Trade: Carpenter", "Location: Leeds", "Card: Gold Advanced Craft", "Expires 2028-04-30"],
          uncertainty: "Card number partially obscured by glare in bottom-right",
          missingInfo: ["Second form of ID"],
          source: "AI", confidence: 0.93,
        }),
      },
    },
  });

  // 4. Follow-up reminder, due now
  const jason = created["Jason Pike"];
  await prisma.task.create({
    data: {
      agencyId, type: "FOLLOW_UP", status: "OPEN", approvalStatus: "NOT_REQUIRED",
      candidateId: jason.candidateId, createdAt: hoursAgo(20), dueAt: minsAgo(30), isSystemGenerated: true,
      payload: { conversationId: jason.conversationId, contactPhone: "whatsapp:+447700900104",
        reason: "Offer sent 20 hours ago with no response", jobId: jobMaidstone.id, jobTitle: jobMaidstone.title },
    },
  });

  // 5. Outreach — dormant candidate matched to urgent job
  const kieran = created["Kieran Doyle"];
  const kieranMsg = "Hi Kieran, it's Vantalos — we've got a plastering package starting in Salford this week. You still looking?";
  await prisma.task.create({
    data: {
      agencyId, type: "OUTREACH", status: "OPEN", approvalStatus: "PENDING",
      candidateId: kieran.candidateId, createdAt: minsAgo(95), isSystemGenerated: true,
      payload: {
        conversationId: kieran.conversationId, contactPhone: "whatsapp:+447700900106",
        pendingReplyText: kieranMsg, opportunityType: "DORMANT_CANDIDATES_MATCH_URGENT_JOB",
        jobId: jobSalford.id, jobTitle: jobSalford.title,
        proposedAction: { actionType: "SEND_MESSAGE", suggestedMessage: kieranMsg, riskLevel: "MEDIUM" },
      },
      proposedAction: {
        actionType: "SEND_MESSAGE", suggestedMessage: kieranMsg, riskLevel: "MEDIUM",
        reasoning: "Dormant candidate matches an urgent, underfilled job.",
        explainability: explain({
          risk: "MEDIUM",
          rationale: ["Salford Quays is URGENT and 5 positions short", "Candidate dormant 47 days", "Trade and region both match"],
          usedFacts: ["Trade: Plasterer", "Location: Bolton", "Last contact 47 days ago", "Job status: URGENT"],
          uncertainty: "Candidate may have found work elsewhere in the interim",
          missingInfo: ["Current availability"],
          alternatives: [{ action: "NO_ACTION", reason: "Leave dormant candidates undisturbed" }],
          confidence: 0.71,
        }),
      },
    },
  });

  // 6. Aftercare check-in
  const errol = created["Errol Barnes"];
  await prisma.task.create({
    data: {
      agencyId, type: "FOLLOW_UP", status: "OPEN", approvalStatus: "NOT_REQUIRED",
      candidateId: errol.candidateId, createdAt: hoursAgo(8), dueAt: hoursAgo(1), isSystemGenerated: true,
      payload: { conversationId: errol.conversationId, contactPhone: "whatsapp:+447700900105",
        reason: "Day-one aftercare check-in", opportunityType: "DAY1_AFTERCARE_CHECKIN",
        jobId: jobTrafford.id, jobTitle: jobTrafford.title },
    },
  });

  // 7-9. Completed tasks (feed the Review page and quality metrics)
  const completed = [
    { person: "Errol Barnes", proposed: "You're all set — start Monday at Salford Quays, 7:30am.", final: "You're all set — start Monday at Salford Quays, 7:30am. Bring your CISRS card and own PPE.", edited: true, hrs: 100 },
    { person: "Jason Pike", proposed: "Perfect. I'll get you details over shortly.", final: "Perfect. I'll get you details over shortly.", edited: false, hrs: 20 },
    { person: "Sam Iqbal", proposed: "Spot on. What's your availability looking like?", final: "Spot on. What's your availability looking like?", edited: false, hrs: 25.1 },
    { person: "Ricky Nunes", proposed: "Got it. Can you send over your right to work docs?", final: "Got it. Can you send over your right to work docs?", edited: false, hrs: 12 },
  ];

  for (const c of completed) {
    const who = created[c.person];
    const task = await prisma.task.create({
      data: {
        agencyId, type: "APPROVAL_REQUIRED", status: "DONE", approvalStatus: "APPROVED",
        candidateId: who.candidateId, approvedByOperatorId: operator.id,
        createdAt: hoursAgo(c.hrs + 0.5), approvedAt: hoursAgo(c.hrs),
        payload: {
          conversationId: who.conversationId,
          proposedMessageText: c.proposed, approvedMessageText: c.final,
          wasEdited: c.edited,
          editMetrics: { charsAdded: Math.max(0, c.final.length - c.proposed.length), charsRemoved: 0, similarity: c.edited ? 0.72 : 1 },
          editSummary: c.edited ? "Operator added PPE and card requirements" : "Sent unchanged",
        },
        proposedAction: {
          actionType: "SEND_MESSAGE", suggestedMessage: c.proposed, riskLevel: "LOW",
          reasoning: "Routine progression message.",
          explainability: explain({ risk: "LOW", rationale: ["Routine next step"], usedFacts: ["Conversation context"], confidence: 0.88 }),
        },
      },
    });

    await prisma.messageReviewSample.create({
      data: {
        agencyId, taskId: task.id, conversationId: who.conversationId, candidateId: who.candidateId,
        sampledReason: c.edited ? "EDITED" : "RANDOM",
        proposedText: c.proposed, finalText: c.final,
        editMetrics: { charsAdded: Math.max(0, c.final.length - c.proposed.length), charsRemoved: 0, similarity: c.edited ? 0.72 : 1 },
        verdict: c.edited ? "NEEDS_IMPROVEMENT" : null,
        reviewedAt: c.edited ? hoursAgo(c.hrs - 2) : null,
        reviewedByOperatorId: c.edited ? operator.id : null,
        notes: c.edited ? "Draft omitted PPE requirements — should be standard for first-day messages." : null,
        createdAt: hoursAgo(c.hrs - 0.2),
      },
    });
  }

  // -- earnings -------------------------------------------------------------
  console.log("   setting up earnings tracker...");
  await prisma.earningsSettings.create({
    data: {
      agencyId, operatorId: operator.id, basePayMonthly: 3200, currency: "GBP",
      commissionBrackets: [
        { minRevenue: 0, maxRevenue: 15000, ratePct: 5 },
        { minRevenue: 15000, maxRevenue: 30000, ratePct: 8 },
        { minRevenue: 30000, maxRevenue: 50000, ratePct: 12 },
        { minRevenue: 50000, maxRevenue: null, ratePct: 15 },
      ],
    },
  });
  const m = now.getMonth() + 1, y = now.getFullYear();
  await prisma.monthlyEarnings.create({ data: { agencyId, operatorId: operator.id, year: y, month: m, revenueTotal: 27450, currency: "GBP" } });
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  await prisma.monthlyEarnings.create({ data: { agencyId, operatorId: operator.id, year: prev.y, month: prev.m, revenueTotal: 41200, currency: "GBP" } });

  // -- summary --------------------------------------------------------------
  const counts = {
    jobs: await prisma.job.count({ where: { agencyId } }),
    candidates: await prisma.candidate.count({ where: { agencyId } }),
    conversations: await prisma.conversation.count({ where: { agencyId } }),
    messages: await prisma.message.count({ where: { agencyId } }),
    openTasks: await prisma.task.count({ where: { agencyId, status: "OPEN" } }),
    pendingApproval: await prisma.task.count({ where: { agencyId, approvalStatus: "PENDING", status: "OPEN" } }),
    pipeline: await prisma.jobPipelineItem.count({ where: { agencyId } }),
    timeline: await prisma.timelineEvent.count({ where: { agencyId } }),
    reviewSamples: await prisma.messageReviewSample.count({ where: { agencyId } }),
  };

  console.log("\n✅ Demo environment ready\n");
  console.table(counts);
  console.log(`\n   Console:  http://localhost:3000/operator`);
  console.log(`   Login:    ${ADMIN_EMAIL}  /  ${ADMIN_PASSWORD}\n`);
}

function hashCode(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}

main()
  .catch((e) => { console.error("\n❌ Demo seed failed:\n", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
