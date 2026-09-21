import { useState } from "react";
import { IconBrandYoutube, IconMusic, IconSearch } from "@tabler/icons-react";
import type { Track } from "@ytbm/core";
import { isTauri } from "@ytbm/ipc";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./AccountMenu.tsx";
import { FullPlayer } from "./FullPlayer.tsx";
import { NowPlaying } from "./NowPlaying.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { TitleBar } from "./TitleBar.tsx";
import { TrackList } from "./TrackList.tsx";
import { useAccount } from "./useAccount.ts";
import { useLibrary } from "./useLibrary.ts";
import { useMediaSession } from "./useMediaSession.ts";
import { usePlayer } from "./usePlayer.ts";
import { useYouTubeSearch } from "./useYouTubeSearch.ts";

type Source = "library" | "youtube";

export function App() {
  const [source, setSource] = useState<Source>("library");
  const [expanded, setExpanded] = useState(false);
  // One query per source. Sharing it would mean switching tabs fires a search
  // for a string typed for somewhere else, which is rarely what was meant.
  const [queries, setQueries] = useState<Record<Source, string>>({ library: "", youtube: "" });
  const query = queries[source];

  const library = useLibrary(queries.library);
  const youtube = useYouTubeSearch(queries.youtube, source === "youtube");
  const player = usePlayer();
  const account = useAccount();
  useMediaSession(player);

  const results: readonly Track[] = source === "library" ? library.tracks : youtube.tracks;
  const loading = source === "library" ? library.loading : youtube.loading;
  const error = source === "library" ? library.error : youtube.error;

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <TitleBar />

      {/* `relative` so the expanded player can cover the browsing area while
          leaving the title bar and the player bar reachable. */}
      <div className="relative flex min-h-0 flex-1">
        <Sidebar
          folders={library.folders}
          report={library.report}
          loading={library.loading}
          onAddFolder={() => void library.addFolder()}
          onRemoveFolder={(path) => void library.removeFolder(path)}
          onRescan={() => void library.rescan()}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 px-4 py-3">
            <SourceTabs source={source} onChange={setSource} />
            <div className="relative min-w-0 flex-1">
              <IconSearch
                size={15}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQueries((q) => ({ ...q, [source]: e.target.value }))}
                placeholder={source === "library" ? "Search your library" : "Search YouTube Music"}
                // A pill on a dark field, which is the shape YouTube Music uses.
                className="h-9 rounded-full bg-secondary pl-9"
              />
            </div>
            <AccountMenu state={account} />
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="px-2 pb-2">
              {error ? (
                <Empty
                  title={source === "library" ? "Library unavailable" : "Search unavailable"}
                  detail={error}
                />
              ) : results.length === 0 && !loading ? (
                <Empty {...emptyCopy(source, query)} />
              ) : (
                <TrackList
                  tracks={results}
                  currentId={player.track?.id ?? null}
                  onPlay={(id) => player.playTrack([...results], id)}
                  onEnqueue={(track) => player.dispatch({ type: "enqueueLast", tracks: [track] })}
                />
              )}
            </div>
          </ScrollArea>
        </main>

        {expanded && (
          <FullPlayer
            track={player.track}
            queue={player.queue}
            onJump={(trackId) => player.dispatch({ type: "jumpTo", trackId })}
            onRemove={(trackId) => player.dispatch({ type: "remove", trackId })}
            onClear={() => player.dispatch({ type: "clear" })}
            onCollapse={() => setExpanded(false)}
          />
        )}
      </div>

      <NowPlaying
        track={player.track}
        playback={player.playback}
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

function SourceTabs({ source, onChange }: { source: Source; onChange: (source: Source) => void }) {
  return (
    <div className="flex shrink-0 gap-1">
      <Tab active={source === "library"} onClick={() => onChange("library")} label="Library">
        <IconMusic size={15} stroke={1.75} />
      </Tab>
      <Tab active={source === "youtube"} onClick={() => onChange("youtube")} label="YouTube Music">
        <IconBrandYoutube size={15} stroke={1.75} />
      </Tab>
    </div>
  );
}

/** A filled pill for the active tab, transparent for the rest — YouTube
 *  Music's chip row, rather than a segmented control in a tinted well. */
function Tab(props: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={props.onClick}
      aria-pressed={props.active}
      className={cn(
        "rounded-full",
        props.active
          ? "bg-foreground text-background hover:bg-foreground hover:text-background"
          : "bg-secondary text-muted-foreground",
      )}
    >
      {props.children}
      {props.label}
    </Button>
  );
}

function emptyCopy(source: Source, query: string): { title: string; detail: string } {
  if (source === "youtube") {
    return query
      ? { title: "No matches", detail: `Nothing on YouTube Music matches “${query}”.` }
      : { title: "Search YouTube Music", detail: "Type to find a song." };
  }
  if (query) return { title: "No matches", detail: `Nothing matches “${query}”.` };
  return {
    title: "Your library is empty",
    detail: isTauri ? "Add a music folder to get started." : "The library needs the desktop app.",
  };
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-8 py-24 text-center">
      <p className="text-sm">{title}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
