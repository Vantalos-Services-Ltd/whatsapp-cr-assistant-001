import { describe, it, expect } from "vitest";
import {
  templateUnderfilledUrgentJob,
  templateDormantReactivation,
  templateFollowUpAfterOffer,
  templateDay1Aftercare,
  buildTemplateContext,
} from '.ts';

describe("opportunityTemplates", () => {
  describe("templateUnderfilledUrgentJob", () => {
    it("generates message with all fields", () => {
      const result = templateUnderfilledUrgentJob({
        name: "John",
        role: "Electrician",
        location: "London",
        payLine: "£25.00/hr",
        startDateLine: "tomorrow",
      });
      expect(result).toBe("Hi John, got a Electrician job in London £25.00/hr Are you available to start tomorrow?");
    });

    it("handles missing name", () => {
      const result = templateUnderfilledUrgentJob({
        role: "Electrician",
        location: "London",
      });
      expect(result).toBe("Hi, got a Electrician job in London Are you available?");
    });

    it("handles missing pay line", () => {
      const result = templateUnderfilledUrgentJob({
        name: "John",
        role: "Electrician",
        location: "London",
        startDateLine: "tomorrow",
      });
      expect(result).toBe("Hi John, got a Electrician job in London Are you available to start tomorrow?");
    });

    it("handles missing location", () => {
      const result = templateUnderfilledUrgentJob({
        name: "John",
        role: "Electrician",
        payLine: "£25.00/hr",
      });
      expect(result).toBe("Hi John, got a Electrician job £25.00/hr Are you available?");
    });

    it("handles minimal fields", () => {
      const result = templateUnderfilledUrgentJob({
        name: "John",
      });
      expect(result).toBe("Hi John, got a job Are you available?");
    });
  });

  describe("templateDormantReactivation", () => {
    it("generates message with all fields", () => {
      const result = templateDormantReactivation({
        name: "John",
        location: "London",
      });
      expect(result).toBe("Hi John, you still looking for work? I've got something that might suit you in London.");
    });

    it("handles missing name", () => {
      const result = templateDormantReactivation({
        location: "London",
      });
      expect(result).toBe("Hi, you still looking for work? I've got something that might suit you in London.");
    });

    it("handles missing location", () => {
      const result = templateDormantReactivation({
        name: "John",
      });
      expect(result).toBe("Hi John, you still looking for work? I've got something that might suit you.");
    });
  });

  describe("templateFollowUpAfterOffer", () => {
    it("generates message with all fields", () => {
      const result = templateFollowUpAfterOffer({
        name: "John",
        role: "Electrician",
        site: "Site A",
      });
      expect(result).toBe("Hi John, just checking if you're still interested in the Electrician role at Site A. Can you confirm?");
    });

    it("handles missing name", () => {
      const result = templateFollowUpAfterOffer({
        role: "Electrician",
        site: "Site A",
      });
      expect(result).toBe("Hi, just checking if you're still interested in the Electrician role at Site A. Can you confirm?");
    });

    it("handles missing role", () => {
      const result = templateFollowUpAfterOffer({
        name: "John",
        site: "Site A",
      });
      expect(result).toBe("Hi John, just checking if you're still interested in the role at Site A. Can you confirm?");
    });

    it("handles missing site", () => {
      const result = templateFollowUpAfterOffer({
        name: "John",
        role: "Electrician",
      });
      expect(result).toBe("Hi John, just checking if you're still interested in the Electrician role. Can you confirm?");
    });
  });

  describe("templateDay1Aftercare", () => {
    it("generates message with name", () => {
      const result = templateDay1Aftercare({
        name: "John",
      });
      expect(result).toBe("Morning John, all good for today? Any issues getting to site?");
    });

    it("handles missing name", () => {
      const result = templateDay1Aftercare({});
      expect(result).toBe("Morning, all good for today? Any issues getting to site?");
    });
  });

  describe("buildTemplateContext", () => {
    it("builds context with all fields", () => {
      const result = buildTemplateContext({
        candidateName: "John",
        jobTitle: "Electrician",
        jobCity: "London",
        jobSiteName: "Site A",
        jobPayRate: 25.0,
        jobCurrency: "GBP",
        jobStartDate: new Date("2024-02-15"),
      });
      expect(result).toEqual({
        name: "John",
        role: "Electrician",
        location: "Site A", // siteName takes precedence
        payLine: "£25.00/hr",
        startDateLine: "15 Feb",
        site: "Site A",
      });
    });

    it("handles missing fields gracefully", () => {
      const result = buildTemplateContext({
        candidateName: "John",
      });
      expect(result).toEqual({
        name: "John",
        role: undefined,
        location: undefined,
        payLine: undefined,
        startDateLine: undefined,
        site: undefined,
      });
    });

    it("uses city when siteName is missing", () => {
      const result = buildTemplateContext({
        jobCity: "London",
      });
      expect(result.location).toBe("London");
    });

    it("formats today's date correctly", () => {
      const today = new Date();
      const result = buildTemplateContext({
        jobStartDate: today,
      });
      expect(result.startDateLine).toBe("today");
    });

    it("formats tomorrow's date correctly", () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const result = buildTemplateContext({
        jobStartDate: tomorrow,
      });
      expect(result.startDateLine).toBe("tomorrow");
    });
  });
});

