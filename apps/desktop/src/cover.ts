/**
 * A picked image turned into what YouTube Music takes as a playlist cover.
 *
 * YouTube Music's own editor crops to a square, refuses files over 15 MB and
 * crops under 360 pixels a side, and uploads the crop as a JPEG. This one
 * takes the centred square rather than offering a crop handle.
 */
const MAX_BYTES = 15 * 1024 * 1024;
const MIN_SIDE = 360;
/** Larger than YouTube serves any cover, so nothing is lost by scaling down to it. */
const MAX_SIDE = 1200;

export interface Cover {
  image: Uint8Array<ArrayBuffer>;
  /** An object URL for the preview; revoke it when done. */
  url: string;
}

export async function squareCover(file: File): Promise<Cover> {
  if (file.size > MAX_BYTES) throw new Error("Try a file that's 15 MB or smaller");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Couldn't open that image, try another one");
  }
  const crop = Math.min(bitmap.width, bitmap.height);
  if (crop < MIN_SIDE) {
    bitmap.close();
    throw new Error(`Images must be at least ${MIN_SIDE} x ${MIN_SIDE} pixels`);
  }
  const side = Math.min(crop, MAX_SIDE);
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Couldn't open that image, try another one");
  context.drawImage(
    bitmap,
    (bitmap.width - crop) / 2,
    (bitmap.height - crop) / 2,
    crop,
    crop,
    0,
    0,
    side,
    side,
  );
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.92),
  );
  if (!blob) throw new Error("Couldn't open that image, try another one");
  return {
    image: new Uint8Array(await blob.arrayBuffer()),
    url: URL.createObjectURL(blob),
  };
}
