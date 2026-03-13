/**
 * Verification script to check database state after cleanup
 */

import { PrismaClient, MessageSenderRole } from "@prisma/client";

const prisma = new PrismaClient();

async function verifyState() {
  console.log("Verifying database state after cleanup...\n");

  // Get all messages
  const messages = await prisma.message.findMany({
    include: {
      contact: true,
      conversation: true,
      relatedTasks: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Total Messages: ${messages.length}`);
  messages.forEach((m) => {
    console.log(
      `  - ${m.senderRole} ${m.direction}: "${m.text.substring(0, 50)}${m.text.length > 50 ? "..." : ""}"`
    );
    console.log(`    Contact: ${m.contact.phone}, Tasks: ${m.relatedTasks.length}`);
  });

  // Get all contacts
  const contacts = await prisma.contact.findMany({
    include: {
      _count: {
        select: {
          messages: {
            where: {
              senderRole: MessageSenderRole.HUMAN,
            },
          },
        },
      },
    },
  });

  console.log(`\nTotal Contacts: ${contacts.length}`);
  contacts.forEach((c) => {
    console.log(`  - ${c.phone} (${c.name || "No name"}) - ${c._count.messages} HUMAN messages`);
  });

  // Get all conversations
  const conversations = await prisma.conversation.findMany({
    include: {
      contact: true,
      _count: {
        select: {
          messages: true,
        },
      },
    },
  });

  console.log(`\nTotal Conversations: ${conversations.length}`);
  conversations.forEach((c) => {
    console.log(
      `  - Contact: ${c.contact.phone}, Total Messages: ${c._count.messages}`
    );
  });

  // Get all tasks
  const tasks = await prisma.task.findMany({
    include: {
      relatedMessage: {
        select: {
          senderRole: true,
          direction: true,
        },
      },
    },
  });

  console.log(`\nTotal Tasks: ${tasks.length}`);
  tasks.forEach((t) => {
    const msgRole = t.relatedMessage?.senderRole || "N/A";
    const msgDir = t.relatedMessage?.direction || "N/A";
    console.log(`  - ${t.type} (Message: ${msgRole} ${msgDir})`);
  });

  // Verification checks
  console.log("\n=== Verification Checks ===");

  // Check 1: One HUMAN message + one AI reply → 1 contact, 1 conversation, 0 tasks
  const humanMessages = messages.filter((m) => m.senderRole === MessageSenderRole.HUMAN);
  const aiMessages = messages.filter((m) => m.senderRole === MessageSenderRole.AI);
  const operatorMessages = messages.filter((m) => m.senderRole === MessageSenderRole.OPERATOR);

  console.log(`\n1. Message counts:`);
  console.log(`   HUMAN: ${humanMessages.length}`);
  console.log(`   AI: ${aiMessages.length}`);
  console.log(`   OPERATOR: ${operatorMessages.length}`);

  console.log(`\n2. Contact count: ${contacts.length} (should be 1 for 1 HUMAN message)`);
  console.log(`   ✅ ${contacts.length === 1 ? "PASS" : "FAIL"}`);

  console.log(`\n3. Conversation count: ${conversations.length} (should be 1 for 1 HUMAN message)`);
  console.log(`   ✅ ${conversations.length === 1 ? "PASS" : "FAIL"}`);

  console.log(`\n4. Task count: ${tasks.length} (should be 0 for safe intents)`);
  console.log(`   ✅ ${tasks.length === 0 ? "PASS" : "FAIL"}`);

  // Check 5: No tasks from AI messages
  const tasksFromAi = tasks.filter(
    (t) => t.relatedMessage?.senderRole === MessageSenderRole.AI
  );
  console.log(`\n5. Tasks from AI messages: ${tasksFromAi.length} (should be 0)`);
  console.log(`   ✅ ${tasksFromAi.length === 0 ? "PASS" : "FAIL"}`);

  // Check 6: All contacts should have HUMAN messages
  const contactsWithoutHumanMessages = contacts.filter((c) => c._count.messages === 0);
  console.log(`\n6. Contacts without HUMAN messages: ${contactsWithoutHumanMessages.length} (should be 0)`);
  console.log(`   ✅ ${contactsWithoutHumanMessages.length === 0 ? "PASS" : "FAIL"}`);

  console.log("\n✅ Verification complete!");
}

verifyState()
  .catch((error) => {
    console.error("❌ Verification failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

