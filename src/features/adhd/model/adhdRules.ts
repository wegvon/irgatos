import upstreamSkill from "../../../../vendor/i-have-adhd/SKILL.md?raw";

export const ADHD_UPSTREAM = {
  name: "i-have-adhd",
  version: "0.4.1",
  author: "Ayoub Ghriss",
  license: "MIT",
  url: "https://github.com/ayghri/i-have-adhd",
} as const;

/** The same frontmatter strip the upstream hooks apply before injecting. */
export function stripSkillFrontmatter(content: string): string {
  return content
    .replace(/^---[^\S\r\n]*\r?\n[\s\S]*?\r?\n---[^\S\r\n]*(?:\r?\n|$)/, "")
    .trim();
}

export const ADHD_RULES = stripSkillFrontmatter(upstreamSkill);

/** Short labels for the ten upstream rules, in their order. */
export const ADHD_RULE_TITLES = [
  "Lead with the next action.",
  "Number multi-step tasks.",
  "End with one concrete next step.",
  "Suppress tangents.",
  "Restate state every turn.",
  "Specific time estimates (minutes, not \u201ca bit\u201d).",
  "Make wins visible.",
  "Matter-of-fact errors.",
  "Cap lists to 5 items.",
  "No preamble. No recap. No closers.",
] as const;

export const ADHD_STOP_PHRASES = [
  "stop adhd mode",
  "normal mode",
  "adhd modunu kapat",
  "normal mod",
] as const;

const RULES_HEADER =
  'ADHD MODE ACTIVE. The ruleset below applies to every response until turned off. Irgatos turns it off for this chat when the user says "stop adhd mode" or "normal mode", and tells you when it does.';

export const ADHD_DISABLED_NOTICE =
  "ADHD MODE OFF. Ignore the i-have-adhd ruleset given earlier in this conversation and return to your default response style.";

export function adhdRulesContext(): string {
  return `<adhd_mode>\n${RULES_HEADER}\n\n${ADHD_RULES}\n</adhd_mode>`;
}

export function adhdDisabledContext(): string {
  return `<adhd_mode>\n${ADHD_DISABLED_NOTICE}\n</adhd_mode>`;
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Changes whenever the injected text does, so open chats get the new rules. */
export const ADHD_RULES_VERSION = fnv1a(adhdRulesContext());
