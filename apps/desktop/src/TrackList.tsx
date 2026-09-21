import { IconPlaylistAdd, IconVolume } from "@tabler/icons-react";
import type { Track, TrackId } from "@ytbm/core";

import { IconButton } from "@/components/IconButton";
import { cn } from "@/lib/utils";
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
    <ul>
      {tracks.map((track) => {
        const isCurrent = track.id === currentId;
        return (
          <li key={track.id}>
            <div
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-1.5 transition-colors",
                isCurrent ? "bg-accent" : "hover:bg-accent/60",
              )}
            >
              <button
                type="button"
                onClick={() => onPlay(track.id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none"
              >
                <Artwork track={track} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {/* YouTube Music marks the playing row with a small red
                        speaker rather than by recolouring the title. */}
                    {isCurrent && (
                      <IconVolume size={14} className="shrink-0 text-brand" aria-hidden />
                    )}
                    <span className="truncate text-sm">{track.title}</span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {track.artists[0]?.name}
                    {track.album ? ` — ${track.album}` : ""}
                  </span>
                </span>
              </button>
              <IconButton
                label="Add to queue"
                onClick={() => onEnqueue(track)}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              >
                <IconPlaylistAdd size={17} stroke={1.75} />
              </IconButton>
              <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
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
export function Artwork({ track, size = "size-9" }: { track: Track; size?: string }) {
  const art = track.thumbnails[0];
  const shared = cn(size, "shrink-0 rounded object-cover");
  if (!art) {
    return (
      <span
        className={cn(shared, "flex items-center justify-center bg-secondary text-xs text-muted-foreground")}
      >
        {track.title.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return <img src={art.url} alt="" className={shared} loading="lazy" />;
}
