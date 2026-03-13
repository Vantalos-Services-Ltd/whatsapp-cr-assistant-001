# Governance Layer - Steps D & E Implementation Summary

## Step D: Sampling Job (Daily + On Demand) ✅

### Implementation Status: **COMPLETE**

### Files Created:

1. **`src/services/reviewSamplingService.ts`** ✅
   - Service function: `createReviewSamplesForDay(agencyId, dateRange, config)`
   - Sampling logic with priority buckets:
     - **Edited tasks** (N1 = 30): Tasks where `wasEdited === true`
     - **High-risk tasks** (N2 = 10): `APPROVAL_REQUIRED` with `riskLevel === "HIGH"` OR `ESCALATION` tasks
     - **Random tasks** (N3 = 10): Other approved tasks
   - Idempotency: Uses `@@unique([agencyId, taskId])` constraint to prevent duplicates
   - Logs with counts for each bucket

2. **`src/workers/reviewSamplingWorker.ts`** ✅
   - Background worker that runs daily at 9am local server time
   - In dev mode: also runs on server start
   - Processes all agencies
   - Uses `setInterval` pattern (similar to `followUpReminderWorker`)
   - Calculates next 9am and schedules accordingly

3. **`src/workers/index.ts`** ✅
   - Updated to start the review sampling worker

### Sampling Logic:

**Priority Order:**
1. **Edited Tasks** (up to 30): Tasks where `payload.wasEdited === true`
2. **High-Risk Tasks** (up to 10): 
   - `task.type === APPROVAL_REQUIRED` AND `task.proposedAction.riskLevel === "HIGH"`
   - OR `task.type === ESCALATION`
3. **Random Tasks** (up to 10): Other approved tasks that sent messages

**High-Risk Definition:**
- `APPROVAL_REQUIRED` tasks with `riskLevel === "HIGH"`
- `ESCALATION` tasks

**Idempotency:**
- Uses `@@unique([agencyId, taskId])` constraint
- Checks for existing samples before creating
- Handles `P2002` (unique constraint violation) gracefully

**Query Logic:**
- Queries tasks approved in last 24 hours
- Filters to tasks with `payload.approvedMessageText` (meaning message was sent)
- Includes related message and conversation data

### Configuration:

```typescript
const DEFAULT_CONFIG: SamplingConfig = {
  editedTasksLimit: 30,
  highRiskTasksLimit: 10,
  randomTasksLimit: 10,
};
```

### Logging:

- Logs start of sampling with date range and config
- Logs total approved tasks found
- Logs categorized tasks into buckets
- Logs counts for each bucket (edited, high-risk, random)
- Logs total created and skipped (for idempotency)

---

## Step E: API Endpoints (Operator) ✅

### Implementation Status: **COMPLETE**

### Files Created:

1. **`src/routes/review.ts`** ✅
   - Three endpoints for review sample management
   - All endpoints require authentication
   - All endpoints are agency-scoped

2. **`src/dto/operator.ts`** ✅
   - Added `ReviewSampleDTO` interface
   - Includes enriched fields for detail view

3. **`src/dto/transformers.ts`** ✅
   - Added `toReviewSampleDTO()` transformer function

4. **`src/index.ts`** ✅
   - Registered review routes

5. **`prisma/schema.prisma`** ✅
   - Added `REVIEW_VERDICT_SET` to `TimelineEventType` enum

### Endpoints:

#### 1. GET /api/review/samples

**Query Parameters:**
- `bucket`: `"pending" | "reviewed"` (default: `"pending"`)
- `limit`: number (default: 25, max: 100)
- `cursor`: base64url-encoded pagination cursor

**Response:**
```json
{
  "samples": ReviewSampleDTO[],
  "nextCursor": string | null,
  "hasMore": boolean
}
```

**Behavior:**
- `pending`: Returns samples where `verdict === null`
- `reviewed`: Returns samples where `verdict !== null`
- Cursor-based pagination using `createdAt` and `id`
- Ordered by `createdAt DESC`

#### 2. GET /api/review/samples/:id

**Response:**
```json
ReviewSampleDTO (with enriched fields)
```

**Enriched Fields:**
- `task`: Task type and creation date
- `candidate`: Name, desired role, phone
- `job`: Title, city (if available)
- `conversationSnippet`: Last 3 messages from conversation (chronological order)

**Behavior:**
- Fetches full sample detail with context
- Includes conversation snippet (last 3 messages) for context
- Does NOT include full conversation history

#### 3. POST /api/review/samples/:id/verdict

**Request Body:**
```json
{
  "verdict": "GOOD" | "NEEDS_IMPROVEMENT" | "UNSAFE",
  "notes": string (optional)
}
```

**Response:**
```json
ReviewSampleDTO (updated)
```

**Behavior:**
- Sets `verdict`, `reviewedAt` (now), `reviewedByOperatorId` (from session)
- Creates `REVIEW_VERDICT_SET` timeline event if `conversationId` exists
- Timeline event includes: `reviewSampleId`, `taskId`, `verdict`, `sampledReason`
- Uses `dedupeKey` for idempotency: `review_${sampleId}_verdict`

### Agency Scoping:

All endpoints:
- Get `agencyId` from `getAgencyId()` helper (single-tenant assumption)
- Verify sample belongs to agency before returning/updating
- Return 403 if agency mismatch

### Authentication:

All endpoints:
- Require `requireAuth` middleware
- Extract `operatorId` from session
- Return 401 if not authenticated

---

## DTO Structure

### ReviewSampleDTO

```typescript
{
  id: string;
  taskId: string;
  conversationId: string | null;
  candidateId: string | null;
  jobId: string | null;
  createdAt: string; // ISO
  sampledReason: "EDITED" | "HIGH_RISK" | "RANDOM";
  proposedText: string;
  finalText: string;
  editMetrics: {
    charDiffRatio: number;
    wordDiffCount: number;
    wasShortened: boolean;
    wasExpanded: boolean;
  };
  verdict: "GOOD" | "NEEDS_IMPROVEMENT" | "UNSAFE" | null;
  reviewedAt: string | null; // ISO
  reviewedByOperatorId: string | null;
  notes: string | null;
  // Enriched fields (optional, for detail view)
  task?: { type: TaskType; createdAt: string };
  candidate?: { name: string | null; desiredRole: string | null; phone: string };
  job?: { title: string; city: string | null };
  conversationSnippet?: Array<{
    messageId: string;
    direction: MessageDirection;
    text: string;
    createdAt: string;
  }>;
}
```

---

## Timeline Integration

### REVIEW_VERDICT_SET Event

**Created when:** Operator sets verdict on a review sample

**Event Data:**
```json
{
  "reviewSampleId": string,
  "taskId": string,
  "verdict": "GOOD" | "NEEDS_IMPROVEMENT" | "UNSAFE",
  "sampledReason": "EDITED" | "HIGH_RISK" | "RANDOM"
}
```

**Summary:** `"Review verdict set: {verdict}"`

**Dedupe Key:** `review_{sampleId}_verdict` (ensures idempotency)

**Scope:** Only created if `conversationId` exists on sample

---

## Summary

✅ **Step D**: Complete - Daily sampling worker + service function
✅ **Step E**: Complete - Three API endpoints with pagination and detail view
✅ **Idempotency**: Unique constraints and dedupe keys prevent duplicates
✅ **Agency Scoping**: All queries and endpoints are agency-scoped
✅ **Timeline Integration**: Verdict setting creates timeline events
✅ **Authentication**: All endpoints require authentication

**Ready for Step F**: Dashboard metrics and visibility

