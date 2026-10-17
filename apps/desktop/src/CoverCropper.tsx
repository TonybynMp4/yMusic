import { useEffect, useRef } from "react";
import type { PercentCrop } from "react-image-crop";

import { ImageCrop, ImageCropContent } from "@/components/kibo-ui/image-crop";
import {
  MIN_SIDE,
  moveCrop,
  zoomCrop,
  type Crop,
  type Picked,
} from "./cover.ts";

/** The longest side the image is shown at while cropping, in CSS pixels. */
const VIEW = 384;

// YouTube Music's labels for the corners; the sides keep theirs in the same words.
const LABELS = {
  cropArea: "Image crop",
  nwDragHandle: "Top left corner of image crop",
  nDragHandle: "Top edge of image crop",
  neDragHandle: "Top right corner of image crop",
  eDragHandle: "Right edge of image crop",
  seDragHandle: "Bottom right corner of image crop",
  sDragHandle: "Bottom edge of image crop",
  swDragHandle: "Bottom left corner of image crop",
  wDragHandle: "Left edge of image crop",
};

/**
 * YouTube Music's "Edit Thumbnail" step: the picked image with a square over
 * it, dragged to move and by its handles to resize (Kibo UI's image crop).
 * On a touchpad, scrolling with two fingers moves it and pinching resizes it.
 * `crop` is in the image's own pixels, held by the caller.
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
  // The crop library works on the image as shown, so the limit is scaled to it.
  const min = MIN_SIDE * scale;
  const box = useRef<HTMLDivElement>(null);
  // The listener is added once, so it reads the latest of these through a ref.
  const latest = useRef({ crop, onCrop });
  latest.current = { crop, onCrop };

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      // Not passive, so neither the dialog scrolls nor (on a pinch) the page zooms.
      event.preventDefault();
      const now = latest.current;
      // A mouse wheel counts in lines, a touchpad in pixels.
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
      const dx = event.deltaX * unit;
      const dy = event.deltaY * unit;
      // Browsers report a pinch as a wheel with Ctrl held.
      const next = event.ctrlKey
        ? zoomCrop(now.crop, Math.exp(dy * 0.01), width, height)
        : moveCrop(now.crop, dx / scale, dy / scale, width, height);
      // Several can come before a render, and each builds on the last.
      now.crop = next;
      now.onCrop(next);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [width, height, scale]);

  const percent: PercentCrop = {
    unit: "%",
    x: (crop.x / width) * 100,
    y: (crop.y / height) * 100,
    width: (crop.size / width) * 100,
    height: (crop.size / height) * 100,
  };
  return (
    <div ref={box}>
      <ImageCrop
        file={picked.file}
        aspect={1}
        keepSelection
        minWidth={min}
        minHeight={min}
        ariaLabels={LABELS}
        crop={percent}
        onChange={(_, next) =>
          onCrop({
            x: (next.x / 100) * width,
            y: (next.y / 100) * height,
            size: (next.width / 100) * width,
          })
        }
      >
        <ImageCropContent
          className="mx-auto max-h-none"
          style={{ width: width * scale, height: height * scale }}
        />
      </ImageCrop>
    </div>
  );
}
