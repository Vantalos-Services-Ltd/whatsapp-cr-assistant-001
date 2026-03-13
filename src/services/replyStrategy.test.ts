/**
 * Tests for reply strategy service
 */

import { describe, it, expect } from "vitest";
import { determineReplyStrategy } from '.ts';
import type { InboundIntent } from '.ts';

describe("determineReplyStrategy", () => {
  describe("AUTOPILOT mode", () => {
    it("should auto-reply for low-risk messages", () => {
      const decision = determineReplyStrategy(
        "AUTOPILOT",
        "LOOKING_FOR_WORK",
        "I'm looking for work",
        { riskLevel: "LOW", actionType: "SEND_MESSAGE" }
      );

      expect(decision.shouldAutoReply).toBe(true);
      expect(decision.reason).toBe("autopilot_mode");
    });

    it("should auto-reply even for medium-risk messages", () => {
      const decision = determineReplyStrategy(
        "AUTOPILOT",
        "AVAILABILITY_UPDATE",
        "I'm available tomorrow",
        { riskLevel: "MEDIUM", actionType: "SEND_MESSAGE" }
      );

      expect(decision.shouldAutoReply).toBe(true);
    });

    it("should NOT auto-reply if escalation trigger detected (salary)", () => {
      const decision = determineReplyStrategy(
        "AUTOPILOT",
        "JOB_QUERY",
        "What's the salary for this job?",
        { riskLevel: "LOW", actionType: "SEND_MESSAGE" }
      );

      expect(decision.shouldAutoReply).toBe(false);
      expect(decision.escalationReason).toBe("salary/compensation");
    });

    it("should NOT auto-reply if escalation trigger detected (offer)", () => {
      const decision = determineReplyStrategy(
        "AUTOPILOT",
        "FOLLOW_UP",
        "When can I start? What's the offer?",
        { riskLevel: "LOW", actionType: "SEND_MESSAGE" }
      );

      expect(decision.shouldAutoReply).toBe(false);
      expect(decision.escalationReason).toBe("offer/contract/start date");
    });
  });

  describe("HYBRID mode", () => {
    it("should auto-reply for low-risk + high-confidence", () => {
      const decision = determineReplyStrategy(
        "HYBRID",
        "LOOKING_FOR_WORK",
        "I'm looking for work",
        { riskLevel: "LOW", actionType: "SEND_MESSAGE" }
      );

      expect(decision.shouldAutoReply).toBe(true);
      expect(decision.reason).toBe("hybrid_auto_low_risk_high_confidence");
    });

    it("should require approval for medium-risk", () => {
      const decision = determineReplyStrategy(
        "HYBRID",
        "AVAILABILITY_UPDATE",
        "I'm available tomorrow",
        { riskLevel: "MEDIUM", actionType: "SEND_MESSAGE" }
      );

      expect(decision.shouldAutoReply).toBe(false);
      expect(decision.reason).toBe("hybrid_requires_approval");
      expect(decision.escalationReason).toBe("medium_or_high_risk");
    });

    it("should require approval for high-risk (escalation trigger)", () => {
      const decision = determineReplyStrategy(
        "HYBRID",
        "FOLLOW_UP",
        "Hello, just checking in",
        { riskLevel: "HIGH", actionType: "SEND_MESSAGE" }
      );

      expect(decision.shouldAutoReply).toBe(false);
      // High-risk triggers escalation, which takes precedence over hybrid mode
      expect(decision.reason).toBe("escalation_trigger");
      expect(decision.escalationReason).toBe("high_risk_action");
    });

    it("should require approval for low-confidence (UNKNOWN intent)", () => {
      const decision = determineReplyStrategy(
        "HYBRID",
        "UNKNOWN",
        "Random message",
        { riskLevel: "LOW", actionType: "SEND_MESSAGE" }
      );

      expect(decision.shouldAutoReply).toBe(false);
      expect(decision.reason).toBe("hybrid_requires_approval");
      expect(decision.escalationReason).toBe("low_confidence");
    });
  });

  describe("APPROVAL_ONLY mode", () => {
    it("should always require approval", () => {
      const decision = determineReplyStrategy(
        "APPROVAL_ONLY",
        "LOOKING_FOR_WORK",
        "I'm looking for work",
        { riskLevel: "LOW", actionType: "SEND_MESSAGE" }
      );

      expect(decision.shouldAutoReply).toBe(false);
      expect(decision.reason).toBe("approval_only_mode");
    });
  });

  describe("Escalation triggers", () => {
    it("should detect salary/compensation trigger", () => {
      const decision = determineReplyStrategy(
        "AUTOPILOT",
        "FOLLOW_UP",
        "What's the pay rate?",
        { riskLevel: "LOW" }
      );

      expect(decision.shouldAutoReply).toBe(false);
      expect(decision.escalationReason).toBe("salary/compensation");
    });

    it("should detect offer/contract trigger", () => {
      const decision = determineReplyStrategy(
        "AUTOPILOT",
        "FOLLOW_UP",
        "When is the start date?",
        { riskLevel: "LOW" }
      );

      expect(decision.shouldAutoReply).toBe(false);
      expect(decision.escalationReason).toBe("offer/contract/start date");
    });

    it("should detect rejection trigger", () => {
      const decision = determineReplyStrategy(
        "AUTOPILOT",
        "FOLLOW_UP",
        "I'm not interested",
        { riskLevel: "LOW" }
      );

      expect(decision.shouldAutoReply).toBe(false);
      expect(decision.escalationReason).toBe("rejection/disqualification");
    });

    it("should detect legal/sensitive trigger", () => {
      const decision = determineReplyStrategy(
        "AUTOPILOT",
        "FOLLOW_UP",
        "This is discrimination",
        { riskLevel: "LOW" }
      );

      expect(decision.shouldAutoReply).toBe(false);
      expect(decision.escalationReason).toBe("legal/sensitive");
    });

    it("should detect high-risk action", () => {
      const decision = determineReplyStrategy(
        "AUTOPILOT",
        "FOLLOW_UP",
        "Hello",
        { riskLevel: "HIGH" }
      );

      expect(decision.shouldAutoReply).toBe(false);
      expect(decision.escalationReason).toBe("high_risk_action");
    });

    it("should detect JOB_QUERY intent as escalation", () => {
      const decision = determineReplyStrategy(
        "AUTOPILOT",
        "JOB_QUERY",
        "What's the job location?",
        { riskLevel: "LOW" }
      );

      expect(decision.shouldAutoReply).toBe(false);
      expect(decision.escalationReason).toBe("job_query_intent");
    });
  });
});

