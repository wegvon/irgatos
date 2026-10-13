import { expect, it } from "vitest";
import type { Block } from "../../sessions/model/session";
import {
  resolveIrgatActivity,
  type IrgatActivitySelection,
} from "./irgatActivity";

const blocks: Block[] = [
  { id: "user", role: "user", text: "Inspect" },
  {
    id: "call",
    role: "tool",
    text: "Inspect file",
    tool: { status: "in_progress" },
  },
];
const selection: IrgatActivitySelection = {
  sessionId: "irgat",
  turnId: "user",
  blocks,
};

it("follows the selected live turn, including new steps and settled tool state", () => {
  const updated: Block[] = [
    blocks[0],
    { ...blocks[1], tool: { status: "completed" } },
    { id: "reply", role: "assistant", text: "Done" },
  ];
  expect(
    resolveIrgatActivity(selection, { id: "irgat", blocks: updated, busy: true }),
  ).toEqual({
    turnId: "user",
    blocks: updated,
    live: true,
  });
  expect(
    resolveIrgatActivity(selection, { id: "irgat", blocks: updated, busy: false })
      ?.live,
  ).toBe(false);
  expect(
    resolveIrgatActivity(selection, {
      id: "irgat",
      blocks: [
        ...updated,
        { id: "next", role: "user", text: "Another request" },
      ],
      busy: true,
    })?.live,
  ).toBe(false);
});

it("retains an archived turn without borrowing another turn or Irgat's activity", () => {
  expect(
    resolveIrgatActivity(selection, {
      id: "irgat",
      blocks: [{ id: "new", role: "user", text: "Latest" }],
      busy: true,
    }),
  ).toEqual({
    turnId: "user",
    blocks,
    live: false,
  });
  expect(
    resolveIrgatActivity(selection, { id: "another-irgat", blocks }),
  ).toBeNull();
  expect(resolveIrgatActivity(selection, undefined)).toBeNull();
  expect(resolveIrgatActivity(null, { id: "irgat", blocks })).toBeNull();
});

it("keeps completion activity separate from the previous reply before any output arrives", () => {
  const notification: Block = {
    id: "notification",
    role: "user",
    text: "Hidden completion prompt",
    internal: true,
    startedAt: 2_000,
    irgatSessionCompletion: {
      sessionId: "worker",
      title: "Review",
      status: "completed",
    },
  };
  const session = { id: "irgat", blocks: [...blocks, notification], busy: true };
  expect(resolveIrgatActivity(selection, session)?.live).toBe(false);
  const completionSelection = {
    sessionId: "irgat",
    turnId: notification.id,
    blocks: [notification],
  };
  const step: Block = {
    id: "check-report",
    role: "tool",
    text: "Read the review session",
    tool: { status: "in_progress" },
  };
  const updated = { ...session, blocks: [...session.blocks, step] };
  expect(resolveIrgatActivity(completionSelection, updated)).toEqual({
    turnId: notification.id,
    blocks: [notification, step],
    live: true,
  });
});
