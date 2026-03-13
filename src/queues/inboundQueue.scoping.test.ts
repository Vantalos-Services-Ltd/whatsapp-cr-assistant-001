/**
 * Tests for agency scoping in inbound queue
 * Verifies that agencyId is included in job payload
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock BullMQ Queue before importing
vi.mock("bullmq", () => {
  const mockAdd = vi.fn();
  return {
    Queue: vi.fn().mockImplementation(() => ({
      add: mockAdd,
    })),
  };
});

vi.mock("./queue.js", () => ({
  connectionOptions: {},
}));

vi.mock("pino", () => ({
  default: vi.fn(() => ({
    error: vi.fn(),
  })),
}));

// Import after mocks
import { enqueueInboundMessage } from '.ts';
import { Queue } from "bullmq";

describe("Inbound queue - Agency scoping", () => {
  let mockAdd: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Get the mock add function from the Queue instance
    const queueInstance = (Queue as any).mock.results[0].value;
    mockAdd = queueInstance.add;
  });

  it("should include agencyId in job payload when enqueuing", async () => {
    const agencyId = "agency-1";
    const messageId = "msg-123";

    await enqueueInboundMessage(agencyId, messageId);

    // Verify add was called with correct payload structure
    expect(mockAdd).toHaveBeenCalledWith(
      "process-inbound-message",
      { agencyId, messageId },
      expect.any(Object)
    );

    // Verify agencyId is in the payload
    const callArgs = mockAdd.mock.calls[0];
    const payload = callArgs[1];
    expect(payload).toHaveProperty("agencyId", agencyId);
    expect(payload).toHaveProperty("messageId", messageId);
  });

  it("should include agencyId even when different agencies are used", async () => {
    const agencyId1 = "agency-1";
    const agencyId2 = "agency-2";
    const messageId1 = "msg-1";
    const messageId2 = "msg-2";

    await enqueueInboundMessage(agencyId1, messageId1);
    await enqueueInboundMessage(agencyId2, messageId2);

    // Verify both calls include their respective agencyIds
    expect(mockAdd).toHaveBeenCalledTimes(2);
    
    const firstCall = mockAdd.mock.calls[0][1];
    expect(firstCall.agencyId).toBe(agencyId1);
    
    const secondCall = mockAdd.mock.calls[1][1];
    expect(secondCall.agencyId).toBe(agencyId2);
  });
});

