import { useState } from "react";
import { isTauri } from "@ytbm/ipc";

import { NowPlaying } from "./NowPlaying.tsx";
import { Queue } from "./Queue.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { TitleBar } from "./TitleBar.tsx";
import { TrackList } from "./TrackList.tsx";
import { useLibrary } from "./useLibrary.ts";
import { usePlayer } from "./usePlayer.ts";

export function App() {
  const [query, setQuery] = useState("");
  const library = useLibrary(query);
  const player = usePlayer();

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
          <div className="px-4 py-3">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your library"
              className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm placeholder:text-neutral-600 focus:border-emerald-500/50 focus:outline-none"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {library.error ? (
              <Empty title="Library unavailable" detail={library.error} />
            ) : library.tracks.length === 0 && !library.loading ? (
              <Empty
                title={query ? "No matches" : "Your library is empty"}
                detail={
                  query
                    ? `Nothing matches “${query}”.`
                    : isTauri
                      ? "Add a music folder to get started."
                      : "The library needs the desktop app."
                }
              />
            ) : (
              <TrackList
                tracks={library.tracks}
                currentId={player.track?.id ?? null}
                onPlay={(id) => player.playTrack(library.tracks, id)}
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

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 px-8 text-center">
      <p className="text-sm text-neutral-300">{title}</p>
      <p className="text-xs text-neutral-500">{detail}</p>
    </div>
  );
}
