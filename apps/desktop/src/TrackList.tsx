import { IconPlaylistAdd } from "@tabler/icons-react";
import type { Track, TrackId } from "@ytbm/core";

import { formatDuration } from "./format.ts";

interface Props {
  /** Any source: a local file and a YouTube result render identically. */
  tracks: readonly Track[];
  currentId: TrackId | null;
  onPlay: (id: TrackId) => void;
  onEnqueue: (track: Track) => void;
}

export function TrackList({ tracks, currentId, onPlay, onEnqueue }: Props) {
  if (tracks.length === 0) return null;

  return (
    <ul className="divide-y divide-white/5">
      {tracks.map((track) => {
        const isCurrent = track.id === currentId;
        return (
          <li key={track.id}>
            <div
              className={`group flex items-center gap-3 px-4 py-2 ${
                isCurrent ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              <button
                type="button"
                onDoubleClick={() => onPlay(track.id)}
                onClick={() => onPlay(track.id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <Artwork track={track} />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-sm ${
                      isCurrent ? "text-emerald-400" : "text-neutral-100"
                    }`}
                  >
                    {track.title}
                  </span>
                  <span className="block truncate text-xs text-neutral-400">
                    {track.artists[0]?.name}
                    {track.album ? ` — ${track.album}` : ""}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onEnqueue(track)}
                title="Add to queue"
                aria-label="Add to queue"
                className="shrink-0 rounded p-1.5 text-neutral-400 opacity-0 transition hover:bg-white/10 hover:text-neutral-100 group-hover:opacity-100"
              >
                <IconPlaylistAdd size={17} stroke={1.75} />
              </button>
              <span className="w-12 shrink-0 text-right text-xs tabular-nums text-neutral-500">
                {formatDuration(track.durationMs)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Falls back to the first letter, so a missing cover still reads as a row. */
export function Artwork({ track, size = "h-9 w-9" }: { track: Track; size?: string }) {
  const art = track.thumbnails[0];
  const shared = `${size} shrink-0 rounded object-cover`;
  if (!art) {
    return (
      <span
        className={`${shared} flex items-center justify-center bg-white/5 text-xs text-neutral-500`}
      >
        {track.title.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return <img src={art.url} alt="" className={shared} loading="lazy" />;
}
