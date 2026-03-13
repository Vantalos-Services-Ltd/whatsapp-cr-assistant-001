/**
 * Frontend API client for operator UI
 * Handles all backend API calls with proper error handling
 */

import type {
  TaskListItemDTO,
  ConversationDTO,
  ConversationListItemDTO,
  MessageDTO,
  ContactDTO,
  PlaybookDTO,
} from "@/shared/dto/operator";

// Lazy import to avoid circular dependencies
let dataStatusStore: {
  setRefreshing: () => void;
  setUpToDate: () => void;
  setOutOfDate: (errorMessage?: string) => void;
  setOffline: () => void;
} | null = null;

/**
 * Initialize dataStatusStore (called from components that have access to the store)
 */
export function initDataStatusStore(store: {
  setRefreshing: () => void;
  setUpToDate: () => void;
  setOutOfDate: (errorMessage?: string) => void;
  setOffline: () => void;
}) {
  dataStatusStore = store;
}

// Re-export types for convenience
export type {
  TaskListItemDTO,
  ConversationDTO,
  ConversationListItemDTO,
  MessageDTO,
  ContactDTO,
};

// API base URL - automatically determined based on where frontend is loaded from
// Uses getApiBaseUrl() to automatically switch between localhost and ngrok
import { getApiBaseUrl } from "./getApiBaseUrl";

/**
 * API Error class for clean error handling
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Single API fetch helper that ALWAYS includes credentials for session cookies
 * Use this for ALL API requests to ensure cookies are sent cross-origin
 * 
 * @param endpoint - API endpoint (e.g., "/api/tasks" or "/auth/login")
 * @param options - Fetch options (method, body, headers, etc.)
 * @returns Promise<Response>
 */
export async function apiFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const apiBaseUrl = getApiBaseUrl();
  const url = `${apiBaseUrl}${endpoint}`;
  
  // CRITICAL: credentials MUST be set after spreading options
  // to ensure it cannot be overridden by caller
  // CRITICAL: Always include credentials for cross-origin cookie sending
  // This is REQUIRED for session cookies to work (Next.js :3000 → Fastify :3001)
  const fetchOptions: RequestInit = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    // Disable cache for inbox views to ensure fresh data
    cache: "no-store",
    // CRITICAL: credentials MUST be set last to override any caller-provided value
    credentials: "include", // MUST be included for authentication
  };
  
  return fetch(url, fetchOptions);
}

/**
 * Extended fetch options with status tracking
 */
interface FetchApiOptions extends RequestInit {
  trackGlobalStatus?: boolean; // If true, track this request in global dataStatusStore (default: false)
}

/**
 * Fetch wrapper with error handling and JSON parsing
 * Ensures ALL requests include credentials for session cookies
 * 
 * @param endpoint - API endpoint
 * @param options - Fetch options, including optional trackStatus flag
 */
export async function fetchApi<T>(
  endpoint: string,
  options?: FetchApiOptions
): Promise<T> {
  const { trackGlobalStatus = false, ...fetchOptions } = options || {};
  const isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  // Before request: if online and trackGlobalStatus=true -> setRefreshing()
  if (trackGlobalStatus && isOnline && dataStatusStore) {
    dataStatusStore.setRefreshing();
  }

  try {
    const response = await apiFetch(endpoint, fetchOptions);

    if (!response.ok) {
      let errorMessage = `Request failed with status ${response.status}`;
      let errorData: unknown;

      try {
        const errorBody = await response.json();
        errorMessage = errorBody.error || errorMessage;
        errorData = errorBody;
      } catch {
        // If response is not JSON, use status text
        errorMessage = response.statusText || errorMessage;
      }

      const error = new ApiError(errorMessage, response.status, errorData);

      // On failure: if trackGlobalStatus=true -> handle error
      if (trackGlobalStatus && dataStatusStore) {
        // Check if it's a network/offline error
        if (!isOnline || response.status === 0 || errorMessage.toLowerCase().includes("network") || errorMessage.toLowerCase().includes("fetch")) {
          dataStatusStore.setOffline();
        } else {
          dataStatusStore.setOutOfDate(errorMessage);
        }
      }

      throw error;
    }

    // On success: if trackGlobalStatus=true -> setUpToDate()
    if (trackGlobalStatus && dataStatusStore) {
      dataStatusStore.setUpToDate();
    }

    // Handle empty responses
    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      return {} as T;
    }

    return response.json();
  } catch (error) {
    // Handle network errors (fetch failures, not HTTP errors)
    // Only handle if we haven't already handled it (ApiError from response.ok check)
    if (trackGlobalStatus && dataStatusStore && !(error instanceof ApiError)) {
      if (error instanceof Error) {
        const isNetworkError = 
          error.message.toLowerCase().includes("network") ||
          error.message.toLowerCase().includes("fetch") ||
          error.message.toLowerCase().includes("failed to fetch") ||
          (!isOnline);

        if (isNetworkError) {
          dataStatusStore.setOffline();
        } else {
          dataStatusStore.setOutOfDate(error.message);
        }
      } else {
        // Unknown error type
        dataStatusStore.setOutOfDate("Unknown error occurred");
      }
    }

    throw error;
  }
}

/**
 * Get tasks by bucket (pending, completed, failed)
 */
export async function getTasks(
  bucket: "pending" | "completed" | "failed"
): Promise<TaskListItemDTO[]> {
  try {
    return await fetchApi<TaskListItemDTO[]>(
      `/api/tasks?bucket=${bucket}`
    );
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to fetch tasks",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Get list of conversations (lightweight)
 */
export async function getConversations(): Promise<ConversationListItemDTO[]> {
  try {
    return await fetchApi<ConversationListItemDTO[]>(
      "/api/conversations?limit=50"
    );
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to fetch conversations",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Get a single conversation with messages
 */
export async function getConversation(
  conversationId: string
): Promise<ConversationDTO> {
  try {
    return await fetchApi<ConversationDTO>(
      `/api/conversations/${conversationId}`
    );
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to fetch conversation",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Pending approval task DTO (returned by GET /api/conversations/:id/pending-approval)
 */
export interface PendingApprovalTaskDTO {
  id: string;
  type: "APPROVAL_REQUIRED" | "FOLLOW_UP" | "ESCALATION" | "OUTREACH";
  status: "OPEN" | "APPROVED" | "REJECTED" | "DONE" | "FAILED";
  approvalStatus: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";
  proposedAction: any; // JSON object
  payload: any; // JSON object
  relatedMessageId: string | null;
  relatedMessage?: {
    id: string;
    text: string;
    createdAt: string; // ISO date string
    conversationId: string;
  } | null;
  candidateId: string | null;
  createdAt: string; // ISO date string
}

/**
 * Response from GET /api/conversations/:id/pending-approval
 */
interface PendingApprovalResponse {
  task: PendingApprovalTaskDTO | null;
}

/**
 * Get pending approval task for a conversation
 */
export async function getPendingApproval(
  conversationId: string
): Promise<PendingApprovalTaskDTO | null> {
  try {
    const response = await fetchApi<PendingApprovalResponse>(
      `/api/conversations/${conversationId}/pending-approval`
    );
    return response.task;
  } catch (error) {
    // Handle 404 gracefully (conversation might not have pending approval)
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to fetch pending approval",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Timeline event DTO (re-export from shared types)
 */
export interface TimelineEventDTO {
  eventId: string;
  type: string;
  actorRole: "SYSTEM" | "AI" | "OPERATOR";
  actorName: string | null;
  operatorId: string | null;
  summary: string;
  data: Record<string, unknown> | null;
  createdAt: string;
  conversationId: string;
  contactId: string;
  candidateId: string | null;
}

/**
 * Timeline response
 */
export interface TimelineResponse {
  items: TimelineEventDTO[];
  nextCursor: string | null;
}

/**
 * Get timeline events for a conversation
 */
export async function getConversationTimeline(
  conversationId: string,
  options?: { limit?: number; cursor?: string | null }
): Promise<TimelineResponse> {
  try {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.append("limit", options.limit.toString());
    }
    if (options?.cursor) {
      params.append("cursor", options.cursor);
    }
    const queryString = params.toString();
    const endpoint = `/api/conversations/${conversationId}/timeline${queryString ? `?${queryString}` : ""}`;
    
    return await fetchApi<TimelineResponse>(endpoint);
  } catch (error) {
    // Handle 404 gracefully (conversation might not exist or have no timeline)
    if (error instanceof ApiError && error.status === 404) {
      // Return empty timeline instead of throwing
      return { items: [], nextCursor: null };
    }
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to fetch timeline",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Refresh memory pack for a conversation
 */
export async function refreshConversationMemory(conversationId: string): Promise<void> {
  try {
    await fetchApi<void>(`/api/conversations/${conversationId}/refresh-memory`, {
      method: "POST",
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to refresh memory",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Approve a task
 * @param taskId - Task ID to approve
 * @param messageOverride - Optional message text to override the suggested message
 */
export async function approveTask(
  taskId: string,
  messageOverride?: string
): Promise<TaskListItemDTO> {
  try {
    // fetchApi wrapper already includes credentials: "include"
    const body: { messageOverride?: string } = {};
    if (messageOverride) {
      body.messageOverride = messageOverride;
    }
    return await fetchApi<TaskListItemDTO>(`/api/tasks/${taskId}/approve`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to approve task",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Reject a task
 * @param taskId - Task ID to reject
 * @param rejectionReason - Optional reason for rejection
 */
export async function rejectTask(
  taskId: string,
  rejectionReason?: string
): Promise<TaskListItemDTO> {
  try {
    // fetchApi wrapper already includes credentials: "include"
    // Send both 'reason' and 'rejectionReason' for backward compatibility
    const body: { reason?: string; rejectionReason?: string } = {};
    if (rejectionReason) {
      body.reason = rejectionReason;
      body.rejectionReason = rejectionReason;
    }
    return await fetchApi<TaskListItemDTO>(`/api/tasks/${taskId}/reject`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to reject task",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Dashboard statistics
 */
export interface DashboardStats {
  activeTasks: number;
  pendingApproval: number;
  stuckTasks: number;
  oldestStuckAgeMinutes: number;
  messagesToday: number;
  activeContacts: number;
  // Quality metrics
  approvalsEditedToday: number;
  approvalsToday: number;
  percentEdited: number;
  unsafeReviews7d: number;
  needsImprovement7d: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  try {
    return await fetchApi<DashboardStats>("/api/dashboard/stats");
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to fetch dashboard statistics",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Dashboard earnings data (not configured)
 */
export interface DashboardEarningsNotConfigured {
  configured: false;
}

/**
 * Dashboard earnings data (configured)
 */
export interface DashboardEarningsConfigured {
  configured: true;
  revenueTotal: number;
  currency: string;
  currentBracketRatePct: number;
  amountToNextBracket: number | null;
  nextBracketRatePct: number | null;
  summaryText: string;
  opportunities: Array<{
    label: string;
    estMonthlyMargin?: number;
    currency: "GBP";
    why: string;
    jobId?: string;
    candidateId?: string;
  }>;
}

export type DashboardEarnings = DashboardEarningsNotConfigured | DashboardEarningsConfigured;

export interface OpportunityDTO {
  opportunityKey: string;
  type: string;
  title: string;
  priority: number;
  reasonBullets: string[];
  recommendedAction: {
    taskType: "OUTREACH" | "FOLLOW_UP";
    count: number;
    description: string;
  };
  relatedJobId: string | null;
  relatedCandidateIdsCount: number;
  createdAt: string;
  expiresAt: string;
  alreadyCreated: boolean;
}

export interface OpportunitiesResponse {
  items: OpportunityDTO[];
}

export interface CreateOpportunityTasksResponse {
  createdCount: number;
  skippedCount: number;
  taskIds: string[];
  wouldCreateCount?: number;
}

export async function getDashboardOpportunities(): Promise<OpportunitiesResponse> {
  return await fetchApi<OpportunitiesResponse>("/api/dashboard/opportunities");
}

export async function createOpportunityTasks(input: {
  opportunityKey: string;
  limit?: number;
  dryRun?: boolean;
}): Promise<CreateOpportunityTasksResponse> {
  return await fetchApi<CreateOpportunityTasksResponse>("/api/dashboard/opportunities/create", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getDashboardEarnings(): Promise<DashboardEarnings> {
  try {
    return await fetchApi<DashboardEarnings>("/api/dashboard/earnings");
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to fetch dashboard earnings",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Earnings settings
 */
export interface EarningsSettings {
  basePayMonthly?: number | null;
  currency: string;
  commissionBrackets: Array<{
    minRevenue: number;
    maxRevenue?: number | null;
    ratePct: number;
  }>;
}

export async function getEarningsSettings(): Promise<EarningsSettings> {
  try {
    return await fetchApi<EarningsSettings>("/api/earnings/settings");
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to fetch earnings settings",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

export async function upsertEarningsSettings(
  settings: EarningsSettings
): Promise<EarningsSettings> {
  try {
    return await fetchApi<EarningsSettings>("/api/earnings/settings", {
      method: "POST",
      body: JSON.stringify(settings),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to save earnings settings",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Monthly earnings
 */
export interface MonthlyEarnings {
  year: number;
  month: number;
  revenueTotal: number;
  currency: string;
}

export async function getMonthlyEarnings(
  year?: number,
  month?: number
): Promise<MonthlyEarnings | { revenueTotal: null; currency: string; year: number; month: number }> {
  try {
    const params = new URLSearchParams();
    if (year !== undefined) params.append("year", year.toString());
    if (month !== undefined) params.append("month", month.toString());
    const queryString = params.toString();
    return await fetchApi<MonthlyEarnings | { revenueTotal: null; currency: string; year: number; month: number }>(
      `/api/earnings/monthly${queryString ? `?${queryString}` : ""}`
    );
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to fetch monthly earnings",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

export async function upsertMonthlyEarnings(
  earnings: MonthlyEarnings
): Promise<MonthlyEarnings> {
  try {
    return await fetchApi<MonthlyEarnings>("/api/earnings/monthly", {
      method: "POST",
      body: JSON.stringify(earnings),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to save monthly earnings",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Get all tasks (not just inbox)
 */
export async function getAllTasks(
  filter?: "pending" | "approved" | "failed" | "all"
): Promise<{ tasks: TaskListItemDTO[]; pagination: { limit: number; offset: number; total: number } }> {
  try {
    const filterParam = filter ? `?filter=${filter}` : "";
    return await fetchApi<{ tasks: TaskListItemDTO[]; pagination: { limit: number; offset: number; total: number } }>(
      `/api/tasks/all${filterParam}`
    );
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to fetch tasks",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Get all messages
 */
export async function getAllMessages(): Promise<{
  messages: MessageDTO[];
  pagination: { limit: number; offset: number; total: number };
}> {
  try {
    return await fetchApi<{
      messages: MessageDTO[];
      pagination: { limit: number; offset: number; total: number };
    }>("/api/operator/messages");
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to fetch messages",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Get all contacts
 */
export async function getAllContacts(): Promise<{
  contacts: ContactDTO[];
  pagination: { limit: number; offset: number; total: number };
}> {
  try {
    return await fetchApi<{
      contacts: ContactDTO[];
      pagination: { limit: number; offset: number; total: number };
    }>("/api/contacts");
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to fetch contacts",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Candidate search result
 */
export interface CandidateSearchResult {
  candidateId: string;
  phone: string;
  name: string | null;
  desiredRole: string | null;
  skills: string[];
  yearsExperience: number | null;
  location: string | null;
  salary: {
    min: number | null;
    max: number | null;
    currency: string | null;
  } | null;
  matchScore: number;
  reasons: string[];
}

/**
 * Search candidates
 */
export async function searchCandidates(
  query: string,
  limit?: number
): Promise<{
  query: string;
  filters: unknown;
  results: CandidateSearchResult[];
  count: number;
}> {
  try {
    // Build URL with query parameters (URL encoded)
    const params = new URLSearchParams();
    if (query) {
      params.append("q", query);
    }
    if (limit !== undefined) {
      params.append("limit", limit.toString());
    }
    const queryString = params.toString();
    const endpoint = `/api/candidates/search${queryString ? `?${queryString}` : ""}`;

    return await fetchApi<{
      query: string;
      filters: unknown;
      results: CandidateSearchResult[];
      count: number;
    }>(endpoint, {
      method: "GET",
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to search candidates",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Outreach preview result
 */
export interface OutreachPreview {
  candidateId: string;
  phone: string;
  suggestedMessage: string;
}

/**
 * Preview outreach messages
 */
export async function previewOutreach(
  candidateIds: string[],
  jobDescription: string
): Promise<{ previews: OutreachPreview[] }> {
  try {
    return await fetchApi<{ previews: OutreachPreview[] }>("/api/candidates/outreach/preview", {
      method: "POST",
      body: JSON.stringify({ candidateIds, jobDescription }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to preview outreach",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Submit outreach request
 */
export async function submitOutreach(
  candidateIds: string[],
  jobDescription: string,
  suggestedMessages?: Record<string, string>
): Promise<{ tasks: { taskId: string; candidateId: string }[]; count: number }> {
  try {
    return await fetchApi<{ tasks: { taskId: string; candidateId: string }[]; count: number }>(
      "/api/candidates/outreach/submit",
      {
        method: "POST",
        body: JSON.stringify({ candidateIds, jobDescription, suggestedMessages }),
      }
    );
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to submit outreach",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Candidate detail
 */
export interface CandidateDetailDTO {
  candidateId: string;
  phone: string;
  name: string | null;
  location: string | null;
  desiredRole: string | null;
  skills: string[];
  yearsExperience: number | null;
  salary: {
    min: number | null;
    max: number | null;
    currency: string | null;
  } | null;
  availabilityNotes: string | null;
  lastSeenAt: string;
  lastContactedAt: string | null;
  recentMessages: Array<{
    messageId: string;
    direction: "INBOUND" | "OUTBOUND";
    text: string;
    createdAt: string;
  }>;
}

/**
 * Get candidate detail
 */
// ============================================================================
// Jobs API
// ============================================================================

export interface JobListItem {
  id: string;
  title: string;
  status: string;
  positionsOpen: number;
  positionsFilled: number;
  tradeRequired: string;
  startDate: string | null;
  postcode: string | null;
  city: string | null;
  updatedAt: string;
}

export interface JobsListResponse {
  items: JobListItem[];
  total: number;
}

export interface JobDetail {
  id: string;
  title: string;
  status: string;
  positionsOpen: number;
  positionsFilled: number;
  tradeRequired: string;
  startDate: string | null;
  durationWeeks: number | null;
  hoursPerDay: number | null;
  daysPerWeek: number | null;
  siteName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postcode: string | null;
  city: string | null;
  clientName: string | null;
  clientType: string | null;
  siteManagerName: string | null;
  siteManagerPhone: string | null;
  isPremiumClient: boolean;
  requirementsJson: any;
  notes: string | null;
  payRate: number | null;
  chargeRate: number | null;
  currency: string;
  marginPerHour: number | null;
  weeklyMargin: number | null;
  projectMargin: number | null;
  createdAt: string;
  updatedAt: string;
}

export async function getJobs(params?: {
  q?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<JobsListResponse> {
  try {
    const queryParams = new URLSearchParams();
    if (params?.q) queryParams.append("q", params.q);
    if (params?.status) queryParams.append("status", params.status);
    if (params?.limit !== undefined) queryParams.append("limit", params.limit.toString());
    if (params?.offset !== undefined) queryParams.append("offset", params.offset.toString());

    const queryString = queryParams.toString();
    const endpoint = `/api/jobs${queryString ? `?${queryString}` : ""}`;

    return await fetchApi<JobsListResponse>(endpoint);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to fetch jobs",
      500,
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

export async function getJobDetail(jobId: string): Promise<JobDetail> {
  try {
    return await fetchApi<JobDetail>(`/api/jobs/${jobId}`);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to fetch job detail",
      500,
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

export interface CreateJobRequest {
  title: string;
  tradeRequired: string;
  status?: string;
  startDate?: string;
  city?: string;
  postcode?: string;
  clientName?: string;
  siteName?: string;
  positionsOpen?: number;
  [key: string]: any; // Allow other optional fields
}

export interface CreateJobResponse {
  id: string;
  title: string;
  status: string;
}

export async function createJob(data: CreateJobRequest): Promise<CreateJobResponse> {
  try {
    return await fetchApi<CreateJobResponse>("/api/jobs", {
      method: "POST",
      body: JSON.stringify(data),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to create job",
      500,
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

export interface JobMatch {
  candidateId: string;
  name: string | null; // Deprecated, use displayName
  phone: string;
  desiredRole: string | null; // Deprecated, use trade
  displayName: string; // "Name - Trade" or phone fallback
  trade?: string | null; // Candidate.desiredRole if available
  location: string | null;
  availabilityNotes: string | null;
  score: number;
  tier: "PROVEN" | "EXCELLENT" | "GOOD" | "WEAK";
  highlights: string[];
}

export interface JobMatchesResponse {
  jobId: string;
  totalAvailable: number;
  matches: JobMatch[];
}

export async function getJobMatches(jobId: string, limit?: number): Promise<JobMatchesResponse> {
  try {
    const limitParam = limit ? `?limit=${limit}` : "";
    return await fetchApi<JobMatchesResponse>(`/api/jobs/${jobId}/matches${limitParam}`);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to fetch job matches",
      500,
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

export async function markJobFilled(
  jobId: string,
  setPositionsFilled?: boolean
): Promise<void> {
  try {
    await fetchApi<void>(`/api/jobs/${jobId}/mark-filled`, {
      method: "POST",
      body: JSON.stringify({ setPositionsFilled: setPositionsFilled ?? true }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to mark job as filled",
      500,
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

// Pipeline API functions
export interface PipelineItem {
  id: string;
  jobId: string;
  candidateId: string;
  stage: "SHORTLISTED" | "OFFER_SENT" | "START_CONFIRMED" | "NO_SHOW" | "DROPPED";
  notes: string | null;
  startDate: string | null; // ISO date string
  payRate: number | null;
  shiftInfo: string | null;
  noShowReason: "DID_NOT_TURN_UP" | "CANCELLED_LAST_MINUTE" | "PHONE_OFF" | "CLIENT_REJECTED_ON_DAY" | "UNKNOWN" | null;
  droppedReason: "NOT_INTERESTED" | "NOT_RESPONDING" | "FAILED_DOCS" | "FAILED_CSCS" | "CLIENT_REJECTED" | "OTHER" | null;
  updatedByOperatorId: string | null;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  candidate: {
    name: string | null;
    desiredRole: string | null;
    location: string | null;
    availabilityNotes: string | null;
    phone: string;
  };
  matchScore: number | null;
  matchTier: string | null;
  conversation: {
    progressStage: string | null;
    memorySummary: string | null;
    lastActivityAt: string | null; // ISO date string
  } | null;
}

export interface UpsertPipelineItemRequest {
  candidateId: string;
  stage: "SHORTLISTED" | "OFFER_SENT" | "START_CONFIRMED" | "NO_SHOW" | "DROPPED";
  notes?: string | null;
  startDate?: string | null; // ISO date string
  payRate?: number | null;
  shiftInfo?: string | null;
  noShowReason?: "DID_NOT_TURN_UP" | "CANCELLED_LAST_MINUTE" | "PHONE_OFF" | "CLIENT_REJECTED_ON_DAY" | "UNKNOWN" | null;
  droppedReason?: "NOT_INTERESTED" | "NOT_RESPONDING" | "FAILED_DOCS" | "FAILED_CSCS" | "CLIENT_REJECTED" | "OTHER" | null;
  confirmedInterest?: boolean;
  createOutreachTask?: boolean;
}

export async function getJobPipeline(jobId: string): Promise<PipelineItem[]> {
  try {
    return await fetchApi<PipelineItem[]>(`/api/jobs/${jobId}/pipeline`);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to fetch pipeline",
      500,
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

export async function upsertPipelineItem(
  jobId: string,
  data: UpsertPipelineItemRequest
): Promise<PipelineItem> {
  try {
    return await fetchApi<PipelineItem>(`/api/jobs/${jobId}/pipeline`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to update pipeline",
      500,
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

export async function removePipelineItem(
  jobId: string,
  candidateId: string
): Promise<void> {
  try {
    await fetchApi<void>(`/api/jobs/${jobId}/pipeline/${candidateId}`, {
      method: "DELETE",
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to remove pipeline item",
      500,
      error instanceof Error ? error.message : "Unknown error"
    );
  }
}

export async function getCandidateDetail(candidateId: string): Promise<CandidateDetailDTO> {
  try {
    return await fetchApi<CandidateDetailDTO>(`/api/candidates/${candidateId}`);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to get candidate detail",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

export interface CreateCscsVerificationRequest {
  candidateId: string;
  jobId: string;
  sourceMessageId?: string;
  imageUrl?: string;
}

export interface CreateCscsVerificationResponse {
  id: string;
  summary: string;
}

export async function createCscsVerification(
  data: CreateCscsVerificationRequest
): Promise<CreateCscsVerificationResponse> {
  try {
    return await fetchApi<CreateCscsVerificationResponse>("/api/tasks/cscs-verification/create", {
      method: "POST",
      body: JSON.stringify(data),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to create CSCS verification task",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

export interface CandidateLatestMediaResponse {
  messageId: string;
  mediaUrl: string;
}

export async function getCandidateLatestMedia(
  candidateId: string
): Promise<CandidateLatestMediaResponse> {
  try {
    return await fetchApi<CandidateLatestMediaResponse>(`/api/candidates/${candidateId}/latest-media`);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to get candidate latest media",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

export interface VerifyCscsRequest {
  extracted: {
    holderName?: string;
    cardType?: string;
    expiryDate?: string;
    cardNumber?: string;
  };
  checks: {
    nameMatchOk: boolean;
    expiryValidOk: boolean;
    requiredLevelOk: boolean;
  };
}

export interface VerifyCscsResponse {
  payload: any;
}

export async function verifyCscs(
  taskId: string,
  data: VerifyCscsRequest
): Promise<VerifyCscsResponse> {
  try {
    return await fetchApi<VerifyCscsResponse>(`/api/tasks/${taskId}/cscs/verify`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to verify CSCS",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Get health status (used by HeartbeatMonitor)
 * Uses trackGlobalStatus=true to update global status pill
 */
export async function getHealth(): Promise<{ ok: boolean; serverTime: string }> {
  return await fetchApi<{ ok: boolean; serverTime: string }>("/api/health", {
    trackGlobalStatus: true,
  });
}

// ============================================================================
// Review Samples API
// ============================================================================

export interface ReviewSampleDTO {
  id: string;
  taskId: string;
  conversationId: string | null;
  candidateId: string | null;
  jobId: string | null;
  createdAt: string;
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
  reviewedAt: string | null;
  reviewedByOperatorId: string | null;
  notes: string | null;
  task?: {
    type: string;
    createdAt: string;
  };
  candidate?: {
    name: string | null;
    desiredRole: string | null;
    phone: string;
  };
  job?: {
    title: string;
    city: string | null;
  };
  conversationSnippet?: Array<{
    messageId: string;
    direction: "INBOUND" | "OUTBOUND";
    text: string;
    createdAt: string;
  }>;
}

export interface ListReviewSamplesResponse {
  samples: ReviewSampleDTO[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function listReviewSamples(
  bucket: "pending" | "reviewed" = "pending",
  limit: number = 25,
  cursor?: string
): Promise<ListReviewSamplesResponse> {
  try {
    const params = new URLSearchParams({
      bucket,
      limit: limit.toString(),
    });
    if (cursor) {
      params.append("cursor", cursor);
    }
    return await fetchApi<ListReviewSamplesResponse>(`/api/review/samples?${params.toString()}`);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to list review samples",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

export async function getReviewSample(sampleId: string): Promise<ReviewSampleDTO> {
  try {
    return await fetchApi<ReviewSampleDTO>(`/api/review/samples/${sampleId}`);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to get review sample",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

export interface SetVerdictRequest {
  verdict: "GOOD" | "NEEDS_IMPROVEMENT" | "UNSAFE";
  notes?: string;
}

export async function setReviewVerdict(
  sampleId: string,
  data: SetVerdictRequest
): Promise<ReviewSampleDTO> {
  try {
    return await fetchApi<ReviewSampleDTO>(`/api/review/samples/${sampleId}/verdict`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to set review verdict",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Get playbook settings
 */
export async function getPlaybook(): Promise<PlaybookDTO> {
  try {
    return await fetchApi<PlaybookDTO>("/api/settings/playbook", { trackGlobalStatus: true });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to fetch playbook",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Update playbook settings
 */
export async function updatePlaybook(update: Partial<PlaybookDTO>): Promise<PlaybookDTO> {
  try {
    return await fetchApi<PlaybookDTO>("/api/settings/playbook", {
      method: "POST",
      body: JSON.stringify(update),
      trackGlobalStatus: true,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      "Failed to update playbook",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
}

