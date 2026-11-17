import type { Thumbnail, VideoId } from "./domain.ts";

/**
 * A radio tuned the way YouTube Music's radio builder and its queue chips tune
 * one. YouTube names such a radio by a playlist id of its own (`RDAT…`) that
 * spells out the seeds and the tuning, so any combination can be built here
 * and played as a mix. See `docs/radio.md`.
 */
export interface RadioTuning {
  /**
   * Artists, by the Knowledge Graph id YouTube keys them on without its
   * `/m/` or `/g/` prefix (`07c0j` for The Beatles, `11hfhf66_d`).
   */
  artists: readonly string[];
  songs: readonly VideoId[];
  /** How much the radio strays from songs the listener already knows. */
  discovery: "familiar" | "blend" | "discover";
  /** How many other artists it brings in. */
  variety: "low" | "medium" | "high";
  filter: "popular" | "deepCuts" | "latest" | null;
  mood: "pumpUp" | "chill" | "upbeat" | "downbeat" | "focus" | null;
}

export const defaultTuning: Omit<RadioTuning, "artists" | "songs"> = {
  discovery: "blend",
  variety: "medium",
  filter: null,
  mood: null,
};

/** The most seeds YouTube Music's radio builder takes. */
export const maxRadioSeeds = 30;

const moods = { pumpUp: "mY", chill: "mX", upbeat: "mb", downbeat: "mc", focus: "ma" } as const;
const filters = { latest: "dX", popular: "pY", deepCuts: "pX" } as const;
const discovery = { familiar: "iY", blend: "", discover: "iX" } as const;
const variety = { low: "rX", medium: "", high: "rZ" } as const;

/**
 * The playlist id of a tuned radio, or null with no seeds.
 *
 * The modifiers come first, in the order YouTube itself writes them (it
 * answers an empty radio for any other), and the defaults are left out. Then
 * the artists, the first as `a<id>` and each further one as `I<id>`, closed by
 * `E`; then each song as `v<videoId>`. An id 13 characters long takes a
 * closing `z`, as YouTube's own do (`RDATpYa0kr_tEz`): YouTube reads `RD` and
 * 11 characters as the radio of a video, so without it the radio is another
 * one, or empty. A `z` on any other id empties the radio.
 */
export function radioId(tuning: RadioTuning): string | null {
  if (tuning.artists.length === 0 && tuning.songs.length === 0) return null;
  let body =
    (tuning.mood ? moods[tuning.mood] : "") +
    (tuning.filter ? filters[tuning.filter] : "") +
    discovery[tuning.discovery] +
    variety[tuning.variety];
  if (tuning.artists.length > 0) {
    body += tuning.artists.map((id, i) => (i === 0 ? "a" : "I") + id).join("") + "E";
  }
  const id = `RDAT${body}${tuning.songs.map((song) => `v${song}`).join("")}`;
  return id.length === 13 ? `${id}z` : id;
}

/**
 * The seeds and tuning a tuned radio's id spells out, the reverse of
 * {@link radioId}; null for any other id, and for one carrying tuning the
 * builder doesn't offer (decades, genres, or new releases with a popularity),
 * which it could not edit without losing it. This is how a mix is edited:
 * YouTube Music's apps build the id from the picks themselves, and read it
 * back to edit it, so any `RDAT…` id can be.
 */
export function parseRadioId(playlistId: string): RadioTuning | null {
  const match =
    /^RDAT(m[YXbca])?(dX)?(p[YX])?(i[YX])?(r[XZ])?(?:a([0-9a-z_]+)((?:I[0-9a-z_]+)*)E)?((?:v[\w-]{11})*)z?$/.exec(
      playlistId,
    );
  if (!match) return null;
  const [, mood, latest, popularity, disc, vari, first, rest, videos] = match;
  if (latest && popularity) return null;
  const artists = first ? [first, ...rest!.split("I").filter(Boolean)] : [];
  const songs = (videos!.match(/v[\w-]{11}/g) ?? []).map((v) => v.slice(1) as VideoId);
  const tuning: RadioTuning = {
    artists,
    songs,
    discovery: keyOf(discovery, disc ?? "")!,
    variety: keyOf(variety, vari ?? "")!,
    filter: keyOf(filters, latest ?? popularity ?? "") ?? null,
    mood: keyOf(moods, mood ?? "") ?? null,
  };
  // Only the id radioId gives back is read, so a missing or misplaced `z` is refused.
  return radioId(tuning) === playlistId ? tuning : null;
}

function keyOf<K extends string>(table: Record<K, string>, value: string): K | undefined {
  return (Object.keys(table) as K[]).find((key) => table[key] === value);
}

/**
 * The artist of a one-artist radio with a single popularity, discovery or
 * variety modifier, as {@link RadioTuning.artists} takes it; null for any
 * other id. These are the ids of the tuning chips YouTube attaches to an
 * artist's mix, which name the artist where its own `RDEM…` id does not.
 * Other modifiers are longer (`d0X`, `g9X`) or could run into the artist
 * (`ma`), so they are not read.
 */
export function radioArtist(playlistId: string): string | null {
  return /^RDAT(?:pY|pX|iY|iX|rX|rZ)a([0-9a-z_]+)Ez?$/.exec(playlistId)?.[1] ?? null;
}

/** What YouTube Music shows for a tuned radio: its name and the cover it draws from the seeds. */
export interface RadioCover {
  /** "Coldplay, Muse Mix". */
  title: string;
  /** "Muse, Coldplay, Blur, and more". */
  subtitle: string;
  thumbnails: Thumbnail[];
}

/**
 * A tuning chip above the queue of a mix or radio, as YouTube Music shows
 * them: "All" plays the mix itself, the rest are tuned radios ("Popular",
 * "Chill", "2010s", "Indie folk").
 */
export interface RadioChip {
  title: string;
  playlistId: string;
}
