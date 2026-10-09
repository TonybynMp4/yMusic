import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconArrowLeft, IconSearch } from "@tabler/icons-react";
import { type Track, type TrackId, type VideoId, videoIdFromTrackId } from "@ymusic/core";
import type { Settings } from "@ymusic/ipc";
import type { Rating } from "@ymusic/youtube/host";

import { IconButton } from "@/components/IconButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AccountMenu } from "./AccountMenu.tsx";
import { BrowseView, type BrowseActions } from "./Browse.tsx";
import { FullPlayer } from "./FullPlayer.tsx";
import { InteractionsProvider, type Interactions } from "./Interactions.tsx";
import { LocalView } from "./Local.tsx";
import type { ScenarioControls } from "./memoryScenario.ts";
import { NowPlaying } from "./NowPlaying.tsx";
import { ScrollParent } from "./scroll.ts";
import { SettingsView } from "./Settings.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { TitleBar } from "./TitleBar.tsx";
import { TrackList } from "./TrackList.tsx";
import { UpdateNotice } from "./UpdateNotice.tsx";
import { useAccount } from "./useAccount.ts";
import { viewKey, type View } from "./useBrowse.ts";
import { useLibrary } from "./useLibrary.ts";
import { useLibraryPlaylists } from "./useLibraryPlaylists.ts";
import { useMediaSession } from "./useMediaSession.ts";
import { useResume } from "./useResume.ts";
import { useSettings } from "./useSettings.ts";
import { useUpdates } from "./useUpdates.ts";
import { usePlayer, type PlayFrom } from "./usePlayer.ts";
import { useYouTubeSearch, type YouTubeSearchState } from "./useYouTubeSearch.ts";

const SIDEBAR_KEY = "ymusic.sidebar-collapsed";
/** How far back Back can go. */
const HISTORY_LIMIT = 50;
/** Local matches shown above YouTube's before "Show all". */
const LOCAL_PREVIEW = 5;

export function App(props: { settings: Settings }) {
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

  const library = useLibrary(query);
  const settings = useSettings(props.settings);
  const youtube = useYouTubeSearch(query, true, settings.settings.pauseSearchHistory);
  const account = useAccount();
  const player = usePlayer(settings, account.account?.name ?? null);
  const playlists = useLibraryPlaylists(account.account?.name ?? null);
  useMediaSession(player);
  useResume(player, account.account?.name ?? null);
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

  // The memory harness's scripted session. Without the build flag the test is
  // a constant and the scenario is left out of the bundle.
  const scenario = useRef<ScenarioControls | null>(null);
  scenario.current = {
    go,
    playTrack: player.playTrack,
    setVolume: player.setVolume,
    seek: player.seek,
    next: player.next,
    trackId: player.track?.id ?? null,
    status: player.playback.status,
    durationMs: player.playback.durationMs,
    signedIn: account.account !== null,
  };
  useEffect(() => {
    if (!import.meta.env.VITE_MEMORY_SCENARIO) return;
    void import("./memoryScenario.ts").then(({ runMemoryScenario }) =>
      runMemoryScenario(() => scenario.current!),
    );
  }, []);

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
  const interactions: Interactions = {
    signedIn: account.account !== null,
    play,
    enqueue: (tracks, at) =>
      player.dispatch({ type: at === "next" ? "enqueueNext" : "enqueueLast", tracks }),
    open: go,
    notify: notice.show,
    libraryChanged: playlists.reload,
    playlistCreated: playlists.created,
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
              <div className="relative min-w-0 flex-1">
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
                  placeholder="Search YouTube Music and your files"
                  // A pill on a dark field, which is the shape YouTube Music uses.
                  className="h-9 rounded-full bg-secondary pl-9"
                />
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
                          actions={browse}
                        />
                      )}
                    </div>
                  </ScrollParent>
                </ScrollArea>
              </main>

              {expanded && (
                <FullPlayer
                  track={player.track}
                  queue={player.queue}
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
          onVolume={player.setVolume}
          onRepeat={player.setRepeat}
          onShuffle={player.setShuffle}
          expanded={expanded}
          onToggleExpanded={() => setExpanded((open) => !open)}
          rating={rating}
          onOpen={go}
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
}) {
  const { query, local, youtube, actions } = props;
  const [showAll, setShowAll] = useState(false);
  if (query.trim().length === 0) {
    return <Empty title="Search" detail="Find songs on YouTube Music and in your local files." />;
  }
  const shown = showAll ? local : local.slice(0, LOCAL_PREVIEW);
  const nothing = local.length === 0 && youtube.tracks.length === 0;
  return (
    <>
      {local.length > 0 && (
        <section className="mb-4">
          <div className="flex items-baseline justify-between px-3 pt-1">
            <h2 className="mb-1 text-sm font-semibold">In your files</h2>
            {local.length > LOCAL_PREVIEW && (
              <Button variant="ghost" size="sm" onClick={() => setShowAll((all) => !all)}>
                {showAll ? "Show fewer" : `Show all ${local.length}`}
              </Button>
            )}
          </div>
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
        youtube.tracks.length > 0 && (
          <section>
            {local.length > 0 && <h2 className="mb-1 px-3 text-sm font-semibold">YouTube Music</h2>}
            <TrackList
              tracks={youtube.tracks}
              currentId={actions.currentId}
              playing={actions.playing}
              onToggle={actions.onToggle}
              // As in YouTube Music: a song from search starts its radio.
              onPlay={(id) => actions.onPlay(youtube.tracks, id, { kind: "radio" })}
              onOpen={actions.onOpen}
            />
          </section>
        )
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
