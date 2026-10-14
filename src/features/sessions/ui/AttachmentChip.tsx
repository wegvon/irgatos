import { useState } from "react";
import { X } from "../../../shared/ui/icons";
import {
  attachmentPreviewSrc,
  folderItemCountLabel,
  isAttachmentFolder,
} from "../model/attachments";
import type { Attachment } from "../model/session";
import { FileTypeIcon } from "../../files/ui/FileTypeIcon";
import { ImageLightbox } from "../../../shared/ui/ImageLightbox";

type Props = {
  attachment: Attachment;
  onRemove?: () => void;
  /** A sent image shown large on its own, like a photo in a messaging app. */
  photo?: boolean;
};

export function AttachmentChip({ attachment, onRemove, photo = false }: Props) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const preview = attachmentPreviewSrc(attachment);
  const image = attachment.kind === "image" && preview;
  const folder = isAttachmentFolder(attachment);
  const itemCount = attachment.folder
    ? folderItemCountLabel(attachment.folder)
    : null;

  return (
    <>
      <div
        className={`group relative flex min-w-0 items-center gap-1.5 rounded-md ${
          image ? "" : "bg-content/10 py-0.5 pl-1 pr-1"
        }`}
        title={chipTitle(attachment, itemCount)}
      >
        {image ? (
          <button
            type="button"
            aria-label={`Open ${attachment.name} full screen`}
            title={`Open ${attachment.name} full screen`}
            onClick={(event) => {
              event.stopPropagation();
              setPreviewOpen(true);
            }}
            className={`${photo ? "min-w-0 rounded-2xl" : "shrink-0 rounded-lg"} cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
          >
            <img
              src={preview}
              alt=""
              draggable={false}
              className={
                photo
                  ? "block max-h-60 max-w-60 rounded-2xl object-cover"
                  : "size-9 rounded-lg object-cover"
              }
            />
          </button>
        ) : (
          <>
            <span className="grid size-5 shrink-0 place-items-center">
              <FileTypeIcon name={attachment.name} isDir={folder} size={16} />
            </span>
            <span className="min-w-0 max-w-[140px] truncate text-[11px] leading-none text-content/80">
              {attachment.name}
            </span>
            {itemCount ? (
              <span className="shrink-0 text-[10px] leading-none text-content/45">
                {itemCount}
              </span>
            ) : null}
          </>
        )}
        {onRemove ? (
          <button
            type="button"
            title="Remove"
            aria-label={`Remove ${attachment.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
            className={`grid shrink-0 place-items-center rounded-full text-content/70 hover:bg-content/15 hover:text-content ${
              image
                ? "absolute -right-1 -top-1 size-5 bg-content/20 opacity-100 shadow-sm backdrop-blur-sm"
                : "size-4 text-content/40"
            }`}
          >
            <X className="size-3" strokeWidth={2} />
          </button>
        ) : null}
      </div>
      {image && previewOpen ? (
        <ImageLightbox
          src={preview}
          alt={attachment.name}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </>
  );
}

function chipTitle(attachment: Attachment, itemCount: string | null): string {
  const where = attachment.path ?? attachment.name;
  const skipped = attachment.folder?.skipped ?? 0;
  if (!itemCount) return where;
  const left = skipped
    ? `, ${skipped} left out (version control, dependencies, build output)`
    : "";
  return `${where}\n${itemCount}${left}`;
}
