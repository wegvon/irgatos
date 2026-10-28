import { describe, expect, it } from "vitest";
import {
  unlaunchableHeldRuns,
  type Automation,
  type AutomationRun,
} from "./automations";

const automation = (id: string, enabled = true) =>
  ({ id, enabled }) as Automation;
const run = (trigger: AutomationRun["trigger"]) =>
  ({ id: `run-${trigger}`, trigger, status: "pending" }) as AutomationRun;

describe("runs held for a usage reset", () => {
  it("stop waiting once their automation is off or gone", () => {
    const held = new Map([
      ["kept", { automation: automation("on"), run: run("scheduled") }],
      ["off", { automation: automation("off"), run: run("scheduled") }],
      ["event", { automation: automation("off"), run: run("event") }],
      ["manual", { automation: automation("off"), run: run("manual") }],
      ["gone", { automation: automation("deleted"), run: run("manual") }],
    ]);
    expect(
      unlaunchableHeldRuns(held, [automation("on"), automation("off", false)]),
    ).toEqual(["off", "event", "gone"]);
  });
});
