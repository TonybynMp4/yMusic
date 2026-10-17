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
  file: File;
  bitmap: ImageBitmap;
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
  return { file, bitmap, width, height };
}

export function closePicked(picked: Picked): void {
  picked.bitmap.close();
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

/**
 * `crop` scaled by `factor` about its centre, no smaller than `MIN_SIDE` and
 * no larger than the image, then moved back inside it if it spilled over.
 */
export function zoomCrop(crop: Crop, factor: number, width: number, height: number): Crop {
  const largest = Math.min(width, height);
  const size = clamp(crop.size * factor, Math.min(MIN_SIDE, largest), largest);
  const shift = (crop.size - size) / 2;
  return moveCrop({ x: crop.x + shift, y: crop.y + shift, size }, 0, 0, width, height);
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
