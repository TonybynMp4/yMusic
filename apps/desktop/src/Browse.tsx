import {
  IconArrowsShuffle,
  IconPlayerPlayFilled,
  IconUser,
} from "@tabler/icons-react";
import type { AlbumPage, ArtistPage, BrowseCard, PlaylistPage, Thumbnail, Track, TrackId } from "@ytbm/core";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TrackList } from "./TrackList.tsx";
import { useBrowse, type Route } from "./useBrowse.ts";

/** What a browse page needs of the player and the navigation stack. */
export interface BrowseActions {
  currentId: TrackId | null;
  /** Plays `tracks` from `id`; with no `id`, from a random track, shuffled. */
  onPlay: (tracks: Track[], id: TrackId | null) => void;
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
    case "playlist":
      return <Playlist page={page.page} actions={actions} />;
    case "artist":
      return <Artist page={page.page} actions={actions} />;
  }
}

function Album({ page, actions }: { page: AlbumPage; actions: BrowseActions }) {
  return (
    <>
      <Header
        art={page.thumbnails[0]}
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
        onPlay={(id) => actions.onPlay(page.tracks, id)}
        onEnqueue={actions.onEnqueue}
        onOpen={actions.onOpen}
        hideAlbum
      />
    </>
  );
}

function Playlist({ page, actions }: { page: PlaylistPage; actions: BrowseActions }) {
  return (
    <>
      <Header
        art={page.thumbnails[0]}
        title={page.title}
        subtitle={page.subtitle}
        tracks={page.tracks}
        actions={actions}
      />
      <TrackList
        tracks={page.tracks}
        currentId={actions.currentId}
        onPlay={(id) => actions.onPlay(page.tracks, id)}
        onEnqueue={actions.onEnqueue}
        onOpen={actions.onOpen}
      />
    </>
  );
}

/**
 * YouTube Music's artist page: a wide banner with the name over it, the top
 * songs, then a row of cards per shelf.
 */
function Artist({ page, actions }: { page: ArtistPage; actions: BrowseActions }) {
  const banner = page.thumbnails[0];
  const playlistId = page.topSongsPlaylistId;
  return (
    <>
      <div className="relative mb-4 overflow-hidden rounded-xl">
        {banner ? (
          <img src={banner.url} alt="" className="aspect-[12/5] w-full bg-secondary object-cover" />
        ) : (
          <div className="aspect-[12/5] w-full bg-secondary" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 px-4 pb-4">
          <h1 className="text-4xl font-bold tracking-tight">{page.name}</h1>
          {page.description && (
            <p className="line-clamp-2 max-w-2xl text-sm text-muted-foreground">
              {page.description}
            </p>
          )}
          <PlayButtons tracks={page.topSongs} actions={actions} />
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

function Header(props: {
  art: Thumbnail | undefined;
  title: string;
  byline?: React.ReactNode;
  subtitle: string | null;
  tracks: Track[];
  actions: BrowseActions;
}) {
  return (
    <div className="mb-4 flex items-end gap-6 px-3 pt-2">
      {props.art ? (
        <img
          src={props.art.url}
          alt=""
          className="size-48 shrink-0 rounded-lg bg-secondary object-cover shadow-lg"
        />
      ) : (
        <div className="size-48 shrink-0 rounded-lg bg-secondary" />
      )}
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
  const art = card.thumbnails[0];
  // Artists are round, everything else square — YouTube Music's own cue.
  const round = card.kind === "artist";
  return (
    <button
      type="button"
      onClick={() => onOpen({ kind: card.kind, id: card.id })}
      className="group flex w-40 shrink-0 flex-col gap-2 text-left outline-none"
    >
      {art ? (
        <img
          src={art.url}
          alt=""
          loading="lazy"
          className={cn(
            "size-40 bg-secondary object-cover transition-opacity group-hover:opacity-80",
            round ? "rounded-full" : "rounded-md",
          )}
        />
      ) : (
        <span
          className={cn(
            "flex size-40 items-center justify-center bg-secondary text-muted-foreground",
            round ? "rounded-full" : "rounded-md",
          )}
        >
          <IconUser size={32} stroke={1.5} />
        </span>
      )}
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
