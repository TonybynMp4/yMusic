import type { LocalTrack } from "@ymusic/ipc";

/**
 * The local files whose artist or album artist is `name`, ignoring case and
 * accents, in album order. A tag naming several artists ("A, B", "A feat. B",
 * "A & B") counts for each of them as well as for the whole.
 */
export function localByArtist(local: readonly LocalTrack[], name: string): LocalTrack[] {
  const wanted = normalize(name);
  if (wanted === "") return [];
  const credits = (tag: string | null | undefined) =>
    tag != null && (normalize(tag) === wanted || splitArtists(tag).includes(wanted));
  return local
    .filter((track) => track.artists.some((a) => credits(a.name)) || credits(track.albumArtist))
    .toSorted(
      (a, b) =>
        collator.compare(a.album ?? "", b.album ?? "") ||
        (a.discNumber ?? 0) - (b.discNumber ?? 0) ||
        (a.trackNumber ?? 0) - (b.trackNumber ?? 0) ||
        collator.compare(a.title, b.title),
    );
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

function normalize(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** The names in a tag that credits several artists, normalized. */
function splitArtists(tag: string): string[] {
  return normalize(tag)
    .split(/\s*(?:[,;/&]|\bfeat\.?|\bft\.|\bfeaturing\b)\s*/)
    .filter(Boolean);
}
