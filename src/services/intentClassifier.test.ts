import { describe, it, expect } from "vitest";
import { classifyInboundIntent } from '.ts';

describe("classifyInboundIntent", () => {
  it("classifies LOOKING_FOR_WORK", () => {
    expect(classifyInboundIntent("any work?")).toBe("LOOKING_FOR_WORK");
  });

  it("classifies AVAILABILITY_UPDATE", () => {
    expect(classifyInboundIntent("I am free tomorrow")).toBe(
      "AVAILABILITY_UPDATE"
    );
  });

  it("classifies JOB_QUERY", () => {
    expect(classifyInboundIntent("what is the rate?")).toBe("JOB_QUERY");
  });

  it("classifies FOLLOW_UP", () => {
    expect(classifyInboundIntent("any update?")).toBe("FOLLOW_UP");
  });

  it("classifies UNKNOWN", () => {
    expect(classifyInboundIntent("hello bro")).toBe("UNKNOWN");
  });

  it("applies priority when rules overlap (AVAILABILITY_UPDATE wins)", () => {
    // Contains FOLLOW_UP ("update"), LOOKING_FOR_WORK ("any work"), and AVAILABILITY cue ("tomorrow").
    expect(classifyInboundIntent("any update? any work tomorrow")).toBe(
      "AVAILABILITY_UPDATE"
    );
  });
});


