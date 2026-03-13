/**
 * Candidate Search Service
 * Parses natural language queries and searches candidates
 */

import pino from "pino";
import { PrismaClient } from "@prisma/client";

const log = pino({ name: "candidateSearch" });
const prisma = new PrismaClient();

const MODEL = "gpt-4o-mini";
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 8_000;

export type SearchFilters = {
  role: string | null;
  skills: string[];
  minYearsExp: number | null;
  location: string | null;
  salaryMax: number | null;
  remotePreference: "remote" | "onsite" | "hybrid" | null;
};

export type SearchResult = {
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
};

type OpenAIChatCompletionsResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

/**
 * Parse natural language query into structured search filters using OpenAI
 */
export async function parseSearchQuery(query: string): Promise<SearchFilters> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log.warn("OPENAI_API_KEY not set; returning empty filters");
    return getEmptyFilters();
  }

  log.info({ query }, "Parsing search query with OpenAI");

  const systemPrompt = [
    "You are a candidate search query parser. Extract structured filters from natural language queries.",
    "Return ONLY valid JSON (no markdown, no extra text).",
    "",
    "Output schema:",
    "{",
    '  "role": string | null,',
    '  "skills": string[],',
    '  "minYearsExp": number | null,',
    '  "location": string | null,',
    '  "salaryMax": number | null,',
    '  "remotePreference": "remote" | "onsite" | "hybrid" | null',
    "}",
    "",
    "Rules:",
    "- Extract explicit mentions only (don't guess)",
    "- skills: array of skill names mentioned",
    "- minYearsExp: minimum years of experience (numeric)",
    "- location: city, region, or country mentioned",
    "- salaryMax: maximum salary mentioned (numeric, no currency symbols)",
    "- remotePreference: extract if mentioned (remote/onsite/hybrid)",
    "- Use null for fields not mentioned",
  ].join("\n");

  const userPrompt = `Parse this search query into filters:\n\n"${query}"`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const body = {
      model: MODEL,
      temperature: 0,
      max_tokens: 300,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    };

    const res = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      log.warn(
        {
          status: res.status,
          statusText: res.statusText,
          error: errText,
          query,
        },
        "OpenAI query parsing failed"
      );
      return getEmptyFilters();
    }

    const data = (await res.json()) as OpenAIChatCompletionsResponse;
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      log.warn({ query }, "OpenAI returned empty content for query parsing");
      return getEmptyFilters();
    }

    // Parse JSON response
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      log.warn(
        { query, content, error: parseError },
        "Failed to parse OpenAI JSON response"
      );
      return getEmptyFilters();
    }

    // Validate and normalize
    const filters = validateAndNormalizeFilters(parsed);

    log.info(
      {
        query,
        filters: Object.keys(filters).filter(
          (key) => filters[key as keyof SearchFilters] !== null && 
          (Array.isArray(filters[key as keyof SearchFilters]) ? (filters[key as keyof SearchFilters] as any[]).length > 0 : true)
        ),
      },
      "Query parsed into filters"
    );

    return filters;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      log.warn({ query }, "Query parsing timed out");
    } else {
      log.error({ query, error }, "Query parsing error");
    }
    return getEmptyFilters();
  }
}

function validateAndNormalizeFilters(data: unknown): SearchFilters {
  if (!data || typeof data !== "object") {
    return getEmptyFilters();
  }

  const obj = data as Record<string, unknown>;

  return {
    role: typeof obj.role === "string" && obj.role.trim() ? obj.role.trim() : null,
    skills: Array.isArray(obj.skills)
      ? obj.skills.filter((s): s is string => typeof s === "string" && s.trim()).map((s) => s.trim().toLowerCase())
      : [],
    minYearsExp: typeof obj.minYearsExp === "number" && obj.minYearsExp > 0 ? obj.minYearsExp : null,
    location: typeof obj.location === "string" && obj.location.trim() ? obj.location.trim() : null,
    salaryMax: typeof obj.salaryMax === "number" && obj.salaryMax > 0 ? obj.salaryMax : null,
    remotePreference:
      obj.remotePreference === "remote" || obj.remotePreference === "onsite" || obj.remotePreference === "hybrid"
        ? obj.remotePreference
        : null,
  };
}

function getEmptyFilters(): SearchFilters {
  return {
    role: null,
    skills: [],
    minYearsExp: null,
    location: null,
    salaryMax: null,
    remotePreference: null,
  };
}

/**
 * Search candidates using filters and calculate match scores
 */
export async function searchCandidates(
  agencyId: string,
  filters: SearchFilters,
  limit: number = 50
): Promise<SearchResult[]> {
  log.info(
    {
      agencyId,
      filters,
      limit,
    },
    "Searching candidates"
  );

  // Build Prisma where clause
  const where: any = {
    agencyId,
  };

  // Apply filters
  if (filters.role) {
    where.desiredRole = {
      contains: filters.role,
      mode: "insensitive",
    };
  }

  if (filters.skills.length > 0) {
    where.skills = {
      hasSome: filters.skills,
    };
  }

  if (filters.minYearsExp !== null) {
    where.yearsExperience = {
      gte: filters.minYearsExp,
    };
  }

  if (filters.location) {
    where.location = {
      contains: filters.location,
      mode: "insensitive",
    };
  }

  if (filters.salaryMax !== null) {
    where.OR = [
      { salaryMin: { lte: filters.salaryMax } },
      { salaryMax: { lte: filters.salaryMax } },
    ];
  }

  // Fetch candidates
  const candidates = await prisma.candidate.findMany({
    where,
    take: limit * 2, // Fetch more to calculate scores, then limit
    orderBy: {
      lastSeenAt: "desc",
    },
  });

  // If no filters applied and no candidates found, return empty array
  const hasFilters = filters.role || filters.skills.length > 0 || filters.minYearsExp !== null || 
                     filters.location || filters.salaryMax !== null;
  
  if (!hasFilters && candidates.length === 0) {
    log.info({ agencyId }, "No filters and no candidates found - returning empty results");
    return [];
  }

  // Calculate match scores and reasons
  const results: SearchResult[] = candidates.map((candidate) => {
    let score = 0;
    const reasons: string[] = [];

    // Skills match (1 point per matching skill)
    if (filters.skills.length > 0 && candidate.skills.length > 0) {
      const candidateSkillsLower = candidate.skills.map((s) => s.toLowerCase());
      const matchingSkills = filters.skills.filter((skill) =>
        candidateSkillsLower.some((cs) => cs.includes(skill) || skill.includes(cs))
      );
      if (matchingSkills.length > 0) {
        score += matchingSkills.length;
        reasons.push(`Matches ${matchingSkills.length} skill(s): ${matchingSkills.join(", ")}`);
      }
    }

    // Role match (2 points)
    if (filters.role && candidate.desiredRole) {
      const roleLower = candidate.desiredRole.toLowerCase();
      const filterRoleLower = filters.role.toLowerCase();
      if (roleLower.includes(filterRoleLower) || filterRoleLower.includes(roleLower)) {
        score += 2;
        reasons.push(`Role matches: ${candidate.desiredRole}`);
      }
    }

    // Years experience match (1 point if meets minimum)
    if (filters.minYearsExp !== null && candidate.yearsExperience !== null) {
      if (candidate.yearsExperience >= filters.minYearsExp) {
        score += 1;
        reasons.push(`Experience: ${candidate.yearsExperience} years`);
      }
    }

    // Location match (1 point)
    if (filters.location && candidate.location) {
      const locationLower = candidate.location.toLowerCase();
      const filterLocationLower = filters.location.toLowerCase();
      if (locationLower.includes(filterLocationLower) || filterLocationLower.includes(locationLower)) {
        score += 1;
        reasons.push(`Location: ${candidate.location}`);
      }
    }

    // Salary range match (1 point if within range)
    if (filters.salaryMax !== null) {
      const candidateMax = candidate.salaryMax;
      const candidateMin = candidate.salaryMin;
      if (candidateMax !== null && candidateMax <= filters.salaryMax) {
        score += 1;
        reasons.push(`Salary within range (max: ${candidateMax})`);
      } else if (candidateMin !== null && candidateMin <= filters.salaryMax) {
        score += 1;
        reasons.push(`Salary within range (min: ${candidateMin})`);
      }
    }

    return {
      candidateId: candidate.id,
      phone: candidate.phone,
      name: candidate.name,
      desiredRole: candidate.desiredRole,
      skills: candidate.skills,
      yearsExperience: candidate.yearsExperience,
      location: candidate.location,
      salary: {
        min: candidate.salaryMin,
        max: candidate.salaryMax,
        currency: candidate.currency,
      },
      matchScore: score,
      reasons: reasons.length > 0 ? reasons : ["No specific matches"],
    };
  });

  // Sort by match score (descending) and limit
  results.sort((a, b) => b.matchScore - a.matchScore);
  return results.slice(0, limit);
}

