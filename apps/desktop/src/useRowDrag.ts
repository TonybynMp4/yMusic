import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

/** How close to the list's top or bottom edge a drag starts scrolling it. */
const SCROLL_EDGE = 40;

/** A drag in progress: the row picked up, and where it would land now. */
export interface Drag {
  from: number;
  to: number;
}

/** The row shown at `position` while a drag holds `from` over `to`. */
export function sourceOf(position: number, drag: Drag | null): number {
  if (!drag) return position;
  const { from, to } = drag;
  if (position === to) return from;
  if (from < to && position >= from && position < to) return position + 1;
  if (to < from && position > to && position <= from) return position - 1;
  return position;
}

/** Where the row at `source` is drawn while a drag holds `from` over `to`. */
export function positionOf(source: number, drag: Drag | null): number {
  if (!drag) return source;
  const { from, to } = drag;
  if (source === from) return to;
  if (from < to && source > from && source <= to) return source - 1;
  if (to < from && source >= to && source < from) return source + 1;
  return source;
}

/**
 * Reordering rows of one fixed height by dragging, for the queue and for your
 * own playlists. The rows reorder as the pointer moves, and the move happens
 * on release. Listening on the window rather than capturing the pointer keeps
 * the drag alive when its row is re-rendered elsewhere or scrolled out of the
 * list. Escape drops it where it started.
 *
 * `rows` is how many of the list's rows can be dragged, from the top.
 */
export function useRowDrag(
  scroller: HTMLElement | null,
  rowHeight: number,
  rows: number,
  onMove: (from: number, to: number) => void,
): { drag: Drag | null; startDrag: (from: number, event: ReactPointerEvent) => void } {
  const [drag, setDrag] = useState<Drag | null>(null);
  /** Ends the drag in progress without moving anything. */
  const cancelDrag = useRef<() => void>(() => {});
  useEffect(() => () => cancelDrag.current(), []);

  const startDrag = (from: number, event: ReactPointerEvent) => {
    if (event.button !== 0 || !scroller) return;
    event.preventDefault();
    const last = rows - 1;
    const start = event.clientY + scroller.scrollTop;
    let pointer = event.clientY;
    let to = from;
    const update = () => {
      const offset = pointer + scroller.scrollTop - start;
      to = Math.min(last, Math.max(0, from + Math.round(offset / rowHeight)));
      setDrag((previous) => (previous?.to === to ? previous : { from, to }));
    };
    // Held near an edge, the list scrolls that way, faster the closer it gets.
    let frame = 0;
    const scroll = () => {
      const { top, bottom } = scroller.getBoundingClientRect();
      const speed =
        pointer < top + SCROLL_EDGE
          ? pointer - (top + SCROLL_EDGE)
          : pointer > bottom - SCROLL_EDGE
            ? pointer - (bottom - SCROLL_EDGE)
            : 0;
      if (speed !== 0) {
        scroller.scrollTop += speed / 3;
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

  return { drag, startDrag };
}
