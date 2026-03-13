import dotenv from "dotenv";

// Load environment variables as early as possible (before any other imports).
const result = dotenv.config();

console.log("[bootstrap/env] dotenv path:", result?.parsed ? "FOUND" : "NOT FOUND");
console.log("[bootstrap/env] keys loaded:", Object.keys(result?.parsed ?? {}));

// Helpful boot-time signal when running with `tsx` and expecting flags from `.env`.
if (process.env.ENABLE_AI_INTENT_CLASSIFIER === undefined) {
  // eslint-disable-next-line no-console
  console.warn(
    "[bootstrap/env] ENABLE_AI_INTENT_CLASSIFIER is undefined after dotenv.config()"
  );
}


