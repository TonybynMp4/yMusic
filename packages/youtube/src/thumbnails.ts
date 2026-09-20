import { Thumbnail } from "@ytbm/core";

/**
 * Google serves cover art from URLs that encode the size in the path, like
 * `...=w120-h120-l90-rj`. Search only ever offers 120px, which looks soft the
 * moment it is used for anything larger than a list row, so the size is
 * rewritten to ask for what the UI actually wants. The original is kept as the
 * smallest entry, because a rewritten URL is a guess about somebody else's CDN
 * and the un-rewritten one is known to work.
 */
const SIZE_PATTERN = /=w\d+-h\d+/;
const PREFERRED_SIZE = 544;

export interface RawThumbnail {
  url?: unknown;
  width?: unknown;
  height?: unknown;
}

export function toThumbnails(raw: readonly RawThumbnail[] | undefined): Thumbnail[] {
  const parsed: Thumbnail[] = [];
  for (const candidate of raw ?? []) {
    const result = Thumbnail.safeParse(candidate);
    // A thumbnail is decoration. One malformed entry should cost that entry,
    // not the whole search result it was attached to.
    if (result.success) parsed.push(result.data);
  }
  if (parsed.length === 0) return [];

  const largest = parsed.reduce((a, b) => (b.width > a.width ? b : a));
  const upgraded = upgrade(largest);
  return upgraded ? [upgraded, ...parsed] : parsed;
}

function upgrade(thumbnail: Thumbnail): Thumbnail | null {
  if (thumbnail.width >= PREFERRED_SIZE) return null;
  if (!SIZE_PATTERN.test(thumbnail.url)) return null;
  return {
    url: thumbnail.url.replace(SIZE_PATTERN, `=w${PREFERRED_SIZE}-h${PREFERRED_SIZE}`),
    width: PREFERRED_SIZE,
    height: PREFERRED_SIZE,
  };
}
