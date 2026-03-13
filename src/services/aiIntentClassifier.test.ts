import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { classifyIntentWithAI } from '.ts';

type MockFetchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

function mockFetchOk(content: string) {
  const res: MockFetchResponse = {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      choices: [{ message: { content } }],
    }),
    text: async () => "",
  };

  globalThis.fetch = vi.fn(async () => res) as any;
}

function mockFetchError(err: unknown) {
  globalThis.fetch = vi.fn(async () => {
    throw err;
  }) as any;
}

describe("classifyIntentWithAI", () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_TIMEOUT_MS = "10";
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  it("accepts a valid intent returned by the model", async () => {
    mockFetchOk("JOB_QUERY");
    await expect(classifyIntentWithAI("what is the rate?")).resolves.toBe(
      "JOB_QUERY"
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns UNKNOWN when the model returns an invalid string", async () => {
    mockFetchOk("NOT_AN_INTENT");
    await expect(classifyIntentWithAI("hello")).resolves.toBe("UNKNOWN");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns UNKNOWN on timeout/error and does not make real API calls", async () => {
    mockFetchError(new Error("timeout"));
    await expect(classifyIntentWithAI("hello")).resolves.toBe("UNKNOWN");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});


