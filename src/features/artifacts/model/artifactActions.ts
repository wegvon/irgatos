import {
  createNote,
  getNote,
  noteTitle,
  NOTES_CHANGED_EVENT,
  type Note,
} from "../../notes";
import {
  artifactDedupeKey,
  artifactNoteBody,
  hashText,
  type WorkspaceArtifact,
} from "./workspaceArtifacts";

export {
  OPEN_ARTIFACT_EVENT,
  requestOpenArtifact,
  type OpenArtifactRequest,
} from "./openArtifact";

const NOTES_KEY = "irgat.artifactNotes.v1";
const inflight = new Map<string, Promise<SavedArtifactNote>>();

export type SavedArtifactNote = { note: Note; created: boolean };

function noteKey(artifact: WorkspaceArtifact, content: string): string {
  return `${artifactDedupeKey(artifact)}#${hashText(content)}`;
}

function readSaved(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.fromEntries(
          Object.entries(parsed).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  } catch {
    return {};
  }
}

function remember(key: string, noteId: string): void {
  try {
    const saved = readSaved();
    saved[key] = noteId;
    localStorage.setItem(NOTES_KEY, JSON.stringify(saved));
  } catch {
    // private mode / quota
  }
}

export function savedArtifactNoteId(
  artifact: WorkspaceArtifact,
  content: string,
): string | undefined {
  return readSaved()[noteKey(artifact, content)];
}

/**
 * Save the artifact as a note exactly once per version of its text. A second
 * click while the first save is in flight joins it, and a later click finds
 * the note it already made instead of filing a duplicate.
 */
export function saveArtifactAsNote(
  artifact: WorkspaceArtifact,
  content: string,
  deps: {
    create?: typeof createNote;
    get?: typeof getNote;
  } = {},
): Promise<SavedArtifactNote> {
  const create = deps.create ?? createNote;
  const get = deps.get ?? getNote;
  const key = noteKey(artifact, content);
  const pending = inflight.get(key);
  if (pending) return pending;
  const run = (async (): Promise<SavedArtifactNote> => {
    const existingId = readSaved()[key];
    if (existingId) {
      const existing = await get(existingId).catch(() => null);
      if (existing) return { note: existing, created: false };
    }
    const body = artifactNoteBody(artifact, content);
    const note = await create({
      title: artifact.title.trim() || noteTitle(body),
      body,
      ...(artifact.sessionId ? { sourceSessionId: artifact.sessionId } : {}),
      ...(artifact.cwd ? { sourceCwd: artifact.cwd } : {}),
    });
    remember(key, note.id);
    window.dispatchEvent(new Event(NOTES_CHANGED_EVENT));
    return { note, created: true };
  })();
  inflight.set(key, run);
  void run.then(
    () => inflight.delete(key),
    () => inflight.delete(key),
  );
  return run;
}

/** Tests only. */
export function resetArtifactNoteState(): void {
  inflight.clear();
  try {
    localStorage.removeItem(NOTES_KEY);
  } catch {
    // ignore
  }
}
