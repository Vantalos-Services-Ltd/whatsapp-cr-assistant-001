/**
 * Task Priority Service
 * Estimates task priority based on margin calculations
 */

export type PriorityResult = {
  priorityScore: number; // higher = more important
  priorityLabel: string | null;
  marginPerHour: number | null;
  expectedHours: number | null;
  jobTitle: string | null;
};

/**
 * Extract job data from task payload
 * Tries multiple locations in order of preference
 */
function extractJobData(task: any): {
  payRate: number | null;
  chargeRate: number | null;
  title: string | null;
  durationWeeks: number | null;
  startDate: string | null;
} {
  const payload = task.payload || {};
  let payRate: number | null = null;
  let chargeRate: number | null = null;
  let title: string | null = null;
  let durationWeeks: number | null = null;
  let startDate: string | null = null;

  // 1) Try task.payload.job.* (CSCS_VERIFICATION tasks)
  if (payload.job) {
    if (typeof payload.job.payRate === "number") {
      payRate = payload.job.payRate;
    }
    if (typeof payload.job.chargeRate === "number") {
      chargeRate = payload.job.chargeRate;
    }
    if (typeof payload.job.title === "string") {
      title = payload.job.title;
    }
    if (typeof payload.job.durationWeeks === "number") {
      durationWeeks = payload.job.durationWeeks;
    }
    if (typeof payload.job.startDate === "string") {
      startDate = payload.job.startDate;
    }
  }

  // 2) Try task.payload.jobSnapshot.* (if exists, from job matches enrichment)
  if (!title && payload.jobSnapshot) {
    if (typeof payload.jobSnapshot.title === "string") {
      title = payload.jobSnapshot.title;
    }
    if (typeof payload.jobSnapshot.payRate === "number" && payRate === null) {
      payRate = payload.jobSnapshot.payRate;
    }
    if (typeof payload.jobSnapshot.chargeRate === "number" && chargeRate === null) {
      chargeRate = payload.jobSnapshot.chargeRate;
    }
    if (typeof payload.jobSnapshot.durationWeeks === "number" && durationWeeks === null) {
      durationWeeks = payload.jobSnapshot.durationWeeks;
    }
    if (typeof payload.jobSnapshot.startDate === "string" && startDate === null) {
      startDate = payload.jobSnapshot.startDate;
    }
  }

  // 3) Future: task.payload.jobId -> join job from DB (not implemented in v1)

  return {
    payRate,
    chargeRate,
    title,
    durationWeeks,
    startDate,
  };
}

/**
 * Calculate expected hours based on task payload
 */
function calculateExpectedHours(
  durationWeeks: number | null,
  startDate: string | null,
  payload: any
): number {
  // Rule 1: If durationWeeks exists, use it: weeks * 40 hours/week
  if (durationWeeks !== null && typeof durationWeeks === "number" && durationWeeks > 0) {
    return durationWeeks * 40;
  }

  // Rule 2: If startDate exists and is within next 7 days, assume 1 week urgency (40 hours)
  if (startDate) {
    try {
      const startDateObj = new Date(startDate);
      const now = new Date();
      const daysUntilStart = Math.ceil((startDateObj.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      // If start date is within next 7 days (0-7 days from now)
      if (daysUntilStart >= 0 && daysUntilStart <= 7) {
        return 40; // 1 week urgency
      }
    } catch (error) {
      // Invalid date, fall through to default
    }
  }

  // Rule 3: Default to 160 hours (4 weeks * 40 hours/week) for "ongoing role"
  return 160;
}

/**
 * Calculate monthly margin from margin per hour
 */
function calculateMonthlyMargin(marginPerHour: number): number {
  // 160 hours/month = 8 hours/day * 5 days/week * 4 weeks/month
  return marginPerHour * 160;
}

/**
 * Format currency for priority label
 */
function formatCurrency(amount: number, currency: string = "GBP"): string {
  if (currency === "GBP") {
    return `£${Math.round(amount).toLocaleString("en-GB")}`;
  }
  return `${Math.round(amount).toLocaleString("en-US")} ${currency}`;
}

/**
 * Estimate task priority based on margin calculations
 */
export function estimateTaskPriority(task: any): PriorityResult {
  // Extract job data from payload
  const jobData = extractJobData(task);

  // Calculate margin per hour
  const marginPerHour =
    jobData.chargeRate !== null &&
    jobData.payRate !== null &&
    typeof jobData.chargeRate === "number" &&
    typeof jobData.payRate === "number"
      ? jobData.chargeRate - jobData.payRate
      : null;

  // Calculate expected hours
  const expectedHours = calculateExpectedHours(jobData.durationWeeks, jobData.startDate, task.payload || {});

  // Calculate priority score
  // priorityScore = marginPerHour * expectedHours (if marginPerHour null => 0)
  const priorityScore = marginPerHour !== null ? marginPerHour * expectedHours : 0;

  // Generate priority label
  let priorityLabel: string | null = null;
  if (jobData.title && marginPerHour !== null) {
    const monthlyMargin = calculateMonthlyMargin(marginPerHour);
    const currency = (task.payload?.job?.currency || "GBP") as string;
    priorityLabel = `Priority: ${jobData.title} (${formatCurrency(monthlyMargin, currency)}/month margin)`;
  }

  return {
    priorityScore,
    priorityLabel,
    marginPerHour,
    expectedHours,
    jobTitle: jobData.title,
  };
}

