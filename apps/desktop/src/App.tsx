import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconArrowLeft, IconSearch } from "@tabler/icons-react";
import type { Track, TrackId } from "@ymusic/core";

import { IconButton } from "@/components/IconButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AccountMenu } from "./AccountMenu.tsx";
import { BrowseView, type BrowseActions } from "./Browse.tsx";
import { FullPlayer } from "./FullPlayer.tsx";
import { LocalView } from "./Local.tsx";
import { NowPlaying } from "./NowPlaying.tsx";
import { ScrollParent } from "./scroll.ts";
import { Sidebar } from "./Sidebar.tsx";
import { TitleBar } from "./TitleBar.tsx";
import { TrackList } from "./TrackList.tsx";
import { useAccount } from "./useAccount.ts";
import { viewKey, type View } from "./useBrowse.ts";
import { useLibrary } from "./useLibrary.ts";
import { useLibraryPlaylists } from "./useLibraryPlaylists.ts";
import { useMediaSession } from "./useMediaSession.ts";
import { usePlayer, type PlayFrom } from "./usePlayer.ts";
import { useYouTubeSearch, type YouTubeSearchState } from "./useYouTubeSearch.ts";

const SIDEBAR_KEY = "ymusic.sidebar-collapsed";
/** How far back Back can go. */
const HISTORY_LIMIT = 50;
/** Local matches shown above YouTube's before "Show all". */
const LOCAL_PREVIEW = 5;

export function App() {
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
  const youtube = useYouTubeSearch(query, true);
  const player = usePlayer();
  const account = useAccount();
  const playlists = useLibraryPlaylists(account.account?.name ?? null);
  useMediaSession(player);

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
  const back = useCallback(() => {
    setExpanded(false);
    setHistory((entries) => (entries.length > 1 ? entries.slice(0, -1) : entries));
  }, []);
  const showSearch = () => {
    go(null);
    searchInput.current?.focus();
  };

  // Restores the offset saved for this depth, or the top for a new page.
  useLayoutEffect(() => {
    if (viewport) viewport.scrollTop = scrolls.current[depth] ?? 0;
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
  const browse: BrowseActions = {
    currentId: player.track?.id ?? null,
    playing: player.playback.status === "playing",
    onToggle: player.toggle,
    onPlay: (tracks: Track[], id: TrackId | null, from?: PlayFrom) => {
      if (tracks.length === 0) return;
      if (id === null) {
        // Shuffle first, so the queue is laid down shuffled from a random start.
        player.setShuffle(true);
        id = tracks[Math.floor(Math.random() * tracks.length)]!.id;
      }
      player.playTrack(tracks, id, from);
    },
    onEnqueue: (track) => player.dispatch({ type: "enqueueLast", tracks: [track] }),
    onOpen: go,
  };

  return (
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
          localCount={library.all.length}
          report={library.report}
          loading={library.loading}
          onAddFolder={() => void library.addFolder()}
          onRemoveFolder={(path) => void library.removeFolder(path)}
          onRescan={() => void library.rescan()}
        />

        <div className="relative flex min-w-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-3 px-4 py-3">
              {depth > 0 && (
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
              <AccountMenu state={account} />
            </div>

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
                  {view?.kind === "local" ? (
                    <LocalView folder={view.id} all={library.all} actions={browse} />
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
              onClear={() => player.dispatch({ type: "clear" })}
              onCollapse={() => setExpanded(false)}
            />
          )}
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
      />
    </div>
  );
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
            onEnqueue={actions.onEnqueue}
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
              onEnqueue={actions.onEnqueue}
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
