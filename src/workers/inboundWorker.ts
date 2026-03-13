import { Worker, type Job } from "bullmq";
import pino from "pino";
import { PrismaClient, TaskStatus, TaskType, MessageDirection, MessageSenderRole } from "@prisma/client";
import { scopeWhere } from "../db/tenantScope.ts";
import { serializeError } from "../utils/errors.ts";

// ConversationState enum (will be available after Prisma client regeneration)
type ConversationStateType = "ACTIVE" | "PAUSED_FOR_APPROVAL" | "PAUSED" | "CLOSED";
const ConversationState: Record<ConversationStateType, ConversationStateType> = {
  ACTIVE: "ACTIVE",
  PAUSED_FOR_APPROVAL: "PAUSED_FOR_APPROVAL",
  PAUSED: "PAUSED",
  CLOSED: "CLOSED",
} as const;
import { connectionOptions } from "../queues/queue.ts";
import { classifyInboundIntent } from "../services/intentClassifier.ts";
import { classifyIntentWithAI } from "../services/aiIntentClassifier.ts";
import { suggestActionWithAI } from "../services/aiActionSuggester.ts";
import { sendAutoReply } from "../services/autoReply.ts";
import { extractCandidateProfile, upsertCandidateProfile } from "../services/candidateExtractor.ts";
import { isIntentSafeForAutoReply, isGreetingMessage, isClarificationMessage } from "../services/intentSafety.ts";
import { requiresEscalation } from "../services/replyStrategy.ts";
import { matchJobsForCandidate } from "../services/jobMatcher.ts";
import { enrichPayloadWithJobSnapshot } from "../services/jobSnapshot.ts";
import { updateMemoryPackAndProgress } from "../services/memoryPackUpdater.ts";
import { mergeNonNull } from "../../shared/types/memoryPack.ts";
import { sanitizeMemoryPack } from "../../shared/types/memoryPack.ts";
import { createTimelineEvent } from "../services/timelineService.ts";
import { applyProgressStateMachine } from "../services/progress/stateMachine.ts";
import type { CandidateSnapshot, TaskFlags, PlacementStatus } from "../services/progress/stateMachineTypes.ts";
import type { Explainability } from "../../shared/types/explainability.ts";
import { createRulesExplainability, sanitizeExplainability } from "../../shared/types/explainability.ts";
import {
  shouldTranscribe,
  transcribeAudioFromUrl,
  hasExistingTranscript,
  updateMessageTranscript,
  type MediaItem,
} from "../services/transcriptionService.ts";
import { getPlaybook } from "../services/playbook/playbookService.ts";
import type { AgencyPlaybook } from "../shared/playbook.ts";
import { resolveOpenQuestions } from "../services/continuity/openQuestionResolver.ts";
import {
  getRequiredQuestionsFromProgress,
  buildPromptTextForKey,
  shouldAskQuestion,
  addOpenQuestion,
} from "../services/continuity/openQuestionRules.ts";
import type { OpenQuestion } from "../../shared/types/memoryPack.ts";
import { processStaleOpenQuestions } from "../services/continuity/followUpTaskCreator.ts";

console.log(
  "[DEBUG] AI flag:",
  process.env.ENABLE_AI_INTENT_CLASSIFIER,
  "OpenAI key present:",
  !!process.env.OPENAI_API_KEY
);

const log = pino({ name: "inboundWorker" });
const prisma = new PrismaClient();

import type { InboundJobData } from "../queues/inboundQueue.ts";

/**
 * Helper to get candidateId from message
 * Prefers conversation.candidateId if exists, else queries by phone
 */
async function getCandidateId(
  agencyId: string,
  phone: string,
  conversation?: any
): Promise<string | null> {
  // Check if conversation has candidateId (if we add this relation later)
  if (conversation?.candidateId) {
    return conversation.candidateId;
  }

  // Query candidate by phone
  try {
    const candidate = await prisma.candidate.findUnique({
      where: {
        agencyId_phone: {
          agencyId,
          phone,
        },
      },
      select: { id: true },
    });
    return candidate?.id || null;
  } catch (error) {
    log.warn({ agencyId, phone, error }, "Failed to query candidate by phone");
    return null;
  }
}

/**
 * Helper to check for existing task by conversationId + type + relatedMessageId
 * Used for replay mode deduplication
 */
async function findExistingTaskForReplay(
  agencyId: string,
  conversationId: string,
  taskType: TaskType,
  inboundMessageId: string
): Promise<any | null> {
  return await prisma.task.findFirst({
    where: scopeWhere(agencyId, {
      status: TaskStatus.OPEN,
      type: taskType,
      relatedMessageId: inboundMessageId,
      OR: [
        {
          relatedMessage: {
            conversationId,
          },
        },
        {
          payload: {
            path: ["conversationId"],
            equals: conversationId,
          },
        },
      ],
    }),
    include: {
      relatedMessage: true,
    },
  });
}

/**
 * Helper to normalize pendingReplyText from various sources
 * Checks proposedAction.suggestedMessage first, then payload.proposedAction.suggestedMessage
 */
function normalizePendingReplyText(
  proposedAction: any,
  payload: any
): string | null {
  // First check: proposedAction.suggestedMessage (top-level)
  if (proposedAction?.suggestedMessage) {
    return proposedAction.suggestedMessage;
  }

  // Second check: payload.proposedAction.suggestedMessage (nested in payload)
  if (payload?.proposedAction?.suggestedMessage) {
    return payload.proposedAction.suggestedMessage;
  }

  return null;
}

/**
 * Helper to ensure explainability is present in proposedAction and payload
 * Creates RULES explainability if missing from AI suggestion
 */
function ensureExplainabilityInProposedAction(
  proposedAction: any,
  payload: any,
  options: {
    missingFields?: string[];
    intent?: string;
    memoryPack?: any;
    candidateName?: string | null;
    desiredRole?: string | null;
  }
): { proposedAction: any; explainability: Explainability; enrichedPayload: any } {
  let explainability: Explainability | undefined = undefined;

  // Try to extract explainability from proposedAction
  if (proposedAction?.explainability) {
    try {
      explainability = sanitizeExplainability(proposedAction.explainability);
    } catch (error) {
      log.warn({ error }, "Failed to parse explainability from proposedAction");
    }
  }

  // If missing, create RULES explainability
  if (!explainability) {
    const usedFacts: string[] = [];
    if (options.memoryPack?.facts?.trade) {
      usedFacts.push(`Trade: ${options.memoryPack.facts.trade}`);
    }
    if (options.memoryPack?.facts?.location) {
      usedFacts.push(`Location: ${options.memoryPack.facts.location}`);
    }
    if (options.memoryPack?.facts?.availability) {
      usedFacts.push(`Availability: ${options.memoryPack.facts.availability}`);
    }
    if (options.candidateName) {
      usedFacts.push(`Name: ${options.candidateName}`);
    }
    if (options.desiredRole) {
      usedFacts.push(`Desired role: ${options.desiredRole}`);
    }

    const missingInfo: string[] = [];
    if (options.missingFields) {
      missingInfo.push(...options.missingFields.slice(0, 6));
    }
    if (options.intent === "UNKNOWN") {
      missingInfo.push("Clear intent");
    }

    const riskLevel = (proposedAction?.riskLevel || "MEDIUM") as "LOW" | "MEDIUM" | "HIGH";
    const rationale = proposedAction?.reasoning
      ? [proposedAction.reasoning]
      : ["Deterministic fallback message generated"];

    explainability = createRulesExplainability({
      riskLevel,
      rationale,
      usedFacts,
      uncertainty: "Some details are missing",
      missingInfo,
      alternatives: [],
    });
  }

  // Ensure proposedAction has explainability
  const enrichedProposedAction = {
    ...proposedAction,
    explainability,
    riskLevel: explainability.riskLevel,
  };

  // Store explainability in payload as well
  const enrichedPayload = {
    ...payload,
    proposedAction: {
      ...(payload.proposedAction || {}),
      explainability,
      riskLevel: explainability.riskLevel,
      usedFactsSnapshot: explainability.usedFacts,
    },
  };

  return {
    proposedAction: enrichedProposedAction,
    explainability,
    enrichedPayload,
  };
}

/**
 * Generate a fallback UK recruiter style reply message for approval scenarios.
 * 
 * This is a deterministic helper that creates safe, professional messages
 * without requiring AI. It tailors the message slightly if location or trade
 * hints are detected in the inbound text.
 * 
 * @param intent - The classified intent of the inbound message
 * @param inboundText - The original message text from the candidate
 * @param candidateName - Optional candidate name for personalization
 * @param desiredRole - Optional desired role/trade from candidate profile
 * @returns A short UK recruiter style message
 */
function getFallbackReplyForApproval({
  intent,
  inboundText,
  candidateName,
  desiredRole,
}: {
  intent: string;
  inboundText: string;
  candidateName?: string | null;
  desiredRole?: string | null;
}): string {
  const text = inboundText.toLowerCase().trim();
  
  // Common UK location patterns (cities, regions, postcodes)
  const locationPatterns = [
    /\b(london|manchester|birmingham|leeds|glasgow|edinburgh|liverpool|bristol|cardiff|belfast)\b/,
    /\b(kent|essex|surrey|yorkshire|lancashire|devon|cornwall|scotland|wales|northern ireland)\b/,
    /\b([a-z]{1,2}\d{1,2}\s?\d[a-z]{2})\b/, // UK postcode pattern (e.g., "SW1A 1AA", "M1 1AA")
    /\b(north|south|east|west)\s+[a-z]+\b/, // Directional regions
    /\b(based in|from|in|near|around)\s+[a-z]+\b/, // Location phrases
  ];
  
  // Common trade/role patterns
  const tradePatterns = [
    /\b(bricklayer|brick layer|brickie)\b/,
    /\b(carpenter|chippy|joiner)\b/,
    /\b(electrician|sparky)\b/,
    /\b(plumber|plumbing)\b/,
    /\b(plasterer|plastering)\b/,
    /\b(roofer|roofing)\b/,
    /\b(painter|decorator|painting)\b/,
    /\b(groundworker|ground worker)\b/,
    /\b(operator|machine operator|plant operator)\b/,
    /\b(driver|hgv|hgv driver|class 1|class 2)\b/,
    /\b(warehouse|warehouse operative|picker|packer)\b/,
    /\b(forklift|fork lift|flt)\b/,
    /\b(labourer|labour|general operative)\b/,
    /\b(trade|tradesman|tradesperson)\b/,
  ];
  
  const hasLocationHint = locationPatterns.some(pattern => pattern.test(text));
  const hasTradeHint = tradePatterns.some(pattern => pattern.test(text)) || 
                       (desiredRole && text.includes(desiredRole.toLowerCase()));
  
  // Use desiredRole if available and not already mentioned in text
  const tradeMentioned = desiredRole && text.includes(desiredRole.toLowerCase());
  const relevantTrade = tradeMentioned ? desiredRole : desiredRole;
  
  // Build personalized greeting if name available
  const greeting = candidateName ? `Hi ${candidateName.split(' ')[0]}, ` : "";
  
  // Tailor message based on intent and detected hints
  switch (intent) {
    case "LOOKING_FOR_WORK":
      if (hasLocationHint && hasTradeHint) {
        return `${greeting}Got you. Just to confirm, what trade are you looking for and what area are you based in?`;
      } else if (hasLocationHint) {
        return `${greeting}Got you. Just to confirm, what trade are you looking for and what area are you based in?`;
      } else if (hasTradeHint || relevantTrade) {
        return `${greeting}Got you. Just to confirm, what area are you based in and when are you available?`;
      } else {
        return `${greeting}Got you. Just to confirm, what trade are you looking for and what area are you based in?`;
      }
    
    case "AVAILABILITY_UPDATE":
      if (hasLocationHint && hasTradeHint) {
        return `${greeting}Noted, cheers. Just to confirm, what trade are you looking for and what area are you based in?`;
      } else if (hasLocationHint) {
        return `${greeting}Noted, cheers. Just to confirm, what trade are you looking for?`;
      } else if (hasTradeHint || relevantTrade) {
        return `${greeting}Noted, cheers. Just to confirm, what area are you based in?`;
      } else {
        return `${greeting}Noted, cheers. Just to confirm, what trade are you looking for and what area are you based in?`;
      }
    
    case "JOB_QUERY":
      if (hasLocationHint && hasTradeHint) {
        return `${greeting}Got it. Just to confirm, what trade are you looking for and what area are you based in?`;
      } else if (hasLocationHint) {
        return `${greeting}Got it. Just to confirm, what trade are you looking for?`;
      } else if (hasTradeHint || relevantTrade) {
        return `${greeting}Got it. Just to confirm, what area are you based in?`;
      } else {
        return `${greeting}Got it. Just to confirm, what trade are you looking for and what area are you based in?`;
      }
    
    case "FOLLOW_UP":
      return `${greeting}Got it. Just checking this and I'll come back to you.`;
    
    case "UNKNOWN":
    default:
      if (hasLocationHint && hasTradeHint) {
        return `${greeting}Got you. Just to confirm, what trade are you looking for and what area are you based in?`;
      } else if (hasLocationHint) {
        return `${greeting}Got you. Just to confirm, what trade are you looking for?`;
      } else if (hasTradeHint || relevantTrade) {
        return `${greeting}Got you. Just to confirm, what area are you based in?`;
      } else {
        return `${greeting}Got you. Just to confirm, what trade are you looking for and what area are you based in?`;
      }
  }
}

/**
 * Helper to enrich payload with job matches if candidateId is available
 */
async function enrichPayloadWithJobMatches(
  agencyId: string,
  phone: string,
  conversation: any,
  existingPayload: any
): Promise<any> {
  try {
    const candidateId = await getCandidateId(agencyId, phone, conversation);
    if (!candidateId) {
      return existingPayload;
    }

    const jobMatches = await matchJobsForCandidate({
      agencyId,
      candidateId,
      limit: 3,
    });

    return {
      ...existingPayload,
      jobMatches: {
        ...jobMatches,
        generatedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    log.warn(
      { agencyId, phone, error },
      "Failed to enrich payload with job matches; continuing without them"
    );
    return existingPayload;
  }
}

async function processInboundMessage(job: Job<InboundJobData>) {
  const { agencyId, messageId, replay, dryRun, allowSendOutbound, forceRecomputeMemory, forceRecomputeProgress } = job.data ?? {};

  if (!agencyId) {
    log.warn({ jobId: job.id, jobName: job.name }, "Missing agencyId in job data");
    return;
  }

  if (!messageId) {
    log.warn({ jobId: job.id, jobName: job.name }, "Missing messageId in job data");
    return;
  }

  // If replay mode, emit REPLAY_INBOUND_STARTED event
  if (replay) {
    try {
      // We'll need to fetch message first to get conversationId
      const messageForEvent = await prisma.message.findFirst({
        where: { id: messageId, agencyId },
        select: { conversationId: true, contactId: true },
      });

      if (messageForEvent && messageForEvent.conversationId && messageForEvent.contactId) {
        await createTimelineEvent({
          agencyId,
          conversationId: messageForEvent.conversationId,
          contactId: messageForEvent.contactId,
          type: "REPLAY_INBOUND_STARTED",
          actorRole: "SYSTEM",
          summary: "Replaying inbound message processing",
          data: {
            messageId,
            jobId: job.id,
            dryRun: dryRun ?? true,
            allowSendOutbound: allowSendOutbound ?? false,
          },
          dedupeKey: `replay_${job.id}`, // Use job id to prevent duplicates
        });
      }
    } catch (error) {
      log.warn({ jobId: job.id, error }, "Failed to create REPLAY_INBOUND_STARTED timeline event (non-blocking)");
    }
  }

  // Fetch message with agency scoping (use findFirst since id is globally unique but not tenant-scoped in unique constraint)
  const message = await prisma.message.findFirst({
    where: {
      id: messageId,
      agencyId, // Ensure message belongs to the agency from job payload
    },
    include: {
      contact: true,
      conversation: {
        include: {
          messages: {
            orderBy: { createdAt: "desc" },
            take: 10, // Get last 10 messages for context
            select: {
              direction: true,
              text: true,
              createdAt: true,
            },
          },
        },
      },
    },
  }) as any; // Type assertion needed until Prisma client is fully regenerated

  if (!message) {
    log.warn({ messageId, agencyId, jobId: job.id }, "Message not found or does not belong to agency; skipping");
    return;
  }

  // Verify message.agencyId matches job agencyId (defense in depth)
  if (message.agencyId !== agencyId) {
    log.warn(
      { messageId, messageAgencyId: message.agencyId, jobAgencyId: agencyId, jobId: job.id },
      "Message agencyId mismatch; skipping"
    );
    return;
  }

  // Extract textForAI from metadata (transcript if available, else original text)
  const metadata = message.metadata as any;
  const textForAI = metadata?.textForAI || message.text;

  // Load playbook once for this message processing (memoized per worker tick)
  const playbook = await getPlaybook(agencyId);

  /**
   * Helper to extract textForAI from a message object
   */
  function getTextForAI(msg: any): string {
    const msgMetadata = msg.metadata as any;
    return msgMetadata?.textForAI || msg.text;
  }

  // Emit MEDIA_RECEIVED timeline event if media exists
  if (metadata?.media && Array.isArray(metadata.media) && metadata.media.length > 0) {
    const mediaItems = metadata.media as MediaItem[];
    const kinds = Array.from(new Set(mediaItems.map((m) => m.kind)));
    
    try {
      await createTimelineEvent({
        agencyId: message.agencyId,
        conversationId: message.conversationId,
        contactId: message.contactId,
        candidateId: await getCandidateId(message.agencyId, message.contact.phone, message.conversation) || null,
        type: "MEDIA_RECEIVED",
        actorRole: "SYSTEM",
        summary: `Received ${mediaItems.length} media file${mediaItems.length > 1 ? "s" : ""}`,
        data: {
          count: mediaItems.length,
          kinds: kinds,
        },
        dedupeKey: `${message.id}_media_received`,
      });
    } catch (error) {
      log.warn({ messageId: message.id, error }, "Failed to create MEDIA_RECEIVED timeline event (non-blocking)");
    }
  }

  // Process media transcription (if any audio media)
  if (metadata?.media && Array.isArray(metadata.media)) {
    const mediaItems = metadata.media as MediaItem[];
    
    for (const mediaItem of mediaItems) {
      // Check if should transcribe
      const { should, reason } = shouldTranscribe(mediaItem);
      
      if (!should) {
        if (reason && reason.includes("too long") || reason?.includes("too large")) {
          // Create approval task for too large audio
          log.info(
            { messageId, mediaSid: mediaItem.sid, reason },
            "Audio too large for automatic transcription, creating approval task"
          );
          
          try {
            await prisma.task.create({
              data: {
                agencyId: message.agencyId,
                type: TaskType.APPROVAL_REQUIRED,
                status: TaskStatus.OPEN,
                approvalStatus: "PENDING" as any,
                relatedMessageId: message.id,
                candidateId: await getCandidateId(message.agencyId, message.contact.phone, message.conversation) || null,
                payload: {
                  reason: "Voice note too long: manual review",
                  mediaSid: mediaItem.sid,
                  mediaUrl: mediaItem.url,
                  durationSeconds: mediaItem.durationSeconds,
                  sizeBytes: mediaItem.sizeBytes,
                } as any,
              },
            });

            await createTimelineEvent({
              agencyId: message.agencyId,
              conversationId: message.conversationId,
              contactId: message.contactId,
              candidateId: await getCandidateId(message.agencyId, message.contact.phone, message.conversation) || null,
              type: "TASK_CREATED",
              actorRole: "SYSTEM",
              summary: "Voice note too long: manual review required",
              data: {
                taskType: "APPROVAL_REQUIRED",
                reason: "Voice note too long: manual review",
                mediaSid: mediaItem.sid,
              },
            });
          } catch (error) {
            log.error({ messageId, mediaSid: mediaItem.sid, error }, "Failed to create approval task for large audio");
          }
        }
        continue;
      }

      // Check idempotency
      const hasTranscript = await hasExistingTranscript(message.id, mediaItem.sid);
      if (hasTranscript) {
        log.debug({ messageId, mediaSid: mediaItem.sid }, "Transcript already exists, skipping");
        continue;
      }

      // Transcribe audio
      try {
        log.info({ messageId, mediaSid: mediaItem.sid, url: mediaItem.url }, "Starting audio transcription");
        
        const transcript = await transcribeAudioFromUrl(mediaItem.url, {
          timeoutMs: 60000, // 60 seconds timeout
        });

        // Update message metadata with transcript
        await updateMessageTranscript(message.id, mediaItem.sid, transcript);

        // Create timeline event (only metadata, no full transcript)
        await createTimelineEvent({
          agencyId: message.agencyId,
          conversationId: message.conversationId,
          contactId: message.contactId,
          candidateId: await getCandidateId(message.agencyId, message.contact.phone, message.conversation) || null,
          type: "VOICE_TRANSCRIBED",
          actorRole: "SYSTEM",
          summary: "Voice note transcribed successfully",
          data: {
            success: true,
            duration: mediaItem.durationSeconds || null,
            chars: transcript.text.length,
            language: transcript.language || null,
          },
          dedupeKey: `${message.id}_voice_transcribed`,
        });

        log.info(
          { messageId, mediaSid: mediaItem.sid, transcriptLength: transcript.text.length },
          "Audio transcription completed successfully"
        );
      } catch (error: any) {
        log.error(
          { messageId, mediaSid: mediaItem.sid, error: error.message },
          "Audio transcription failed"
        );

        // Store error transcript
        const errorTranscript = {
          text: null,
          error: error.message || "Transcription failed",
          createdAt: new Date().toISOString(),
          provider: "openai",
          mediaSid: mediaItem.sid,
        };

        await updateMessageTranscript(message.id, mediaItem.sid, errorTranscript);

        // Create timeline event for failure (only metadata, no full transcript)
        await createTimelineEvent({
          agencyId: message.agencyId,
          conversationId: message.conversationId,
          contactId: message.contactId,
          candidateId: await getCandidateId(message.agencyId, message.contact.phone, message.conversation) || null,
          type: "VOICE_TRANSCRIBED",
          actorRole: "SYSTEM",
          summary: "Voice note transcription failed",
          data: {
            success: false,
            duration: mediaItem.durationSeconds || null,
            chars: 0,
            error: error.message || "Transcription failed",
          },
          dedupeKey: `${message.id}_voice_transcribed`,
        });
      }
    }
  }

  // Step E: Auto-attach images to CSCS verification tasks
  if (metadata?.media && Array.isArray(metadata.media)) {
    const imageMedia = (metadata.media as MediaItem[]).filter((m) => m.kind === "image");
    
    if (imageMedia.length > 0) {
      try {
        // Find open CSCS_VERIFICATION task for this conversation
        const openCscsTask = await prisma.task.findFirst({
          where: scopeWhere(message.agencyId, {
            type: TaskType.CSCS_VERIFICATION,
            status: TaskStatus.OPEN,
            relatedMessage: {
              conversationId: message.conversationId,
            },
          }),
          include: {
            relatedMessage: true,
          },
        });

        if (openCscsTask) {
          // Attach media URLs to task payload (with idempotency)
          const taskPayload = (openCscsTask.payload as any) || {};
          const existingMediaUrls = taskPayload.cscs?.mediaUrls || [];
          const existingMediaSids = new Set(existingMediaUrls.map((m: any) => m.sid || m.url));

          // Filter out media that's already attached
          const newMedia = imageMedia.filter((m) => !existingMediaSids.has(m.sid) && !existingMediaSids.has(m.url));

          if (newMedia.length > 0) {
            const updatedPayload = {
              ...taskPayload,
              cscs: {
                ...(taskPayload.cscs || {}),
                mediaUrls: [
                  ...existingMediaUrls,
                  ...newMedia.map((m) => ({
                    sid: m.sid,
                    url: m.url,
                    contentType: m.contentType,
                    receivedAt: m.receivedAt,
                    attachedAt: new Date().toISOString(),
                    attachedFromMessageId: message.id,
                  })),
                ],
              },
            };

            await prisma.task.update({
              where: { id: openCscsTask.id },
              data: { payload: updatedPayload as any },
            });

            // Create timeline events for each attached media
            for (const mediaItem of newMedia) {
              await createTimelineEvent({
                agencyId: message.agencyId,
                conversationId: message.conversationId,
                contactId: message.contactId,
                candidateId: await getCandidateId(message.agencyId, message.contact.phone, message.conversation) || null,
                type: "MEDIA_LINKED_TO_TASK",
                actorRole: "SYSTEM",
                summary: "Image attached to CSCS verification task",
                data: {
                  taskId: openCscsTask.id,
                  mediaSid: mediaItem.sid,
                  messageId: message.id,
                },
                dedupeKey: `${openCscsTask.id}_${mediaItem.sid}_linked`,
              });
            }

            log.info(
              {
                messageId: message.id,
                taskId: openCscsTask.id,
                attachedMediaCount: newMedia.length,
              },
              "Attached images to existing CSCS verification task"
            );
          }
        } else {
          // No open CSCS task - check if progress stage indicates docs needed
          const progressStage = (message.conversation.progressStage as string) || "";
          const progressData = (message.conversation.progressData as any) || {};

          if (progressStage === "DOCS_NEEDED" || progressStage === "CSCS_VERIFICATION") {
            // Create CSCS_VERIFICATION task with attached images
            const candidateId = await getCandidateId(message.agencyId, message.contact.phone, message.conversation);

            const newTask = await prisma.task.create({
              data: {
                agencyId: message.agencyId,
                type: TaskType.CSCS_VERIFICATION,
                status: TaskStatus.OPEN,
                approvalStatus: "PENDING" as any,
                relatedMessageId: message.id,
                candidateId: candidateId || null,
                payload: {
                  conversationId: message.conversationId,
                  mediaUrls: imageMedia.map((m) => ({
                    sid: m.sid,
                    url: m.url,
                    contentType: m.contentType,
                    receivedAt: m.receivedAt,
                    attachedAt: new Date().toISOString(),
                    attachedFromMessageId: message.id,
                  })),
                  reason: "Image received for CSCS verification",
                } as any,
              },
            });

            // Create timeline events
            await createTimelineEvent({
              agencyId: message.agencyId,
              conversationId: message.conversationId,
              contactId: message.contactId,
              candidateId: candidateId || null,
              type: "TASK_CREATED",
              actorRole: "SYSTEM",
              summary: "CSCS verification task created with image",
              data: {
                taskId: newTask.id,
                taskType: "CSCS_VERIFICATION",
                mediaCount: imageMedia.length,
              },
            });

            for (const mediaItem of imageMedia) {
              await createTimelineEvent({
                agencyId: message.agencyId,
                conversationId: message.conversationId,
                contactId: message.contactId,
                candidateId: candidateId || null,
                type: "MEDIA_LINKED_TO_TASK",
                actorRole: "SYSTEM",
                summary: "Image attached to CSCS verification task",
                data: {
                  taskId: newTask.id,
                  mediaSid: mediaItem.sid,
                  messageId: message.id,
                },
                dedupeKey: `${newTask.id}_${mediaItem.sid}_linked`,
              });
            }

            log.info(
              {
                messageId: message.id,
                taskId: newTask.id,
                progressStage,
                mediaCount: imageMedia.length,
              },
              "Created CSCS verification task with attached images"
            );
          }
        }
      } catch (error) {
        log.error(
          { messageId: message.id, error },
          "Failed to attach images to CSCS task (non-blocking)"
        );
      }
    }
  }

  // Create INBOUND_MESSAGE_RECEIVED timeline event
  try {
    const candidateId = await getCandidateId(message.agencyId, message.contact.phone, message.conversation);
    const messageSnippet = textForAI.length > 80 ? textForAI.substring(0, 80) + "..." : textForAI;
    await createTimelineEvent({
      agencyId: message.agencyId,
      conversationId: message.conversationId,
      contactId: message.contactId,
      candidateId,
      type: "INBOUND_MESSAGE_RECEIVED",
      actorRole: "SYSTEM",
      summary: "Inbound message received",
      data: {
        messageId: message.id,
        direction: message.direction,
        channel: message.channel,
        snippet: messageSnippet,
      },
      dedupeKey: `msg_${message.id}`,
    });
  } catch (error) {
    log.warn({ messageId, error }, "Failed to create INBOUND_MESSAGE_RECEIVED timeline event (non-blocking)");
  }

  // CRITICAL SAFEGUARD: Only process HUMAN INBOUND messages
  // AI/OPERATOR messages should NEVER create approval tasks
  if (message.direction !== MessageDirection.INBOUND) {
    log.warn(
      {
        messageId: message.id,
        direction: message.direction,
        jobId: job.id,
      },
      "Message is not INBOUND; skipping task creation (OUTBOUND messages should not create approval tasks)"
    );
    return;
  }

  // CRITICAL SAFEGUARD: Only process HUMAN messages
  // AI/OPERATOR messages should NEVER create tasks or trigger processing
  const senderRole = (message as any).senderRole as MessageSenderRole | undefined;
  if (senderRole !== MessageSenderRole.HUMAN) {
    log.warn(
      {
        messageId: message.id,
        senderRole,
        direction: message.direction,
        jobId: job.id,
      },
      "Message is not from HUMAN; skipping task creation (AI/OPERATOR messages should not create approval tasks)"
    );
    return;
  }

  // SAFEGUARD: Block auto-replies if conversation is paused for approval
  if (message.conversation.state === ConversationState.PAUSED_FOR_APPROVAL) {
    log.info(
      {
        messageId: message.id,
        conversationId: message.conversationId,
        conversationState: message.conversation.state,
        pausedReason: message.conversation.pausedReason,
      },
      "Conversation is PAUSED_FOR_APPROVAL; blocking auto-reply and checking for existing task"
    );
    
    // Check if a pending task already exists for this conversation
    const existingTask = await prisma.task.findFirst({
      where: {
        agencyId: message.agencyId,
        type: TaskType.APPROVAL_REQUIRED,
        status: TaskStatus.OPEN,
        approvalStatus: "PENDING",
        relatedMessage: {
          conversationId: message.conversationId,
        },
      },
      include: {
        relatedMessage: true,
      },
    });

    if (existingTask) {
      // Update existing task with new message context
      const existingPayload = existingTask.payload as any;
      
      // Ensure pendingReplyText is never removed/overwritten with null
      // If missing, generate fallback
      const existingPendingReplyText = existingPayload.pendingReplyText;
      const pendingReplyText = existingPendingReplyText || 
        getFallbackReplyForApproval({
          intent: "UNKNOWN",
          inboundText: textForAI,
          candidateName: message.contact.name,
          desiredRole: null,
        });
      
      const updatedPayload = {
        ...existingPayload,
        additionalMessages: [
          ...(existingPayload.additionalMessages || []),
          {
            messageId: message.id,
            text: message.text,
            intent: "UNKNOWN",
            receivedAt: new Date().toISOString(),
          },
        ],
        lastMessageId: message.id,
        lastMessageText: message.text,
        pendingReplyText, // Always preserve or set fallback, never null
      };

      await prisma.task.update({
        where: { id: existingTask.id },
        data: {
          payload: updatedPayload,
        },
      });

      log.info(
        {
          taskId: existingTask.id,
          messageId: message.id,
          conversationId: message.conversationId,
          additionalMessagesCount: updatedPayload.additionalMessages.length,
        },
        "Existing pending task updated with new message context - no duplicate task created"
      );

      return;
    }

    // No existing task - create new one
    const basePayload = {
      reason: "Inbound message received while conversation paused for approval",
      channel: "WHATSAPP",
      intent: "UNKNOWN",
      conversationId: message.conversationId,
      checkpointMessageId: message.id,
      pendingReplyText: null,
    };
    
    let enrichedPayload = await enrichPayloadWithJobMatches(
      message.agencyId,
      message.contact.phone,
      message.conversation,
      basePayload
    );

    // Add job snapshot for priority scoring
    enrichedPayload = await enrichPayloadWithJobSnapshot(
      enrichedPayload,
      message.agencyId
    );

    // Ensure conversationId is always present in payload
    if (!enrichedPayload.conversationId) {
      enrichedPayload.conversationId = message.conversationId;
    }

    // Determine suggested message using fallback logic
    const proposedActionForPaused = null; // No AI action available for paused conversations
    const suggested = 
      (proposedActionForPaused as any)?.suggestedMessage ??
      enrichedPayload.pendingReplyText ??
      getFallbackReplyForApproval({
        intent: "UNKNOWN",
        inboundText: textForAI,
        candidateName: message.contact.name,
        desiredRole: null, // Not easily available here without extra query
      });

    // Create proper proposedAction structure
    const proposedActionRaw = {
      actionType: "SEND_MESSAGE" as const,
      suggestedMessage: suggested,
      reasoning: "Fallback message because message received during paused conversation",
      riskLevel: "MEDIUM" as const, // Paused conversations are typically medium risk
    };

    // Ensure explainability is present (create RULES explainability for deterministic fallback)
    const { proposedAction, enrichedPayload: finalPayload } = ensureExplainabilityInProposedAction(
      proposedActionRaw,
      enrichedPayload,
      {
        missingFields: message.conversation.progressData?.missingFields as string[] | undefined,
        intent: "UNKNOWN",
        memoryPack: message.conversation.memoryPack as any,
        candidateName: message.contact.name,
        desiredRole: null,
      }
    );

    // Idempotency check: Look for existing task with same relatedMessageId + type
    const existingTaskByIdempotency = await prisma.task.findFirst({
      where: {
        agencyId: message.agencyId,
        relatedMessageId: message.id,
        type: TaskType.APPROVAL_REQUIRED,
        status: TaskStatus.OPEN,
      },
    });

    if (existingTaskByIdempotency) {
      log.info(
        {
          taskId: existingTaskByIdempotency.id,
          messageId: message.id,
          conversationId: message.conversationId,
        },
        "Task already exists for this message (idempotency check) - skipping duplicate task creation"
      );
      return;
    }

    // Update payload with suggested message
    finalPayload.pendingReplyText = suggested;

    const task = await prisma.task.create({
      data: {
        agencyId: message.agencyId,
        type: TaskType.APPROVAL_REQUIRED,
        status: TaskStatus.OPEN,
        approvalStatus: "PENDING",
        proposedAction,
        relatedMessageId: message.id,
        payload: finalPayload,
      } as any,
    });

    // Create TASK_CREATED timeline event
    try {
      const candidateId = await getCandidateId(message.agencyId, message.contact.phone, message.conversation);
      const payload = task.payload as any;
      await createTimelineEvent({
        agencyId: message.agencyId,
        conversationId: message.conversationId,
        contactId: message.contactId,
        candidateId,
        type: "TASK_CREATED",
        actorRole: "SYSTEM",
        summary: `Task created: ${task.type}`,
        data: {
          taskId: task.id,
          taskType: task.type,
          priority: payload.priority?.score || null,
        },
        dedupeKey: `task_${task.id}`,
      });
    } catch (error) {
      log.warn({ taskId: task.id, error }, "Failed to create TASK_CREATED timeline event (non-blocking)");
    }

    log.info(
      {
        taskId: task.id,
        messageId: message.id,
        conversationId: message.conversationId,
      },
      "Approval task created for message received during paused conversation"
    );

    return;
  }

  // Load agency to get messagingMode (for future use, but we're using intent-based routing now)
  const agency = await prisma.agency.findUnique({
    where: { id: message.agencyId },
  });

  // Extract and upsert candidate profile (ALWAYS run on every inbound message)
  let extractedProfile: any = null; // Store for continuity pipeline
  try {
    const conversationHistory = message.conversation.messages
      .reverse() // Reverse to get chronological order (oldest first)
      .map((msg) => ({
        direction: msg.direction,
        text: getTextForAI(msg),
        createdAt: msg.createdAt,
      }));

    extractedProfile = await extractCandidateProfile({
      conversationHistory,
      latestMessage: {
        direction: message.direction,
        text: textForAI,
        createdAt: message.createdAt,
      },
      contactPhone: message.contact.phone,
      sourceMessageId: message.id,
    });

    if (extractedProfile) {
      await upsertCandidateProfile({
        agencyId: message.agencyId,
        phone: message.contact.phone,
        conversationId: message.conversationId,
        extractedProfile,
        sourceMessageId: message.id,
      });

      log.info(
        {
          messageId: message.id,
          contactPhone: message.contact.phone,
          conversationId: message.conversationId,
        },
        "Candidate profile extracted and upserted"
      );
    } else {
      log.debug(
        {
          messageId: message.id,
          contactPhone: message.contact.phone,
        },
        "Candidate profile extraction skipped or failed (non-blocking)"
      );
    }
  } catch (error) {
    // Non-blocking: log error but continue with message processing
    log.warn(
      {
        messageId: message.id,
        contactPhone: message.contact.phone,
        error,
      },
      "Candidate profile extraction failed (non-blocking)"
    );
  }

  // Classify intent
  let intent = classifyInboundIntent(textForAI);
  if (intent === "UNKNOWN") {
    const enableAi =
      (process.env.ENABLE_AI_INTENT_CLASSIFIER ?? "").toLowerCase() === "true";

    if (!enableAi) {
      log.debug(
        { source: "rules", messageId: message.id, aiEnabled: false },
        "AI intent classifier disabled; skipping fallback"
      );
    } else {
      log.info(
        { messageId: message.id, text: message.text },
        "Calling AI intent classifier"
      );
      try {
        const aiIntent = await classifyIntentWithAI(textForAI);
        if (aiIntent !== "UNKNOWN") {
          log.info(
            {
              source: "ai",
              messageId: message.id,
              originalIntent: "UNKNOWN",
              finalIntent: aiIntent,
            },
            "Intent upgraded by AI fallback"
          );
          intent = aiIntent;
        } else {
          log.debug(
            { source: "rules", messageId: message.id, finalIntent: "UNKNOWN" },
            "Intent remained UNKNOWN after fallback"
          );
        }
      } catch (error) {
        log.warn(
          { source: "rules", messageId: message.id, err: error },
          "AI intent fallback failed; keeping UNKNOWN"
        );
      }
    }
  }

  // Update memory pack and progress (non-blocking)
  try {
    // Get candidate snapshot if available (use findFirst with agency scoping)
    const candidateId = await getCandidateId(message.agencyId, message.contact.phone, message.conversation);
    let candidateSnapshot: import("../services/memoryPackUpdater.ts").CandidateSnapshot | null = null;
    if (candidateId) {
      const candidate = await prisma.candidate.findFirst({
        where: scopeWhere(agencyId, { id: candidateId }),
        select: {
          name: true,
          desiredRole: true,
          location: true,
          availabilityNotes: true,
          salaryMin: true,
          salaryMax: true,
          currency: true,
          skills: true,
          yearsExperience: true,
        },
      });
      if (candidate) {
        // Convert to memoryPackUpdater.CandidateSnapshot format (has nested salary object)
        candidateSnapshot = {
          name: candidate.name,
          desiredRole: candidate.desiredRole,
          location: candidate.location,
          availability: candidate.availabilityNotes,
          salary: candidate.salaryMin !== null || candidate.salaryMax !== null || candidate.currency !== null
            ? {
                min: candidate.salaryMin,
                max: candidate.salaryMax,
                currency: candidate.currency,
              }
            : null,
          skills: candidate.skills || [],
          yearsExperience: candidate.yearsExperience,
        };
      }
    }

    // Get conversation with current progress and memory pack (use findFirst with agency scoping)
    const conversation = await prisma.conversation.findFirst({
      where: scopeWhere(agencyId, { id: message.conversationId }),
      select: {
        progressStage: true,
        progressData: true,
        memoryPack: true,
      },
    });

    // Get last 20 messages for context
    const lastMessages = message.conversation.messages
      .slice(-20)
      .map((msg) => ({
        direction: msg.direction as "INBOUND" | "OUTBOUND",
        text: getTextForAI(msg),
        createdAt: msg.createdAt,
      }));

    // Existing memory pack and progress
    const existingMemoryPack = conversation?.memoryPack
      ? sanitizeMemoryPack(conversation.memoryPack)
      : null;
    const existingProgressStage = (conversation?.progressStage as any) || "NEW";
    const existingProgressData = (conversation?.progressData as any) || null;

    // Gather context for progress engine
    // Check for pending approval tasks
    const pendingTasks = await prisma.task.findMany({
      where: {
        agencyId: message.agencyId,
        approvalStatus: "PENDING",
        status: "OPEN",
        OR: [
          {
            relatedMessage: {
              conversationId: message.conversationId,
            },
          },
          {
            payload: {
              path: ["conversationId"],
              equals: message.conversationId,
            },
          },
        ],
      },
      select: {
        type: true,
      },
    });

    const hasPendingApproval = pendingTasks.length > 0;
    const hasOpenTasks = {
      types: pendingTasks.map((t) => t.type),
    };

    // Get matched jobs count (if available from job matcher)
    let matchedJobsCount = 0;
    try {
      if (candidateId) {
        const jobMatches = await prisma.jobCandidateMatch.findMany({
          where: {
            candidateId,
            job: {
              status: { in: ["ACTIVE", "URGENT"] },
            },
          },
          select: { id: true },
        });
        matchedJobsCount = jobMatches.length;
      }
    } catch (error) {
      log.debug({ conversationId: message.conversationId, error }, "Failed to get matched jobs count (non-blocking)");
    }

    // Update memory pack and progress
    const updateResult = await updateMemoryPackAndProgress({
      conversationId: message.conversationId,
      lastMessages,
      existingMemoryPack,
      forceRecomputeMemory: forceRecomputeMemory ?? false,
      forceRecomputeProgress: forceRecomputeProgress ?? false,
      existingProgressStage,
      existingProgressData,
      candidateSnapshot,
    });

    if (updateResult) {
      // Merge updates into existing data
      const now = new Date().toISOString();
      let updatedMemoryPack = existingMemoryPack
        ? {
            ...mergeNonNull(existingMemoryPack, updateResult.memoryPackPatch),
            lastUpdatedAt: now,
            version: existingMemoryPack.version || 1,
          }
        : sanitizeMemoryPack({
            ...updateResult.memoryPackPatch,
            lastUpdatedAt: now,
            version: 1,
          });
      
      const updatedProgressData = existingProgressData
        ? mergeNonNull(existingProgressData, updateResult.progressUpdate.progressDataPatch)
        : {
            missingFields: [],
            nextAction: null,
            followUpAt: null,
            lastDecision: null,
            ...updateResult.progressUpdate.progressDataPatch,
          };

      // ============================================================================
      // Continuity Pipeline: Resolve and track open questions
      // ============================================================================
      try {
        const currentOpenQuestions: OpenQuestion[] = updatedMemoryPack.structuredOpenQuestions || [];
        const nowDate = new Date();
        
        // Step 1: Resolve open questions based on inbound message
        const mediaItems = (metadata?.media as MediaItem[]) || [];
        const resolutionResult = resolveOpenQuestions({
          openQuestions: currentOpenQuestions,
          inboundMessageText: textForAI,
          messageId: message.id,
          candidateExtractorResult: extractedProfile,
          mediaItems,
          now: nowDate,
        });

        // Step 2: Emit timeline events for resolved questions
        for (const resolved of resolutionResult.newlyResolved) {
          try {
            const candidateId = await getCandidateId(message.agencyId, message.contact.phone, message.conversation);
            await createTimelineEvent({
              agencyId: message.agencyId,
              conversationId: message.conversationId,
              contactId: message.contactId,
              candidateId,
              type: "OPEN_QUESTION_RESOLVED",
              actorRole: "SYSTEM",
              summary: `Question resolved: ${resolved.key}`,
              data: {
                key: resolved.key,
                questionId: resolved.question.id,
                evidenceSnippet: resolved.evidence.substring(0, 80),
              },
              dedupeKey: `${message.conversationId}_${resolved.key}_resolved_${message.id}`,
            });
          } catch (error) {
            log.warn({ conversationId: message.conversationId, key: resolved.key, error }, "Failed to create OPEN_QUESTION_RESOLVED timeline event (non-blocking)");
          }
        }

        // Step 3: Determine required questions from current progress stage
        // Convert memoryPackUpdater.CandidateSnapshot to stateMachineTypes.CandidateSnapshot format
        const stateMachineSnapshot: import("../services/progress/stateMachineTypes.ts").CandidateSnapshot | null = candidateSnapshot
          ? {
              name: candidateSnapshot.name,
              desiredRole: candidateSnapshot.desiredRole,
              location: candidateSnapshot.location,
              availability: candidateSnapshot.availability,
              salaryMin: candidateSnapshot.salary?.min ?? null,
              salaryMax: candidateSnapshot.salary?.max ?? null,
              skills: candidateSnapshot.skills,
              yearsExperience: candidateSnapshot.yearsExperience,
              phone: message.contact.phone,
            }
          : null;
        const requiredQuestions = getRequiredQuestionsFromProgress(
          updateResult.progressUpdate.stage,
          updatedProgressData,
          stateMachineSnapshot,
          {} // jobContext - can be enhanced later
        );

        // Step 4: Add new questions if needed
        const newQuestions: OpenQuestion[] = [];
        for (const key of requiredQuestions) {
          // Check if we should ask this question
          if (shouldAskQuestion(key, resolutionResult.resolvedQuestions, nowDate)) {
            // Check if question already exists (by key)
            const existing = resolutionResult.resolvedQuestions.find((q) => q.key === key);
            if (!existing || existing.status === "RESOLVED") {
              // Add new question
              const promptText = buildPromptTextForKey(key, playbook, message.contact.name);
              const newQuestion = addOpenQuestion(
                message.conversationId,
                key,
                message.id, // Use current message ID as the "asked" message
                promptText,
                nowDate
              );
              newQuestions.push(newQuestion);

              // Emit timeline event
              try {
                const candidateId = await getCandidateId(message.agencyId, message.contact.phone, message.conversation);
                await createTimelineEvent({
                  agencyId: message.agencyId,
                  conversationId: message.conversationId,
                  contactId: message.contactId,
                  candidateId,
                  type: "OPEN_QUESTION_ADDED",
                  actorRole: "SYSTEM",
                  summary: `Question added: ${key}`,
                  data: {
                    key,
                    questionId: newQuestion.id,
                    promptText: newQuestion.promptText.substring(0, 100), // Max 100 chars for timeline
                  },
                  dedupeKey: `${message.conversationId}_${key}_added_${nowDate.getTime()}`,
                });
              } catch (error) {
                log.warn({ conversationId: message.conversationId, key, error }, "Failed to create OPEN_QUESTION_ADDED timeline event (non-blocking)");
              }
            }
          }
        }

        // Step 5: Update memory pack with resolved and new questions
        updatedMemoryPack = {
          ...updatedMemoryPack,
          structuredOpenQuestions: [
            ...resolutionResult.resolvedQuestions,
            ...newQuestions,
          ].slice(0, 20), // Clamp to max 20 questions
        };

        // Step 6: Process stale open questions and create follow-up tasks if needed
        // Use the updated memory pack questions (after resolution and new additions)
        try {
          const allOpenQuestions = updatedMemoryPack.structuredOpenQuestions || [];
          if (allOpenQuestions.length > 0) {
            const followUpResult = await processStaleOpenQuestions(
              message.agencyId,
              message.conversationId,
              allOpenQuestions,
              playbook,
              nowDate
            );
            if (followUpResult.created > 0) {
              log.info(
                {
                  conversationId: message.conversationId,
                  created: followUpResult.created,
                  skipped: followUpResult.skipped,
                },
                "Created follow-up tasks for stale open questions"
              );
            }
          }
        } catch (error) {
          log.warn(
            {
              messageId: message.id,
              conversationId: message.conversationId,
              error,
            },
            "Follow-up task creation failed (non-blocking)"
          );
        }
      } catch (error) {
        log.warn(
          {
            messageId: message.id,
            conversationId: message.conversationId,
            error,
          },
          "Continuity pipeline failed (non-blocking)"
        );
      }

      // Update conversation in database
      await prisma.conversation.update({
        where: { id: message.conversationId },
        data: {
          progressStage: updateResult.progressUpdate.stage,
          progressUpdatedAt: new Date(),
          progressData: updatedProgressData as any,
          memoryPack: updatedMemoryPack as any,
          memoryUpdatedAt: new Date(),
        },
      });

      log.info(
        {
          conversationId: message.conversationId,
          stage: updateResult.progressUpdate.stage,
          messageId: message.id,
        },
        "Memory pack updated"
      );

      // Create MEMORY_PACK_UPDATED timeline event
      try {
        const candidateId = await getCandidateId(message.agencyId, message.contact.phone, message.conversation);
        const memoryUpdatedAt = new Date().toISOString();
        await createTimelineEvent({
          agencyId: message.agencyId,
          conversationId: message.conversationId,
          contactId: message.contactId,
          candidateId,
          type: "MEMORY_PACK_UPDATED",
          actorRole: "AI",
          summary: "Memory pack updated",
          data: {
            memoryPackVersion: updatedMemoryPack.version || 1,
          },
          dedupeKey: `conv_${message.conversationId}_memory_${memoryUpdatedAt}`,
        });
      } catch (error) {
        log.warn({ conversationId: message.conversationId, error }, "Failed to create MEMORY_PACK_UPDATED timeline event (non-blocking)");
      }

      // Create PROGRESS_STAGE_CHANGED timeline event if stage changed
      if (updateResult.progressUpdate.stage !== existingProgressStage) {
        try {
          const candidateId = await getCandidateId(message.agencyId, message.contact.phone, message.conversation);
          await createTimelineEvent({
            agencyId: message.agencyId,
            conversationId: message.conversationId,
            contactId: message.contactId,
            candidateId,
            type: "PROGRESS_STAGE_CHANGED",
            actorRole: "SYSTEM",
            summary: `Progress stage changed: ${existingProgressStage} → ${updateResult.progressUpdate.stage}`,
            data: {
              from: existingProgressStage,
              to: updateResult.progressUpdate.stage,
              reason: updateResult.progressUpdate.progressDataPatch?.nextAction || null,
              missingFields: updatedProgressData.missingFields || [],
              nextAction: updatedProgressData.nextAction || null,
            },
            dedupeKey: `conv_${message.conversationId}_progress_${updateResult.progressUpdate.stage}`,
          });
        } catch (error) {
          log.warn({ conversationId: message.conversationId, error }, "Failed to create PROGRESS_STAGE_CHANGED timeline event (non-blocking)");
        }
      }
    }
  } catch (error) {
    // Non-blocking: log error but continue with message processing
    log.warn(
      {
        messageId: message.id,
        conversationId: message.conversationId,
        error,
      },
      "Memory pack update failed (non-blocking)"
    );
  }

  // Check if intent is safe for auto-reply
  const isSafeIntent = isIntentSafeForAutoReply(intent);
  
  // Check if this is a clarification message (short, non-sensitive follow-up)
  const isClarification = isClarificationMessage(textForAI);
  
  // Check for escalation triggers (salary, offer, rejection, legal, etc.)
  const escalation = requiresEscalation(
    intent,
    textForAI,
    undefined, // proposedAction not yet generated
    playbook
  );

  // Determine if we should auto-reply or require approval
  // Clarification messages are safe UNLESS they contain escalation patterns
  // UNKNOWN intent alone does NOT trigger approval unless escalation patterns match
  const shouldAutoReply = (isSafeIntent || isClarification) && !escalation.requires;

  log.info(
    {
      messageId: message.id,
      intent,
      isSafeIntent,
      isClarification,
      escalationRequired: escalation.requires,
      escalationReason: escalation.reason,
      shouldAutoReply,
    },
    "Intent safety and escalation check completed"
  );

  // Get conversation history for AI context (last 10 messages, chronological)
  const conversationHistory = message.conversation.messages
    .reverse() // Reverse to get chronological order
    .map((msg) => ({
      direction: msg.direction as MessageDirection,
      text: getTextForAI(msg),
      createdAt: msg.createdAt,
    }));

  if (shouldAutoReply) {
    // SAFE INTENT: Auto-reply immediately, no task, ensure conversation is ACTIVE
    log.info(
      {
        messageId: message.id,
        intent,
        conversationId: message.conversationId,
      },
      "Safe intent detected - generating and sending AI reply immediately"
    );

    // Ensure conversation state is ACTIVE
    if (message.conversation.state !== ConversationState.ACTIVE) {
      await prisma.conversation.update({
        where: { id: message.conversationId },
        data: {
          state: ConversationState.ACTIVE as any,
          pausedReason: null,
        } as any,
      });

      log.info(
        {
          messageId: message.id,
          conversationId: message.conversationId,
          previousState: message.conversation.state,
          newState: ConversationState.ACTIVE,
        },
        "Conversation resumed to ACTIVE for safe intent auto-reply"
      );
    }}

    // Generate AI reply
    let replyMessage: string | null = null;
    let aiSuggestedNoAction = false;
    let aiParseFailed = false; // Track if AI response parsing failed (separate from NO_ACTION)
    let proposedAction: Awaited<ReturnType<typeof suggestActionWithAI>> | null = null;
    try {
      const aiEnabled =
        (process.env.ENABLE_AI_INTENT_CLASSIFIER ?? "").toLowerCase() === "true";

      if (aiEnabled) {
        // Get updated memory pack and progress after update (use findFirst with agency scoping)
        const updatedConversation = await prisma.conversation.findFirst({
          where: scopeWhere(agencyId, { id: message.conversationId }),
          select: {
            memoryPack: true,
            progressStage: true,
            progressData: true,
          },
        });

        const memoryPack = updatedConversation?.memoryPack as any;
        const progressStage = updatedConversation?.progressStage as any;
        const progressData = updatedConversation?.progressData as any;

        proposedAction = await suggestActionWithAI({
          intent,
          messageText: textForAI,
          contactName: message.contact.name,
          conversationHistory, // Pass conversation history for context
          memoryPack: memoryPack || null,
          progressStage: progressStage || null,
          progressData: progressData || null,
          playbook, // Pass playbook for AI behavior configuration
        });

        // Check if parsing failed (indicated by "PARSE_FAILED:" prefix in reasoning)
        if (proposedAction && proposedAction.reasoning.startsWith("PARSE_FAILED:")) {
          aiParseFailed = true;
          log.warn(
            {
              messageId: message.id,
              intent,
              reasoning: proposedAction.reasoning,
            },
            "AI response parsing failed - will send fallback message regardless of conversation state"
          );
        }

        // Create AI_SUGGESTION_CREATED timeline event with safe explainability fields
        if (proposedAction) {
          try {
            const candidateId = await getCandidateId(message.agencyId, message.contact.phone, message.conversation);
            
            // Extract safe explainability fields (first bullet/item only, no full arrays)
            const explainability = proposedAction.explainability;
          const safeExplainabilityData: Record<string, unknown> = {
            intent,
            risk: proposedAction.riskLevel,
            suggestedTaskType: proposedAction.actionType === "ESCALATE" ? "APPROVAL_REQUIRED" : null,
          };
          
          // Add safe explainability fields if available (first bullet/item only, no full arrays)
          if (explainability) {
            // Use riskLevel from explainability (preferred) or fallback to proposedAction.riskLevel
            safeExplainabilityData.riskLevel = explainability.riskLevel || proposedAction.riskLevel;
            // Only include first rationale bullet (keep it short, no full arrays)
            if (explainability.rationale && explainability.rationale.length > 0) {
              safeExplainabilityData.rationaleFirst = explainability.rationale[0];
            }
            // Only include first missingInfo item (keep it short)
            if (explainability.missingInfo && explainability.missingInfo.length > 0) {
              safeExplainabilityData.missingInfoFirst = explainability.missingInfo[0];
            }
          } else {
            // Fallback: use riskLevel from proposedAction if explainability not available
            if (proposedAction.riskLevel) {
              safeExplainabilityData.riskLevel = proposedAction.riskLevel;
            }
          }
          
          await createTimelineEvent({
            agencyId: message.agencyId,
            conversationId: message.conversationId,
            contactId: message.contactId,
            candidateId,
            type: "AI_SUGGESTION_CREATED",
            actorRole: "AI",
            summary: `AI suggested ${proposedAction.actionType}`,
            data: safeExplainabilityData,
            dedupeKey: `msg_${message.id}_ai_suggested`,
          });
          } catch (error) {
            log.warn({ messageId, error }, "Failed to create AI_SUGGESTION_CREATED timeline event (non-blocking)");
          }
        }

        if (proposedAction && proposedAction.actionType === "SEND_MESSAGE" && proposedAction.suggestedMessage) {
          replyMessage = proposedAction.suggestedMessage;
          log.info(
            {
              messageId: message.id,
              intent,
              actionType: proposedAction.actionType,
              riskLevel: proposedAction.riskLevel,
            },
            "AI-generated reply message ready"
          );
        } else if (proposedAction) {
          aiSuggestedNoAction = proposedAction.actionType === "NO_ACTION" && !aiParseFailed;
          log.warn(
            {
              messageId: message.id,
              actionType: proposedAction.actionType,
              reasoning: proposedAction.reasoning,
              parseFailed: aiParseFailed,
            },
            "AI suggested NO_ACTION or missing message; checking if fallback should be sent"
          );
        }
      }

      // Fallback messages if AI didn't provide one
      // CRITICAL: If parsing failed, ALWAYS send fallback regardless of conversation state
      // Only skip fallback if AI explicitly said NO_ACTION AND conversation has history AND is active
      const hasHistory = conversationHistory.length > 1;
      const isActive = message.conversation.state === ConversationState.ACTIVE;
      
      // Determine if we should send a fallback message
      let shouldSendFallback = false;
      let fallbackReason = "";
      
      if (!replyMessage) {
        if (!aiEnabled) {
          // AI not enabled - always use fallback (maintains existing behavior)
          shouldSendFallback = true;
          fallbackReason = "AI not enabled";
        } else if (aiParseFailed) {
          // CRITICAL: If parsing failed, always send fallback (ignore history/state)
          shouldSendFallback = true;
          fallbackReason = "AI response parsing failed";
        } else if (aiSuggestedNoAction) {
          // AI explicitly said NO_ACTION - only send fallback if no history or not active
          shouldSendFallback = !hasHistory || !isActive;
          fallbackReason = aiSuggestedNoAction 
            ? `AI suggested NO_ACTION (history: ${hasHistory}, active: ${isActive})`
            : "AI did not provide message";
        } else {
          // AI is enabled but didn't provide message (edge case) - send fallback
          shouldSendFallback = true;
          fallbackReason = "AI did not provide message";
        }
      }

      if (shouldSendFallback) {
        log.info(
          {
            messageId: message.id,
            intent,
            fallbackReason,
            hasHistory,
            isActive,
            aiParseFailed,
            aiSuggestedNoAction,
          },
          "Sending fallback message"
        );

        // Adjust tone based on whether this is an ongoing conversation
        switch (intent) {
          case "LOOKING_FOR_WORK":
            replyMessage = hasHistory
              ? "Understood 👍 Checking what's available and I'll come back to you."
              : "Got it 👍 Let me check what we've got available and I'll come back to you.";
            break;
          case "AVAILABILITY_UPDATE":
            replyMessage = hasHistory
              ? "Noted, cheers. Just checking what's coming up and I'll update you."
              : "Cheers for that, noted your availability. Just checking what's coming up and I'll update you.";
            break;
          case "FOLLOW_UP":
            replyMessage = hasHistory
              ? "Makes sense. Just confirming a couple of details and I'll get back to you."
              : "Thanks for checking in. Just confirming a couple of details and I'll get back to you.";
            break;
          case "UNKNOWN":
            if (isGreetingMessage(textForAI)) {
              replyMessage = hasHistory
                ? "Hey 👋 What's up?"
                : "Hey 👋 What can I help you with today?";
            } else {
              replyMessage = hasHistory
                ? "Got it. Just checking this and I'll come back to you."
                : "Got it, thanks. Just checking this and I'll come back to you.";
            }
            break;
          default:
            replyMessage = hasHistory
              ? "Got it. Just checking this and I'll come back to you."
              : "Got it, thanks. Just checking this and I'll come back to you.";
        }
      } else if (!replyMessage && hasHistory && isActive && aiSuggestedNoAction && !aiParseFailed) {
        // Only skip fallback if AI explicitly said NO_ACTION (not due to parse failure)
        // AND conversation has history AND is active
        log.info(
          {
            messageId: message.id,
            intent,
            hasHistory,
            conversationState: message.conversation.state,
            aiSuggestedNoAction,
            aiParseFailed,
          },
          "Skipping fallback message - AI explicitly said NO_ACTION, conversation has history and is ACTIVE"
        );
        // NO TASK CREATED for safe intents (as per requirements)
        return;
      }

      // Send auto-reply only if we have a message to send
      // In replay mode: check dryRun and allowSendOutbound flags
      try {
        if (replyMessage) {
          const shouldSend = !replay || (allowSendOutbound && !dryRun);
        
        if (replay && dryRun) {
          log.info(
            {
              messageId: message.id,
              replyMessage,
              replay: true,
              dryRun: true,
            },
            "[REPLAY DRY RUN] Would send auto-reply (suppressed)"
          );
        } else if (replay && !allowSendOutbound) {
          log.info(
            {
              messageId: message.id,
              replyMessage,
              replay: true,
              allowSendOutbound: false,
            },
            "[REPLAY] Auto-reply suppressed (allowSendOutbound=false)"
          );
        } else if (shouldSend) {
          const twilioSid = await sendAutoReply({
            messageId: message.id,
            contactPhone: message.contact.phone,
            replyText: replyMessage,
            agencyId: message.agencyId,
            conversationId: message.conversationId,
            contactId: message.contactId,
          });

        // Create OUTREACH_SENT timeline event (auto-reply)
        try {
          const candidateId = await getCandidateId(message.agencyId, message.contact.phone, message.conversation);
          // Find the outbound message by twilioSid (use findFirst with agency scoping)
          const outboundMessage = await prisma.message.findFirst({
            where: scopeWhere(agencyId, {
              providerMessageId: twilioSid,
              direction: MessageDirection.OUTBOUND,
            }),
            select: { id: true },
          });
          await createTimelineEvent({
            agencyId: message.agencyId,
            conversationId: message.conversationId,
            contactId: message.contactId,
            candidateId,
            type: "OUTREACH_SENT",
            actorRole: "AI",
            summary: "Auto-reply sent",
            data: {
              outboundMessageId: outboundMessage?.id || null,
              deliveryStatus: "SENT",
            },
            dedupeKey: outboundMessage?.id ? `msg_${outboundMessage.id}` : `twilio_${twilioSid}`,
          });
        } catch (error) {
          log.warn({ messageId, error }, "Failed to create OUTREACH_SENT timeline event (non-blocking)");
        }

        log.info(
          {
            messageId: message.id,
            intent,
            conversationId: message.conversationId,
            replyMessageLength: replyMessage.length,
          },
          "AI auto-reply sent successfully - no task created"
        );

        // NO TASK CREATED for safe intents (as per requirements)
        return;
        }
      }
      } catch (error) {
        // If auto-reply fails, fall back to approval workflow
        log.error(
          {
            messageId: message.id,
            intent,
            error,
          },
          "Auto-reply failed; falling back to approval workflow"
        );
        // Continue to approval workflow below
      }

      // GUARD: If AI suggested SEND_MESSAGE with LOW risk but no message was sent,
      // we MUST create a task to prevent silent conversation stalls
      if (
        proposedAction &&
        proposedAction.actionType === "SEND_MESSAGE" &&
        proposedAction.riskLevel === "LOW"
      ) {
          log.warn(
            {
              messageId: message.id,
              intent,
              actionType: proposedAction.actionType,
              riskLevel: proposedAction.riskLevel,
              hasHistory,
              conversationState: message.conversation.state,
            },
            "AI suggested LOW-risk SEND_MESSAGE but no message was sent - creating task to prevent silent stall"
          );

          // Pause conversation to ensure operator reviews the issue
          await prisma.conversation.update({
            where: { id: message.conversationId },
            data: {
              state: ConversationState.PAUSED_FOR_APPROVAL as any,
              pausedReason: "AI suggested LOW-risk message but it was not sent - requires review",
            } as any,
          });

          // Create a task explaining why the message cannot be sent
          const basePayloadWithoutPending = {
            reason: "AI suggested LOW-risk SEND_MESSAGE but message was not sent",
            explanation: `AI suggested sending: "${proposedAction.suggestedMessage || "N/A"}" with LOW risk, but the message was not sent. Conversation has history: ${hasHistory}, state: ${message.conversation.state}. This task was created to prevent a silent conversation stall.`,
            channel: "WHATSAPP",
            intent,
            conversationId: message.conversationId,
            checkpointMessageId: message.id,
            proposedAction: {
              actionType: proposedAction.actionType,
              suggestedMessage: proposedAction.suggestedMessage,
              reasoning: proposedAction.reasoning,
              riskLevel: proposedAction.riskLevel,
            },
            conversationState: message.conversation.state,
            hasHistory,
          };

          const basePayload = {
            ...basePayloadWithoutPending,
            pendingReplyText: normalizePendingReplyText(proposedAction, basePayloadWithoutPending),
          };

          let enrichedPayload = await enrichPayloadWithJobMatches(
            message.agencyId,
            message.contact.phone,
            message.conversation,
            basePayload
          );

          // Add job snapshot for priority scoring
          enrichedPayload = await enrichPayloadWithJobSnapshot(
            enrichedPayload,
            message.agencyId
          );

          // Ensure conversationId is always present in payload
          if (!enrichedPayload.conversationId) {
            enrichedPayload.conversationId = message.conversationId;
          }

          // Determine suggested message using fallback logic
          const suggested = 
            (proposedAction as any)?.suggestedMessage ??
            enrichedPayload.pendingReplyText ??
            getFallbackReplyForApproval({
              intent,
              inboundText: textForAI,
              candidateName: message.contact.name,
              desiredRole: null, // Not easily available here without extra query
            });

          // Create proper proposedAction structure
          const proposedActionForTaskRaw = {
            actionType: "SEND_MESSAGE" as const,
            suggestedMessage: suggested,
            reasoning: proposedAction.reasoning || "Fallback message because AI suggested LOW-risk SEND_MESSAGE but message was not sent",
            riskLevel: (proposedAction.riskLevel || "LOW") as "LOW" | "MEDIUM",
            explainability: proposedAction.explainability, // Preserve AI explainability if present
          };

          // Ensure explainability is present
          const { proposedAction: proposedActionForTask, enrichedPayload: finalPayload } = ensureExplainabilityInProposedAction(
            proposedActionForTaskRaw,
            enrichedPayload,
            {
              missingFields: message.conversation.progressData?.missingFields as string[] | undefined,
              intent,
              memoryPack: message.conversation.memoryPack as any,
              candidateName: message.contact.name,
            }
          );

          // Idempotency check: Look for existing task with same relatedMessageId + type
          const existingTaskByIdempotency2 = await prisma.task.findFirst({
            where: {
              agencyId: message.agencyId,
              relatedMessageId: message.id,
              type: TaskType.APPROVAL_REQUIRED,
              status: TaskStatus.OPEN,
            },
          });

          if (existingTaskByIdempotency2) {
            log.info(
              {
                taskId: existingTaskByIdempotency2.id,
                messageId: message.id,
              },
              "Task already exists for this message (idempotency check) - skipping duplicate task creation"
            );
            return;
          }

          // Update payload with suggested message
          finalPayload.pendingReplyText = suggested;

          await prisma.task.create({
            data: {
              agencyId: message.agencyId,
              type: TaskType.APPROVAL_REQUIRED,
              status: TaskStatus.OPEN,
              approvalStatus: "PENDING",
              proposedAction: proposedActionForTask,
              relatedMessageId: message.id,
              payload: finalPayload,
            },
          });

          log.info(
            {
              messageId: message.id,
              conversationId: message.conversationId,
              intent,
            },
            "Task created and conversation paused for LOW-risk SEND_MESSAGE that was not sent - preventing silent stall"
          );

          return;
        }
    } catch (error) {
      log.warn(
        { messageId: message.id, error },
        "Failed to generate AI reply or send auto-reply; falling back to approval workflow"
      );
      // Continue to approval workflow below
    }

  // REQUIRES_APPROVAL: Pause conversation, create task, NO reply sent
  log.info(
    {
      messageId: message.id,
      intent,
      escalationReason: escalation.reason,
      conversationId: message.conversationId,
    },
    "Intent requires approval - pausing conversation and creating approval task"
  );

  // Generate proposed action for approval task
  let proposedActionForApproval: unknown | undefined = undefined;
  try {
    const aiEnabled =
      (process.env.ENABLE_AI_INTENT_CLASSIFIER ?? "").toLowerCase() === "true";

    if (aiEnabled) {
      // Get memory pack and progress for context (use findFirst with agency scoping)
      const conversationForContext = await prisma.conversation.findFirst({
        where: scopeWhere(agencyId, { id: message.conversationId }),
        select: {
          memoryPack: true,
          progressStage: true,
          progressData: true,
        },
      });

      const memoryPack = conversationForContext?.memoryPack as any;
      const progressStage = conversationForContext?.progressStage as any;
      const progressData = conversationForContext?.progressData as any;

      proposedActionForApproval = await suggestActionWithAI({
        intent,
        messageText: textForAI,
        contactName: message.contact.name,
        conversationHistory, // Pass conversation history for context
        memoryPack: memoryPack || null,
        progressStage: progressStage || null,
        progressData: progressData || null,
        playbook, // Pass playbook for AI behavior configuration
      });

      log.info(
        {
          messageId: message.id,
          intent,
          actionType: (proposedActionForApproval as any)?.actionType,
          riskLevel: (proposedActionForApproval as any)?.riskLevel,
        },
        "AI action suggestion generated for approval task"
      );
    }
  } catch (error) {
    log.warn(
      { messageId: message.id, error },
      "Failed to generate AI action suggestion; continuing without it"
    );
  }

  // Pause conversation for approval
  const pausedReason = escalation.requires
    ? `Awaiting approval: ${escalation.reason}`
    : `Awaiting approval: ${intent} intent requires human review`;

  await prisma.conversation.update({
    where: { id: message.conversationId },
    data: {
      state: ConversationState.PAUSED_FOR_APPROVAL as any,
      pausedReason,
    } as any,
  });

  log.info(
    {
      messageId: message.id,
      conversationId: message.conversationId,
      conversationState: ConversationState.PAUSED_FOR_APPROVAL,
      pausedReason,
      intent,
      escalationReason: escalation.reason,
    },
    "Conversation paused for approval - no reply sent"
  );

  // Idempotency check: Look for existing task with same relatedMessageId + type
  // This prevents duplicate tasks when replaying message processing
  const existingTaskByIdempotency = await prisma.task.findFirst({
    where: {
      agencyId: message.agencyId,
      relatedMessageId: message.id,
      type: TaskType.APPROVAL_REQUIRED,
      status: TaskStatus.OPEN,
    },
  });

  if (existingTaskByIdempotency) {
    log.info(
      {
        taskId: existingTaskByIdempotency.id,
        messageId: message.id,
        conversationId: message.conversationId,
      },
      "Task already exists for this message (idempotency check) - skipping duplicate task creation"
    );
    return;
  }

  // Check if a pending task already exists for this conversation (legacy check)
  const existingTask = await prisma.task.findFirst({
    where: {
      agencyId: message.agencyId,
      type: TaskType.APPROVAL_REQUIRED,
      status: TaskStatus.OPEN,
      approvalStatus: "PENDING",
      relatedMessage: {
        conversationId: message.conversationId,
      },
    },
    include: {
      relatedMessage: true,
    },
  });

  if (existingTask) {
    // Update existing task with new message context and proposed action
    const existingPayload = existingTask.payload as any;
    
    // Ensure pendingReplyText is never removed/overwritten with null
    // Priority: new proposedActionForApproval > existing payload > fallback
    const existingPendingReplyText = existingPayload.pendingReplyText;
    const pendingReplyText = 
      (proposedActionForApproval as any)?.suggestedMessage || 
      existingPendingReplyText || 
      getFallbackReplyForApproval({
        intent,
        inboundText: message.text,
        candidateName: message.contact.name,
        desiredRole: null,
      });
    
    const updatedPayload = {
      ...existingPayload,
      additionalMessages: [
        ...(existingPayload.additionalMessages || []),
        {
          messageId: message.id,
          text: message.text,
          intent,
          escalationReason: escalation.reason,
          receivedAt: new Date().toISOString(),
        },
      ],
      lastMessageId: message.id,
      lastMessageText: message.text,
      lastIntent: intent,
      lastEscalationReason: escalation.reason,
      pendingReplyText, // Always preserve or set fallback, never null
    };

    await prisma.task.update({
      where: { id: existingTask.id },
      data: {
        proposedAction: proposedActionForApproval ?? existingTask.proposedAction ?? undefined,
        payload: updatedPayload,
      },
    });

    log.info(
      {
        taskId: existingTask.id,
        messageId: message.id,
        conversationId: message.conversationId,
        intent,
        additionalMessagesCount: updatedPayload.additionalMessages.length,
      },
      "Existing pending task updated with new message context - no duplicate task created"
    );

    return;
  }

  // No existing task - create new one
  const basePayload = {
    reason: "Inbound message received - approval required",
    channel: "WHATSAPP",
    intent,
    escalationReason: escalation.reason,
    conversationId: message.conversationId,
    checkpointMessageId: message.id,
    pendingReplyText: normalizePendingReplyText(proposedActionForApproval, null),
  };

  let enrichedPayload = await enrichPayloadWithJobMatches(
    message.agencyId,
    message.contact.phone,
    message.conversation,
    basePayload
  );

  // Add job snapshot for priority scoring
  enrichedPayload = await enrichPayloadWithJobSnapshot(
    enrichedPayload,
    message.agencyId
  );

  // Ensure conversationId is always present in payload
  if (!enrichedPayload.conversationId) {
    enrichedPayload.conversationId = message.conversationId;
  }

  // Determine suggested message using fallback logic
  const suggested = 
    (proposedActionForApproval as any)?.suggestedMessage ??
    enrichedPayload.pendingReplyText ??
    getFallbackReplyForApproval({
      intent,
      inboundText: message.text,
      candidateName: message.contact.name,
      desiredRole: null, // Not easily available here without extra query
    });

  // Determine risk level based on escalation
  const riskLevel = escalation.requires ? "MEDIUM" : "LOW";

  // Create proper proposedAction structure
  const proposedActionForTaskRaw = {
    actionType: "SEND_MESSAGE" as const,
    suggestedMessage: suggested,
    reasoning: (proposedActionForApproval as any)?.reasoning || `Fallback message because ${escalation.requires ? "escalation required" : "AI suggested escalation/unknown"}`,
    riskLevel: riskLevel as "LOW" | "MEDIUM",
    explainability: (proposedActionForApproval as any)?.explainability, // Preserve AI explainability if present
  };

  // Ensure explainability is present
  const { proposedAction: proposedActionForTask, enrichedPayload: finalPayload } = ensureExplainabilityInProposedAction(
    proposedActionForTaskRaw,
    enrichedPayload,
    {
      missingFields: message.conversation.progressData?.missingFields as string[] | undefined,
      intent,
      memoryPack: message.conversation.memoryPack as any,
      candidateName: message.contact.name,
    }
  );

  // Idempotency check: Look for existing task with same relatedMessageId + type
  const existingTaskByIdempotencyFinal = await prisma.task.findFirst({
    where: {
      agencyId: message.agencyId,
      relatedMessageId: message.id,
      type: TaskType.APPROVAL_REQUIRED,
      status: TaskStatus.OPEN,
    },
  });

  if (existingTaskByIdempotencyFinal) {
    log.info(
      {
        taskId: existingTaskByIdempotencyFinal.id,
        messageId: message.id,
        conversationId: message.conversationId,
      },
      "Task already exists for this message (idempotency check) - skipping duplicate task creation"
    );
    return;
  }

  // Update payload with suggested message
  finalPayload.pendingReplyText = suggested;

  const task = await prisma.task.create({
    data: {
      agencyId: message.agencyId,
      type: TaskType.APPROVAL_REQUIRED,
      status: TaskStatus.OPEN,
      approvalStatus: "PENDING",
      proposedAction: proposedActionForTask,
      relatedMessageId: message.id,
      payload: finalPayload,
    } as any,
  });

  // Create TASK_CREATED timeline event
  try {
    const candidateId = await getCandidateId(message.agencyId, message.contact.phone, message.conversation);
    const payload = task.payload as any;
    await createTimelineEvent({
      agencyId: message.agencyId,
      conversationId: message.conversationId,
      contactId: message.contactId,
      candidateId,
      type: "TASK_CREATED",
      actorRole: "SYSTEM",
      summary: `Task created: ${task.type}`,
      data: {
        taskId: task.id,
        taskType: task.type,
        priority: payload.priority?.score || null,
      },
      dedupeKey: `task_${task.id}`,
    });
  } catch (error) {
    log.warn({ taskId: task.id, error }, "Failed to create TASK_CREATED timeline event (non-blocking)");
  }

  log.info(
    {
      taskId: task.id,
      messageId: message.id,
      conversationId: message.conversationId,
      taskType: task.type,
      taskStatus: task.status,
      approvalStatus: "PENDING",
      intent,
      escalationReason: escalation.reason,
    },
    "Approval task created - conversation paused, no reply sent"
  );
}

const worker = new Worker<InboundJobData>(
  "inbound-messages",
  async (job) => {
    const jobId = job.id;
    const messageId = job.data?.messageId;
    const agencyId = job.data?.agencyId;
    
    // Log job start with key identifiers
    log.info(
      {
        jobId,
        messageId,
        agencyId,
        conversationId: job.data?.messageId ? "fetching..." : undefined,
      },
      "Job started: processing inbound message"
    );

    try {
      // Get conversationId for logging (fetch early if possible)
      let conversationId: string | undefined;
      if (messageId && agencyId) {
        try {
          const message = await prisma.message.findFirst({
            where: { id: messageId, agencyId },
            select: { conversationId: true },
          });
          conversationId = message?.conversationId || undefined;
        } catch (err) {
          // Non-blocking - just for logging
          log.debug({ jobId, messageId, error: serializeError(err) }, "Could not fetch conversationId for logging");
        }
      }

      // Process the message
      await processInboundMessage(job);

      // Log successful completion
      log.info(
        {
          jobId,
          messageId,
          agencyId,
          conversationId,
        },
        "Job finished: inbound message processed successfully"
      );
    } catch (error) {
      // Log full error with stack trace
      const errorDetails = serializeError(error);
      log.error(
        {
          jobId,
          messageId,
          agencyId,
          error: errorDetails,
          stack: errorDetails.stack,
        },
        "Job failed: inbound message processing error"
      );
      throw error; // Re-throw to mark job as failed
    }
  },
  {
    connection: connectionOptions,
    concurrency: 5,
  }
);

worker.on("completed", async (job) => {
  // If replay mode, emit REPLAY_INBOUND_FINISHED event
  if (job.data?.replay) {
    try {
      const messageForEvent = await prisma.message.findFirst({
        where: { id: job.data.messageId, agencyId: job.data.agencyId },
        select: { conversationId: true, contactId: true },
      });

      if (messageForEvent && messageForEvent.conversationId && messageForEvent.contactId) {
        await createTimelineEvent({
          agencyId: job.data.agencyId,
          conversationId: messageForEvent.conversationId,
          contactId: messageForEvent.contactId,
          type: "REPLAY_INBOUND_FINISHED",
          actorRole: "SYSTEM",
          summary: "Finished replaying inbound message processing",
          data: {
            messageId: job.data.messageId,
            jobId: job.id,
            dryRun: job.data.dryRun ?? true,
            allowSendOutbound: job.data.allowSendOutbound ?? false,
          },
          dedupeKey: `replay_finished_${job.id}`,
        });
      }
    } catch (error) {
      log.warn({ jobId: job.id, error }, "Failed to create REPLAY_INBOUND_FINISHED timeline event (non-blocking)");
    }
  }

  log.debug({ jobId: job.id, messageId: job.data?.messageId }, "Job completed");
});

worker.on("failed", (job, err) => {
  const errorDetails = serializeError(err);
  log.error(
    {
      jobId: job?.id,
      messageId: job?.data?.messageId,
      agencyId: job?.data?.agencyId,
      error: errorDetails,
      stack: errorDetails.stack,
      reason: err?.message || "Unknown error",
    },
    "BullMQ: Job failed event"
  );
});

worker.on("stalled", (jobId) => {
  log.warn(
    { jobId },
    "BullMQ: Job stalled (taking too long, will be retried)"
  );
});

worker.on("error", (err) => {
  const errorDetails = serializeError(err);
  log.error(
    {
      error: errorDetails,
      stack: errorDetails.stack,
    },
    "BullMQ: Worker error (connection/queue issue)"
  );
});

async function shutdown(signal: string) {
  log.info({ signal }, "Shutting down inbound worker...");
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
