import { useEffect, useState, type ReactNode } from "react";
import {
  IconAlertTriangle,
  IconBroadcast,
  IconCheck,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { skipToken, useQueries, useQuery } from "@tanstack/react-query";
import {
  defaultTuning,
  maxRadioSeeds,
  radioId,
  type BrowseCard,
  type RadioCover,
  type RadioTuning,
  type SearchResults,
  type Thumbnail,
  type Track,
  type VideoId,
  videoIdFromTrackId,
} from "@ymusic/core";

import { Art } from "@/components/Art";
import { Chip } from "@/components/Chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { engine } from "./engine.ts";

/** What a radio grows from: an artist, by channel, or a song. */
export type RadioSeed =
  | { kind: "artist"; channelId: string; name: string; thumbnails: Thumbnail[] }
  | { kind: "song"; videoId: VideoId; title: string; thumbnails: Thumbnail[] };

type Tuning = Omit<RadioTuning, "artists" | "songs">;

const DISCOVERY: [Tuning["discovery"], string][] = [
  ["familiar", "Familiar"],
  ["blend", "Blend"],
  ["discover", "Discover"],
];
const VARIETY: [Tuning["variety"], string][] = [
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
];
const FILTERS: [NonNullable<Tuning["filter"]>, string][] = [
  ["popular", "Popular"],
  ["deepCuts", "Deep cuts"],
  ["latest", "New releases"],
];
const MOODS: [NonNullable<Tuning["mood"]>, string][] = [
  ["pumpUp", "Pump-up"],
  ["chill", "Chill"],
  ["upbeat", "Upbeat"],
  ["downbeat", "Downbeat"],
  ["focus", "Focus"],
];

/**
 * YouTube Music's radio builder: pick artists and songs, tune how familiar
 * and how varied the radio is, and play it. Open while `seeds` is set, with
 * those seeds picked.
 */
export function RadioBuilderDialog({
  seeds,
  signedIn,
  onClose,
  onPlay,
}: {
  seeds: RadioSeed[] | null;
  /** Whether there is a library to suggest seeds from. */
  signedIn: boolean;
  onClose: () => void;
  onPlay: (tracks: Track[], cover: RadioCover | null, radio: string) => void;
}) {
  return (
    <Dialog open={seeds !== null} onOpenChange={(open) => open || onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-lg flex-col">
        {/* Mounted afresh on each opening, so it starts from the seeds given. */}
        {seeds && (
          <Builder
            initial={seeds}
            signedIn={signedIn}
            onPlay={(tracks, cover, radio) => {
              onPlay(tracks, cover, radio);
              onClose();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function seedKey(seed: RadioSeed): string {
  return seed.kind === "artist" ? `artist:${seed.channelId}` : `song:${seed.videoId}`;
}

/**
 * The Knowledge Graph id a tuned radio names an artist by, which only the
 * tuning chips of the artist's own mix carry. Null when the artist has no
 * mix, or YouTube offers no tuning for it.
 */
function radioArtistOptions(channelId: string) {
  return {
    queryKey: ["radio-artist", channelId],
    queryFn: async () => {
      const page = await engine.artist(channelId);
      return page.mix ? engine.radioArtist(page.mix.playlistId) : null;
    },
    staleTime: Infinity,
  };
}

/**
 * A few artists and songs from the library to start from, different ones
 * each few minutes: library artists, and recently liked songs.
 */
function useSuggestions(signedIn: boolean): RadioSeed[] {
  const suggestions = useQuery({
    queryKey: ["radio-suggestions", signedIn],
    queryFn: async () => {
      const [artists, songs] = await Promise.all([
        engine.libraryCards("artists"),
        engine.librarySongs(),
      ]);
      const seeds: RadioSeed[] = [];
      for (const card of sample(artists.cards, SUGGESTED)) seeds.push(artistSeed(card));
      for (const track of sample(songs.tracks, SUGGESTED)) {
        const seed = songSeed(track);
        if (seed) seeds.push(seed);
      }
      return seeds;
    },
    enabled: signedIn,
    staleTime: 5 * 60_000,
  });
  return suggestions.data ?? [];
}

/** How many artists, and how many songs, the library suggests. */
const SUGGESTED = 8;

function sample<T>(items: readonly T[], count: number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, count);
}

function artistSeed(card: BrowseCard): RadioSeed {
  return { kind: "artist", channelId: card.id, name: card.title, thumbnails: card.thumbnails };
}

function songSeed(track: Track): RadioSeed | null {
  const videoId = videoIdFromTrackId(track.id);
  return videoId
    ? { kind: "song", videoId, title: track.title, thumbnails: track.thumbnails }
    : null;
}

function Builder({
  initial,
  signedIn,
  onPlay,
}: {
  initial: RadioSeed[];
  signedIn: boolean;
  onPlay: (tracks: Track[], cover: RadioCover | null, radio: string) => void;
}) {
  const [seeds, setSeeds] = useState(initial);
  const [tuning, setTuning] = useState<Tuning>(defaultTuning);
  const tune = (change: Partial<Tuning>) => setTuning((t) => ({ ...t, ...change }));

  const artistSeeds = seeds.filter((s) => s.kind === "artist");
  const artistTokens = useQueries({
    queries: artistSeeds.map((s) => radioArtistOptions(s.channelId)),
  });
  const tokenOf = new Map(artistSeeds.map((s, i) => [s.channelId, artistTokens[i]!]));
  const resolving = artistTokens.some((q) => q.isPending);

  const id = resolving
    ? null
    : radioId({
        ...tuning,
        artists: artistTokens.flatMap((q) => (q.data ? [q.data] : [])),
        songs: seeds.flatMap((s) => (s.kind === "song" ? [s.videoId] : [])),
      });
  const radio = useQuery({
    queryKey: ["tuned-radio", id],
    queryFn: id === null ? skipToken : () => engine.mix(id),
    staleTime: 5 * 60_000,
  });
  const cover = useQuery({
    queryKey: ["radio-cover", id],
    queryFn: id === null ? skipToken : () => engine.radioCover(id),
    staleTime: Infinity,
  });

  const add = (seed: RadioSeed) =>
    setSeeds((all) =>
      all.length >= maxRadioSeeds || all.some((s) => seedKey(s) === seedKey(seed))
        ? all
        : [...all, seed],
    );
  const remove = (seed: RadioSeed) =>
    setSeeds((all) => all.filter((s) => seedKey(s) !== seedKey(seed)));
  const picked = new Set(seeds.map(seedKey));
  const toggle = (seed: RadioSeed) => (picked.has(seedKey(seed)) ? remove(seed) : add(seed));
  const suggestions = useSuggestions(signedIn);

  const tracks = radio.data ?? null;
  const playable = tracks !== null && tracks.length > 0;

  return (
    <form
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (playable && id !== null) onPlay(tracks, cover.data ?? null, id);
      }}
    >
      <DialogHeader>
        <DialogTitle>Create a mix</DialogTitle>
      </DialogHeader>
      {/* Header and footer stay put; the rest scrolls when the window is short. */}
      <div className="-mx-6 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-0.5">
        <SeedSearch
          full={seeds.length >= maxRadioSeeds}
          picked={picked}
          suggestions={suggestions}
          onToggle={toggle}
        />
        {seeds.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Seeds">
            {seeds.map((seed) => {
              const token = seed.kind === "artist" ? tokenOf.get(seed.channelId) : undefined;
              return (
                <SeedChip
                  key={seedKey(seed)}
                  seed={seed}
                  pending={token?.isPending ?? false}
                  unusable={token !== undefined && !token.isPending && !token.data}
                  onRemove={() => remove(seed)}
                />
              );
            })}
          </ul>
        )}
        <Section title="Music discovery">
          {DISCOVERY.map(([value, label]) => (
            <Chip
              key={value}
              selected={tuning.discovery === value}
              onClick={() => tune({ discovery: value })}
            >
              {label}
            </Chip>
          ))}
        </Section>
        <Section title="Artist variety">
          {VARIETY.map(([value, label]) => (
            <Chip
              key={value}
              selected={tuning.variety === value}
              onClick={() => tune({ variety: value })}
            >
              {label}
            </Chip>
          ))}
        </Section>
        <Section title="Filters">
          {FILTERS.map(([value, label]) => (
            <Chip
              key={value}
              selected={tuning.filter === value}
              onClick={() => tune({ filter: tuning.filter === value ? null : value })}
            >
              {label}
            </Chip>
          ))}
        </Section>
        <Section title="Mood">
          {MOODS.map(([value, label]) => (
            <Chip
              key={value}
              selected={tuning.mood === value}
              onClick={() => tune({ mood: tuning.mood === value ? null : value })}
            >
              {label}
            </Chip>
          ))}
        </Section>
      </div>
      <Preview
        empty={seeds.length === 0}
        loading={resolving || radio.isFetching}
        error={radio.error?.message ?? null}
        tracks={tracks}
        cover={cover.data ?? null}
      />
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
        <Button type="submit" disabled={!playable || radio.isFetching}>
          <IconBroadcast />
          Start mix
        </Button>
      </DialogFooter>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-xs font-medium text-muted-foreground">{title}</legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

function SeedChip({
  seed,
  pending,
  unusable,
  onRemove,
}: {
  seed: RadioSeed;
  pending: boolean;
  unusable: boolean;
  onRemove: () => void;
}) {
  const name = seed.kind === "artist" ? seed.name : seed.title;
  return (
    <li
      className={cn(
        "flex h-8 max-w-56 items-center gap-1.5 rounded-full bg-secondary py-1 pr-1 pl-1 text-sm",
        unusable && "text-muted-foreground",
      )}
      title={unusable ? "YouTube Music can't make a mix from this artist" : undefined}
    >
      <Art
        thumbnails={seed.thumbnails}
        width={24}
        lazy={false}
        className={cn("size-6 shrink-0", seed.kind === "artist" ? "rounded-full" : "rounded")}
      />
      <span className={cn("truncate", unusable && "line-through")}>{name}</span>
      {pending && <Spinner size={12} label="Finding the artist" />}
      {unusable && <IconAlertTriangle size={14} className="shrink-0" />}
      <button
        type="button"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
        className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
      >
        <IconX size={14} />
      </button>
    </li>
  );
}

function Preview({
  empty,
  loading,
  error,
  tracks,
  cover,
}: {
  empty: boolean;
  loading: boolean;
  error: string | null;
  tracks: Track[] | null;
  cover: RadioCover | null;
}) {
  let body: ReactNode;
  if (empty) {
    body = <p className="text-muted-foreground">Add artists or songs to start from.</p>;
  } else if (loading && tracks === null) {
    body = <Spinner label="Tuning the mix" />;
  } else if (error) {
    body = <p className="text-destructive">{error}</p>;
  } else if (tracks !== null && tracks.length === 0) {
    body = (
      <p className="text-muted-foreground">
        YouTube Music can't make this mix. Try fewer filters or other seeds.
      </p>
    );
  } else if (tracks !== null) {
    body = (
      <div className="min-w-0">
        <p className="truncate font-medium">{cover?.title ?? "Mix"}</p>
        <p className="truncate text-xs text-muted-foreground">
          {cover?.subtitle || `${tracks.length} songs`}
        </p>
      </div>
    );
  }
  return (
    <div className="flex min-h-16 items-center gap-3 rounded-lg bg-secondary/50 p-2 text-sm">
      <Art
        thumbnails={cover?.thumbnails ?? []}
        width={48}
        lazy={false}
        className="size-12 shrink-0 rounded"
        fallback={<IconBroadcast size={20} />}
      />
      {body}
      {loading && tracks !== null && <Spinner size={14} label="Tuning the mix" />}
    </div>
  );
}

/** The artists and songs a search offers as seeds, the top result first, artists first. */
function seedsFrom(results: SearchResults): RadioSeed[] {
  const artists: BrowseCard[] = [];
  const songs: Track[] = [];
  const top = results.top?.item;
  if (top?.kind === "card" && top.card.kind === "artist") artists.push(top.card);
  if (top?.kind === "track") songs.push(top.track);
  for (const shelf of results.shelves) {
    if (shelf.kind === "cards") artists.push(...shelf.cards.filter((c) => c.kind === "artist"));
    else if (shelf.filter === "songs") songs.push(...shelf.tracks);
  }
  const seeds = new Map<string, RadioSeed>();
  for (const card of artists) seeds.set(`artist:${card.id}`, artistSeed(card));
  for (const track of songs) {
    const seed = songSeed(track);
    if (seed) seeds.set(seedKey(seed), seed);
  }
  return [...seeds.values()];
}

function SeedSearch({
  full,
  picked,
  suggestions,
  onToggle,
}: {
  full: boolean;
  /** Keys of the seeds picked, shown ticked. */
  picked: Set<string>;
  suggestions: RadioSeed[];
  onToggle: (seed: RadioSeed) => void;
}) {
  const [query, setQuery] = useState("");
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSettled(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);
  // Signed out, as the search box does while typing, so it stays out of the
  // account's search history.
  const search = useQuery({
    queryKey: ["radio-seed-search", settled],
    queryFn:
      settled === ""
        ? skipToken
        : async () => seedsFrom((await engine.search(settled, { signedOut: true })).results),
    staleTime: 5 * 60_000,
  });
  const searching = query.trim() !== "";
  const results = searching ? (search.data ?? []) : suggestions;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <IconSearch
          size={16}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          autoFocus
          aria-label="Search for artists and songs"
          placeholder="Search for artists and songs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-8"
        />
        {search.isFetching && (
          <Spinner
            size={14}
            label="Searching"
            className="absolute top-1/2 right-2.5 -translate-y-1/2"
          />
        )}
      </div>
      {full && (
        <p className="text-xs text-muted-foreground">
          Up to {maxRadioSeeds} artists and songs. Remove one to add another.
        </p>
      )}
      {results.length > 0 && (
        <SeedGallery
          label={searching ? "Search results" : "From your library"}
          seeds={results}
          picked={picked}
          full={full}
          onToggle={onToggle}
        />
      )}
      {searching && search.isSuccess && settled === query.trim() && results.length === 0 && (
        <p className="text-xs text-muted-foreground">No artists or songs found.</p>
      )}
    </div>
  );
}

/** A row of artists and songs to pick from, scrolling sideways like a shelf. */
function SeedGallery({
  label,
  seeds,
  picked,
  full,
  onToggle,
}: {
  label: string;
  seeds: RadioSeed[];
  picked: Set<string>;
  full: boolean;
  onToggle: (seed: RadioSeed) => void;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
      <ul className="-mx-6 flex gap-3 overflow-x-auto px-6 pb-2">
        {seeds.map((seed) => {
          const name = seed.kind === "artist" ? seed.name : seed.title;
          const on = picked.has(seedKey(seed));
          const round = seed.kind === "artist";
          return (
            <li key={seedKey(seed)} className="w-24 shrink-0">
              <button
                type="button"
                aria-pressed={on}
                disabled={full && !on}
                onClick={() => onToggle(seed)}
                className="group flex w-full flex-col gap-1.5 text-left outline-none disabled:opacity-50"
              >
                <span className="relative">
                  <Art
                    thumbnails={seed.thumbnails}
                    width={96}
                    className={cn(
                      "size-24 transition-opacity group-hover:opacity-80 group-focus-visible:ring-2 group-focus-visible:ring-ring",
                      round ? "rounded-full" : "rounded-md",
                    )}
                  />
                  {on && (
                    <span
                      className={cn(
                        "absolute inset-0 flex items-center justify-center bg-black/50 text-white",
                        round ? "rounded-full" : "rounded-md",
                      )}
                    >
                      <IconCheck size={28} />
                    </span>
                  )}
                </span>
                <span className={cn("min-w-0", round && "text-center")}>
                  <span className="line-clamp-2 text-xs">{name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {round ? "Artist" : "Song"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
