/**
 * Cleanup script to remove AI-created artifacts
 * 
 * This script:
 * 1. Deletes contacts created for the AI number
 * 2. Deletes conversations where the participant is the AI number
 * 3. Deletes tasks created from AI messages
 * 4. Recomputes dashboard counters correctly
 * 
 * Run with: pnpm tsx scripts/cleanup-ai-artifacts.ts
 */

import { PrismaClient, MessageSenderRole } from "@prisma/client";
import { env } from "../src/config/env.js";

const prisma = new PrismaClient();

async function cleanupAiArtifacts() {
  console.log("Starting cleanup of AI-created artifacts...\n");

  // Get Twilio WhatsApp number (normalize for comparison)
  const twilioNumber = env.TWILIO_WHATSAPP_NUMBER.replace(/^whatsapp:/i, "").trim();
  console.log(`Twilio WhatsApp Number: ${twilioNumber}\n`);

  // 1. Find and delete contacts created for the AI number
  console.log("1. Finding contacts created for AI number...");
  const aiContacts = await prisma.contact.findMany({
    where: {
      phone: {
        contains: twilioNumber,
      },
    },
    include: {
      _count: {
        select: {
          messages: true,
          conversations: true,
        },
      },
    },
  });

  console.log(`   Found ${aiContacts.length} contacts for AI number`);
  
  if (aiContacts.length > 0) {
    // Delete messages from AI contacts first (cascade will handle conversations)
    for (const contact of aiContacts) {
      const deletedMessages = await prisma.message.deleteMany({
        where: {
          contactId: contact.id,
        },
      });
      console.log(`   Deleted ${deletedMessages.count} messages from contact ${contact.id}`);
    }

    // Delete conversations from AI contacts
    for (const contact of aiContacts) {
      const deletedConversations = await prisma.conversation.deleteMany({
        where: {
          contactId: contact.id,
        },
      });
      console.log(`   Deleted ${deletedConversations.count} conversations from contact ${contact.id}`);
    }

    // Delete AI contacts
    const deletedContacts = await prisma.contact.deleteMany({
      where: {
        id: {
          in: aiContacts.map((c) => c.id),
        },
      },
    });
    console.log(`   Deleted ${deletedContacts.count} AI contacts\n`);
  } else {
    console.log("   No AI contacts found\n");
  }

  // 2. Find and delete conversations where participant is the AI number
  // (This catches any conversations that might have been created differently)
  console.log("2. Finding conversations with AI number as participant...");
  const aiConversations = await prisma.conversation.findMany({
    where: {
      contact: {
        phone: {
          contains: twilioNumber,
        },
      },
    },
    include: {
      contact: true,
    },
  });

  console.log(`   Found ${aiConversations.length} conversations with AI number as participant`);
  
  if (aiConversations.length > 0) {
    // Delete messages from these conversations first
    for (const conversation of aiConversations) {
      const deletedMessages = await prisma.message.deleteMany({
        where: {
          conversationId: conversation.id,
        },
      });
      console.log(`   Deleted ${deletedMessages.count} messages from conversation ${conversation.id}`);
    }

    // Delete conversations
    const deletedConversations = await prisma.conversation.deleteMany({
      where: {
        id: {
          in: aiConversations.map((c) => c.id),
        },
      },
    });
    console.log(`   Deleted ${deletedConversations.count} AI conversations\n`);
  } else {
    console.log("   No AI conversations found\n");
  }

  // 3. Find and delete tasks created from AI messages
  console.log("3. Finding tasks created from AI messages...");
  const aiTasks = await prisma.task.findMany({
    where: {
      relatedMessage: {
        senderRole: MessageSenderRole.AI,
      },
    },
    include: {
      relatedMessage: {
        select: {
          id: true,
          senderRole: true,
        },
      },
    },
  });

  console.log(`   Found ${aiTasks.length} tasks created from AI messages`);
  
  if (aiTasks.length > 0) {
    const deletedTasks = await prisma.task.deleteMany({
      where: {
        id: {
          in: aiTasks.map((t) => t.id),
        },
      },
    });
    console.log(`   Deleted ${deletedTasks.count} tasks created from AI messages\n`);
  } else {
    console.log("   No tasks from AI messages found\n");
  }

  // 4. Verify cleanup: Count remaining AI messages
  console.log("4. Verifying cleanup...");
  const remainingAiMessages = await prisma.message.count({
    where: {
      senderRole: MessageSenderRole.AI,
    },
  });
  console.log(`   Remaining AI messages: ${remainingAiMessages} (these should remain as they're part of conversation threads)\n`);

  // 5. Verify: Count HUMAN messages
  const humanMessages = await prisma.message.count({
    where: {
      senderRole: MessageSenderRole.HUMAN,
    },
  });
  console.log(`   HUMAN messages: ${humanMessages}\n`);

  // 6. Verify: Count OPERATOR messages
  const operatorMessages = await prisma.message.count({
    where: {
      senderRole: MessageSenderRole.OPERATOR,
    },
  });
  console.log(`   OPERATOR messages: ${operatorMessages}\n`);

  // 7. Verify: Count contacts (should only be HUMAN contacts now)
  const allContacts = await prisma.contact.count();
  console.log(`   Total contacts: ${allContacts} (should only be HUMAN contacts)\n`);

  // 8. Verify: Count conversations (should only be HUMAN conversations now)
  const allConversations = await prisma.conversation.count();
  console.log(`   Total conversations: ${allConversations} (should only be HUMAN conversations)\n`);

  // 9. Verify: Count tasks (should only be from HUMAN messages now)
  const allTasks = await prisma.task.count({
    where: {
      relatedMessage: {
        senderRole: {
          not: MessageSenderRole.AI, // Should not have any AI tasks
        },
      },
    },
  });
  console.log(`   Tasks from HUMAN messages: ${allTasks}\n`);

  console.log("✅ Cleanup completed successfully!");
}

cleanupAiArtifacts()
  .catch((error) => {
    console.error("❌ Cleanup failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

