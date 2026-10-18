import { Check, Star } from "../../../shared/ui/icons";
import { ALT } from "../../../platform/tauri/platform";
import { MAX_FAVORITE_MODELS, type AgentModel } from "../model/models";
import { HARNESS_TITLE } from "../model/session";
import { HarnessIcon } from "./HarnessIcon";

type Props = {
  models: AgentModel[];
  currentId: string;
  enabled: (item: AgentModel) => boolean;
  disabledHint?: (item: AgentModel) => string | undefined;
  onPick: (item: AgentModel) => void;
  /** Unstar from the pinned row; omitted where the list is read-only. */
  onRemove?: (id: string) => void;
  /** Show how to pin a model when nothing is starred yet. */
  showEmptyHint?: boolean;
  className?: string;
};

/**
 * The starred models pinned atop a model picker: one click (or ⌥1–⌥3) away,
 * in the order they were starred.
 */
export function FavoriteModels({
  models,
  currentId,
  enabled,
  disabledHint,
  onPick,
  onRemove,
  showEmptyHint = false,
  className = "",
}: Props) {
  if (models.length === 0 && !showEmptyHint) return null;
  return (
    <div
      role="group"
      aria-label="Favorite models"
      data-favorite-models
      className={className}
    >
      <div className="flex h-6 items-center gap-1.5 px-2.5 text-[10px] font-medium uppercase tracking-wide text-content/40">
        <Star className="size-3" strokeWidth={1.75} fill="currentColor" />
        <span className="min-w-0 flex-1">Favorites</span>
        <span className="tabular-nums normal-case tracking-normal">
          {models.length}/{MAX_FAVORITE_MODELS}
        </span>
      </div>
      {models.length === 0 ? (
        <p className="px-2.5 pb-2 text-[11px] leading-4 text-content/45">
          Star a model to pin it here. Up to {MAX_FAVORITE_MODELS}.
        </p>
      ) : (
        models.map((item, index) => {
          const selected = item.id === currentId;
          const disabled = !enabled(item);
          const provenance = item.provider?.name ?? HARNESS_TITLE[item.harness];
          return (
            <div
              key={item.id}
              className={`group/favorite flex h-8 items-center rounded-lg px-1 ${
                disabled ? "text-content/30" : "text-content hover:bg-content/5"
              }`}
            >
              <button
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                aria-label={`${item.name}, ${provenance}`}
                aria-keyshortcuts={`Alt+${index + 1}`}
                disabled={disabled}
                title={disabled ? disabledHint?.(item) : `${ALT}${index + 1}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(item)}
                className="flex min-w-0 flex-1 items-center gap-2 px-1.5 text-left text-[13px] disabled:cursor-not-allowed"
              >
                <HarnessIcon
                  harness={item.harness}
                  className="size-3.5 shrink-0"
                />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <span className="max-w-24 shrink-0 truncate text-[10px] text-content/40">
                  {provenance}
                </span>
                <kbd className="shrink-0 font-sans text-[10px] text-content/35">
                  {ALT}
                  {index + 1}
                </kbd>
              </button>
              {onRemove ? (
                <button
                  type="button"
                  title="Remove from favorites"
                  aria-label={`Remove ${item.name} from favorites`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(item.id);
                  }}
                  className="grid size-6 shrink-0 place-items-center rounded-md text-content/60 hover:text-content"
                >
                  <Star
                    className="size-3.5"
                    strokeWidth={1.75}
                    fill="currentColor"
                  />
                </button>
              ) : null}
              <span
                aria-hidden="true"
                className="grid size-6 shrink-0 place-items-center"
              >
                {selected ? (
                  <Check className="size-3.5 text-content/55" strokeWidth={2} />
                ) : null}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
