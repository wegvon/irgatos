// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "./session";
import {
  acceptSendToChat,
  requestSendToChat,
  SEND_TO_CHAT_EVENT,
  type SendToChatRequest,
} from "./sendToChat";

const screenshot: Attachment = {
  id: "shot",
  name: "example-com-button.png",
  mimeType: "image/png",
  kind: "image",
  size: 4,
  data: "iVBORw==",
};

function listen(target: {
  attachmentsSupported: boolean;
  submit: (text: string, attachments: Attachment[]) => boolean | void;
}) {
  const onSend = (event: Event) =>
    acceptSendToChat((event as CustomEvent<SendToChatRequest>).detail, {
      sessionId: "s1",
      title: "Fix the hero",
      ...target,
    });
  window.addEventListener(SEND_TO_CHAT_EVENT, onSend);
  return () => window.removeEventListener(SEND_TO_CHAT_EVENT, onSend);
}

describe("requestSendToChat", () => {
  const stops: (() => void)[] = [];
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
  });

  it("reports that no chat took the message", () => {
    expect(requestSendToChat("hi", [screenshot])).toBeNull();
  });

  it("submits through the receiving pane with its files", () => {
    const submit = vi.fn(() => true);
    stops.push(listen({ attachmentsSupported: true, submit }));

    expect(requestSendToChat("Look at this", [screenshot])).toEqual({
      status: "sent",
      sessionId: "s1",
      title: "Fix the hero",
      droppedAttachments: 0,
    });
    expect(submit).toHaveBeenCalledWith("Look at this", [screenshot]);
  });

  it("drops files a harness can't take and says so", () => {
    const submit = vi.fn();
    stops.push(listen({ attachmentsSupported: false, submit }));

    expect(requestSendToChat("Look at this", [screenshot])).toMatchObject({
      status: "sent",
      droppedAttachments: 1,
    });
    expect(submit).toHaveBeenCalledWith("Look at this", []);
  });

  it("passes on a rejection from the session", () => {
    stops.push(listen({ attachmentsSupported: true, submit: () => false }));

    expect(requestSendToChat("Look at this", [])).toEqual({
      status: "rejected",
      sessionId: "s1",
      title: "Fix the hero",
    });
  });

  it("is submitted by one pane only", () => {
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    stops.push(listen({ attachmentsSupported: true, submit: first }));
    stops.push(listen({ attachmentsSupported: true, submit: second }));

    requestSendToChat("Look at this", []);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});
