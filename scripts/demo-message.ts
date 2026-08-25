/**
 * DEMO: simulate an inbound WhatsApp message.
 *
 * Creates a real inbound message in the database exactly as the Twilio webhook
 * would, then pushes it through the normal processing queue. Everything
 * downstream is the real pipeline: intent classification, candidate profile
 * extraction, memory pack update, progress state machine, AI reply drafting,
 * safety gate, and task creation.
 *
 * Usage:
 *   pnpm demo:message "Danny" "I can start Monday, got my CSCS card too"
 *   pnpm demo:message +447700900101 "what's the rate on that job?"
 *   pnpm demo:message --list
 */

import dotenv from "dotenv";
dotenv.config();

import { PrismaClient } from "@prisma/client";
import { enqueueInboundMessage } from "../src/queues/inboundQueue.ts";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);

  const agency = await prisma.agency.findFirst({ orderBy: { createdAt: "asc" } });
  if (!agency) {
    console.error("No agency found. Run:  pnpm demo:seed");
    process.exit(1);
  }

  if (args.length === 0 || args[0] === "--list" || args[0] === "-l") {
    const contacts = await prisma.contact.findMany({
      where: { agencyId: agency.id, type: "CANDIDATE" },
      include: { conversations: { select: { progressStage: true }, take: 1 } },
      orderBy: { name: "asc" },
    });
    console.log("\nWho you can send a message as:\n");
    for (const c of contacts) {
      const stage = c.conversations[0]?.progressStage ?? "—";
      console.log(`  ${(c.name ?? "Unknown").padEnd(18)} ${c.phone.replace("whatsapp:", "").padEnd(16)} ${stage}`);
    }
    console.log(`\nExample:\n  pnpm demo:message "Danny" "I'm free from Monday and I've got my CSCS card"\n`);
    return;
  }

  const [who, ...rest] = args;
  const text = rest.join(" ");
  if (!text) {
    console.error('Give me a message. Example:  pnpm demo:message "Danny" "I can start Monday"');
    process.exit(1);
  }

  // Resolve the person by name fragment or phone number
  const needle = who.replace(/^whatsapp:/, "").replace(/^\+/, "");
  const contact = await prisma.contact.findFirst({
    where: {
      agencyId: agency.id,
      OR: [
        { name: { contains: who, mode: "insensitive" } },
        { phone: { contains: needle } },
      ],
    },
  });

  if (!contact) {
    console.error(`Couldn't find anyone matching "${who}". Try:  pnpm demo:message --list`);
    process.exit(1);
  }

  const conversation = await prisma.conversation.findFirst({
    where: { agencyId: agency.id, contactId: contact.id },
  });
  if (!conversation) {
    console.error(`${contact.name} has no conversation yet. Run:  pnpm demo:seed`);
    process.exit(1);
  }

  const candidate = await prisma.candidate.findUnique({
    where: { agencyId_phone: { agencyId: agency.id, phone: contact.phone } },
    select: { id: true },
  });

  const message = await prisma.message.create({
    data: {
      agencyId: agency.id,
      contactId: contact.id,
      conversationId: conversation.id,
      direction: "INBOUND",
      channel: "WHATSAPP",
      senderRole: "HUMAN",
      text,
      providerMessageId: `SMDEMO${Date.now().toString(16)}`,
      deliveryStatus: "SENT",
      rawPayload: { demo: true, From: contact.phone, Body: text },
      candidateId: candidate?.id ?? null,
    },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });

  await enqueueInboundMessage(agency.id, message.id);

  console.log(`\n📲  Message sent as ${contact.name}:`);
  console.log(`    "${text}"\n`);
  console.log(`    Conversation: http://localhost:3000/operator/messages`);
  console.log(`    Inbox:        http://localhost:3000/operator/inbox\n`);
  console.log(`    The worker is processing it now — refresh the console in a few seconds.`);
  console.log(`    Watch it happen live with:  pnpm logs\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); process.exit(0); });
