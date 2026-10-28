// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { irgatSessionCompletionMessage } from "../../irgats/model/irgatSessionCompletion";
import { MessageQueue } from "./MessageQueue";

it("labels a pending completion and offers removal without editing or steering it", () => {
  const message = irgatSessionCompletionMessage({
    sessionId: "worker",
    requestId: "app-irgat-monitor",
    project: "/code/project",
    prompt: "Review",
    session: undefined,
    outcome: { status: "completed", text: "Done" },
  });
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    createElement(MessageQueue, {
      messages: [message],
      onSteer: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      variant: "messages",
    }),
  );
  expect(container.textContent).toContain("Session completed: Agent session");
  expect(container.textContent).not.toContain(
    "Irgatos completion notification",
  );
  expect(container.textContent).not.toContain("Steer");
  expect(
    container.querySelector<HTMLButtonElement>(
      '[aria-label="Edit queued message"]',
    )?.disabled,
  ).toBe(true);
  expect(
    container.querySelector('[aria-label="Remove queued message"]'),
  ).not.toBeNull();
});

it("labels a combined report without exposing the app prompt", () => {
  const message = irgatSessionCompletionMessage({
    sessionId: "worker",
    requestId: "request",
    project: "/code/project",
    prompt: "Review",
    outcome: { status: "completed", text: "Done" },
  });
  message.irgatSessionCompletion!.sessionCount = 3;
  const markup = renderToStaticMarkup(
    createElement(MessageQueue, { messages: [message] }),
  );
  expect(markup).toContain("3 sessions finished");
  expect(markup).not.toContain("Irgatos completion notification");
});

it("never offers Steer on a queued plan and offers Retry on a failed row", () => {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    createElement(MessageQueue, {
      messages: [
        {
          id: "plan",
          text: "Plan the migration",
          attachments: [],
          intent: "plan",
        },
        {
          id: "failed",
          text: "Use TypeScript",
          attachments: [],
          error: "Rejected",
        },
      ],
      status: "paused",
      onSteer: vi.fn(),
    }),
  );
  const [planSteer, retry] = Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).filter(
    (button) =>
      /Steer|Retry/.test(button.textContent ?? "") &&
      !button.closest("div.border-b"),
  );
  expect(planSteer.textContent).toContain("Steer");
  expect(planSteer.disabled).toBe(true);
  expect(retry.textContent).toContain("Retry");
  expect(retry.disabled).toBe(false);
});
