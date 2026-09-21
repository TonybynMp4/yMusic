import { useState } from "react";
import { IconLoader2, IconX } from "@tabler/icons-react";
import { currentItemIndex, type QueueState, type Track, type TrackId } from "@ymusic/core";

import { IconButton } from "@/components/IconButton";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { VirtualList } from "@/components/VirtualList";
import { cn } from "@/lib/utils";
import { Artwork } from "./TrackList.tsx";

const ROW_HEIGHT = 48;

interface Props {
  queue: QueueState;
  /** The queue's source is still loading, so more tracks are on the way. */
  filling: boolean;
  autoplay: boolean;
  onAutoplay: (on: boolean) => void;
  onJump: (id: TrackId) => void;
  onRemove: (id: TrackId) => void;
  onClear: () => void;
}

/**
 * The "Up next" tab of the expanded player.
 *
 * Fills whatever it is given rather than owning a width: on YouTube Music the
 * queue is one tab of the full-page player, not a permanent sidebar, so its
 * container decides the size.
 *
 * Autoplay suggestions follow the queue under their own heading, as in
 * YouTube Music. They are not part of the queue until one starts playing.
 */
export function Queue({ queue, filling, autoplay, onAutoplay, onJump, onRemove, onClear }: Props) {
  const current = currentItemIndex(queue);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);

  if (queue.items.length === 0) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        Play a track, or add one from the library to line it up.
      </p>
    );
  }

  const queued = queue.order.length;
  const suggested = queue.suggestions.length;
  // One list for both, so they scroll together; the heading takes a row.
  const count = queued + (suggested > 0 ? 1 + suggested : 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {queue.items.length} tracks
          {filling && <IconLoader2 size={12} className="animate-spin" aria-label="Loading more" />}
        </span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Autoplay
            <Switch checked={autoplay} onCheckedChange={onAutoplay} />
          </label>
          <Button variant="ghost" size="xs" onClick={onClear} className="text-muted-foreground">
            Clear
          </Button>
        </div>
      </div>

      <ScrollArea viewportRef={setViewport} className="min-h-0 flex-1">
        {/* Queue order, not library order: `order` is the permutation that
            shuffle rewrites, so rendering it directly keeps the list honest. */}
        {viewport && (
          <VirtualList
            count={count}
            scroller={viewport}
            rowHeight={ROW_HEIGHT}
            getKey={(position) =>
              position < queued
                ? `${position}:${queue.order[position]}`
                : position === queued
                  ? "autoplay"
                  : `suggestion:${queue.suggestions[position - queued - 1]?.id}`
            }
            className="px-2 pb-2"
            renderRow={(position) => {
              if (position === queued) {
                return (
                  <div
                    style={{ height: ROW_HEIGHT }}
                    className="flex items-end px-2 pb-2 text-xs font-medium text-muted-foreground"
                  >
                    Autoplay
                  </div>
                );
              }
              if (position > queued) {
                const track = queue.suggestions[position - queued - 1];
                if (!track) return null;
                return (
                  <Row track={track} onJump={onJump} className="opacity-70 hover:opacity-100" />
                );
              }
              const itemIndex = queue.order[position]!;
              const track = queue.items[itemIndex];
              if (!track) return null;
              return (
                <Row
                  track={track}
                  current={itemIndex === current}
                  onJump={onJump}
                  onRemove={onRemove}
                />
              );
            }}
          />
        )}
      </ScrollArea>
    </div>
  );
}

function Row({
  track,
  current = false,
  onJump,
  onRemove,
  className,
}: {
  track: Track;
  current?: boolean;
  onJump: (id: TrackId) => void;
  onRemove?: (id: TrackId) => void;
  className?: string;
}) {
  return (
    <div
      style={{ height: ROW_HEIGHT }}
      className={cn(
        "group flex items-center gap-2 rounded-lg px-2 transition-colors",
        current ? "bg-accent" : "hover:bg-accent/60",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onJump(track.id)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
      >
        <Artwork track={track} size={36} />
        <span className="min-w-0">
          <span className={cn("block truncate text-sm", current && "text-brand")}>
            {track.title}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {track.artists[0]?.name}
          </span>
        </span>
      </button>
      {onRemove && (
        <IconButton
          label="Remove from queue"
          onClick={() => onRemove(track.id)}
          size="icon-xs"
          className="opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
        >
          <IconX size={14} stroke={2} />
        </IconButton>
      )}
    </div>
  );
}
