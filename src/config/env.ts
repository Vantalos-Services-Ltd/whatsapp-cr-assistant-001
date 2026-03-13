import { z } from "zod";

const envSchema = z.object({
  // Server
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // Feature flags
  ENABLE_AI_INTENT_CLASSIFIER: z.boolean(),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url().default("redis://localhost:6379"),

  // Twilio
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_WHATSAPP_NUMBER: z.string().min(1),
  // Base URL for webhooks (e.g., ngrok URL in development)
  WEBHOOK_BASE_URL: z.string().url().optional(),

  // OpenAI
  // Optional: AI intent classifier is gated behind ENABLE_AI_INTENT_CLASSIFIER and
  // the classifier itself handles missing keys gracefully.
  OPENAI_API_KEY: z.string().optional(),

  // Session secret for cookies (required for auth)
  SESSION_SECRET: z.string().min(32),
});

export type Env = z.infer<typeof envSchema>;

let env: Env;

try {
  // Only read values from process.env; dotenv loading is handled in bootstrap.
  env = envSchema.parse({
    ...process.env,
    ENABLE_AI_INTENT_CLASSIFIER:
      process.env.ENABLE_AI_INTENT_CLASSIFIER === "true",
  });
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error("❌ Invalid environment variables:");
    error.errors.forEach((err) => {
      console.error(`  ${err.path.join(".")}: ${err.message}`);
    });
    process.exit(1);
  }
  throw error;
}

export { env };

