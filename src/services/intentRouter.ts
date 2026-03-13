import { TaskType } from "@prisma/client";
import type { InboundIntent } from "../domain/intent.ts";

/**
 * Map an inbound intent to a TaskType for downstream automation.
 *
 * NOTE: `JOB_QUERY` is routed to `APPROVAL_REQUIRED` because job details (rate,
 * location, site, etc.) often require a recruiter/admin to confirm accuracy
 * before any outbound reply or action is taken.
 */
export function mapIntentToTaskType(intent: InboundIntent): TaskType {
  switch (intent) {
    case "JOB_QUERY":
      return TaskType.APPROVAL_REQUIRED;
    case "LOOKING_FOR_WORK":
    case "AVAILABILITY_UPDATE":
    case "FOLLOW_UP":
    case "UNKNOWN":
    default:
      return TaskType.FOLLOW_UP;
  }
}


