/**
 * High-level intent classification for inbound messages.
 *
 * This is a shared domain contract used across:
 * - webhook ingestion
 * - queue workers
 * - downstream automation/routing
 */

/**
 * Represents the user's intent in an inbound message.
 *
 * Use `UNKNOWN` when the message doesn't match any known intent or is too vague.
 */
export type InboundIntent =
  /**
   * The contact is looking for work / roles / opportunities.
   *
   * Examples:
   * - "Hi, I'm looking for a new role in sales."
   * - "Do you have any warehouse jobs available?"
   */
  | "LOOKING_FOR_WORK"
  /**
   * The contact is updating availability or schedule.
   *
   * Examples:
   * - "I'm free to talk tomorrow afternoon."
   * - "I can start from next Monday."
   */
  | "AVAILABILITY_UPDATE"
  /**
   * The contact is asking about a specific job, position, or posting.
   *
   * Examples:
   * - "Is the Software Engineer role still open?"
   * - "What's the salary range for the Logistics Coordinator job?"
   */
  | "JOB_QUERY"
  /**
   * The contact is following up on a previous conversation or application.
   *
   * Examples:
   * - "Any update on my application?"
   * - "Just checking in—did you hear back from the client?"
   */
  | "FOLLOW_UP"
  /**
   * Intent could not be determined.
   *
   * Examples:
   * - "Hi"
   * - "Ok"
   */
  | "UNKNOWN";

/**
 * Canonical list of all supported intents (useful for validation, UIs, and tests).
 */
export const ALL_INTENTS = [
  "LOOKING_FOR_WORK",
  "AVAILABILITY_UPDATE",
  "JOB_QUERY",
  "FOLLOW_UP",
  "UNKNOWN",
] as const satisfies ReadonlyArray<InboundIntent>;


