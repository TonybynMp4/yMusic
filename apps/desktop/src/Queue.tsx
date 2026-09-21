import { IconX } from "@tabler/icons-react";
import { currentItemIndex, type QueueState, type TrackId } from "@ytbm/core";

import { IconButton } from "@/components/IconButton";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
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
    <aside className="flex w-72 shrink-0 flex-col border-l">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Queue · {queue.items.length}
        </h2>
        {queue.items.length > 0 && (
          <Button variant="ghost" size="xs" onClick={onClear} className="text-muted-foreground">
            Clear
          </Button>
        )}
      </div>

      {queue.items.length === 0 ? (
        <p className="px-4 text-xs text-muted-foreground">
          Play a track, or add one from the library to line it up.
        </p>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <ol className="px-2 pb-2">
            {/* Queue order, not library order: `order` is the permutation that
                shuffle rewrites, so rendering it directly keeps the list honest. */}
            {queue.order.map((itemIndex, position) => {
              const track = queue.items[itemIndex];
              if (!track) return null;
              const isCurrent = itemIndex === current;
              return (
                <li
                  key={`${track.id}-${position}`}
                  className={cn(
                    "group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
                    isCurrent ? "bg-accent" : "hover:bg-accent/60",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onJump(track.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
                  >
                    <Artwork track={track} size="size-7" />
                    <span className="min-w-0">
                      <span className={cn("block truncate text-xs", isCurrent && "text-brand")}>
                        {track.title}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {track.artists[0]?.name}
                      </span>
                    </span>
                  </button>
                  <IconButton
                    label="Remove from queue"
                    onClick={() => onRemove(track.id)}
                    size="icon-xs"
                    className="opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <IconX size={14} stroke={2} />
                  </IconButton>
                </li>
              );
            })}
          </ol>
        </ScrollArea>
      )}
    </aside>
  );
}
