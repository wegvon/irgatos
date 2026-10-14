import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ADHD_DISABLED_NOTICE,
  ADHD_RULES,
  ADHD_RULES_VERSION,
  ADHD_RULE_TITLES,
  ADHD_UPSTREAM,
  adhdDisabledContext,
  adhdRulesContext,
  stripSkillFrontmatter,
} from "./adhdRules";

const vendor = (name: string) =>
  readFileSync(
    fileURLToPath(
      new URL(`../../../../vendor/i-have-adhd/${name}`, import.meta.url),
    ),
    "utf8",
  );

describe("i-have-adhd ruleset", () => {
  it("ships the upstream MIT license next to the vendored skill", () => {
    const license = vendor("LICENSE");
    expect(license).toMatch(/^MIT License/);
    expect(license).toContain("Copyright (c) 2026 Ayoub Ghriss");
    expect(vendor("UPSTREAM.md")).toContain(ADHD_UPSTREAM.url);
    expect(vendor("SKILL.md")).toContain("license: MIT");
  });

  it("injects the skill body without its frontmatter, like the upstream hooks", () => {
    expect(ADHD_RULES.startsWith("# i-have-adhd")).toBe(true);
    expect(ADHD_RULES).not.toContain("disable-model-invocation");
    expect(ADHD_RULES).toContain("### 1. Lead with the next action");
    expect(ADHD_RULES).toContain("### 10. No preamble, no recap");
    expect(ADHD_RULES).toContain("## Pre-send check");
    expect(stripSkillFrontmatter(vendor("SKILL.md"))).toBe(ADHD_RULES);
  });

  it("strips only a leading frontmatter block", () => {
    expect(stripSkillFrontmatter("---\nname: x\n---\nBody\n\n")).toBe("Body");
    expect(stripSkillFrontmatter("Body\n---\nnot: frontmatter\n---\n")).toBe(
      "Body\n---\nnot: frontmatter\n---",
    );
    expect(stripSkillFrontmatter("---\r\nname: x\r\n---\r\nBody")).toBe("Body");
  });

  it("lists one title per upstream rule", () => {
    expect(ADHD_RULE_TITLES).toHaveLength(10);
    const headings = [...ADHD_RULES.matchAll(/^### (\d+)\./gm)].map(
      (match) => Number(match[1]),
    );
    expect(headings).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("wraps the rules and the off notice as app context", () => {
    const on = adhdRulesContext();
    expect(on.startsWith("<adhd_mode>\nADHD MODE ACTIVE.")).toBe(true);
    expect(on).toContain(ADHD_RULES);
    expect(on.endsWith("</adhd_mode>")).toBe(true);
    expect(adhdDisabledContext()).toBe(
      `<adhd_mode>\n${ADHD_DISABLED_NOTICE}\n</adhd_mode>`,
    );
  });

  it("versions the injected text with a stable hash", () => {
    expect(ADHD_RULES_VERSION).toMatch(/^[0-9a-f]{8}$/);
  });
});
