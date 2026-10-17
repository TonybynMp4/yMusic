import type { PercentCrop } from "react-image-crop";

import { ImageCrop, ImageCropContent } from "@/components/kibo-ui/image-crop";
import { MIN_SIDE, type Crop, type Picked } from "./cover.ts";

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
  const percent: PercentCrop = {
    unit: "%",
    x: (crop.x / width) * 100,
    y: (crop.y / height) * 100,
    width: (crop.size / width) * 100,
    height: (crop.size / height) * 100,
  };
  return (
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
  );
}
