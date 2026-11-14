import * as React from "react";
import { cn } from "@/lib/utils";

/** The thumb never shrinks below this, so a list of thousands keeps one to grab. */
const MIN_THUMB = 24;

/**
 * The browser's own scrolling, with a thumb of our own beside it. Base UI's
 * scroll area set CSS variables on the scrolled element on every scroll event,
 * which restyled everything inside it: a fast scroll through a long playlist
 * ran at a few frames a second. WebKitGTK's scrollbar, styled or not, vanished
 * while scrolling. This thumb sits outside the scrolled element, and a scroll
 * writes only its own position.
 */
function ScrollArea({
  className,
  viewportRef,
  ...props
}: React.ComponentProps<"div"> & {
  /** The element that actually scrolls, for virtualized lists and scroll restoration. */
  viewportRef?: React.Ref<HTMLDivElement>;
}) {
  const viewport = React.useRef<HTMLDivElement | null>(null);
  const track = React.useRef<HTMLDivElement>(null);
  const thumb = React.useRef<HTMLDivElement>(null);
  const setViewport = React.useCallback(
    (element: HTMLDivElement | null) => {
      viewport.current = element;
      if (typeof viewportRef === "function") return viewportRef(element);
      if (viewportRef) viewportRef.current = element;
    },
    [viewportRef],
  );

  /** Where the thumb sits and how tall it is, for the scroll position now. */
  const geometry = React.useCallback(() => {
    const { scrollTop, scrollHeight, clientHeight } = viewport.current!;
    const height = Math.max(MIN_THUMB, (clientHeight * clientHeight) / scrollHeight);
    const room = clientHeight - height;
    const range = scrollHeight - clientHeight;
    return { height, room, range, top: range > 0 ? (scrollTop / range) * room : 0 };
  }, []);

  React.useLayoutEffect(() => {
    const element = viewport.current;
    const rail = track.current;
    const bar = thumb.current;
    if (!element || !rail || !bar) return;
    const update = () => {
      const { height, range, top } = geometry();
      // The whole track goes, not just the thumb: it sits over the content's edge.
      rail.style.display = range > 0 ? "" : "none";
      bar.style.height = `${height}px`;
      bar.style.transform = `translateY(${top}px)`;
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    // The content grows as a long playlist arrives, and the pane resizes with the window.
    const resized = new ResizeObserver(update);
    const watch = () => {
      resized.disconnect();
      resized.observe(element);
      for (const child of element.children) resized.observe(child);
    };
    watch();
    const children = new MutationObserver(watch);
    children.observe(element, { childList: true });
    return () => {
      element.removeEventListener("scroll", update);
      resized.disconnect();
      children.disconnect();
    };
  }, [geometry]);

  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = viewport.current;
    if (!element || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const bar = event.currentTarget;
    bar.setPointerCapture(event.pointerId);
    const { room, range } = geometry();
    const startY = event.clientY;
    const startTop = element.scrollTop;
    const move = (moved: PointerEvent) => {
      element.scrollTop = startTop + ((moved.clientY - startY) * range) / Math.max(room, 1);
    };
    const end = () => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", end);
      bar.removeEventListener("pointercancel", end);
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", end);
    bar.addEventListener("pointercancel", end);
  };

  /** A press on the track jumps a page toward the pointer, as a native scrollbar does. */
  const page = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = viewport.current;
    if (!element || event.button !== 0) return;
    const above = event.clientY < thumb.current!.getBoundingClientRect().top;
    element.scrollBy({ top: (above ? -1 : 1) * element.clientHeight * 0.9 });
  };

  return (
    <div data-slot="scroll-area" className={cn("relative flex flex-col", className)}>
      <div
        ref={setViewport}
        className="no-scrollbar min-h-0 flex-1 overflow-auto outline-none"
        {...props}
      />
      <div
        ref={track}
        aria-hidden
        className="absolute inset-y-0 right-0 w-2.5"
        onPointerDown={page}
      >
        <div
          ref={thumb}
          onPointerDown={drag}
          className="absolute inset-x-0.5 top-0 rounded-full bg-border transition-colors hover:bg-muted-foreground/50 active:bg-muted-foreground/50"
        />
      </div>
    </div>
  );
}

export { ScrollArea };
