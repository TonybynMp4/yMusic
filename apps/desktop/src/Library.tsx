import { useEffect, useState, type ReactNode } from "react";
import {
  IconArrowsShuffle,
  IconDeviceDesktop,
  IconDisc,
  IconFolder,
  IconHeart,
  IconLayoutGrid,
  IconList,
  IconPlaylist,
  IconPlus,
  IconUser,
} from "@tabler/icons-react";
import type { BrowseCard, Thumbnail, Track } from "@ymusic/core";
import type { LocalTrack } from "@ymusic/ipc";

import { Art } from "@/components/Art";
import { IconButton } from "@/components/IconButton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { BrowseActions } from "./Browse.tsx";
import { formatTotal } from "./format.ts";
import {
  InteractionArea,
  InteractionButton,
  useNewPlaylist,
  type Subject,
} from "./Interactions.tsx";
import { useRecentlyPlayed } from "./recent.ts";
import { TrackList } from "./TrackList.tsx";
import { viewKey, type View } from "./useBrowse.ts";
import { folderName, tracksIn } from "./useLibrary.ts";
import { LIKED_MUSIC } from "./useLibraryPlaylists.ts";
import { useSaved, type SavedState } from "./useSavedLibrary.ts";

export type Chip = "playlists" | "songs" | "albums" | "artists" | "local";
type AccountChip = Exclude<Chip, "local">;
export type Sort = "added" | "played" | "title";
type Layout = "grid" | "list";

const CHIPS: { value: Chip; label: string; account: boolean }[] = [
  { value: "playlists", label: "Playlists", account: true },
  { value: "songs", label: "Songs", account: true },
  { value: "albums", label: "Albums", account: true },
  { value: "artists", label: "Artists", account: true },
  { value: "local", label: "Local files", account: false },
];

/** Local files' sorts. The account's lists take the sorts YouTube offers for each. */
const SORTS: { value: Sort; label: string }[] = [
  { value: "added", label: "Recently added" },
  { value: "played", label: "Recently played" },
  { value: "title", label: "A to Z" },
];

const PREFS_KEY = "ymusic.library-page";

interface Prefs {
  chip: Chip;
  /** Local files' sort. */
  sort: Sort;
  /** Each account list's sort, as YouTube words it; missing for its default. */
  sorts: Partial<Record<AccountChip, string>>;
  layout: Layout;
}

function readPrefs(): Prefs {
  const fallback: Prefs = { chip: "playlists", sort: "added", sorts: {}, layout: "grid" };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    const sorts = Object.fromEntries(
      Object.entries(saved.sorts ?? {}).filter(([, value]) => typeof value === "string"),
    );
    return {
      chip: CHIPS.some((c) => c.value === saved.chip) ? saved.chip! : fallback.chip,
      sort: SORTS.some((s) => s.value === saved.sort) ? saved.sort! : fallback.sort,
      sorts,
      layout: saved.layout === "list" ? "list" : "grid",
    };
  } catch {
    return fallback;
  }
}

/**
 * Everything saved, on one page, as YouTube Music's Library is: a chip per
 * kind, a sort, and a grid or a list. Signed out, only local files are left.
 */
export function LibraryView(props: {
  /** Who is signed in, or null. */
  account: string | null;
  /** The sidebar's playlists, shown while the page loads its own. */
  playlists: readonly BrowseCard[];
  folders: readonly string[];
  covers: Readonly<Record<string, Thumbnail[]>>;
  local: readonly LocalTrack[];
  localLoading: boolean;
  actions: BrowseActions;
  onNavigate: (view: View) => void;
}) {
  const [prefs, setPrefs] = useState(readPrefs);
  const update = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      return next;
    });
  const signedIn = props.account !== null;
  const chips = CHIPS.filter((c) => signedIn || !c.account);
  // The saved chip waits while signed out, and comes back on signing in.
  const chip = chips.some((c) => c.value === prefs.chip) ? prefs.chip : "local";
  const played = useRecentlyPlayed();
  const newPlaylist = useNewPlaylist();
  const sortOf = (c: AccountChip) => (chip === c ? (prefs.sorts[c] ?? "") : "");
  const playlists = useSaved(
    props.account,
    chip === "playlists" ? "playlists" : null,
    sortOf("playlists"),
  );
  const albums = useSaved(props.account, chip === "albums" ? "albums" : null, sortOf("albums"));
  const artists = useSaved(props.account, chip === "artists" ? "artists" : null, sortOf("artists"));
  const songs = useSaved(props.account, chip === "songs" ? "songs" : null, sortOf("songs"));
  const saved =
    chip === "playlists"
      ? playlists
      : chip === "albums"
        ? albums
        : chip === "artists"
          ? artists
          : chip === "songs"
            ? songs
            : null;
  // A list reloading in a new order keeps its menu up meanwhile.
  const [menus, setMenus] = useState<Partial<Record<AccountChip, SortMenu>>>({});
  const menu = saved?.status === "ready" ? saved : chip === "local" ? undefined : menus[chip];
  useEffect(() => {
    if (chip === "local" || saved?.status !== "ready") return;
    const { sorts, sort } = saved;
    setMenus((m) =>
      m[chip]?.sort === sort && m[chip]?.sorts.join("\n") === sorts.join("\n")
        ? m
        : { ...m, [chip]: { sorts, sort } },
    );
  }, [chip, saved]);

  let body: ReactNode;
  switch (chip) {
    case "playlists": {
      // YouTube's default order is the sidebar's, so it stands in while loading.
      const fallback = !prefs.sorts.playlists && props.playlists.length > 0;
      const state: SavedState<BrowseCard> =
        playlists.status === "loading" && fallback
          ? {
              status: "ready",
              items: [...props.playlists],
              loadingMore: false,
              sorts: [],
              sort: null,
            }
          : playlists;
      body = (
        <Saved state={state} layout={prefs.layout}>
          {(cards) => (
            <Items
              items={cards.map(cardItem)}
              layout={prefs.layout}
              onOpen={props.onNavigate}
              lead={newPlaylist && <NewPlaylistItem layout={prefs.layout} onClick={newPlaylist} />}
              empty="Playlists you save or make show here."
            />
          )}
        </Saved>
      );
      break;
    }
    case "albums":
    case "artists":
      body = (
        <Saved state={chip === "albums" ? albums : artists} layout={prefs.layout}>
          {(cards) => (
            <Items
              items={cards.map(cardItem)}
              layout={prefs.layout}
              onOpen={props.onNavigate}
              empty={
                chip === "albums"
                  ? "Albums you save show here."
                  : "The artists of the songs in your library show here."
              }
            />
          )}
        </Saved>
      );
      break;
    case "songs":
      body = (
        <Saved state={songs} layout="list">
          {(tracks, loadingMore) => (
            <Songs tracks={tracks} loadingMore={loadingMore} actions={props.actions} />
          )}
        </Saved>
      );
      break;
    case "local":
      body =
        props.localLoading && props.local.length === 0 && props.folders.length === 0 ? (
          <Loading layout={prefs.layout} />
        ) : (
          <Items
            items={sortItems(
              localItems(props.local, props.folders, props.covers),
              prefs.sort,
              played,
              (item) => item.key === "local:",
            )}
            layout={prefs.layout}
            onOpen={props.onNavigate}
            empty="Add a music folder to see your files here."
          />
        );
  }

  const sorts =
    chip === "local" ? SORTS : (menu?.sorts ?? []).map((title) => ({ value: title, label: title }));
  const sort = chip === "local" ? prefs.sort : (menu?.sort ?? null);

  return (
    <div className="flex flex-col gap-4 px-3 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        {chips.length > 1 &&
          chips.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-pressed={chip === c.value}
              onClick={() => update({ chip: c.value })}
              className={cn(
                "h-8 rounded-lg px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                chip === c.value
                  ? "bg-foreground text-background"
                  : "bg-secondary text-foreground hover:bg-accent",
              )}
            >
              {c.label}
            </button>
          ))}
        <div className="ml-auto flex items-center gap-1">
          {sorts.length > 0 && (
            <Select<string>
              items={sorts}
              value={sort}
              onValueChange={(value) => {
                if (value === null) return;
                if (chip === "local") update({ sort: value as Sort });
                else update({ sorts: { ...prefs.sorts, [chip]: value } });
              }}
            >
              <SelectTrigger className="w-44" aria-label="Sort">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                {sorts.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {/* Songs are a list, as on YouTube Music. */}
          {chip !== "songs" && (
            <IconButton
              label={prefs.layout === "grid" ? "Show as a list" : "Show as a grid"}
              size="icon"
              onClick={() => update({ layout: prefs.layout === "grid" ? "list" : "grid" })}
            >
              {prefs.layout === "grid" ? (
                <IconList size={18} stroke={1.75} />
              ) : (
                <IconLayoutGrid size={18} stroke={1.75} />
              )}
            </IconButton>
          )}
        </div>
      </div>
      {body}
    </div>
  );
}

interface SortMenu {
  sorts: string[];
  sort: string | null;
}

/** One thing on the page, whatever its kind. */
interface Item {
  /** Its view's key, which is also its key in the recently played record. */
  key: string;
  view: View;
  title: string;
  subtitle: string | null;
  thumbnails: readonly Thumbnail[];
  round: boolean;
  icon: ReactNode;
  subject: Subject | null;
  /** When a local item was last added to; YouTube's lists keep its own order. */
  added: number;
}

function cardItem(card: BrowseCard): Item {
  const view: View = { kind: card.kind, id: card.id };
  const liked = card.kind === "playlist" && card.id === LIKED_MUSIC;
  return {
    key: viewKey(view),
    view,
    title: card.title,
    subtitle: card.subtitle,
    thumbnails: card.thumbnails,
    round: card.kind === "artist",
    icon: liked ? (
      <IconHeart size={32} stroke={1.5} />
    ) : card.kind === "artist" ? (
      <IconUser size={32} stroke={1.5} />
    ) : card.kind === "album" ? (
      <IconDisc size={32} stroke={1.5} />
    ) : (
      <IconPlaylist size={32} stroke={1.5} />
    ),
    subject: { kind: "collection", route: { kind: card.kind, id: card.id } },
    added: 0,
  };
}

/** Every local file first, then each folder, with its own cover image when it has one. */
function localItems(
  all: readonly LocalTrack[],
  folders: readonly string[],
  covers: Readonly<Record<string, Thumbnail[]>>,
): Item[] {
  const newest = (tracks: readonly LocalTrack[]) =>
    tracks.reduce((latest, track) => Math.max(latest, track.addedAt), 0);
  return [
    {
      key: "local:",
      view: { kind: "local", id: "" },
      title: "All local files",
      subtitle: details(all),
      thumbnails: [],
      round: false,
      icon: <IconDeviceDesktop size={32} stroke={1.5} />,
      subject: null,
      added: newest(all),
    },
    ...folders.map((path): Item => {
      const tracks = tracksIn(all, path);
      return {
        key: `local:${path}`,
        view: { kind: "local", id: path },
        title: folderName(path),
        subtitle: `Folder • ${details(tracks)}`,
        thumbnails: covers[path] ?? [],
        round: false,
        icon: <IconFolder size={32} stroke={1.5} />,
        subject: { kind: "folder", path },
        added: newest(tracks),
      };
    }),
  ];
}

function details(tracks: readonly Track[]): string {
  const count = `${tracks.length} song${tracks.length === 1 ? "" : "s"}`;
  const length = tracks.reduce((sum, track) => sum + (track.durationMs ?? 0), 0);
  return length > 0 ? `${count} • ${formatTotal(length)}` : count;
}

const byTitle = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/**
 * Local files in the order asked for. Recently played is this device's
 * record; what has not played here follows, newest added first. `pinned`
 * items stay in front.
 */
export function sortItems<T extends { key: string; title: string; added: number }>(
  items: readonly T[],
  sort: Sort,
  played: Readonly<Record<string, number>>,
  pinned: (item: T) => boolean = () => false,
): T[] {
  const compare = comparer(sort, played);
  return [...items].sort((a, b) => Number(pinned(b)) - Number(pinned(a)) || compare(a, b));
}

function comparer(
  sort: Sort,
  played: Readonly<Record<string, number>>,
): (a: { key: string; title: string; added: number }, b: typeof a) => number {
  const added = (a: { added: number }, b: { added: number }) => b.added - a.added;
  if (sort === "title") return (a, b) => byTitle.compare(a.title, b.title) || added(a, b);
  if (sort === "played")
    return (a, b) => (played[b.key] ?? 0) - (played[a.key] ?? 0) || added(a, b);
  return added;
}

function Items(props: {
  items: readonly Item[];
  layout: Layout;
  onOpen: (view: View) => void;
  /** An action shown before the items, such as "New playlist". */
  lead?: ReactNode;
  empty: string;
}) {
  if (props.items.length === 0 && !props.lead) return <Empty text={props.empty} />;
  const grid = props.layout === "grid";
  return (
    <ul
      className={cn(
        grid
          ? "grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-4 gap-y-6"
          : "flex flex-col",
      )}
    >
      {props.lead}
      {props.items.map((item) =>
        grid ? (
          <Tile key={item.key} item={item} onOpen={props.onOpen} />
        ) : (
          <Row key={item.key} item={item} onOpen={props.onOpen} />
        ),
      )}
    </ul>
  );
}

/** A card, as on YouTube Music's library grid: artists round, everything else square. */
function Tile({ item, onOpen }: { item: Item; onOpen: (view: View) => void }) {
  return (
    <InteractionArea subject={item.subject} render={<li />} className="group relative min-w-0">
      <button
        type="button"
        onClick={() => onOpen(item.view)}
        className="group/open flex w-full flex-col gap-2 text-left outline-none"
      >
        <Art
          thumbnails={item.thumbnails}
          width={200}
          className={cn(
            "aspect-square w-full transition-opacity group-hover:opacity-80",
            item.round ? "rounded-full" : "rounded-md",
          )}
          fallback={item.icon}
        />
        <span className={cn("min-w-0", item.round && "text-center")}>
          <span className="line-clamp-2 text-sm group-focus-visible/open:underline">
            {item.title}
          </span>
          {item.subtitle && (
            <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>
          )}
        </span>
      </button>
      {item.subject && (
        <InteractionButton
          subject={item.subject}
          className="absolute top-1 right-1 bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-black/70 hover:text-white focus-visible:opacity-100 data-popup-open:opacity-100"
        />
      )}
    </InteractionArea>
  );
}

function Row({ item, onOpen }: { item: Item; onOpen: (view: View) => void }) {
  return (
    <InteractionArea subject={item.subject} render={<li />} className="group relative">
      <button
        type="button"
        onClick={() => onOpen(item.view)}
        className="flex w-full items-center gap-3 rounded-lg p-2 pr-12 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent/60"
      >
        <Art
          thumbnails={item.thumbnails}
          width={48}
          className={cn("size-12 shrink-0", item.round ? "rounded-full" : "rounded")}
          fallback={item.icon}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{item.title}</span>
          {item.subtitle && (
            <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>
          )}
        </span>
      </button>
      {item.subject && (
        <InteractionButton
          subject={item.subject}
          className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
        />
      )}
    </InteractionArea>
  );
}

/** YouTube Music's "New playlist" tile, first in the Playlists grid. */
function NewPlaylistItem({ layout, onClick }: { layout: Layout; onClick: () => void }) {
  const grid = layout === "grid";
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group w-full text-left outline-none",
          grid
            ? "flex flex-col gap-2"
            : "flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-accent/60 focus-visible:bg-accent/60",
        )}
      >
        <span
          className={cn(
            "flex items-center justify-center bg-secondary text-muted-foreground transition-colors group-hover:text-foreground",
            grid ? "aspect-square w-full rounded-md" : "size-12 shrink-0 rounded",
          )}
        >
          <IconPlus size={grid ? 40 : 20} stroke={1.5} />
        </span>
        <span className="text-sm group-focus-visible:underline">New playlist</span>
      </button>
    </li>
  );
}

function Songs(props: { tracks: Track[]; loadingMore: boolean; actions: BrowseActions }) {
  const { tracks, actions } = props;
  if (tracks.length === 0) return <Empty text="Songs you save or like show here." />;
  return (
    <section>
      <Button
        variant="outline"
        className="mb-2 rounded-full"
        // Until every page is in, it would shuffle only the first ones.
        disabled={props.loadingMore}
        onClick={() => actions.onPlay(tracks, null)}
      >
        <IconArrowsShuffle size={16} stroke={1.75} />
        Shuffle all
      </Button>
      <TrackList
        tracks={tracks}
        currentId={actions.currentId}
        playing={actions.playing}
        onToggle={actions.onToggle}
        onPlay={(id) => actions.onPlay(tracks, id)}
        onOpen={actions.onOpen}
      />
      {props.loadingMore && (
        <p className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
          <Spinner size={14} />
          Loading more songs ({tracks.length} so far)
        </p>
      )}
    </section>
  );
}

function Saved<T>(props: {
  state: SavedState<T>;
  layout: Layout;
  children: (items: T[], loadingMore: boolean) => ReactNode;
}) {
  const { state } = props;
  if (state.status === "loading") return <Loading layout={props.layout} />;
  if (state.status === "error") {
    return (
      <div className="flex flex-col items-center gap-1 px-8 py-24 text-center">
        <p className="text-sm">Could not load your library</p>
        <p className="text-xs text-muted-foreground">{state.error}</p>
      </div>
    );
  }
  return props.children(state.items, state.loadingMore);
}

function Empty({ text }: { text: string }) {
  return <p className="px-3 py-24 text-center text-sm text-muted-foreground">{text}</p>;
}

function Loading({ layout }: { layout: Layout }) {
  if (layout === "list") {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-4 gap-y-6">
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}
