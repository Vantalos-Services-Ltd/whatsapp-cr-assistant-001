# Timeline System Verification Checklist

## Files Changed

### Created Files
1. `prisma/migrations/20260202171853_add_timeline_events/migration.sql` - Database migration
2. `shared/types/timeline.ts` - Shared TypeScript types
3. `src/services/timelineService.ts` - Timeline service (already existed, verified)
4. `src/services/timelineService.test.ts` - Unit tests (already existed, fixed)
5. `components/conversation/TimelineView.tsx` - Frontend timeline component

### Modified Files
1. `prisma/schema.prisma` - Added TimelineEvent model and enums
2. `shared/types/index.ts` - Exported timeline types
3. `shared/dto/operator.ts` - Added TimelineEventDTO interface
4. `src/dto/operator.ts` - Added TimelineEventDTO interface (backend)
5. `src/dto/transformers.ts` - Added `toTimelineEventDTO()` transformer
6. `src/workers/inboundWorker.ts` - Added 6 timeline event types
7. `src/routes/tasks.ts` - Added TASK_APPROVED, TASK_REJECTED, CSCS_APPROVED, CSCS_REJECTED events
8. `src/workers/cscsAutoVerifyWorker.ts` - Added CSCS_AUTO_VERIFIED event
9. `src/routes/operator.ts` - Added `getConversationTimelineHandler` endpoint
10. `components/conversation/ConversationView.tsx` - Added Tabs with Timeline view
11. `app/operator/messages/page.tsx` - Passes conversationId to ConversationView

## Prisma Schema Diff

### New Enums
```prisma
enum TimelineEventType {
  INBOUND_MESSAGE_RECEIVED
  AI_SUGGESTION_CREATED
  TASK_CREATED
  TASK_APPROVED
  TASK_REJECTED
  PROGRESS_STAGE_CHANGED
  MEMORY_PACK_UPDATED
  CSCS_AUTO_VERIFIED
  CSCS_APPROVED
  CSCS_REJECTED
  OUTREACH_SENT
  FOLLOW_UP_CREATED
}

enum TimelineActorRole {
  SYSTEM
  AI
  OPERATOR
}
```

### New Model
```prisma
model TimelineEvent {
  id              String            @id @default(cuid())
  agencyId        String
  conversationId  String
  contactId       String
  candidateId     String?
  type            TimelineEventType
  actorRole       TimelineActorRole
  actorOperatorId String?
  summary         String            @db.VarChar(200)
  data            Json?
  dedupeKey       String?
  createdAt       DateTime          @default(now())

  // Relations
  agency       Agency       @relation(fields: [agencyId], references: [id], onDelete: Cascade)
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  contact      Contact      @relation(fields: [contactId], references: [id], onDelete: Cascade)
  candidate    Candidate?   @relation(fields: [candidateId], references: [id], onDelete: SetNull)
  operator     Operator?    @relation(fields: [actorOperatorId], references: [id], onDelete: SetNull)

  @@index([agencyId, conversationId, createdAt])
  @@index([agencyId, contactId, createdAt])
  @@index([agencyId, type, createdAt])
  @@map("timeline_events")
}
```

### Updated Relations
- Added `timelineEvents TimelineEvent[]` to: Agency, Conversation, Contact, Candidate, Operator

## API Endpoint Sample Response

### GET /api/conversations/:conversationId/timeline?limit=25&cursor=...

**Request:**
```
GET /api/conversations/conv_123/timeline?limit=25
```

**Response (200 OK):**
```json
{
  "items": [
    {
      "eventId": "event_abc123",
      "type": "INBOUND_MESSAGE_RECEIVED",
      "actorRole": "SYSTEM",
      "actorName": "System",
      "operatorId": null,
      "summary": "Inbound message received",
      "data": {
        "messageId": "msg_xyz789",
        "direction": "INBOUND",
        "channel": "WHATSAPP",
        "snippet": "Hi, I'm looking for work as a bricklayer in Maidstone..."
      },
      "createdAt": "2026-02-02T17:30:00.000Z",
      "conversationId": "conv_123",
      "contactId": "contact_456",
      "candidateId": "candidate_789"
    },
    {
      "eventId": "event_def456",
      "type": "AI_SUGGESTION_CREATED",
      "actorRole": "AI",
      "actorName": "AI",
      "operatorId": null,
      "summary": "AI suggested SEND_MESSAGE",
      "data": {
        "intent": "LOOKING_FOR_WORK",
        "risk": "LOW",
        "suggestedTaskType": null
      },
      "createdAt": "2026-02-02T17:30:05.000Z",
      "conversationId": "conv_123",
      "contactId": "contact_456",
      "candidateId": "candidate_789"
    },
    {
      "eventId": "event_ghi789",
      "type": "TASK_CREATED",
      "actorRole": "SYSTEM",
      "actorName": "System",
      "operatorId": null,
      "summary": "Task created: APPROVAL_REQUIRED",
      "data": {
        "taskId": "task_abc123",
        "taskType": "APPROVAL_REQUIRED",
        "priority": 75
      },
      "createdAt": "2026-02-02T17:30:10.000Z",
      "conversationId": "conv_123",
      "contactId": "contact_456",
      "candidateId": "candidate_789"
    },
    {
      "eventId": "event_jkl012",
      "type": "TASK_APPROVED",
      "actorRole": "OPERATOR",
      "actorName": "operator@example.com",
      "operatorId": "op_123",
      "summary": "Task approved",
      "data": {
        "taskId": "task_abc123",
        "taskType": "APPROVAL_REQUIRED",
        "wasEdited": true,
        "deliveryStatus": "SENT"
      },
      "createdAt": "2026-02-02T17:35:00.000Z",
      "conversationId": "conv_123",
      "contactId": "contact_456",
      "candidateId": "candidate_789"
    }
  ],
  "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTAyLTAyVDE3OjMwOjEwLjAwMFoiLCJpZCI6ImV2ZW50X2doaTc4OSJ9"
}
```

**Error Responses:**
- `404`: `{ "error": "Conversation not found" }`
- `403`: `{ "error": "Conversation does not belong to your agency" }`
- `400`: `{ "error": "Limit must be at least 1" }`

## Timeline Tab Screenshot Description

The Timeline tab appears in the Messages page conversation view:

**Layout:**
- Two tabs at the top: "Messages" (default) and "Timeline"
- Timeline tab shows a vertical list of events, most recent first
- Each event displays:
  - **Left side**: Colored icon (5x5, lucide-react icons)
    - Blue MessageSquare for inbound messages
    - Purple Sparkles for AI suggestions
    - Gray Clipboard for tasks
    - Green CheckCircle for approvals
    - Red XCircle for rejections
    - Orange ArrowRight for progress changes
    - Indigo Brain for memory updates
    - Cyan BadgeCheck for CSCS auto-verification
  - **Right side**: 
    - Event summary (bold, 14px)
    - Actor name and relative time below (12px, muted)
    - Optional data snippets (task type, status, stage transitions) in smaller text
- "Load more" button at bottom when more events available
- Empty state: "No timeline events yet" (centered, muted text)
- Loading state: 5 skeleton loaders with icon placeholders

**Styling:**
- Clean, minimal design matching existing UI
- Icons are color-coded by event type
- Relative time shows "3m ago", "2h ago", etc. with absolute timestamp on hover
- No aggressive polling - only fetches when tab is opened
- Scrollable container preserves Messages tab scroll position

## Verification Checklist

### ✅ Event Creation Points

1. **INBOUND_MESSAGE_RECEIVED**
   - Location: `src/workers/inboundWorker.ts:284`
   - Trigger: After message fetch, before processing
   - dedupeKey: `msg_${message.id}`
   - Data: `{ messageId, direction, channel, snippet }` (snippet max 80 chars)

2. **AI_SUGGESTION_CREATED**
   - Location: `src/workers/inboundWorker.ts:960`
   - Trigger: After `suggestActionWithAI` call
   - dedupeKey: `msg_${message.id}_ai_suggested`
   - Data: `{ intent, risk, suggestedTaskType }` (NO prompts)

3. **TASK_CREATED**
   - Location: `src/workers/inboundWorker.ts:480, 1173, 1414`
   - Trigger: After all 3 `prisma.task.create` calls
   - dedupeKey: `task_${task.id}`
   - Data: `{ taskId, taskType, priority }`

4. **OUTREACH_SENT** (Auto-reply)
   - Location: `src/workers/inboundWorker.ts:957`
   - Trigger: After `sendAutoReply` success
   - dedupeKey: `msg_${outboundMessageId}` or `twilio_${sid}`
   - Data: `{ outboundMessageId, deliveryStatus }`

5. **TASK_APPROVED**
   - Location: `src/routes/tasks.ts:548`
   - Trigger: After task approval
   - dedupeKey: `task_${taskId}_approved`
   - Data: `{ taskId, taskType, wasEdited, deliveryStatus }`
   - Actor: OPERATOR with `actorOperatorId`

6. **TASK_REJECTED / CSCS_REJECTED**
   - Location: `src/routes/tasks.ts:833, 861`
   - Trigger: After task rejection
   - dedupeKey: `task_${taskId}_rejected`
   - Data: `{ taskId, taskType, rejectionReason }` (reason snippet max 100 chars)

7. **MEMORY_PACK_UPDATED**
   - Location: `src/workers/inboundWorker.ts:792`
   - Trigger: After memory pack update
   - dedupeKey: `conv_${conversationId}_memory_${timestamp}`
   - Data: `{ memoryPackVersion }`

8. **PROGRESS_STAGE_CHANGED**
   - Location: `src/workers/inboundWorker.ts:808`
   - Trigger: Only when stage actually changes
   - dedupeKey: `conv_${conversationId}_progress_${newStage}`
   - Data: `{ from, to, reason, missingFields, nextAction }`

9. **CSCS_AUTO_VERIFIED**
   - Location: `src/workers/cscsAutoVerifyWorker.ts:188`
   - Trigger: After successful auto-verification
   - dedupeKey: `task_${taskId}_cscs_auto_verified`
   - Data: `{ overallStatus, issues, confidence }`
   - Summary: Card number masked (last 4 digits only)

### ✅ Idempotency Verification

**DedupeKey Strategy:**
- All events with `dedupeKey` check for existing event first
- If exists, returns existing event (no duplicate)
- If unique constraint violation (race condition), fetches and returns existing
- Partial unique index: `CREATE UNIQUE INDEX ... WHERE "dedupeKey" IS NOT NULL`

**Test Scenarios:**
1. Worker retry: Same `dedupeKey` → No duplicate
2. Concurrent requests: Race condition handled → No duplicate
3. Events without `dedupeKey`: Allowed (normal events, no idempotency needed)

### ✅ Data Sanitization Verification

**Secrets Removed:**
- `prompt`, `systemPrompt`, `userPrompt` - ✅ Removed in `sanitizeData()`
- `openaiResponse` - ✅ Removed
- `apiKey`, `token`, `secret`, `password`, `passwordHash` - ✅ Removed
- `authToken`, `accessToken`, `refreshToken` - ✅ Removed

**Card Number Masking:**
- CSCS auto-verification: ✅ Card number masked to last 4 digits in summary
- Location: `src/workers/cscsAutoVerifyWorker.ts:195`
- Format: `****1234` (last 4 digits only)

**String Truncation:**
- Message snippets: ✅ Max 80 chars (inboundWorker) or 100 chars (service)
- All string values: ✅ Max 500 chars
- Summary: ✅ Max 200 chars
- Rejection reason: ✅ Max 100 chars in timeline event

**No Raw Prompts:**
- AI_SUGGESTION_CREATED: ✅ Only `{ intent, risk, suggestedTaskType }` (no prompts)
- All other events: ✅ No prompt fields in data

## Testing Instructions

1. **Create conversation with inbound message:**
   - Send WhatsApp message to test number
   - Open conversation in Messages page
   - Click Timeline tab
   - ✅ Verify: INBOUND_MESSAGE_RECEIVED event appears

2. **AI generates approval task:**
   - Send message that triggers approval (e.g., "I need a job")
   - Wait for task creation
   - Check Timeline tab
   - ✅ Verify: AI_SUGGESTION_CREATED and TASK_CREATED events appear

3. **Approve the task:**
   - Go to Inbox → Pending
   - Click Approve on the task
   - Return to Messages → Timeline tab
   - ✅ Verify: TASK_APPROVED event appears with operator name

4. **Reject a CSCS task:**
   - Create CSCS verification task
   - Reject it with a reason
   - Check Timeline tab
   - ✅ Verify: CSCS_REJECTED event appears with rejection reason snippet

5. **Test idempotency:**
   - Restart worker or force retry
   - Check Timeline tab
   - ✅ Verify: No duplicate events (same dedupeKey events appear only once)

6. **Verify no secrets:**
   - Check database: `SELECT data FROM timeline_events WHERE type = 'AI_SUGGESTION_CREATED';`
   - ✅ Verify: No `prompt`, `systemPrompt`, or `openaiResponse` fields
   - Check CSCS events: `SELECT summary FROM timeline_events WHERE type = 'CSCS_AUTO_VERIFIED';`
   - ✅ Verify: Card numbers show as `****1234` (last 4 digits only)

