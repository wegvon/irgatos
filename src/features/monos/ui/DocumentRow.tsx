import { artifactLabel, type ArtifactCard } from "../../artifacts/artifacts";
import { ArtifactIcon } from "../../artifacts/ui/ArtifactCard";

/** A document it wrote, laid out like a habit; opens in the reader. */
export function DocumentRow({
  card,
  onOpen,
}: {
  card: ArtifactCard;
  onOpen: (id: string) => void;
}) {
  const label = artifactLabel(card.kind);
  return (
    <button
      type="button"
      data-mono-document={card.id}
      aria-label={`Open ${label.toLowerCase()} ${card.title}`}
      onClick={() => onOpen(card.id)}
      className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-content/5"
    >
      <span
        aria-hidden
        className="grid size-7 shrink-0 place-items-center rounded-md bg-content/6 text-content/60"
      >
        <ArtifactIcon kind={card.kind} className="size-3.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[12px] leading-5 text-content/85">
          {card.title}
        </span>
        <span className="truncate text-[11px] leading-4 text-content/40">
          {card.summary || label}
        </span>
      </span>
    </button>
  );
}
