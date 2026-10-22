import { useCallback, useEffect, useRef, useState } from "react";
import { uploadFile, type Upload } from "../upload";
import { Spinner } from "./parts";
import { CircleAlert, File, Plus, X } from "../../../../shared/ui/icons";

const MAX_FILES = 10;

/**
 * Files picked or pasted into a composer: each starts uploading to the Mac
 * at once, so by the time the message is written they are usually there.
 */
export function useUploads() {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const live = useRef(uploads);
  live.current = uploads;
  useEffect(
    () => () => {
      for (const upload of live.current)
        if (upload.preview) URL.revokeObjectURL(upload.preview);
    },
    [],
  );

  const patch = (key: string, next: Partial<Upload>) =>
    setUploads((current) =>
      current.map((upload) =>
        upload.key === key ? { ...upload, ...next } : upload,
      ),
    );

  const add = useCallback((files: Iterable<File>) => {
    const room = MAX_FILES - live.current.length;
    for (const file of [...files].slice(0, Math.max(0, room))) {
      const key = crypto.randomUUID();
      const preview = file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined;
      setUploads((current) => [
        ...current,
        { key, name: file.name || "file", ...(preview ? { preview } : {}) },
      ]);
      uploadFile(file).then(
        (id) => patch(key, { id }),
        (reason: unknown) =>
          patch(key, {
            error: reason instanceof Error ? reason.message : String(reason),
          }),
      );
    }
  }, []);

  const remove = (key: string) =>
    setUploads((current) =>
      current.filter((upload) => {
        if (upload.key === key && upload.preview)
          URL.revokeObjectURL(upload.preview);
        return upload.key !== key;
      }),
    );

  const clear = () => {
    for (const upload of live.current)
      if (upload.preview) URL.revokeObjectURL(upload.preview);
    setUploads([]);
  };

  const ids = uploads.flatMap((upload) => (upload.id ? [upload.id] : []));
  return {
    uploads,
    add,
    remove,
    clear,
    ids,
    /** Still sending, or failed: the message waits until they are sorted. */
    blocked: uploads.some((upload) => !upload.id),
  };
}

/** The composer's + : the system's picker for photos, the camera or files. */
export function AttachButton({
  onFiles,
  disabled = false,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        aria-label="Attach files"
        disabled={disabled}
        onClick={() => input.current?.click()}
        className="web-press flex size-11 shrink-0 items-center justify-center rounded-full text-(--ink-2) active:bg-content/8 disabled:opacity-40"
      >
        <Plus className="size-[22px]" strokeWidth={2} />
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}

/** What is attached so far, above the field: a thumbnail or the name. */
export function UploadChips({
  uploads,
  onRemove,
}: {
  uploads: Upload[];
  onRemove: (key: string) => void;
}) {
  if (!uploads.length) return null;
  return (
    <div className="flex gap-2 overflow-x-auto px-1 pb-2 pt-1 [scrollbar-width:none]">
      {uploads.map((upload) => (
        <div
          key={upload.key}
          title={upload.error}
          className={`relative flex h-14 max-w-[13rem] shrink-0 items-center gap-2 rounded-[14px] pr-8 text-[13.5px] ${
            upload.error
              ? "bg-(--bad)/12 text-(--bad)"
              : "bg-content/6 text-(--ink)"
          } ${upload.preview ? "pl-1" : "pl-3"}`}
        >
          {upload.preview ? (
            <img
              src={upload.preview}
              alt=""
              className="size-12 shrink-0 rounded-[10px] object-cover"
            />
          ) : (
            <File className="size-4 shrink-0 text-(--ink-2)" />
          )}
          <span className="min-w-0 flex-1 overflow-hidden">
            <span className="block truncate font-medium">{upload.name}</span>
            <span className="flex items-center gap-1 text-[12px] text-(--ink-3)">
              {upload.error ? (
                <>
                  <CircleAlert className="size-3 text-(--bad)" />
                  <span className="truncate text-(--bad)">Couldn't attach</span>
                </>
              ) : upload.id ? (
                "Ready"
              ) : (
                <>
                  <Spinner className="size-3" />
                  Sending to your Mac
                </>
              )}
            </span>
          </span>
          <button
            type="button"
            aria-label={`Remove ${upload.name}`}
            onClick={() => onRemove(upload.key)}
            className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-(--ink-3) text-(--color-background-base)"
          >
            <X className="size-3.5" strokeWidth={2.5} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Pictures pasted into a field, e.g. a screenshot copied on the phone. */
export function pastedFiles(event: React.ClipboardEvent): File[] {
  return [...event.clipboardData.files];
}
