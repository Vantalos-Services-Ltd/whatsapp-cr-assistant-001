import dotenv from "dotenv";
import { PrismaClient, JobStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

// Seed scripts should be able to run with the minimum required env vars.
// We intentionally do NOT import `src/config/env.ts` here because it enforces
// non-DB secrets (Twilio/OpenAI) that aren't needed to seed the database.
dotenv.config();

export async function seed() {
  const prisma = new PrismaClient();

  try {
    // 1. Create or find Agency (FIXED: use specific name check for idempotency)
    const agencyName = "Vantalos Demo Agency";
    let agency = await prisma.agency.findFirst({
      where: { name: agencyName },
    });

        if (agency) {
          // Keep this log stable for CI/dev scripts.
          // eslint-disable-next-line no-console
          console.log(`[seed] Agency already exists: ${agency.id}`);
        } else {
          agency = await prisma.agency.create({
            data: {
              name: agencyName,
              messagingMode: "APPROVAL_ONLY", // Default to approval-only for safety
            } as any, // Type assertion needed until Prisma client is regenerated
          });

          // eslint-disable-next-line no-console
          console.log(`[seed] Created agency: ${agency.id}`);
        }

    // 2. Create or upsert Operator (admin user)
    const adminEmail = "admin@example.com";
    const adminPassword = "admin123";
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    const operator = await prisma.operator.upsert({
      where: { email: adminEmail },
      update: {
        // Update password hash in case it changed
        passwordHash,
      },
      create: {
        email: adminEmail,
        passwordHash,
      },
    });

    // eslint-disable-next-line no-console
    console.log(`[seed] Operator upserted: ${operator.id} (${operator.email})`);

    // 3. Create default playbook for agency if none exists
    const existingPlaybook = await prisma.agencyPlaybook.findUnique({
      where: { agencyId: agency.id },
    });

    if (!existingPlaybook) {
      await prisma.agencyPlaybook.create({
        data: {
          agencyId: agency.id,
          toneStyle: "UK recruiter, friendly, direct",
          maxQuestionsPerMessage: 2,
          greetingStyle: "SHORT",
          forbiddenPhrases: [],
          requiredChecks: {},
          escalationRules: {},
          signatureStyle: "NONE",
        } as any,
      });

      // eslint-disable-next-line no-console
      console.log(`[seed] Created default playbook for agency: ${agency.id}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`[seed] Playbook already exists for agency: ${agency.id}`);
    }

    // 4. Create demo job if none exist
    const existingJobs = await prisma.job.findMany({
      where: { agencyId: agency.id },
      take: 1,
    });

    if (existingJobs.length === 0) {
      const demoJob = await prisma.job.create({
        data: {
          agencyId: agency.id,
          title: "Maidstone Residential Development",
          tradeRequired: "Labourer",
          status: JobStatus.URGENT,
          startDate: new Date("2026-01-20"),
          durationWeeks: 12,
          hoursPerDay: 8,
          daysPerWeek: 5,
          positionsOpen: 2,
          positionsFilled: 0,
          siteName: "Maidstone Residential Development Site",
          addressLine1: "123 Construction Road",
          addressLine2: "Maidstone Industrial Estate",
          postcode: "ME14 1AB",
          city: "Maidstone",
          clientName: "ABC Construction Ltd",
          clientType: "Main Contractor",
          siteManagerName: "John Smith",
          siteManagerPhone: "+44 7700 900123",
          isPremiumClient: true,
          requirementsJson: {
            mustHave: [
              { label: "CSCS Card", value: "Green required" },
              { label: "PPE", value: "Standard (hard hat, hi-vis, boots, gloves)" },
            ],
            preferred: [
              { label: "Language", value: "Polish speakers preferred" },
            ],
            notes: [
              "Must be comfortable with heavy lifting",
              "Previous construction experience preferred",
            ],
          },
          notes: "Urgent start required. Site is active and needs immediate coverage. Good rates and regular work available.",
          payRate: 18.50,
          chargeRate: 25.00,
          currency: "GBP",
        } as any,
      });

      // eslint-disable-next-line no-console
      console.log(`[seed] Created demo job: ${demoJob.id} (${demoJob.title})`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`[seed] Jobs already exist, skipping demo job creation`);
    }

    // Note: Step numbering continues from above

    // eslint-disable-next-line no-console
    console.log("\n========================================");
    // eslint-disable-next-line no-console
    console.log("✅ Seed completed successfully!");
    // eslint-disable-next-line no-console
    console.log("\n📧 Login credentials:");
    // eslint-disable-next-line no-console
    console.log(`   Email: ${adminEmail}`);
    // eslint-disable-next-line no-console
    console.log(`   Password: ${adminPassword}`);
    // eslint-disable-next-line no-console
    console.log("========================================\n");

    return { agency, operator };
  } finally {
    await prisma.$disconnect();
  }
}

// Prisma runs the configured seed command as a script. We invoke `seed()` when
// executed directly via `prisma db seed`.
seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[seed] Failed:", err);
  process.exitCode = 1;
});


