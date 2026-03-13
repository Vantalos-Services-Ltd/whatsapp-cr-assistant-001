/**
 * Deterministic message templates for opportunities
 * No OpenAI calls - uses known facts only
 */

import type { OpportunityType } from "./types.ts";

interface TemplateContext {
  name?: string;
  role?: string;
  location?: string;
  payLine?: string;
  startDateLine?: string;
  site?: string;
}

/**
 * Format pay line from job data
 */
function formatPayLine(payRate?: number | null, currency: string = "GBP"): string | undefined {
  if (!payRate || payRate <= 0) return undefined;
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency;
  return `${symbol}${payRate.toFixed(2)}/hr`;
}

/**
 * Format start date line
 */
function formatStartDateLine(startDate?: Date | string | null): string | undefined {
  if (!startDate) return undefined;
  const date = typeof startDate === "string" ? new Date(startDate) : startDate;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  if (date.toDateString() === today.toDateString()) {
    return "today";
  }
  if (date.toDateString() === tomorrow.toDateString()) {
    return "tomorrow";
  }
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Format location from job data
 */
function formatLocation(city?: string | null, siteName?: string | null): string | undefined {
  if (siteName) return siteName;
  if (city) return city;
  return undefined;
}

/**
 * Template: Underfilled urgent job outreach
 */
export function templateUnderfilledUrgentJob(context: TemplateContext): string {
  const parts: string[] = [];
  
  // Greeting
  if (context.name) {
    parts.push(`Hi ${context.name},`);
  } else {
    parts.push("Hi,");
  }
  
  // Job offer
  const jobParts: string[] = [];
  if (context.role) {
    jobParts.push(`got a ${context.role} job`);
  } else {
    jobParts.push("got a job");
  }
  
  if (context.location) {
    jobParts.push(`in ${context.location}`);
  }
  
  parts.push(jobParts.join(" "));
  
  // Pay line (optional)
  if (context.payLine) {
    parts.push(context.payLine);
  }
  
  // Start date (optional)
  if (context.startDateLine) {
    parts.push(`Are you available to start ${context.startDateLine}?`);
  } else {
    parts.push("Are you available?");
  }
  
  return parts.join(" ");
}

/**
 * Template: Dormant reactivation
 */
export function templateDormantReactivation(context: TemplateContext): string {
  const parts: string[] = [];
  
  // Greeting
  if (context.name) {
    parts.push(`Hi ${context.name},`);
  } else {
    parts.push("Hi,");
  }
  
  // Question
  parts.push("you still looking for work?");
  
  // Job mention
  if (context.location) {
    parts.push(`I've got something that might suit you in ${context.location}.`);
  } else {
    parts.push("I've got something that might suit you.");
  }
  
  return parts.join(" ");
}

/**
 * Template: Follow up after offer
 */
export function templateFollowUpAfterOffer(context: TemplateContext): string {
  const parts: string[] = [];
  
  // Greeting
  if (context.name) {
    parts.push(`Hi ${context.name},`);
  } else {
    parts.push("Hi,");
  }
  
  // Check-in
  parts.push("just checking if you're still interested");
  
  // Job details
  const jobParts: string[] = [];
  if (context.role) {
    jobParts.push(`the ${context.role} role`);
  } else {
    jobParts.push("the role");
  }
  
  if (context.site) {
    jobParts.push(`at ${context.site}`);
  }
  
  if (jobParts.length > 0) {
    parts.push(`in ${jobParts.join(" ")}.`);
  } else {
    parts.push(".");
  }
  
  // Question
  parts.push("Can you confirm?");
  
  return parts.join(" ");
}

/**
 * Template: Day 1 aftercare check-in
 */
export function templateDay1Aftercare(context: TemplateContext): string {
  const parts: string[] = [];
  
  // Greeting
  if (context.name) {
    parts.push(`Morning ${context.name},`);
  } else {
    parts.push("Morning,");
  }
  
  // Check-in
  parts.push("all good for today?");
  
  // Question
  parts.push("Any issues getting to site?");
  
  return parts.join(" ");
}

/**
 * Get template function for opportunity type
 */
export function getTemplateForType(type: OpportunityType): (context: TemplateContext) => string {
  switch (type) {
    case "UNDERFILLED_URGENT_JOB":
      return templateUnderfilledUrgentJob;
    case "DORMANT_CANDIDATES_MATCH_URGENT_JOB":
      return templateDormantReactivation;
    case "FOLLOW_UP_AFTER_OFFER":
      return templateFollowUpAfterOffer;
    case "DAY1_AFTERCARE_CHECKIN":
      return templateDay1Aftercare;
    default:
      throw new Error(`Unknown opportunity type: ${type}`);
  }
}

/**
 * Build template context from job and candidate data
 */
export function buildTemplateContext(input: {
  candidateName?: string | null;
  jobTitle?: string | null;
  jobCity?: string | null;
  jobSiteName?: string | null;
  jobPayRate?: number | null;
  jobCurrency?: string | null;
  jobStartDate?: Date | string | null;
}): TemplateContext {
  return {
    name: input.candidateName || undefined,
    role: input.jobTitle || undefined,
    location: formatLocation(input.jobCity, input.jobSiteName),
    payLine: formatPayLine(input.jobPayRate, input.jobCurrency),
    startDateLine: formatStartDateLine(input.jobStartDate),
    site: input.jobSiteName || input.jobCity || undefined,
  };
}

