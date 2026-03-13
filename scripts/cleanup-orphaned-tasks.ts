import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function cleanupOrphanedTasks() {
  console.log("Cleaning up orphaned tasks (no relatedMessage)...\n");

  const result = await prisma.task.deleteMany({
    where: {
      relatedMessageId: null,
    },
  });

  console.log(`Deleted ${result.count} orphaned tasks\n`);
  console.log("✅ Cleanup complete!");

  await prisma.$disconnect();
}

cleanupOrphanedTasks().catch(console.error);

