import { useEffect, useRef } from "react";
import type { SearchFilter, SearchResults, Track } from "@ymusic/core";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { Card, Shelf, ShelfHeader, type BrowseActions } from "./Browse.tsx";
import { TrackList } from "./TrackList.tsx";
import type { YouTubeSearchState } from "./useYouTubeSearch.ts";

/** Each chip's label, and the title of its shelf. */
const LABELS: Record<SearchFilter, string> = {
  songs: "Songs",
  videos: "Videos",
  albums: "Albums",
  "featured-playlists": "Featured playlists",
  "community-playlists": "Community playlists",
  artists: "Artists",
};

/**
 * YouTube Music's chips, which narrow the search to one kind. "All" is every
 * kind, and the local files with them.
 */
export function SearchChips({ youtube }: { youtube: YouTubeSearchState }) {
  const { filter, filters } = youtube;
  if (filters.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-2 px-3 pt-1" role="toolbar" aria-label="Filter results">
      <Chip selected={filter === null} onClick={() => youtube.setFilter(null)}>
        All
      </Chip>
      {filters.map((chip) => (
        <Chip key={chip} selected={filter === chip} onClick={() => youtube.setFilter(chip)}>
          {LABELS[chip]}
        </Chip>
      ))}
    </div>
  );
}

/**
 * YouTube Music's half of search, laid out as YouTube Music does: the top
 * result and a shelf per kind, each with "Show all", which selects that
 * kind's chip. Songs and videos play and start their radio; albums,
 * playlists and artists open their page.
 */
export function YouTubeResults({
  youtube,
  actions,
}: {
  youtube: YouTubeSearchState;
  actions: BrowseActions;
}) {
  const { results, filter } = youtube;
  if (results === null) return youtube.loading ? <Loading /> : null;
  return filter === null ? (
    <Everything results={results} actions={actions} onFilter={youtube.setFilter} />
  ) : (
    <>
      <Filtered results={results} filter={filter} actions={actions} />
      {youtube.hasMore && <More loading={youtube.loadingMore} onReach={youtube.loadMore} />}
    </>
  );
}

function Chip(props: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      variant="secondary"
      size="sm"
      aria-pressed={props.selected}
      onClick={props.onClick}
      className={cn(
        "rounded-lg",
        props.selected && "bg-foreground text-background hover:bg-foreground/90",
      )}
    >
      {props.children}
    </Button>
  );
}

function Everything({
  results,
  actions,
  onFilter,
}: {
  results: SearchResults;
  actions: BrowseActions;
  onFilter: (filter: SearchFilter) => void;
}) {
  return (
    <>
      {results.top && <TopResult top={results.top} actions={actions} />}
      {results.shelves.map((shelf) => {
        const showAll = (
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => onFilter(shelf.filter)}
          >
            Show all
          </Button>
        );
        return shelf.kind === "cards" ? (
          <Shelf
            key={shelf.filter}
            title={LABELS[shelf.filter]}
            cards={shelf.cards}
            onOpen={actions.onOpen}
            action={showAll}
          />
        ) : (
          <section key={shelf.filter} className="mb-6">
            <ShelfHeader title={LABELS[shelf.filter]} action={showAll} />
            <Tracks tracks={shelf.tracks} actions={actions} />
          </section>
        );
      })}
    </>
  );
}

/** The card YouTube Music leads with, beside the songs it lists. */
function TopResult({
  top,
  actions,
}: {
  top: NonNullable<SearchResults["top"]>;
  actions: BrowseActions;
}) {
  const { item } = top;
  return (
    <section className="mb-6">
      <h2 className="mb-2 px-3 text-xl font-semibold">Top result</h2>
      {item.kind === "card" ? (
        <div className="flex items-start gap-4">
          <div className="pl-3">
            <Card card={item.card} onOpen={actions.onOpen} />
          </div>
          <div className="min-w-0 flex-1">
            <Tracks tracks={top.tracks} actions={actions} />
          </div>
        </div>
      ) : (
        <Tracks tracks={[item.track, ...top.tracks]} actions={actions} />
      )}
    </section>
  );
}

/**
 * One chip's results: a list for songs and videos, a grid of cards for the
 * rest. Only the chip's own kind shows, should YouTube slip another kind in.
 */
function Filtered({
  results,
  filter,
  actions,
}: {
  results: SearchResults;
  filter: SearchFilter;
  actions: BrowseActions;
}) {
  const shelf = results.shelves.find((s) => s.filter === filter);
  if (!shelf) return null;
  if (shelf.kind === "tracks") return <Tracks tracks={shelf.tracks} actions={actions} />;
  return (
    <div className="flex flex-wrap gap-4 px-3">
      {shelf.cards.map((card) => (
        <Card key={`${card.kind}:${card.id}`} card={card} onOpen={actions.onOpen} />
      ))}
    </div>
  );
}

/**
 * The end of a chip's list. Coming within a screen of it loads the next page,
 * as YouTube Music does; there is no button.
 */
function More({ loading, onReach }: { loading: boolean; onReach: () => void }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = end.current;
    if (!target || loading) return;
    // The margin only widens the root, so the root has to be the scroll area
    // the results sit in, not the window.
    const root = target.closest<HTMLElement>("[data-slot=scroll-area-viewport]");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onReach();
      },
      { root, rootMargin: "100% 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [loading, onReach]);
  return (
    <div ref={end} className="flex h-12 items-center justify-center text-xs text-muted-foreground">
      {loading && (
        <span className="flex items-center gap-2">
          <Spinner size={14} />
          Loading more results
        </span>
      )}
    </div>
  );
}

function Tracks({ tracks, actions }: { tracks: Track[]; actions: BrowseActions }) {
  return (
    <TrackList
      tracks={tracks}
      currentId={actions.currentId}
      playing={actions.playing}
      onToggle={actions.onToggle}
      // As in YouTube Music: a song or video from search starts its radio.
      onPlay={(id) => actions.onPlay(tracks, id, { kind: "radio" })}
      onOpen={actions.onOpen}
    />
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-2 px-3">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** Whether a search came back with nothing to show. */
export function isEmpty(results: SearchResults | null): boolean {
  return results !== null && results.top === null && results.shelves.length === 0;
}
