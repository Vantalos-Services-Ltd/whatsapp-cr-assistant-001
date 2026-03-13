import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function checkTasks() {
  const tasks = await prisma.task.findMany({
    include: {
      relatedMessage: {
        select: {
          id: true,
          senderRole: true,
          direction: true,
          text: true,
        },
      },
    },
  });

  console.log(`Found ${tasks.length} tasks:\n`);
  
  tasks.forEach((t) => {
    console.log(`Task ID: ${t.id}`);
    console.log(`  Type: ${t.type}`);
    console.log(`  Status: ${t.status}`);
    console.log(`  ApprovalStatus: ${t.approvalStatus}`);
    console.log(`  RelatedMessageId: ${t.relatedMessageId || "NULL"}`);
    if (t.relatedMessage) {
      console.log(`  RelatedMessage: ${t.relatedMessage.senderRole} ${t.relatedMessage.direction}`);
      console.log(`  Message Text: "${t.relatedMessage.text.substring(0, 50)}..."`);
    } else {
      console.log(`  RelatedMessage: NULL (orphaned task)`);
    }
    console.log(`  CreatedAt: ${t.createdAt}`);
    console.log("");
  });

  const orphanedTasks = tasks.filter((t) => !t.relatedMessage);
  console.log(`\nOrphaned tasks (no relatedMessage): ${orphanedTasks.length}`);
  
  if (orphanedTasks.length > 0) {
    console.log("These tasks should be cleaned up as they have no related message.");
  }

  await prisma.$disconnect();
}

checkTasks().catch(console.error);

