import {
  IconArrowsShuffle,
  IconDisc,
  IconLoader2,
  IconPlayerPlayFilled,
  IconUser,
} from "@tabler/icons-react";
import type {
  AlbumPage,
  ArtistPage,
  BrowseCard,
  PlaylistPage,
  Thumbnail,
  Track,
  TrackId,
} from "@ytbm/core";

import { useState, type CSSProperties } from "react";

import { Art } from "@/components/Art";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TrackList } from "./TrackList.tsx";
import { useBrowse, type Route } from "./useBrowse.ts";
import type { PlayFrom } from "./usePlayer.ts";

/** What a browse page needs of the player and the navigation stack. */
export interface BrowseActions {
  currentId: TrackId | null;
  /** Whether the current track is playing rather than paused. */
  playing: boolean;
  onToggle: () => void;
  /**
   * Plays `tracks` from `id`; with no `id`, from a random track, shuffled.
   * `from` lets the queue keep growing, with the rest of a playlist or a radio.
   */
  onPlay: (tracks: Track[], id: TrackId | null, from?: PlayFrom) => void;
  onEnqueue: (track: Track) => void;
  onOpen: (route: Route) => void;
}

export function BrowseView({ route, actions }: { route: Route; actions: BrowseActions }) {
  const state = useBrowse(route);
  if (state.status === "loading") return <Loading round={route.kind === "artist"} />;
  if (state.status === "error") {
    return (
      <div className="flex flex-col items-center gap-1 px-8 py-24 text-center">
        <p className="text-sm">Could not open this page</p>
        <p className="text-xs text-muted-foreground">{state.error}</p>
      </div>
    );
  }
  const { page } = state;
  switch (page.kind) {
    case "album":
      return <Album page={page.page} actions={actions} />;
    case "playlist": {
      // Queue the whole playlist, including the rows still loading.
      const from: PlayFrom = { kind: "playlist", id: route.id };
      const following = {
        ...actions,
        onPlay: (tracks: Track[], id: TrackId | null) => actions.onPlay(tracks, id, from),
      };
      return <Playlist page={page.page} loadingMore={state.loadingMore} actions={following} />;
    }
    case "artist":
      return <Artist page={page.page} actions={actions} />;
  }
}

function Album({ page, actions }: { page: AlbumPage; actions: BrowseActions }) {
  return (
    <>
      <Header
        thumbnails={page.thumbnails}
        title={page.title}
        byline={page.artists.map((artist, i) => (
          <span key={`${artist.name}:${i}`}>
            {i > 0 && ", "}
            {artist.channelId ? (
              <button
                type="button"
                onClick={() => actions.onOpen({ kind: "artist", id: artist.channelId! })}
                className="hover:underline"
              >
                {artist.name}
              </button>
            ) : (
              artist.name
            )}
          </span>
        ))}
        subtitle={page.subtitle}
        tracks={page.tracks}
        actions={actions}
      />
      <TrackList
        tracks={page.tracks}
        currentId={actions.currentId}
        playing={actions.playing}
        onToggle={actions.onToggle}
        onPlay={(id) => actions.onPlay(page.tracks, id)}
        onEnqueue={actions.onEnqueue}
        onOpen={actions.onOpen}
        hideAlbum
      />
    </>
  );
}

function Playlist({
  page,
  loadingMore,
  actions,
}: {
  page: PlaylistPage;
  loadingMore: boolean;
  actions: BrowseActions;
}) {
  return (
    <>
      <Header
        thumbnails={page.thumbnails}
        title={page.title}
        subtitle={page.subtitle}
        tracks={page.tracks}
        actions={actions}
      />
      <TrackList
        tracks={page.tracks}
        currentId={actions.currentId}
        playing={actions.playing}
        onToggle={actions.onToggle}
        onPlay={(id) => actions.onPlay(page.tracks, id)}
        onEnqueue={actions.onEnqueue}
        onOpen={actions.onOpen}
      />
      {loadingMore && (
        <p className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
          <IconLoader2 size={14} className="animate-spin" aria-hidden />
          Loading more songs ({page.tracks.length} so far)
        </p>
      )}
    </>
  );
}

/**
 * YouTube Music's artist page: the name, description and buttons over the
 * banner's lower edge, the top songs, then a row of cards per shelf.
 */
function Artist({ page, actions }: { page: ArtistPage; actions: BrowseActions }) {
  const playlistId = page.topSongsPlaylistId;
  return (
    <>
      {/* The banner is a backdrop of capped height rather than a full-width
          image at its own aspect, which on a wide window fills the screen.
          The block is at least as tall as the banner, so what follows starts
          below it, and grows past it when the description is expanded. */}
      <div
        className="relative isolate mb-4 flex min-h-(--banner) flex-col justify-end"
        style={{ "--banner": "clamp(240px, 40vh, 380px)" } as CSSProperties}
      >
        <div className="absolute inset-x-0 top-0 -z-10 h-(--banner) overflow-hidden rounded-xl">
          <Art
            thumbnails={page.thumbnails}
            width={1200}
            lazy={false}
            className="size-full object-[center_25%]"
            fallback={null}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/0" />
        </div>
        <div className="flex items-end gap-6 px-4 pt-24 pb-1">
          <Art
            thumbnails={page.avatar}
            width={144}
            lazy={false}
            className="size-36 shrink-0 rounded-full shadow-lg"
            fallback={<IconUser size={48} stroke={1.25} />}
          />
          <div className="flex min-w-0 flex-col gap-3">
            <h1 className="text-4xl font-bold tracking-tight">{page.name}</h1>
            {page.description && <Description text={page.description} />}
            <PlayButtons tracks={page.topSongs} actions={actions} />
          </div>
        </div>
      </div>

      {page.topSongs.length > 0 && (
        <section className="mb-6">
          <div className="flex items-baseline justify-between px-3">
            <h2 className="mb-2 text-xl font-semibold">Top songs</h2>
            {playlistId && (
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => actions.onOpen({ kind: "playlist", id: playlistId })}
              >
                Show all
              </Button>
            )}
          </div>
          <TrackList
            tracks={page.topSongs}
            currentId={actions.currentId}
            playing={actions.playing}
            onToggle={actions.onToggle}
            onPlay={(id) => actions.onPlay(page.topSongs, id)}
            onEnqueue={actions.onEnqueue}
            onOpen={actions.onOpen}
          />
        </section>
      )}

      {page.shelves.map((shelf) => (
        <Shelf key={shelf.title} title={shelf.title} cards={shelf.cards} onOpen={actions.onOpen} />
      ))}
    </>
  );
}

/** Two lines until clicked, then the whole thing; clicking again folds it. */
function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => setOpen((o) => !o)}
      className="max-w-2xl cursor-pointer text-left text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
    >
      <span className={cn("whitespace-pre-line", !open && "line-clamp-2")}>{text}</span>
    </button>
  );
}

export function Header(props: {
  thumbnails: Thumbnail[];
  /** Drawn in place of artwork, for pages that have none. */
  fallback?: React.ReactNode;
  title: string;
  byline?: React.ReactNode;
  subtitle: string | null;
  tracks: Track[];
  actions: BrowseActions;
}) {
  return (
    <div className="mb-4 flex items-end gap-6 px-3 pt-2">
      <Art
        thumbnails={props.thumbnails}
        width={192}
        lazy={false}
        className="size-48 shrink-0 rounded-lg shadow-lg"
        fallback={props.fallback}
      />
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{props.title}</h1>
        {props.byline && <p className="text-sm">{props.byline}</p>}
        {props.subtitle && <p className="text-xs text-muted-foreground">{props.subtitle}</p>}
        <PlayButtons tracks={props.tracks} actions={props.actions} />
      </div>
    </div>
  );
}

function PlayButtons({ tracks, actions }: { tracks: Track[]; actions: BrowseActions }) {
  const empty = tracks.length === 0;
  return (
    <div className="mt-1 flex gap-2">
      <Button
        className="rounded-full bg-foreground text-background hover:bg-foreground/90"
        disabled={empty}
        onClick={() => actions.onPlay(tracks, tracks[0]!.id)}
      >
        <IconPlayerPlayFilled size={16} />
        Play
      </Button>
      <Button
        variant="outline"
        className="rounded-full"
        disabled={empty}
        onClick={() => actions.onPlay(tracks, null)}
      >
        <IconArrowsShuffle size={16} stroke={1.75} />
        Shuffle
      </Button>
    </div>
  );
}

/** A horizontally scrolling row of cards, as YouTube Music lays out a shelf. */
function Shelf({
  title,
  cards,
  onOpen,
}: {
  title: string;
  cards: BrowseCard[];
  onOpen: (route: Route) => void;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 px-3 text-xl font-semibold">{title}</h2>
      <div className="flex gap-4 overflow-x-auto px-3 pb-2">
        {cards.map((card) => (
          <Card key={`${card.kind}:${card.id}`} card={card} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function Card({ card, onOpen }: { card: BrowseCard; onOpen: (route: Route) => void }) {
  // Artists are round, everything else square: YouTube Music's own cue.
  const round = card.kind === "artist";
  return (
    <button
      type="button"
      onClick={() => onOpen({ kind: card.kind, id: card.id })}
      className="group flex w-40 shrink-0 flex-col gap-2 text-left outline-none"
    >
      <Art
        thumbnails={card.thumbnails}
        width={160}
        className={cn(
          "size-40 transition-opacity group-hover:opacity-80",
          round ? "rounded-full" : "rounded-md",
        )}
        fallback={round ? <IconUser size={32} stroke={1.5} /> : <IconDisc size={32} stroke={1.5} />}
      />
      <span className={cn("min-w-0", round && "text-center")}>
        <span className="line-clamp-2 text-sm group-focus-visible:underline">{card.title}</span>
        {card.subtitle && (
          <span className="block truncate text-xs text-muted-foreground">{card.subtitle}</span>
        )}
      </span>
    </button>
  );
}

function Loading({ round }: { round: boolean }) {
  return (
    <div className="flex flex-col gap-4 px-3 pt-2">
      <div className="flex items-end gap-6">
        <Skeleton className={cn("size-48", round && "rounded-full")} />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
