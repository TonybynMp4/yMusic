import { IconX } from "@tabler/icons-react";
import { currentItemIndex, type QueueState, type TrackId } from "@ytbm/core";

import { Artwork } from "./TrackList.tsx";

interface Props {
  queue: QueueState;
  onJump: (id: TrackId) => void;
  onRemove: (id: TrackId) => void;
  onClear: () => void;
}

export function Queue({ queue, onJump, onRemove, onClear }: Props) {
  const current = currentItemIndex(queue);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-white/10 bg-black/20">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          Queue · {queue.items.length}
        </h2>
        {queue.items.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-neutral-500 transition hover:text-neutral-200"
          >
            Clear
          </button>
        )}
      </div>

      {queue.items.length === 0 ? (
        <p className="px-4 text-xs text-neutral-600">
          Play a track, or add one from the library to line it up.
        </p>
      ) : (
        <ol className="min-h-0 flex-1 overflow-y-auto">
          {/* Queue order, not library order: `order` is the permutation that
              shuffle rewrites, so rendering it directly keeps the list honest. */}
          {queue.order.map((itemIndex, position) => {
            const track = queue.items[itemIndex];
            if (!track) return null;
            const isCurrent = itemIndex === current;
            return (
              <li
                key={`${track.id}-${position}`}
                className={`group flex items-center gap-2 px-3 py-1.5 ${
                  isCurrent ? "bg-white/10" : "hover:bg-white/5"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onJump(track.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <Artwork track={track} size="h-7 w-7" />
                  <span className="min-w-0">
                    <span
                      className={`block truncate text-xs ${
                        isCurrent ? "text-emerald-400" : "text-neutral-200"
                      }`}
                    >
                      {track.title}
                    </span>
                    <span className="block truncate text-[11px] text-neutral-500">
                      {track.artists[0]?.name}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(track.id)}
                  title="Remove from queue"
                  aria-label="Remove from queue"
                  className="shrink-0 rounded p-0.5 text-neutral-600 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                >
                  <IconX size={14} stroke={2} />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
