import { useState } from "react";
import { IconBrandYoutube, IconMusic } from "@tabler/icons-react";
import type { Track } from "@ytbm/core";
import { isTauri } from "@ytbm/ipc";

import { NowPlaying } from "./NowPlaying.tsx";
import { Queue } from "./Queue.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { TitleBar } from "./TitleBar.tsx";
import { TrackList } from "./TrackList.tsx";
import { useLibrary } from "./useLibrary.ts";
import { usePlayer } from "./usePlayer.ts";
import { useYouTubeSearch } from "./useYouTubeSearch.ts";

type Source = "library" | "youtube";

export function App() {
  const [source, setSource] = useState<Source>("library");
  // One query per source. Sharing it would mean switching tabs fires a search
  // for a string typed for somewhere else, which is rarely what was meant.
  const [queries, setQueries] = useState<Record<Source, string>>({ library: "", youtube: "" });
  const query = queries[source];

  const library = useLibrary(queries.library);
  const youtube = useYouTubeSearch(queries.youtube, source === "youtube");
  const player = usePlayer();

  const results: readonly Track[] = source === "library" ? library.tracks : youtube.tracks;
  const loading = source === "library" ? library.loading : youtube.loading;
  const error = source === "library" ? library.error : youtube.error;

  return (
    <div className="flex h-full flex-col bg-neutral-950/80 text-neutral-100">
      <TitleBar />

      <div className="flex min-h-0 flex-1">
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
            <input
              type="search"
              value={query}
              onChange={(e) => setQueries((q) => ({ ...q, [source]: e.target.value }))}
              placeholder={
                source === "library" ? "Search your library" : "Search YouTube Music"
              }
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm placeholder:text-neutral-600 focus:border-emerald-500/50 focus:outline-none"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
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
        </main>

        <Queue
          queue={player.queue}
          onJump={(trackId) => player.dispatch({ type: "jumpTo", trackId })}
          onRemove={(trackId) => player.dispatch({ type: "remove", trackId })}
          onClear={() => player.dispatch({ type: "clear" })}
        />
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
        onVolume={player.setVolume}
        onRepeat={player.setRepeat}
        onShuffle={player.setShuffle}
      />
    </div>
  );
}

function SourceTabs({
  source,
  onChange,
}: {
  source: Source;
  onChange: (source: Source) => void;
}) {
  return (
    <div className="flex shrink-0 gap-1 rounded-md bg-white/5 p-1">
      <Tab active={source === "library"} onClick={() => onChange("library")} label="Library">
        <IconMusic size={15} stroke={1.75} />
      </Tab>
      <Tab active={source === "youtube"} onClick={() => onChange("youtube")} label="YouTube">
        <IconBrandYoutube size={15} stroke={1.75} />
      </Tab>
    </div>
  );
}

function Tab(props: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.active}
      className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition ${
        props.active
          ? "bg-white/10 text-neutral-100"
          : "text-neutral-500 hover:text-neutral-300"
      }`}
    >
      {props.children}
      {props.label}
    </button>
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
    <div className="flex h-full flex-col items-center justify-center gap-1 px-8 text-center">
      <p className="text-sm text-neutral-300">{title}</p>
      <p className="text-xs text-neutral-500">{detail}</p>
    </div>
  );
}
