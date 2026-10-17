import { useRef, type KeyboardEvent, type PointerEvent } from "react";

import { cn } from "@/lib/utils";
import { moveCrop, resizeCrop, type Corner, type Crop, type Picked } from "./cover.ts";

/** The longest side the image is shown at while cropping, in CSS pixels. */
const VIEW = 384;

// Inside the square, so they stay whole when it reaches the image's edge.
const CORNERS: { corner: Corner; label: string; className: string }[] = [
  {
    corner: "nw",
    label: "Top left corner of image crop",
    className: "top-0 left-0 border-t-4 border-l-4 cursor-nwse-resize",
  },
  {
    corner: "ne",
    label: "Top right corner of image crop",
    className: "top-0 right-0 border-t-4 border-r-4 cursor-nesw-resize",
  },
  {
    corner: "sw",
    label: "Bottom left corner of image crop",
    className: "bottom-0 left-0 border-b-4 border-l-4 cursor-nesw-resize",
  },
  {
    corner: "se",
    label: "Bottom right corner of image crop",
    className: "right-0 bottom-0 border-r-4 border-b-4 cursor-nwse-resize",
  },
];

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * YouTube Music's "Edit Thumbnail" step: the picked image with a square over
 * it, dragged to move and by its corners to resize. Arrow keys do the same on
 * the focused square or corner, Shift for bigger steps.
 */
export function CoverCropper({
  picked,
  crop,
  onCrop,
}: {
  picked: Picked;
  crop: Crop;
  onCrop: (crop: Crop) => void;
}) {
  const { width, height } = picked;
  const scale = Math.min(VIEW / width, VIEW / height);
  // Where a drag started, so each move is measured from there rather than
  // adding up rounding from every event.
  const drag = useRef<{ x: number; y: number; crop: Crop; corner: Corner | null } | null>(null);

  const change = (from: Crop, corner: Corner | null, dx: number, dy: number) =>
    onCrop(
      corner
        ? resizeCrop(from, corner, dx, dy, width, height)
        : moveCrop(from, dx, dy, width, height),
    );

  const start = (corner: Corner | null) => (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, crop, corner };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const from = drag.current;
    if (!from) return;
    change(
      from.crop,
      from.corner,
      (event.clientX - from.x) / scale,
      (event.clientY - from.y) / scale,
    );
  };
  const end = () => {
    drag.current = null;
  };
  const key = (corner: Corner | null) => (event: KeyboardEvent<HTMLElement>) => {
    const arrow = ARROWS[event.key];
    if (!arrow) return;
    event.preventDefault();
    event.stopPropagation();
    const step = Math.max(width, height) * (event.shiftKey ? 0.05 : 0.01);
    change(crop, corner, arrow[0] * step, arrow[1] * step);
  };
  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };

  return (
    <div
      className="relative mx-auto touch-none overflow-hidden rounded-md select-none"
      style={{ width: width * scale, height: height * scale }}
    >
      <img src={picked.url} alt="" draggable={false} className="size-full" />
      <div
        role="group"
        aria-label="Image crop"
        tabIndex={0}
        className="absolute cursor-move outline-2 -outline-offset-2 outline-white shadow-[0_0_0_9999px_rgb(0_0_0/0.6)] focus-visible:outline-primary"
        style={{
          left: crop.x * scale,
          top: crop.y * scale,
          width: crop.size * scale,
          height: crop.size * scale,
        }}
        onPointerDown={start(null)}
        onKeyDown={key(null)}
        {...handlers}
      >
        {CORNERS.map(({ corner, label, className }) => (
          <span
            key={corner}
            role="button"
            aria-label={label}
            tabIndex={0}
            className={cn(
              "absolute size-5 border-white outline-none focus-visible:border-primary",
              className,
            )}
            onPointerDown={start(corner)}
            onKeyDown={key(corner)}
            {...handlers}
          />
        ))}
      </div>
    </div>
  );
}
