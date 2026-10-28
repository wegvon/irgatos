import { describe, expect, it } from "vitest";
import {
  CHAT_STARTERS,
  draftWithStarter,
  isUntouchedStarterDraft,
} from "./chatStarters";

const [explain, fix, build] = CHAT_STARTERS;

describe("chat starters", () => {
  it("offers the three first-request starting points", () => {
    expect(CHAT_STARTERS.map((starter) => starter.label)).toEqual([
      "Explain this project",
      "Help me fix a problem",
      "Build a feature",
    ]);
  });

  it("fills an empty draft with the starter's text", () => {
    expect(draftWithStarter("", fix)).toBe(fix.draft);
    expect(draftWithStarter("  \n", explain)).toBe(explain.draft);
  });

  it("swaps an untouched starter instead of stacking it", () => {
    expect(isUntouchedStarterDraft(fix.draft)).toBe(true);
    expect(draftWithStarter(fix.draft, build)).toBe(build.draft);
  });

  it("keeps what the user wrote and adds the starter below it", () => {
    expect(draftWithStarter("Look at the login page.  ", build)).toBe(
      `Look at the login page.\n\n${build.draft}`,
    );
    expect(isUntouchedStarterDraft(`${fix.draft}the save button`)).toBe(false);
  });
});
