import { describe, expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";
import {
  deliverFloatingIrgatRequest,
  floatingIrgatSession,
  type FloatingIrgatHost,
} from "./floatingIrgat";

const session = newSession("codex", "/tmp", "default", "auto");
function host(): FloatingIrgatHost {
  return {
    open: vi.fn().mockResolvedValue(session),
    submit: vi.fn().mockReturnValue(true),
    stop: vi.fn(),
    approval: vi.fn(),
    question: vi.fn(),
    questionInteraction: vi.fn(),
    reveal: vi.fn().mockResolvedValue(undefined),
    openFile: vi.fn(),
    resume: vi.fn(),
  };
}

describe("floating Irgat delivery", () => {
  it("asks the workspace to add a Irgat for the chat that requested it", async () => {
    const runtime = host();
    runtime.create = vi.fn().mockResolvedValue(undefined);
    await deliverFloatingIrgatRequest(
      { id: 1, irgatId: "irgat", action: { kind: "create" } },
      runtime,
      async () => true,
    );
    expect(runtime.create).toHaveBeenCalledWith("irgat");
  });
  it("opens the selected document in the main Irgat conversation", async () => {
    const runtime = host();
    runtime.openArtifact = vi.fn();
    await deliverFloatingIrgatRequest(
      {
        id: 1,
        irgatId: "irgat",
        action: { kind: "openArtifact", id: "doc-report" },
      },
      runtime,
      async () => true,
    );
    expect(runtime.openArtifact).toHaveBeenCalledWith("irgat", "doc-report");
  });
  it("uses the existing session for chat and approvals", async () => {
    const runtime = host();
    const accept = vi.fn().mockResolvedValue(true);
    await deliverFloatingIrgatRequest(
      {
        id: 1,
        irgatId: "irgat",
        action: { kind: "submit", text: "hello", attachments: [] },
      },
      runtime,
      accept,
    );
    expect(runtime.open).toHaveBeenCalledWith("irgat");
    expect(runtime.submit).toHaveBeenCalledExactlyOnceWith(
      session.id,
      "hello",
      [],
    );
    await deliverFloatingIrgatRequest(
      {
        id: 2,
        irgatId: "irgat",
        action: { kind: "approval", requestId: 7, decision: "deny" },
      },
      runtime,
      accept,
    );
    expect(runtime.approval).toHaveBeenCalledWith(session.id, 7, "deny");
  });

  it("does not deliver a request that expired while its Irgat was loading", async () => {
    const runtime = host();
    await deliverFloatingIrgatRequest(
      {
        id: 1,
        irgatId: "irgat",
        action: { kind: "submit", text: "hello", attachments: [] },
      },
      runtime,
      async () => false,
    );
    expect(runtime.submit).not.toHaveBeenCalled();
  });

  it("reports rejection so the floating composer can retain the draft", async () => {
    const runtime = host();
    vi.mocked(runtime.submit).mockReturnValue(false);
    await expect(
      deliverFloatingIrgatRequest(
        {
          id: 1,
          irgatId: "irgat",
          action: { kind: "submit", text: "hello", attachments: [] },
        },
        runtime,
        async () => true,
      ),
    ).rejects.toThrow("could not be sent");
  });

  it("transfers attachment bytes instead of another webview's blob URL", () => {
    const file = {
      id: "image",
      name: "pasted.png",
      kind: "image" as const,
      mimeType: "image/png",
      size: 3,
      data: "YWJj",
      previewUrl: "blob:main-only",
    };
    const original = {
      ...session,
      blocks: [
        {
          id: "message",
          role: "user" as const,
          text: "look",
          attachments: [file],
        },
      ],
    };
    const transferred = floatingIrgatSession(original);
    expect(transferred.blocks[0].attachments?.[0]).toMatchObject({
      data: "YWJj",
      name: "pasted.png",
    });
    expect(transferred.blocks[0].attachments?.[0].previewUrl).toBeUndefined();
    expect(original.blocks[0].attachments[0].previewUrl).toBe("blob:main-only");
  });
});
