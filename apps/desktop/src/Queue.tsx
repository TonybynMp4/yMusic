import {
  IconArrowDown,
  IconArrowUp,
  IconGripVertical,
  IconLoader2,
  IconX,
} from "@tabler/icons-react";
import { currentItemIndex, type QueueState, type Track, type TrackId } from "@ymusic/core";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { IconButton } from "@/components/IconButton";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { VirtualList } from "@/components/VirtualList";
import { cn } from "@/lib/utils";
import { InteractionArea, InteractionButton, useDisliked } from "./Interactions.tsx";
import { Artwork } from "./TrackList.tsx";

const ROW_HEIGHT = 48;
/** How close to the list's top or bottom edge a drag starts scrolling it. */
const SCROLL_EDGE = 40;

interface Props {
  queue: QueueState;
  /** The queue's source is still loading, so more tracks are on the way. */
  filling: boolean;
  autoplay: boolean;
  onAutoplay: (on: boolean) => void;
  onJump: (id: TrackId) => void;
  onRemove: (id: TrackId) => void;
  /** Moves the track at playing position `from` to position `to`. */
  onMove: (from: number, to: number) => void;
  onClear: () => void;
}

/** A drag in progress: the row picked up, and where it would land now. */
interface Drag {
  from: number;
  to: number;
}

/** The row shown at `position` while a drag holds `from` over `to`. */
function sourceOf(position: number, drag: Drag | null): number {
  if (!drag) return position;
  const { from, to } = drag;
  if (position === to) return from;
  if (from < to && position >= from && position < to) return position + 1;
  if (to < from && position > to && position <= from) return position - 1;
  return position;
}

/** Where the row at `source` is drawn while a drag holds `from` over `to`. */
function positionOf(source: number, drag: Drag | null): number {
  if (!drag) return source;
  const { from, to } = drag;
  if (source === from) return to;
  if (from < to && source > from && source <= to) return source - 1;
  if (to < from && source >= to && source < from) return source + 1;
  return source;
}

/** Where the playing row is, relative to what the list shows. */
type Away = "above" | "below" | null;

/**
 * Where the row at `position` sits in the viewport. A row cut off by an edge
 * is `clipped`: still in view, so the list counts as following it, but worth
 * scrolling to when a new song lands there.
 */
function placement(viewport: HTMLDivElement, position: number): Away | "clipped" | "visible" {
  const top = position * ROW_HEIGHT;
  const { scrollTop, clientHeight } = viewport;
  if (top + ROW_HEIGHT <= scrollTop) return "above";
  if (top >= scrollTop + clientHeight) return "below";
  if (top < scrollTop || top + ROW_HEIGHT > scrollTop + clientHeight) return "clipped";
  return "visible";
}

/**
 * Keeps the playing row in view, as YouTube Music's queue does. Opening the
 * queue centres it, and when the song changes the list follows, unless you
 * have scrolled away from the old one to look at something else. While it is
 * out of view, `away` says which way it lies, for the button that goes back.
 *
 * `position` is where the playing row is drawn, which a drag can move.
 */
function useFollowPlaying(
  viewport: HTMLDivElement | null,
  position: number | null,
  dragging: boolean,
): { away: Away; reveal: () => void } {
  const [away, setAway] = useState<Away>(null);
  const following = useRef(true);
  /** The list last centred on opening; a new viewport is a queue just opened. */
  const opened = useRef<HTMLDivElement | null>(null);
  /** The position last seen, so only a new one is followed. */
  const previous = useRef<number | null>(null);
  /**
   * A smooth scroll to the playing row is under way. Until it arrives the row
   * reads as out of view, which is not you scrolling away from it.
   */
  const revealing = useRef(false);

  const scrollToPlaying = useCallback(
    (behavior: ScrollBehavior) => {
      if (!viewport || position === null) return;
      revealing.current = behavior === "smooth";
      const top = position * ROW_HEIGHT - (viewport.clientHeight - ROW_HEIGHT) / 2;
      viewport.scrollTo({ top: Math.max(0, top), behavior });
    },
    [viewport, position],
  );

  // A layout effect, so an opening queue is centred before it is painted
  // rather than scrolling in from the top.
  useLayoutEffect(() => {
    if (!viewport || position === null) return;
    const measure = () => {
      const where = placement(viewport, position);
      const next = where === "above" || where === "below" ? where : null;
      if (revealing.current) {
        if (next !== null) return;
        revealing.current = false;
      }
      setAway(next);
      following.current = next === null;
    };
    const moved = previous.current !== position;
    previous.current = position;
    if (opened.current !== viewport) {
      opened.current = viewport;
      scrollToPlaying("instant");
    }
    // A new song that has slipped out of view is brought back, unless the
    // old one was out of view too: then you were reading the list.
    else if (moved && following.current && !dragging) {
      if (placement(viewport, position) !== "visible") scrollToPlaying("smooth");
    }
    measure();
    // Scrolling by hand cuts a smooth scroll short, so stop waiting for it.
    const interrupt = () => {
      revealing.current = false;
    };
    viewport.addEventListener("scroll", measure, { passive: true });
    viewport.addEventListener("wheel", interrupt, { passive: true });
    viewport.addEventListener("pointerdown", interrupt);
    viewport.addEventListener("keydown", interrupt);
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => {
      viewport.removeEventListener("scroll", measure);
      viewport.removeEventListener("wheel", interrupt);
      viewport.removeEventListener("pointerdown", interrupt);
      viewport.removeEventListener("keydown", interrupt);
      observer.disconnect();
    };
  }, [viewport, position, dragging, scrollToPlaying]);

  return {
    away: position === null ? null : away,
    reveal: () => scrollToPlaying("smooth"),
  };
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
export function Queue({
  queue,
  filling,
  autoplay,
  onAutoplay,
  onJump,
  onRemove,
  onMove,
  onClear,
}: Props) {
  const current = currentItemIndex(queue);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** Ends the drag in progress without moving anything. */
  const cancelDrag = useRef<() => void>(() => {});
  useEffect(() => () => cancelDrag.current(), []);
  const playing = useFollowPlaying(
    viewport,
    queue.cursor === null ? null : positionOf(queue.cursor, drag),
    drag !== null,
  );

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

  // The rows reorder as the pointer moves, and the move happens on release.
  // Listening on the window rather than capturing the pointer keeps the drag
  // alive when its row is re-rendered elsewhere or scrolled out of the list.
  const startDrag = (from: number, event: ReactPointerEvent) => {
    if (event.button !== 0 || !viewport) return;
    event.preventDefault();
    const last = queued - 1;
    const start = event.clientY + viewport.scrollTop;
    let pointer = event.clientY;
    let to = from;
    const update = () => {
      const offset = pointer + viewport.scrollTop - start;
      to = Math.min(last, Math.max(0, from + Math.round(offset / ROW_HEIGHT)));
      setDrag((previous) => (previous?.to === to ? previous : { from, to }));
    };
    // Held near an edge, the list scrolls that way, faster the closer it gets.
    let frame = 0;
    const scroll = () => {
      const { top, bottom } = viewport.getBoundingClientRect();
      const speed =
        pointer < top + SCROLL_EDGE
          ? pointer - (top + SCROLL_EDGE)
          : pointer > bottom - SCROLL_EDGE
            ? pointer - (bottom - SCROLL_EDGE)
            : 0;
      if (speed !== 0) {
        viewport.scrollTop += speed / 3;
        update();
      }
      frame = requestAnimationFrame(scroll);
    };
    const onPointerMove = (e: PointerEvent) => {
      pointer = e.clientY;
      update();
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.cursor = "";
      cancelDrag.current = () => {};
      setDrag(null);
    };
    const onPointerUp = () => {
      stop();
      if (to !== from) onMove(from, to);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("keydown", onKeyDown);
    document.body.style.cursor = "grabbing";
    cancelDrag.current = stop;
    setDrag({ from, to });
    frame = requestAnimationFrame(scroll);
  };

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

      <div className="relative min-h-0 flex-1">
        <ScrollArea viewportRef={setViewport} className="h-full">
          {/* Queue order, not library order: `order` is the permutation that
              shuffle rewrites, so rendering it directly keeps the list honest. */}
          {viewport && (
            <VirtualList
              count={count}
              scroller={viewport}
              rowHeight={ROW_HEIGHT}
              getKey={(position) =>
                position < queued
                  ? `${position}:${queue.order[sourceOf(position, drag)]}`
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
                  return <Row track={track} onJump={onJump} suggestion />;
                }
                const source = sourceOf(position, drag);
                const itemIndex = queue.order[source]!;
                const track = queue.items[itemIndex];
                if (!track) return null;
                return (
                  <Row
                    track={track}
                    current={itemIndex === current}
                    onJump={onJump}
                    onRemove={onRemove}
                    onDragStart={(event) => startDrag(source, event)}
                    dragging={drag?.from === source}
                    className={cn(drag && "pointer-events-none")}
                  />
                );
              }}
            />
          )}
        </ScrollArea>
        {/* Hidden during a drag, which uses the list's edges to scroll. */}
        {playing.away && !drag && (
          <Button
            variant="secondary"
            size="sm"
            onClick={playing.reveal}
            className={cn(
              "absolute left-1/2 -translate-x-1/2 rounded-full shadow-lg",
              playing.away === "above" ? "top-2" : "bottom-2",
            )}
          >
            {playing.away === "above" ? <IconArrowUp /> : <IconArrowDown />}
            Now playing
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({
  track,
  current = false,
  onJump,
  onRemove,
  onDragStart,
  dragging = false,
  suggestion = false,
  className,
}: {
  track: Track;
  current?: boolean;
  onJump: (id: TrackId) => void;
  onRemove?: (id: TrackId) => void;
  onDragStart?: (event: ReactPointerEvent) => void;
  /** Picked up and following the pointer. */
  dragging?: boolean;
  /** An autoplay suggestion, faded unless hovered. A disliked one fades as far as a queued one does. */
  suggestion?: boolean;
  className?: string;
}) {
  const remove = onRemove && (() => onRemove(track.id));
  const dimmed = useDisliked(track) && !current;
  return (
    <InteractionArea
      subject={{ kind: "song", track, ...(remove && { onRemove: remove }) }}
      style={{ height: ROW_HEIGHT }}
      className={cn(
        "group flex items-center gap-2 rounded-lg px-2 transition-colors",
        current ? "bg-accent" : "hover:bg-accent/60",
        dragging && "bg-accent shadow-lg ring-1 ring-foreground/10",
        suggestion && !dimmed && "opacity-70 hover:opacity-100",
        className,
      )}
    >
      {onDragStart && (
        <span
          aria-hidden
          onPointerDown={onDragStart}
          className={cn(
            "-mx-1 grid h-full w-5 shrink-0 cursor-grab touch-none place-items-center text-muted-foreground opacity-0 group-hover:opacity-100",
            dragging && "opacity-100",
          )}
        >
          <IconGripVertical size={14} stroke={1.75} />
        </span>
      )}
      <button
        type="button"
        onClick={() => onJump(track.id)}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 text-left outline-none",
          dimmed && "opacity-40",
        )}
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
      <InteractionButton
        subject={{ kind: "song", track, ...(remove && { onRemove: remove }) }}
        size="icon-xs"
        className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 data-popup-open:opacity-100"
      />
      {remove && (
        <IconButton
          label="Remove from queue"
          onClick={remove}
          size="icon-xs"
          className="opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
        >
          <IconX size={14} stroke={2} />
        </IconButton>
      )}
    </InteractionArea>
  );
}
