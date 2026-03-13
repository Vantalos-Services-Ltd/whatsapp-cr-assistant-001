/**
 * Worker entry point
 * Starts all BullMQ workers
 */

import "../bootstrap/env.ts";
import "./index.ts";

// Keep process alive
process.on("SIGTERM", () => {
  process.exit(0);
});

process.on("SIGINT", () => {
  process.exit(0);
});

