# Governance Layer - Steps B & C Implementation Summary

## Step B: Approval Audit Data on Task Payload ✅

### Implementation Status: **COMPLETE**

All required fields are now written to the Task payload on approval:

1. ✅ `payload.proposedMessageText` - AI suggested message (capped at 2000 chars)
2. ✅ `payload.approvedMessageText` - Final message sent (capped at 2000 chars)
3. ✅ `payload.wasEdited` - Boolean indicating if text was edited
4. ✅ `payload.editMetrics` - Object with:
   - `charDiffRatio` - Ratio of character difference (0-1)
   - `wordDiffCount` - Absolute difference in word count
   - `wasShortened` - Boolean if final is shorter
   - `wasExpanded` - Boolean if final is longer
5. ✅ `payload.editSummary` - Short human-readable summary (e.g., "Shortened and removed uncertain language")

### Helper Utility: `src/utils/editMetrics.ts`

**Functions Implemented:**
- `computeEditMetrics(proposed, final)` - Computes all metrics
- `wasEdited(proposed, final)` - Determines if text was edited (after normalization)
- `capText(text, maxLength)` - Caps text at 2000 chars for storage
- `generateEditSummary(metrics)` - Generates human-readable summary

**Normalization Rules:**
- Trims whitespace
- Collapses multiple spaces to single space
- Compares normalized texts to determine if edited

### Rules Compliance:

✅ **proposedMessageText**: Resolved from `task.proposedAction.suggestedMessage` or `payload.pendingReplyText` (AI-suggested, not fallback)

✅ **approvedMessageText**: Resolved using priority: `messageOverride` > `suggestedMessage` > `fallback`

✅ **wasEdited**: True when texts differ after normalization (trim whitespace, collapse multiple spaces)

✅ **Text Capping**: Both texts capped at 2000 chars before storage

---

## Step C: Integration into Approve Endpoint ✅

### Implementation Status: **COMPLETE**

**Location**: `src/routes/tasks.ts` - `approveTaskHandler` function

### Implementation Flow:

1. ✅ **Resolve Proposed Message** (Lines 180-192)
   - Reads from `task.proposedAction.suggestedMessage` (primary)
   - Falls back to `payload.pendingReplyText` (secondary)
   - Leaves empty if neither exists (edge case)

2. ✅ **Resolve Final Message** (Lines 194-295)
   - Priority 1: `messageOverride` from request body
   - Priority 2: `proposedMessageText` (if no override)
   - Priority 3: Fallback generator (if no proposed message)
   - Handles edge case: if fallback used and no proposed, sets proposed = final (no edit)

3. ✅ **Compute Metrics** (Lines 297-300)
   - Calls `wasEdited(proposedMessageText, approvedMessageText)`
   - Calls `computeEditMetrics(proposedMessageText, approvedMessageText)`
   - Generates `editSummary` using `generateEditSummary(editMetrics)`

4. ✅ **Cap Texts** (Lines 302-304)
   - Caps both texts at 2000 chars using `capText()`

5. ✅ **Write to Payload** (Lines 306-317)
   - Updates `updateData.payload` with all audit fields
   - Preserves existing payload fields
   - Includes backward compatibility field `sentText`

6. ✅ **Update Task** (Line 518)
   - Task updated with `updateData` (includes payload with audit fields)
   - **Happens BEFORE message is sent** (correct order)

7. ✅ **Timeline Event** (Lines 583-625)
   - Creates `TASK_APPROVED` timeline event
   - Includes `wasEdited` flag in summary
   - Includes `editSummary` in summary text
   - Includes full `editMetrics` in event data
   - Summary format: `"Task approved (${editSummary})"` or `"Task approved"`

### Idempotency:

✅ **Double Approval Prevention**: Already handled (lines 117-129)
- Checks if `approvalStatus === APPROVED` before processing
- Returns 409 Conflict if already approved

✅ **Unique Constraint**: Will be handled in Step D (MessageReviewSample model has `@@unique([agencyId, taskId])`)

### Message Sending:

✅ **No Behavioral Changes**: Message sending logic unchanged
- Task is enqueued via `enqueueApprovedTask(taskId)` (line 556)
- Message is sent by the worker, not in the approve handler
- Payload is updated before enqueueing (correct order)

---

## Files Modified

### 1. `src/utils/editMetrics.ts` ✅
- **Status**: Already existed and is complete
- **Functions**: `computeEditMetrics`, `wasEdited`, `capText`, `generateEditSummary`
- **No changes needed**

### 2. `src/routes/tasks.ts` ✅
- **Status**: Already integrated
- **Changes**: 
  - Lines 15: Import edit metrics utilities
  - Lines 180-321: Resolve proposed/final messages, compute metrics, write to payload
  - Lines 583-625: Timeline event includes edit metrics

---

## Testing Checklist

### Manual Verification:

1. ✅ **Approve task with AI suggestion, no edit**
   - `proposedMessageText` = AI suggestion
   - `approvedMessageText` = AI suggestion
   - `wasEdited` = false
   - `editSummary` = "No changes"

2. ✅ **Approve task with operator override**
   - `proposedMessageText` = AI suggestion
   - `approvedMessageText` = messageOverride
   - `wasEdited` = true (if different)
   - `editMetrics` computed correctly

3. ✅ **Approve task with no AI suggestion (fallback used)**
   - `proposedMessageText` = fallback (edge case)
   - `approvedMessageText` = fallback
   - `wasEdited` = false
   - Handles gracefully

4. ✅ **Text capping at 2000 chars**
   - Long messages are truncated
   - Both proposed and final are capped

5. ✅ **Timeline event includes metrics**
   - Event summary includes edit summary
   - Event data includes full metrics

---

## Summary

✅ **Step B**: Complete - All audit fields written to Task payload
✅ **Step C**: Complete - Integrated into approve endpoint with correct order
✅ **No Breaking Changes**: Message sending behavior unchanged
✅ **Idempotency**: Double approval prevention in place
✅ **Timeline Integration**: Edit metrics included in TASK_APPROVED events

**Ready for Step D**: Review Queue and Sampling Logic

