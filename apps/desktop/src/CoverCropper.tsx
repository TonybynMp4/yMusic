import { IconZoomIn, IconZoomOut } from "@tabler/icons-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Cropper, { type Point, type Size } from "react-easy-crop";

import { Slider } from "@/components/ui/slider";
import { MIN_SIDE, type Crop, type Picked } from "./cover.ts";

/**
 * YouTube Music's "Edit Thumbnail" step, drawn like Origin UI's cropper: a
 * fixed square over the picked image, which moves and zooms under it. Drag or
 * scroll with two fingers to move it; pinch, Ctrl+wheel or the slider zoom.
 * It takes focus on opening, so the keyboard works at once: the arrow keys
 * move the square over the image (Shift for finer steps), + and - zoom, 0
 * starts over and Enter calls `onDone`. Opens on `initial` when given, as when
 * a cover is cropped again. Reports the square in the image's own pixels.
 */
export function CoverCropper({
  picked,
  initial,
  onCrop,
  onDone,
}: {
  picked: Picked;
  initial?: Crop | undefined;
  onCrop: (crop: Crop) => void;
  onDone: () => void;
}) {
  const { url, width, height } = picked;
  // Zoomed in no further than leaves the square at the smallest YouTube takes.
  const maxZoom = Math.min(width, height) / MIN_SIDE;
  // One state for both, as a move is clamped by the zoom: an update reads the
  // latest of each, so events that come between renders add up.
  const [{ position, zoom }, setView] = useState<View>(START);
  // Whether the square is on screen yet. It is what takes focus.
  const [drawn, setDrawn] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  /** The image and the square as last laid out, in screen pixels. */
  const sizes = useRef<{ media: Size | null; square: Size | null }>({ media: null, square: null });

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      // Chromium (Windows) reports a pinch as a wheel with Ctrl held, which the
      // cropper zooms with itself.
      if (event.ctrlKey) return;
      // Not passive, so the dialog does not scroll instead.
      event.preventDefault();
      // A mouse wheel counts in lines, a touchpad in pixels.
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
      // The image goes the other way to the square it replaces, whose sideways
      // direction was flipped to follow the fingers.
      const [dx, dy] = [event.deltaX * unit, -event.deltaY * unit];
      // Copied here: an updater can run during render, which reads no refs.
      const laid = { ...sizes.current };
      setView((from) => movedBy(from, laid, dx, dy));
    };
    // On Linux a pinch comes from the app's shell instead, as the scale since
    // it began (platform/window.rs).
    let begun = 1;
    const pinch = (event: Event) => {
      const spread = (event as CustomEvent<number>).detail;
      // oxlint-disable-next-line react/immutability -- a local of the effect, never read in render
      if (spread === 1) begun = 1;
      const ratio = spread / begun;
      begun = spread;
      setView((from) => ({ ...from, zoom: Math.min(Math.max(from.zoom * ratio, 1), maxZoom) }));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("touchpadpinch", pinch);
    return () => {
      element.removeEventListener("wheel", wheel);
      window.removeEventListener("touchpadpinch", pinch);
    };
  }, [maxZoom]);

  useEffect(() => {
    if (drawn) box.current?.querySelector<HTMLElement>(".reactEasyCrop_CropArea")?.focus();
  }, [drawn]);

  const setPosition = (next: Point) => setView((from) => ({ ...from, position: next }));
  const zoomTo = (next: number) =>
    setView((from) => ({ ...from, zoom: Math.min(Math.max(next, 1), maxZoom) }));
  // In place of the cropper's own, which moves the image the way the arrow
  // points and so the square the other way.
  const keys = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 2 : 10;
    const arrow = ARROWS[event.key];
    if (arrow) {
      const laid = { ...sizes.current };
      setView((from) => movedBy(from, laid, -arrow[0] * step, -arrow[1] * step));
    } else if (event.key === "Enter") {
      // Held down, it would finish the crop again on every repeat.
      if (!event.repeat) onDone();
    } else if (event.key === "+" || event.key === "=") zoomTo(zoom * 1.1);
    else if (event.key === "-") zoomTo(zoom / 1.1);
    else if (event.key === "0") setView(START);
    else return;
    event.preventDefault();
  };

  return (
    <div data-slot="cover-cropper" className="flex flex-col gap-4">
      <div
        ref={box}
        className="relative h-[28rem] w-full overflow-hidden rounded-md has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
      >
        <Cropper
          image={url}
          crop={position}
          zoom={zoom}
          aspect={1}
          minZoom={1}
          maxZoom={maxZoom}
          onCropChange={setPosition}
          onZoomChange={zoomTo}
          onWheelRequest={(event) => event.ctrlKey}
          // On every layout, not only on load: the dialog widens once the
          // cropper is in it, and the image is shown larger after.
          setMediaSize={(media) => (sizes.current.media = media)}
          onCropSizeChange={(square) => {
            sizes.current.square = square;
            setDrawn(true);
          }}
          // Moving it only reports the change; zooming reports it complete.
          onCropAreaChange={(_, area) => onCrop({ x: area.x, y: area.y, size: area.width })}
          onCropComplete={(_, area) => onCrop({ x: area.x, y: area.y, size: area.width })}
          {...(initial && {
            initialCroppedAreaPixels: {
              x: initial.x,
              y: initial.y,
              width: initial.size,
              height: initial.size,
            },
          })}
          classes={{ cropAreaClassName: "outline-none" }}
          cropperProps={{ "aria-label": "Image crop", onKeyDown: keys }}
          // Inline, as the cropper's own stylesheet outranks Tailwind's layers.
          style={{
            cropAreaStyle: {
              border: "3px solid white",
              boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.3)",
            },
          }}
        />
      </div>
      <div className="flex items-center gap-3 px-1 text-muted-foreground">
        <IconZoomOut className="size-4 shrink-0" aria-hidden />
        <Slider
          aria-label="Zoom"
          min={1}
          max={maxZoom}
          step={0.01}
          value={zoom}
          disabled={maxZoom <= 1}
          onValueChange={(value) => zoomTo(Array.isArray(value) ? value[0]! : value)}
        />
        <IconZoomIn className="size-4 shrink-0" aria-hidden />
      </div>
    </div>
  );
}

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Where the image sits under the square, and how far it is zoomed in. */
interface View {
  position: Point;
  zoom: number;
}

const START: View = { position: { x: 0, y: 0 }, zoom: 1 };

/**
 * The view with the image moved by `dx`, `dy`, kept covering the square.
 * Unchanged before the image has loaded.
 */
function movedBy(
  view: View,
  { media, square }: { media: Size | null; square: Size | null },
  dx: number,
  dy: number,
): View {
  if (!media || !square) return view;
  const reach = (side: number, inner: number) => Math.max(0, (side * view.zoom - inner) / 2);
  return {
    ...view,
    position: {
      x: clamp(view.position.x + dx, reach(media.width, square.width)),
      y: clamp(view.position.y + dy, reach(media.height, square.height)),
    },
  };
}

function clamp(value: number, reach: number): number {
  return Math.min(Math.max(value, -reach), reach);
}
