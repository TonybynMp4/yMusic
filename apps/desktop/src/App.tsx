import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { IconArrowLeft, IconHistory, IconSearch, IconX } from "@tabler/icons-react";
import { type Track, type TrackId, type VideoId, videoIdFromTrackId } from "@ymusic/core";
import type { SavedVolume, Settings } from "@ymusic/ipc";
import type { Rating } from "@ymusic/youtube/host";

import { IconButton } from "@/components/IconButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AccountMenu } from "./AccountMenu.tsx";
import { BrowseView, ShelfHeader, type BrowseActions } from "./Browse.tsx";
import { FullPlayer } from "./FullPlayer.tsx";
import { InteractionsProvider, type Interactions } from "./Interactions.tsx";
import { LibraryView } from "./Library.tsx";
import { LocalView } from "./Local.tsx";
import { NowPlaying } from "./NowPlaying.tsx";
import { recordPlayed } from "./recent.ts";
import { ScrollParent } from "./scroll.ts";
import { isEmpty, SearchChips, YouTubeResults } from "./Search.tsx";
import { SettingsView } from "./Settings.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { TitleBar } from "./TitleBar.tsx";
import { TrackList } from "./TrackList.tsx";
import { UpdateNotice } from "./UpdateNotice.tsx";
import { useAccount } from "./useAccount.ts";
import { forgetPage, viewKey, type View } from "./useBrowse.ts";
import { tracksIn, useLibrary } from "./useLibrary.ts";
import { useLibraryPlaylists } from "./useLibraryPlaylists.ts";
import { forgetSaved } from "./useSavedLibrary.ts";
import { useMediaSession } from "./useMediaSession.ts";
import { useResume } from "./useResume.ts";
import { useSavedQueue } from "./useSavedQueue.ts";
import { searchHistoryIn, useSearchHistory, type RecentSearch } from "./useSearchHistory.ts";
import { useSettings } from "./useSettings.ts";
import { useUpdates } from "./useUpdates.ts";
import { usePlayer, type PlayFrom } from "./usePlayer.ts";
import { useYouTubeSearch, type YouTubeSearchState } from "./useYouTubeSearch.ts";

const SIDEBAR_KEY = "ymusic.sidebar-collapsed";
/** How far back Back can go. */
const HISTORY_LIMIT = 50;
/** Local matches shown above YouTube's before "Show all". */
const LOCAL_PREVIEW = 5;

export function App(props: { settings: Settings; volume: SavedVolume }) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  // Where you have been, newest last; `null` is search. Every move pushes,
  // sidebar ones included, so Back always returns to the previous screen.
  const [history, setHistory] = useState<(View | null)[]>([null]);
  const view = history.at(-1) ?? null;
  const depth = history.length - 1;
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  /** Scroll offsets by history depth, so Back lands where you left. */
  const scrolls = useRef<number[]>([]);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === "1");
  const searchInput = useRef<HTMLInputElement>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  const library = useLibrary(query);
  const settings = useSettings(props.settings);
  const account = useAccount();
  const signedIn = account.account !== null;
  // Only "youtube" searches with the account: that is what records them there.
  const youtube = useYouTubeSearch(
    query,
    true,
    searchHistoryIn(settings.settings.searchHistory, signedIn) === "youtube",
  );
  const searchEmpty = query.trim().length === 0;
  // The empty search page lists recent searches itself; over any other page
  // they drop down from the focused box.
  const recentOnPage = searchEmpty && view === null;
  const recentInBox = searchEmpty && searchFocused && view !== null;
  const searchHistory = useSearchHistory(
    settings.settings.searchHistory,
    signedIn,
    recentOnPage || recentInBox,
  );
  const player = usePlayer(settings, account.account?.name ?? null, props.volume.volume);
  const playlists = useLibraryPlaylists(account.account?.name ?? null);
  useMediaSession(player);
  useRecordPlays(player, library);
  const resumed = useResume(player, account.account?.name ?? null, !account.busy);
  useSavedQueue(player, resumed);
  const notice = useNotice();
  const updates = useUpdates(props.settings.checkForUpdates);

  const toggleSidebar = () =>
    setCollapsed((c) => {
      localStorage.setItem(SIDEBAR_KEY, c ? "0" : "1");
      return !c;
    });
  const go = (next: View | null) => {
    setExpanded(false);
    setHistory((entries) => {
      const current = entries.at(-1) ?? null;
      const same = current === next || (current && next && viewKey(current) === viewKey(next));
      if (same) return entries;
      scrolls.current.length = entries.length;
      return [...entries, next].slice(-HISTORY_LIMIT);
    });
  };
  // With the player open, Back closes it and stays on the page under it.
  const back = useCallback(() => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setHistory((entries) => (entries.length > 1 ? entries.slice(0, -1) : entries));
  }, [expanded]);
  /**
   * Takes a deleted playlist out of history, so Back never lands on it, and
   * leaves its page if that is where you are.
   */
  const playlistDeleted = (id: string, title: string) => {
    const gone = (entry: View | null) => entry?.kind === "playlist" && entry.id === id;
    const kept: (View | null)[] = [];
    const offsets: number[] = [];
    history.forEach((entry, i) => {
      if (gone(entry)) return;
      // Two visits to the same page, once apart, become one.
      const last = kept.at(-1);
      const same = last === entry || (last && entry && viewKey(last) === viewKey(entry));
      if (kept.length > 0 && same) return;
      kept.push(entry);
      offsets.push(scrolls.current[i] ?? 0);
    });
    scrolls.current = offsets;
    setHistory(kept.length > 0 ? kept : [null]);
    playlists.deleted(id);
    forgetSaved("playlists");
    forgetPage({ kind: "playlist", id });
    notice.show(`Deleted ${title}`);
  };
  const showSearch = () => {
    go(null);
    searchInput.current?.focus();
  };

  // Restores the offset saved for this depth, or the top for a new page. A
  // page the browse cache dropped arrives again a moment later, too short to
  // scroll that far at first, so the offset is applied again as it grows,
  // until it is reached or the user scrolls.
  useLayoutEffect(() => {
    if (!viewport) return;
    const target = scrolls.current[depth] ?? 0;
    viewport.scrollTop = target;
    const content = viewport.firstElementChild;
    if (viewport.scrollTop >= target || !content) return;
    let applied = viewport.scrollTop;
    const observer = new ResizeObserver(() => {
      if (viewport.scrollTop !== applied) return observer.disconnect();
      viewport.scrollTop = target;
      applied = viewport.scrollTop;
      if (applied >= target) observer.disconnect();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [viewport, depth]);

  // The mouse's back button and Alt+Left, as in a browser.
  useEffect(() => {
    const onMouse = (event: MouseEvent) => {
      if (event.button === 3) back();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.key === "ArrowLeft") back();
    };
    window.addEventListener("mouseup", onMouse);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mouseup", onMouse);
      window.removeEventListener("keydown", onKey);
    };
  }, [back]);
  const play = (tracks: Track[], id: TrackId | null, from?: PlayFrom) => {
    if (tracks.length === 0) return;
    if (id === null) {
      // Shuffle first, so the queue is laid down shuffled from a random start.
      player.setShuffle(true);
      id = tracks[Math.floor(Math.random() * tracks.length)]!.id;
    }
    player.playTrack(tracks, id, from);
  };
  /** Rates a song, from the player bar or a song's menu, and says what happened. */
  const rate = (videoId: VideoId, value: Rating) => {
    const before = player.ratingOf(videoId);
    void player
      .rate(videoId, value)
      .then(() => {
        if (value === "like") notice.show("Saved to Liked Music");
        else if (before === "like") notice.show("Removed from Liked Music");
        // A liked song is a saved one, so the library's Songs chip changes too.
        if (value === "like" || before === "like") forgetSaved("songs");
      })
      .catch((error: unknown) =>
        notice.show(error instanceof Error ? error.message : String(error)),
      );
  };
  // Null for a local file or while signed out: the rating is the account's.
  const playingId = player.track === null ? null : videoIdFromTrackId(player.track.id);
  const playingRating = playingId === null ? null : player.ratingOf(playingId);
  const rating =
    playingRating !== null && playingId !== null
      ? { rating: playingRating, onRate: (value: Rating) => rate(playingId, value) }
      : null;
  const browse: BrowseActions = {
    currentId: player.track?.id ?? null,
    playing: player.playback.status === "playing",
    onToggle: player.toggle,
    onPlay: play,
    onOpen: go,
  };
  // Playing or opening a result is what makes a search worth remembering,
  // not each pause in typing.
  const searchActions: BrowseActions = {
    ...browse,
    onPlay: (tracks, id, from) => {
      remember(query);
      play(tracks, id, from);
    },
    onOpen: (next) => {
      remember(query);
      go(next);
    },
  };
  /** Records a search where the setting keeps them, leaving the results as they are. */
  const remember = (searched: string) => {
    searchHistory.record(searched);
    youtube.record(searched);
  };
  /** Records a search and, kept on the account, shows the account's results for it. */
  const submit = (searched: string) => {
    searchHistory.record(searched);
    youtube.submit(searched);
  };
  const searchAgain = (past: string) => {
    setQuery(past);
    submit(past);
    // The button picked from the keyboard is about to unmount, so focus goes
    // back to the box rather than the page.
    searchInput.current?.focus();
    go(null);
  };
  const interactions: Interactions = {
    signedIn,
    play,
    enqueue: (tracks, at) =>
      player.dispatch({ type: at === "next" ? "enqueueNext" : "enqueueLast", tracks }),
    open: go,
    notify: notice.show,
    libraryChanged: () => {
      playlists.reload();
      forgetSaved();
    },
    playlistCreated: playlists.created,
    playlistDeleted,
    ratingOf: player.ratingOf,
    rate,
  };

  return (
    <InteractionsProvider value={interactions}>
      <div className="flex h-full flex-col bg-background text-foreground">
        <TitleBar />

        <div className="flex min-h-0 flex-1">
          {/* Outside the area the expanded player covers, so the library stays
              reachable with the player open. */}
          <Sidebar
            collapsed={collapsed}
            onToggleCollapsed={toggleSidebar}
            current={expanded ? "player" : view ? viewKey(view) : null}
            onSearch={showSearch}
            onNavigate={go}
            playlists={playlists.playlists}
            folders={library.folders}
            covers={library.covers}
            localCount={library.all.length}
            report={library.report}
            loading={library.loading || playlists.loading}
            onAddFolder={() => void library.addFolder()}
            onRemoveFolder={(path) => void library.removeFolder(path)}
            onRefresh={() => {
              playlists.reload();
              forgetSaved();
              if (library.folders.length > 0) void library.rescan();
            }}
          />

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Above the area the expanded player covers, like the sidebar, so
                search and settings stay reachable with the player open. */}
            <div className="flex items-center gap-3 px-4 py-3">
              {(depth > 0 || expanded) && (
                <IconButton label="Back" size="icon" onClick={back}>
                  <IconArrowLeft size={18} stroke={1.75} />
                </IconButton>
              )}
              {/* Focus is tracked on the box and its list together, so Tab can
                  move into the recent searches without closing them. */}
              <div
                className="relative min-w-0 flex-1"
                onFocus={() => setSearchFocused(true)}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) setSearchFocused(false);
                }}
              >
                <IconSearch
                  size={15}
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  ref={searchInput}
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    // Typing is a new search, so it shows the results.
                    go(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit(query);
                    if (e.key === "Escape") e.currentTarget.blur();
                  }}
                  placeholder="Search YouTube Music and your files"
                  // A pill on a dark field, which is the shape YouTube Music uses.
                  className="h-9 rounded-full bg-secondary pr-9 pl-9"
                />
                {query.length > 0 && (
                  <IconButton
                    label="Clear search"
                    size="icon-xs"
                    onClick={() => {
                      setQuery("");
                      searchInput.current?.focus();
                    }}
                    className="absolute top-1/2 right-2 -translate-y-1/2"
                  >
                    <IconX />
                  </IconButton>
                )}
                {recentInBox && searchHistory.recent.length > 0 && (
                  <RecentSearches
                    floating
                    recent={searchHistory.recent}
                    onSearch={searchAgain}
                    onRemoved={() => searchInput.current?.focus()}
                  />
                )}
              </div>
              <AccountMenu
                state={account}
                onSettings={() => go({ kind: "settings", id: "" })}
              />
            </div>

            <div className="relative flex min-h-0 flex-1">
              <main className="flex min-w-0 flex-1 flex-col">
                {/* Keyed by position in history, so each screen mounts fresh. */}
                <ScrollArea
                  key={`${depth}:${view ? viewKey(view) : "search"}`}
                  viewportRef={setViewport}
                  onScrollCapture={(event) => {
                    if (event.target === viewport) scrolls.current[depth] = viewport.scrollTop;
                  }}
                  className="min-h-0 flex-1"
                >
                  <ScrollParent value={viewport}>
                    <div className="px-2 pb-2">
                      {view?.kind === "settings" ? (
                        <SettingsView
                          settings={settings}
                          library={library}
                          updates={updates}
                          account={account}
                        />
                      ) : view?.kind === "library" ? (
                        <LibraryView
                          account={account.account?.name ?? null}
                          playlists={playlists.playlists}
                          folders={library.folders}
                          covers={library.covers}
                          local={library.all}
                          localLoading={library.loading}
                          actions={browse}
                          onNavigate={go}
                        />
                      ) : view?.kind === "local" ? (
                        <LocalView
                          folder={view.id}
                          all={library.all}
                          cover={library.covers[view.id]}
                          actions={browse}
                        />
                      ) : view ? (
                        <BrowseView route={view} actions={browse} />
                      ) : (
                        <SearchResults
                          query={query}
                          local={library.matches}
                          youtube={youtube}
                          actions={searchActions}
                          recent={
                            searchHistory.recent.length > 0 && (
                              <RecentSearches
                                recent={searchHistory.recent}
                                onSearch={searchAgain}
                                onRemoved={() => searchInput.current?.focus()}
                              />
                            )
                          }
                        />
                      )}
                    </div>
                  </ScrollParent>
                </ScrollArea>
              </main>

              {expanded && (
                <FullPlayer
                  track={player.track}
                  lease={player.lease}
                  queue={player.queue}
                  playingFrom={player.playingFrom}
                  filling={player.filling}
                  autoplay={player.autoplay}
                  onAutoplay={player.setAutoplay}
                  onJump={(trackId) => player.dispatch({ type: "jumpTo", trackId })}
                  onRemove={(trackId) => player.dispatch({ type: "remove", trackId })}
                  onMove={(from, to) => player.dispatch({ type: "move", from, to })}
                  onClear={() => player.dispatch({ type: "clear" })}
                  onCollapse={() => setExpanded(false)}
                  rating={rating}
                  onOpen={go}
                  stats={settings.settings.statsForNerds}
                  onCloseStats={() => settings.update({ statsForNerds: false })}
                />
              )}
            </div>
          </div>
        </div>

        <NowPlaying
          track={player.track}
          playback={player.playback}
          position={player.position}
          repeat={player.queue.repeat}
          shuffle={player.queue.shuffle}
          onToggle={player.toggle}
          onNext={player.next}
          onPrevious={player.previous}
          onSeek={player.seek}
          volume={player.volume}
          unmutedVolume={props.volume.unmuted}
          onVolume={player.setVolume}
          onRepeat={player.setRepeat}
          onShuffle={player.setShuffle}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((open) => !open)}
          device={player.playingFrom?.device ?? null}
          rating={rating}
          onOpen={go}
          degraded={player.lease?.degraded ?? null}
        />
        <UpdateNotice updates={updates} />
        {notice.message && (
          <p
            role="status"
            className="pointer-events-none fixed bottom-28 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-4 py-2 text-sm text-background shadow-lg"
          >
            {notice.message}
          </p>
        )}
      </div>
    </InteractionsProvider>
  );
}

/**
 * Past searches, as YouTube Music lists them: on the empty search page, or
 * `floating` under the empty search box over any other page. A mouse down on
 * the floating list would blur the box and close the list before the click
 * lands, so it is held back. A removed entry takes its focused button with
 * it, so `onRemoved` puts focus back on the box.
 */
function RecentSearches(props: {
  recent: RecentSearch[];
  onSearch: (query: string) => void;
  onRemoved: () => void;
  floating?: boolean;
}) {
  return (
    <ul
      aria-label="Recent searches"
      onMouseDown={props.floating ? (e) => e.preventDefault() : undefined}
      className={
        props.floating
          ? "absolute top-full right-0 left-0 z-40 mt-1 max-h-96 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10"
          : "px-1"
      }
    >
      {props.recent.map((entry) => (
        <li key={entry.query} className="flex items-center rounded-md hover:bg-accent">
          <button
            type="button"
            onClick={() => props.onSearch(entry.query)}
            className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left text-sm"
          >
            <IconHistory size={16} className="shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{entry.query}</span>
          </button>
          {entry.remove && (
            <IconButton
              label={`Remove ${entry.query}`}
              size="icon-xs"
              onClick={() => {
                entry.remove?.();
                props.onRemoved();
              }}
            >
              <IconX />
            </IconButton>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Notes the local folders of each local file that starts playing, for the
 * library's "Recently played" sort of local files. YouTube orders the
 * account's lists itself.
 */
function useRecordPlays(
  player: ReturnType<typeof usePlayer>,
  library: ReturnType<typeof useLibrary>,
) {
  const playing = player.playback.status === "playing";
  const track = player.track;
  const recorded = useRef<TrackId | null>(null);
  const { all, folders } = library;
  useEffect(() => {
    if (!playing || track === null || recorded.current === track.id) return;
    recorded.current = track.id;
    const local = all.find((t) => t.id === track.id);
    if (!local) return;
    recordPlayed([
      "local:",
      ...folders.filter((folder) => tracksIn([local], folder).length > 0).map((f) => `local:${f}`),
    ]);
  }, [playing, track, all, folders]);
}

/** How long a notice stays up. */
const NOTICE_MS = 4000;

/** One short message at a time, as YouTube Music's snackbar shows them. */
function useNotice() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string) => {
    window.clearTimeout(timer.current);
    setMessage(text);
    timer.current = window.setTimeout(() => setMessage(null), NOTICE_MS);
  }, []);
  return { message, show };
}

/**
 * One search over both sources: matching local files first, since they are
 * already yours, then YouTube Music.
 */
function SearchResults(props: {
  query: string;
  local: readonly Track[];
  youtube: YouTubeSearchState;
  actions: BrowseActions;
  /** What the page shows before anything is typed, when there are recent searches. */
  recent: ReactNode;
}) {
  const { query, local, youtube, actions } = props;
  const [showAll, setShowAll] = useState(false);
  if (query.trim().length === 0) {
    return props.recent ? (
      <section className="mb-6">
        <ShelfHeader title="Recent searches" />
        {props.recent}
      </section>
    ) : (
      <Empty
        title="Search"
        detail="Find songs, videos, albums, playlists and artists on YouTube Music, and songs in your files."
      />
    );
  }
  const shown = showAll ? local : local.slice(0, LOCAL_PREVIEW);
  // Local files belong with everything, not with one kind of YouTube result.
  const withLocal = youtube.filter === null && local.length > 0;
  const nothing = !withLocal && isEmpty(youtube.results);
  return (
    <>
      <SearchChips youtube={youtube} />
      {withLocal && (
        <section className="mb-6">
          <ShelfHeader
            title="In your files"
            action={
              local.length > LOCAL_PREVIEW && (
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => setShowAll((all) => !all)}
                >
                  {showAll ? "Show fewer" : `Show all ${local.length}`}
                </Button>
              )
            }
          />
          <TrackList
            tracks={shown}
            currentId={actions.currentId}
            playing={actions.playing}
            onToggle={actions.onToggle}
            onPlay={(id) => actions.onPlay([...local], id)}
          />
        </section>
      )}
      {youtube.error ? (
        <Empty title="YouTube Music search unavailable" detail={youtube.error} />
      ) : nothing && !youtube.loading ? (
        <Empty title="No matches" detail={`Nothing matches “${query}”.`} />
      ) : (
        <YouTubeResults youtube={youtube} actions={actions} />
      )}
    </>
  );
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-8 py-24 text-center">
      <p className="text-sm">{title}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
