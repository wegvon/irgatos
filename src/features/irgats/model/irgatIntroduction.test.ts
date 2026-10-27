import { expect, it } from "vitest";
import { newSession, type Session } from "../../sessions/model/session";
import type { Irgat } from "./irgat";
import {
  irgatIntroductionPrompt,
  irgatsToIntroduce,
} from "./irgatIntroduction";

const irgat = (patch: Partial<Irgat> = {}): Irgat => ({
  id: "i1",
  mascot: "crab",
  color: "#fff",
  projects: [],
  introduce: true,
  sessionId: "chat",
  ...patch,
});
const chat = (patch: Partial<Session> = {}): Session => ({
  ...newSession("claude", "/Users/me"),
  id: "chat",
  ...patch,
});

it("greets once its chat is loaded and idle", () => {
  expect(irgatsToIntroduce([irgat()], [])).toEqual([]);
  expect(irgatsToIntroduce([irgat()], [chat({ busy: true })])).toEqual([]);
  expect(irgatsToIntroduce([irgat({ introduce: undefined })], [chat()])).toEqual(
    [],
  );
  const [due] = irgatsToIntroduce([irgat()], [chat()]);
  expect(due.greet).toBe(true);
});

it("only clears the flag when the user already wrote first", () => {
  const [due] = irgatsToIntroduce(
    [irgat()],
    [chat({ blocks: [{ id: "u", role: "user", text: "hi" }] })],
  );
  expect(due.greet).toBe(false);
});

it("asks for a short hello and suggestions, not changes", () => {
  const prompt = irgatIntroductionPrompt("Crab");
  expect(prompt).toContain("Introduce yourself as Crab");
  expect(prompt).toContain('chat.card type "habit"');
  expect(prompt).toContain("Do not start sessions, add habits or change anything yet.");
});
