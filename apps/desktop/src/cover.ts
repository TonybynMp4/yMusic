/**
 * A picked image turned into what YouTube Music takes as a playlist cover.
 *
 * YouTube Music's own editor refuses files over 15 MB and images under 360
 * pixels a side, lets you place a square crop no smaller than that, and
 * uploads the crop as a JPEG. This does the same.
 */
const MAX_BYTES = 15 * 1024 * 1024;
export const MIN_SIDE = 360;
/** Larger than YouTube serves any cover, so nothing is lost by scaling down to it. */
const MAX_SIDE = 1200;

/** A picked image, ready to crop. Release it with `closePicked` when done. */
export interface Picked {
  bitmap: ImageBitmap;
  /** An object URL of the file, to show while cropping. */
  url: string;
  width: number;
  height: number;
}

/** A square within the image, in the image's own pixels. */
export interface Crop {
  x: number;
  y: number;
  size: number;
}

export interface Cover {
  image: Uint8Array<ArrayBuffer>;
  /** An object URL for the preview; revoke it when done. */
  url: string;
}

/**
 * Whether `thumbnails` are a cover someone uploaded rather than the one YouTube
 * makes from the songs. YouTube serves uploaded covers from their own path.
 */
export function isCustomCover(thumbnails: readonly { url: string }[]): boolean {
  return thumbnails.some(({ url }) => url.includes("/pl_c/"));
}

const UNREADABLE = "Couldn't open that image, try another one";

export async function openImage(file: File): Promise<Picked> {
  if (file.size > MAX_BYTES) throw new Error("Try a file that's 15 MB or smaller");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(UNREADABLE);
  }
  if (Math.min(bitmap.width, bitmap.height) < MIN_SIDE) {
    bitmap.close();
    throw new Error(`Images must be at least ${MIN_SIDE} x ${MIN_SIDE} pixels`);
  }
  const { width, height } = bitmap;
  return { bitmap, url: URL.createObjectURL(file), width, height };
}

export function closePicked(picked: Picked): void {
  picked.bitmap.close();
  URL.revokeObjectURL(picked.url);
}

/** The largest square in the middle, where the crop starts. */
export function centredCrop(width: number, height: number): Crop {
  const size = Math.min(width, height);
  return { x: (width - size) / 2, y: (height - size) / 2, size };
}

/** `crop` moved by `dx`, `dy`, kept inside the image. */
export function moveCrop(crop: Crop, dx: number, dy: number, width: number, height: number): Crop {
  return {
    x: clamp(crop.x + dx, 0, width - crop.size),
    y: clamp(crop.y + dy, 0, height - crop.size),
    size: crop.size,
  };
}

export type Corner = "nw" | "ne" | "sw" | "se";

/**
 * `crop` resized by dragging `corner` by `dx`, `dy`. The opposite corner stays
 * put, the crop stays square, inside the image and no smaller than `MIN_SIDE`.
 */
export function resizeCrop(
  crop: Crop,
  corner: Corner,
  dx: number,
  dy: number,
  width: number,
  height: number,
): Crop {
  const west = corner === "nw" || corner === "sw";
  const north = corner === "nw" || corner === "ne";
  // The corner that stays, and how far the square may grow away from it.
  const anchorX = west ? crop.x + crop.size : crop.x;
  const anchorY = north ? crop.y + crop.size : crop.y;
  const room = Math.min(west ? anchorX : width - anchorX, north ? anchorY : height - anchorY);
  // The square follows whichever way the pointer went further.
  const grow = Math.max(west ? -dx : dx, north ? -dy : dy);
  const size = clamp(crop.size + grow, Math.min(MIN_SIDE, room), room);
  return { x: west ? anchorX - size : anchorX, y: north ? anchorY - size : anchorY, size };
}

export async function cropCover(picked: Picked, crop: Crop): Promise<Cover> {
  const side = Math.round(Math.min(crop.size, MAX_SIDE));
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(UNREADABLE);
  context.drawImage(picked.bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, side, side);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.92),
  );
  if (!blob) throw new Error(UNREADABLE);
  return { image: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
