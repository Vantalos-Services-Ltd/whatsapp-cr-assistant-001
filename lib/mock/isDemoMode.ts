/**
 * Demo mode: the operator console runs entirely in the browser against an
 * in-memory fake backend (lib/mock). No API server, database, Redis, Twilio
 * or OpenAI is contacted.
 *
 * Enabled by building/running the frontend with NEXT_PUBLIC_DEMO_MODE=true
 * (see `pnpm dev:demo`).
 */
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}
