import { useEffect, useRef, useState, type FormEvent } from "react";
import { Modal } from "../../../shared/ui/Modal";
import {
  createManualArtifact,
  PinnedArtifactTooLargeError,
} from "../model/pinnedArtifacts";
import type { WorkspaceArtifact } from "../model/workspaceArtifacts";

type Props = {
  scope: string;
  onCreated: (artifact: WorkspaceArtifact) => void;
  onCancel: () => void;
};

/** Paste or write something worth keeping next to the generated artifacts. */
export function NewArtifactDialog({ scope, onCreated, onCancel }: Props) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!content.trim()) return;
    try {
      onCreated(createManualArtifact(scope, { title, content }));
    } catch (cause) {
      setError(
        cause instanceof PinnedArtifactTooLargeError
          ? cause.message
          : `Could not create the artifact: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  };

  return (
    <Modal
      title="New artifact"
      description="Keep a page, diagram, document or snippet with this project's artifacts."
      size="md"
      onClose={onCancel}
    >
      <form className="flex flex-col gap-4 p-4" onSubmit={submit}>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-content/70">Title</span>
          <input
            ref={input}
            type="text"
            value={title}
            placeholder="release-checklist.md"
            aria-label="Artifact title"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setTitle(event.target.value)}
            className="h-9 rounded-md border border-content/10 bg-content/5 px-2.5 font-sans text-[13px] text-content outline-none placeholder:text-content/30 focus:border-content/25"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-content/70">Content</span>
          <textarea
            value={content}
            placeholder="Paste HTML, SVG, Mermaid, Markdown or code"
            aria-label="Artifact content"
            spellCheck={false}
            rows={12}
            onChange={(event) => {
              setContent(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            className="min-h-40 resize-y rounded-md border border-content/10 bg-content/5 px-2.5 py-2 font-mono text-[12px] leading-5 text-content outline-none placeholder:text-content/30 focus:border-content/25"
          />
          <span className="text-[11px] text-content/45">
            The kind is picked from the title's extension, or from the content.
          </span>
        </label>
        {error ? (
          <p role="alert" className="text-[11px] leading-4 text-red-400/90">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-[12px] text-content/70 hover:bg-content/8 hover:text-content"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!content.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-content px-3 py-1.5 text-[12px] font-medium text-background-base hover:bg-content/80 disabled:opacity-40"
          >
            Create artifact
          </button>
        </div>
      </form>
    </Modal>
  );
}
