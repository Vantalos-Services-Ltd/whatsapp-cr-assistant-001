/**
 * Deterministic Progress State Machine
 * 
 * Layer 1: Pure computation (no side effects)
 * Layer 2: Apply with audit and idempotency
 */

import pino from "pino";
import { prisma } from "../../db/prisma.ts";
import { createTimelineEvent } from "../timelineService.ts";
import type {
  ProgressMachineContext,
  ProgressStateResult,
  ProgressStage,
} from "./stateMachineTypes.ts";
import {
  normalizeMissingFields,
  computeDormancyFollowUpAt,
  safeIsoString,
  isOlderThanDays,
  defaultValue,
} from "./stateMachineTypes.ts";

const log = pino({ name: "progressStateMachine" });

/**
 * Layer 1: Pure computation
 * Computes next progress state from context without any side effects
 * 
 * Rules priority (checked in order):
 * Rule 0: Operator waiting dominates flags (set flags, but stage stable unless NEW)
 * Rule 1: CLOSED - if candidate not looking or confirmed job found
 * Rule 2: DORMANT - if no activity >30 days (unless CLOSED)
 * Rule 3: PROFILE_INCOMPLETE - if missing required fields (desiredRole, location, availability)
 * Rule 4: LOOKING_FOR_WORK - if intent indicates looking for work and profile complete
 * Rule 5: MATCHED_TO_JOBS - if jobs matched >0 and stage is LOOKING_FOR_WORK
 * Rule 6: CSCS_VERIFICATION or DOCS_NEEDED - based on actual tasks/facts
 * Rule 7: READY_TO_PLACE - if all requirements met and candidate interested
 * Rule 8: PLACED and AFTERCARE - if placement confirmed
 */
export function computeNextProgressState(
  context: ProgressMachineContext
): ProgressStateResult {
  const {
    currentStage,
    currentProgressData,
    lastActivityAt,
    lastInboundMessageAt,
    candidate,
    tasks,
    placement,
    lastIntent,
    matchedJobsCount,
  } = context;

  const now = new Date();
  const nowIso = now.toISOString();
  const lastActivity = typeof lastActivityAt === "string" ? new Date(lastActivityAt) : lastActivityAt;
  const lastInbound = lastInboundMessageAt
    ? typeof lastInboundMessageAt === "string"
      ? new Date(lastInboundMessageAt)
      : lastInboundMessageAt
    : null;

  // Initialize progress data patch with defaults
  const progressDataPatch: ProgressStateResult["progressDataPatch"] = {
    missingFields: [],
    nextAction: null,
    followUpAt: null,
    flags: {
      waitingForOperator: false,
      needsFollowUp: false,
      highPriority: false,
    },
    lastStageReason: "",
    lastStageChangedAt: nowIso,
  };

  // Merge with existing flags
  if (currentProgressData?.flags) {
    progressDataPatch.flags = {
      ...progressDataPatch.flags,
      ...currentProgressData.flags,
    };
  }

  let finalStage: ProgressStage = currentStage || "NEW";
  let reason = "";

  // Rule 0: Operator waiting dominates flags
  // Set flags but keep stage stable unless NEW with no other info
  if (tasks.hasPendingApproval) {
    progressDataPatch.flags.waitingForOperator = true;
    progressDataPatch.nextAction = "Waiting for operator approval";
    
    // Only allow stage change if NEW and no other info
    if (currentStage === "NEW" || !currentStage) {
      // Allow transition to PROFILE_INCOMPLETE or LOOKING_FOR_WORK if we have info
      // But don't bounce - keep stable
      if (candidate && candidate.desiredRole && candidate.location && candidate.availability) {
        finalStage = "LOOKING_FOR_WORK";
        reason = "Profile complete, waiting for approval";
      } else if (candidate && (candidate.desiredRole || candidate.location)) {
        finalStage = "PROFILE_INCOMPLETE";
        reason = "Profile incomplete, waiting for approval";
      } else {
        finalStage = "NEW";
        reason = "New conversation, waiting for approval";
      }
    } else {
      // Keep current stage, just update flags
      finalStage = currentStage;
      reason = `Maintaining ${currentStage} (waiting for operator approval)`;
    }
    
    // Return early if we're just updating flags for pending approval
    // But continue to other rules if stage is NEW to allow proper initialization
    if (currentStage && currentStage !== "NEW") {
      // Preserve existing fields
      if (!progressDataPatch.missingFields.length && currentProgressData?.missingFields) {
        progressDataPatch.missingFields = currentProgressData.missingFields;
      }
      if (!progressDataPatch.nextAction && currentProgressData?.nextAction) {
        progressDataPatch.nextAction = currentProgressData.nextAction;
      }
      if (!progressDataPatch.followUpAt && currentProgressData?.followUpAt) {
        progressDataPatch.followUpAt = currentProgressData.followUpAt;
      }
      return {
        stage: finalStage,
        reason,
        progressDataPatch,
      };
    }
  }

  // Rule 1: CLOSED - if candidate not looking or confirmed job found
  // Note: Intent system doesn't have explicit "NOT_LOOKING" yet, so we check placement status
  // If placement was cancelled (hasConfirmedPlacement is false but we were PLACED), move back
  const placementCancelled = placement && !placement.hasConfirmedPlacement && currentStage === "PLACED";
  
  if (placementCancelled) {
    // Placement cancelled - move back to LOOKING_FOR_WORK
    finalStage = "LOOKING_FOR_WORK";
    reason = "Placement cancelled";
    progressDataPatch.nextAction = "Re-engage candidate and find new opportunities";
    progressDataPatch.flags.waitingForOperator = false;
    progressDataPatch.flags.needsFollowUp = true;
    // Set follow-up to soon
    const followUpDate = new Date(now);
    followUpDate.setDate(followUpDate.getDate() + 1);
    progressDataPatch.followUpAt = followUpDate.toISOString();
    return {
      stage: finalStage,
      reason,
      progressDataPatch,
    };
  }
  
  // For now, CLOSED is only set manually (operator action)
  // In future, can detect "not looking" signals from message text or memory pack

  // If already CLOSED, stay closed
  if (currentStage === "CLOSED") {
    finalStage = "CLOSED";
    reason = "Conversation is closed";
    progressDataPatch.nextAction = null;
    progressDataPatch.followUpAt = null;
    return {
      stage: finalStage,
      reason,
      progressDataPatch,
    };
  }

  // Rule 2: DORMANT - if no activity >30 days (unless CLOSED)
  if (isOlderThanDays(lastActivity, 30)) {
    finalStage = "DORMANT";
    const daysSinceActivity = Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));
    reason = `No activity for ${daysSinceActivity} days`;
    progressDataPatch.flags.needsFollowUp = true;
    
    // Set followUpAt to now or next working day
    const followUpDate = new Date(now);
    // Simple: set to tomorrow (can be enhanced with working day logic)
    followUpDate.setDate(followUpDate.getDate() + 1);
    progressDataPatch.followUpAt = followUpDate.toISOString();
    
    return {
      stage: finalStage,
      reason,
      progressDataPatch,
    };
  }

  // Rule 3: PROFILE_INCOMPLETE - if missing required fields
  // Required fields: desiredRole, location, availability
  const requiredFields: Array<{ key: keyof NonNullable<typeof candidate>; label: string }> = [
    { key: "desiredRole", label: "desiredRole" },
    { key: "location", label: "location" },
    { key: "availability", label: "availability" },
  ];
  
  const missingRequiredFields: string[] = [];
  if (candidate) {
    for (const field of requiredFields) {
      const value = candidate[field.key];
      if (!value || (typeof value === "string" && value.trim().length === 0)) {
        missingRequiredFields.push(field.label);
      }
    }
  } else {
    // No candidate at all means profile is incomplete
    missingRequiredFields.push("desiredRole", "location", "availability");
  }

  if (missingRequiredFields.length > 0 && currentStage !== "CLOSED" && currentStage !== "DORMANT") {
    finalStage = "PROFILE_INCOMPLETE";
    reason = `Missing required fields: ${missingRequiredFields.join(", ")}`;
    progressDataPatch.missingFields = normalizeMissingFields(missingRequiredFields);
    
    // Build nextAction instruction
    const missingList = missingRequiredFields.join(" and ");
    progressDataPatch.nextAction = `Collect ${missingList}`;
    progressDataPatch.followUpAt = null;
    
    return {
      stage: finalStage,
      reason,
      progressDataPatch,
    };
  }

  // Rule 4: LOOKING_FOR_WORK - if intent indicates looking for work and profile minimum complete
  const profileMinimumComplete = candidate && 
    candidate.desiredRole && 
    candidate.location && 
    candidate.availability;
  
  const intentIndicatesLookingForWork = lastIntent === "LOOKING_FOR_WORK" || 
    (lastIntent && ["AVAILABILITY_UPDATE", "FOLLOW_UP"].includes(lastIntent) && profileMinimumComplete);
  
  if (intentIndicatesLookingForWork && profileMinimumComplete) {
    finalStage = "LOOKING_FOR_WORK";
    reason = "Candidate is looking for work";
    
    // Check for optional preferences
    const optionalMissing: string[] = [];
    if (!candidate.salaryMin && !candidate.salaryMax) {
      optionalMissing.push("salary");
    }
    // Check for tickets/CSCS if relevant (could be in candidate facts)
    
    if (optionalMissing.length > 0) {
      progressDataPatch.missingFields = normalizeMissingFields(optionalMissing);
      progressDataPatch.nextAction = "Send suitable jobs or ask 1 missing preference";
    } else {
      progressDataPatch.nextAction = "Send suitable jobs";
    }
    
    return {
      stage: finalStage,
      reason,
      progressDataPatch,
    };
  }

  // Rule 5: MATCHED_TO_JOBS - if jobs matched >0 and stage is LOOKING_FOR_WORK
  if (matchedJobsCount > 0 && (currentStage === "LOOKING_FOR_WORK" || finalStage === "LOOKING_FOR_WORK")) {
    finalStage = "MATCHED_TO_JOBS";
    reason = "Matching jobs available";
    progressDataPatch.nextAction = "Send top 2 jobs and confirm interest";
    progressDataPatch.flags.highPriority = true;
    return {
      stage: finalStage,
      reason,
      progressDataPatch,
    };
  }

  // Rule 6: CSCS_VERIFICATION or DOCS_NEEDED
  if (tasks.hasOpenCscsTask) {
    finalStage = "CSCS_VERIFICATION";
    reason = "CSCS verification task is open";
    progressDataPatch.missingFields = normalizeMissingFields(["CSCS card verification"]);
    progressDataPatch.nextAction = "Review CSCS verification result";
    progressDataPatch.flags.highPriority = true;
    progressDataPatch.flags.waitingForOperator = true;
    return {
      stage: finalStage,
      reason,
      progressDataPatch,
    };
  }
  
  // DOCS_NEEDED - only if we have actual evidence of missing docs
  // This should be driven by actual tasks or candidate facts, not invented
  // For now, skip DOCS_NEEDED unless we have explicit task types for it
  // (Can be expanded when more document task types are added)

  // Rule 7: READY_TO_PLACE - if all requirements met and candidate interested
  const profileComplete = candidate && 
    candidate.desiredRole && 
    candidate.location && 
    candidate.availability;
  
  const cscsNotRequired = !tasks.hasOpenCscsTask; // Assume CSCS verified or not required
  
  // Check for job interest - this would come from memory pack or conversation facts
  // For now, if we have matched jobs and profile is complete, consider ready
  // In future, check for lastJobDiscussed and interest indicators
  const candidateInterested = matchedJobsCount > 0; // Simplified - can be enhanced with memory pack
  
  if (
    profileComplete &&
    cscsNotRequired &&
    candidateInterested &&
    !tasks.hasPendingApproval &&
    matchedJobsCount > 0
  ) {
    finalStage = "READY_TO_PLACE";
    reason = "All requirements met, candidate interested in jobs";
    progressDataPatch.nextAction = "Confirm start date and site details";
    progressDataPatch.flags.highPriority = true;
    return {
      stage: finalStage,
      reason,
      progressDataPatch,
    };
  }

  // Rule 8: PLACED and AFTERCARE
  if (placement?.hasConfirmedPlacement) {
    // Check if placement start date has passed
    if (placement.placementStartDate) {
      const startDate = new Date(placement.placementStartDate);
      if (!isNaN(startDate.getTime())) {
        const daysSinceStart = (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
        
        // If start date is in the past, move to AFTERCARE
        if (startDate <= now) {
          finalStage = "AFTERCARE";
          reason = `Placement started ${Math.floor(daysSinceStart)} days ago`;
          progressDataPatch.nextAction = "Aftercare check in";
          return {
            stage: finalStage,
            reason,
            progressDataPatch,
          };
        }
      }
    }
    
    // Placement confirmed but not started yet
    finalStage = "PLACED";
    reason = "Placement confirmed";
    progressDataPatch.nextAction = "Aftercare check in";
    progressDataPatch.flags.highPriority = false;
    progressDataPatch.flags.waitingForOperator = false;
    return {
      stage: finalStage,
      reason,
      progressDataPatch,
    };
  }

  // Default: Keep current stage or initialize to NEW/LOOKING_FOR_WORK
  if (!currentStage || currentStage === "NEW") {
    if (profileMinimumComplete) {
      finalStage = "LOOKING_FOR_WORK";
      reason = "Profile complete, candidate is looking for work";
      progressDataPatch.nextAction = "Find suitable job matches";
    } else {
      finalStage = "NEW";
      reason = "New conversation";
      progressDataPatch.nextAction = "Collect candidate information";
    }
  } else {
    finalStage = currentStage;
    reason = `Maintaining current stage: ${currentStage}`;
  }

  // Set flags based on task status (if not already set by Rule 0)
  if (!tasks.hasPendingApproval && tasks.hasOpenFollowUpTask) {
    progressDataPatch.flags.needsFollowUp = true;
    const followUpDate = computeDormancyFollowUpAt(lastActivity);
    if (followUpDate) {
      progressDataPatch.followUpAt = followUpDate;
    }
  }

  // Preserve existing fields if stage didn't change and no new values set
  if (finalStage === currentStage) {
    if (!progressDataPatch.missingFields.length && currentProgressData?.missingFields) {
      progressDataPatch.missingFields = currentProgressData.missingFields;
    }
    if (!progressDataPatch.nextAction && currentProgressData?.nextAction) {
      progressDataPatch.nextAction = currentProgressData.nextAction;
    }
    if (!progressDataPatch.followUpAt && currentProgressData?.followUpAt) {
      progressDataPatch.followUpAt = currentProgressData.followUpAt;
    }
  }

  return {
    stage: finalStage,
    reason,
    progressDataPatch,
  };
}

/**
 * Layer 2: Apply with audit and idempotency
 * 
 * Loads conversation, computes next state, and updates if changed.
 * Creates timeline event for stage changes.
 * Idempotent: running twice on same state produces no changes.
 */
export async function applyProgressStateMachine(input: {
  conversationId: string;
  agencyId: string;
  context: Omit<ProgressMachineContext, "currentStage" | "currentProgressData">;
}): Promise<{
  changed: boolean;
  stage: ProgressStage;
  reason: string;
}> {
  const { conversationId, agencyId, context } = input;

  try {
    // Load current conversation state
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        agencyId: true,
        progressStage: true,
        progressData: true,
        progressUpdatedAt: true,
        contactId: true,
        lastMessageAt: true,
        contact: {
          select: {
            phone: true,
            type: true,
          },
        },
      },
    });

    if (!conversation) {
      log.warn({ conversationId }, "Conversation not found");
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    if (conversation.agencyId !== agencyId) {
      log.warn({ conversationId, agencyId }, "Conversation does not belong to agency");
      throw new Error("Conversation does not belong to agency");
    }

    // Build full context
    const currentStage = (conversation.progressStage as ProgressStage) || "NEW";
    const currentProgressData = (conversation.progressData as any) || null;

    const fullContext: ProgressMachineContext = {
      ...context,
      currentStage,
      currentProgressData,
      conversationId,
      lastActivityAt: conversation.lastMessageAt || new Date(),
      lastInboundMessageAt: context.lastInboundMessageAt || conversation.lastMessageAt || null,
    };

    // Compute next state (Layer 1)
    const result = computeNextProgressState(fullContext);

    // Check if stage actually changed
    const stageChanged = result.stage !== currentStage;
    
    // Deep merge progressDataPatch with existing data
    // Only overwrite keys that are provided in the patch
    const mergedProgressData: any = {
      // Start with existing data if it exists
      ...(currentProgressData || {}),
    };

    // Merge missingFields: normalize and ensure stable order
    if (result.progressDataPatch.missingFields !== undefined) {
      const normalizedMissing = normalizeMissingFields(result.progressDataPatch.missingFields);
      const existingMissing = normalizeMissingFields(currentProgressData?.missingFields || []);
      
      // Only update if different (deep compare after normalization)
      if (JSON.stringify(normalizedMissing.sort()) !== JSON.stringify(existingMissing.sort())) {
        mergedProgressData.missingFields = normalizedMissing;
      } else {
        mergedProgressData.missingFields = existingMissing; // Preserve existing
      }
    } else {
      // Patch didn't provide missingFields, preserve existing
      mergedProgressData.missingFields = normalizeMissingFields(currentProgressData?.missingFields || []);
    }

    // Merge nextAction: only if patch provides it
    if (result.progressDataPatch.nextAction !== undefined) {
      const existingNextAction = currentProgressData?.nextAction || null;
      if (result.progressDataPatch.nextAction !== existingNextAction) {
        mergedProgressData.nextAction = result.progressDataPatch.nextAction;
      } else {
        mergedProgressData.nextAction = existingNextAction;
      }
    } else {
      // Preserve existing
      mergedProgressData.nextAction = currentProgressData?.nextAction || null;
    }

    // Merge followUpAt: only if patch provides it
    if (result.progressDataPatch.followUpAt !== undefined) {
      const existingFollowUpAt = currentProgressData?.followUpAt || null;
      if (result.progressDataPatch.followUpAt !== existingFollowUpAt) {
        mergedProgressData.followUpAt = result.progressDataPatch.followUpAt;
      } else {
        mergedProgressData.followUpAt = existingFollowUpAt;
      }
    } else {
      // Preserve existing
      mergedProgressData.followUpAt = currentProgressData?.followUpAt || null;
    }

    // Merge flags: deep merge, only update if different
    const existingFlags = currentProgressData?.flags || {};
    const patchFlags = result.progressDataPatch.flags || {};
    
    mergedProgressData.flags = {
      waitingForOperator: patchFlags.waitingForOperator !== undefined 
        ? patchFlags.waitingForOperator 
        : (existingFlags.waitingForOperator || false),
      needsFollowUp: patchFlags.needsFollowUp !== undefined 
        ? patchFlags.needsFollowUp 
        : (existingFlags.needsFollowUp || false),
      highPriority: patchFlags.highPriority !== undefined 
        ? patchFlags.highPriority 
        : (existingFlags.highPriority || false),
    };

    // lastStageReason and lastStageChangedAt: only update when stage actually changes
    if (stageChanged) {
      mergedProgressData.lastStageReason = result.reason;
      mergedProgressData.lastStageChangedAt = safeIsoString(new Date());
    } else {
      // Preserve existing values when stage unchanged
      mergedProgressData.lastStageReason = currentProgressData?.lastStageReason || result.reason;
      mergedProgressData.lastStageChangedAt = currentProgressData?.lastStageChangedAt || safeIsoString(new Date());
    }

    // Check if any data actually changed (for idempotency check)
    const dataChanged = (() => {
      if (!currentProgressData) {
        return true; // No existing data, any merge is a change
      }

      // Compare missingFields (already normalized)
      const existingMissingNormalized = normalizeMissingFields(currentProgressData.missingFields || []);
      const mergedMissingNormalized = normalizeMissingFields(mergedProgressData.missingFields || []);
      if (JSON.stringify(existingMissingNormalized.sort()) !== JSON.stringify(mergedMissingNormalized.sort())) {
        return true;
      }

      // Compare nextAction
      if (mergedProgressData.nextAction !== (currentProgressData.nextAction || null)) {
        return true;
      }

      // Compare followUpAt
      if (mergedProgressData.followUpAt !== (currentProgressData.followUpAt || null)) {
        return true;
      }

      // Compare flags
      const existingFlags = currentProgressData.flags || {};
      const mergedFlags = mergedProgressData.flags || {};
      if (
        mergedFlags.waitingForOperator !== (existingFlags.waitingForOperator || false) ||
        mergedFlags.needsFollowUp !== (existingFlags.needsFollowUp || false) ||
        mergedFlags.highPriority !== (existingFlags.highPriority || false)
      ) {
        return true;
      }

      // lastStageReason and lastStageChangedAt only matter if stage changed
      if (stageChanged) {
        return true; // Stage change always counts as data change
      }

      return false;
    })();

    // Idempotency: if nothing changed, return early
    if (!stageChanged && !dataChanged) {
      log.debug(
        { conversationId, stage: result.stage },
        "Progress state unchanged, skipping update (idempotent)"
      );
      return {
        changed: false,
        stage: result.stage,
        reason: result.reason,
      };
    }

    // Update conversation
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        progressStage: result.stage,
        progressData: mergedProgressData as any,
        progressUpdatedAt: new Date(),
      },
    });

    log.info(
      {
        conversationId,
        previousStage: currentStage,
        newStage: result.stage,
        stageChanged,
        dataChanged,
      },
      "Progress state updated"
    );

    // Create timeline event if stage changed
    if (stageChanged) {
      try {
        // Get candidateId if available
        let candidateId: string | null = null;
        if (context.candidate?.phone) {
          const candidate = await prisma.candidate.findUnique({
            where: {
              agencyId_phone: {
                agencyId,
                phone: context.candidate.phone,
              },
            },
            select: { id: true },
          });
          candidateId = candidate?.id || null;
        }

        await createTimelineEvent({
          agencyId,
          conversationId,
          contactId: conversation.contactId,
          candidateId,
          type: "PROGRESS_STAGE_CHANGED",
          actorRole: "SYSTEM",
          summary: `Progress moved to ${result.stage}`,
          data: {
            from: currentStage,
            to: result.stage,
            reason: result.reason,
            missingFields: result.progressDataPatch.missingFields || [],
            nextAction: result.progressDataPatch.nextAction || null,
          },
          dedupeKey: `conv_${conversationId}_progress_${result.stage}_${safeIsoString(new Date())}`,
        });
      } catch (error) {
        log.warn({ conversationId, error }, "Failed to create PROGRESS_STAGE_CHANGED timeline event (non-blocking)");
      }
    }

    return {
      changed: true,
      stage: result.stage,
      reason: result.reason,
    };
  } catch (error) {
    log.error({ conversationId, error }, "Failed to apply progress state machine");
    throw error;
  }
}

