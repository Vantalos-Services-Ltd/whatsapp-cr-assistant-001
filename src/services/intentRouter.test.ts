import { describe, it, expect } from "vitest";
import { TaskType } from "@prisma/client";
import { mapIntentToTaskType } from '.ts';

describe("mapIntentToTaskType", () => {
  it("maps LOOKING_FOR_WORK → FOLLOW_UP", () => {
    expect(mapIntentToTaskType("LOOKING_FOR_WORK")).toBe(TaskType.FOLLOW_UP);
  });

  it("maps AVAILABILITY_UPDATE → FOLLOW_UP", () => {
    expect(mapIntentToTaskType("AVAILABILITY_UPDATE")).toBe(TaskType.FOLLOW_UP);
  });

  it("maps JOB_QUERY → APPROVAL_REQUIRED", () => {
    expect(mapIntentToTaskType("JOB_QUERY")).toBe(TaskType.APPROVAL_REQUIRED);
  });

  it("maps FOLLOW_UP → FOLLOW_UP", () => {
    expect(mapIntentToTaskType("FOLLOW_UP")).toBe(TaskType.FOLLOW_UP);
  });

  it("maps UNKNOWN → FOLLOW_UP", () => {
    expect(mapIntentToTaskType("UNKNOWN")).toBe(TaskType.FOLLOW_UP);
  });
});


