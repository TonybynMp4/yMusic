import { IconPlaylistAdd, IconVolume } from "@tabler/icons-react";
import type { Track, TrackId } from "@ytbm/core";
import { Fragment, type ReactNode } from "react";

import { IconButton } from "@/components/IconButton";
import { cn } from "@/lib/utils";
import { formatDuration } from "./format.ts";
import type { Route } from "./useBrowse.ts";

interface Props {
  /** Any source: a local file and a YouTube result render identically. */
  tracks: readonly Track[];
  currentId: TrackId | null;
  onPlay: (id: TrackId) => void;
  onEnqueue: (track: Track) => void;
  /** Opens an artist or album page. Without it, bylines are plain text. */
  onOpen?: (route: Route) => void;
  /** Leave the album out of the byline, as on the album's own page. */
  hideAlbum?: boolean;
}

export function TrackList({ tracks, currentId, onPlay, onEnqueue, onOpen, hideAlbum }: Props) {
  if (tracks.length === 0) return null;

  return (
    <ul>
      {tracks.map((track) => {
        const isCurrent = track.id === currentId;
        return (
          <li key={track.id}>
            {/* The whole row plays on click, for the mouse; the title is the
                real button, for the keyboard. Byline links sit inside the
                row but not inside that button, which cannot nest them. */}
            <div
              onClick={() => onPlay(track.id)}
              className={cn(
                "group flex cursor-default items-center gap-3 rounded-lg px-3 py-1.5 transition-colors",
                isCurrent ? "bg-accent" : "hover:bg-accent/60",
              )}
            >
              <Artwork track={track} />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  {/* YouTube Music marks the playing row with a small red
                      speaker rather than by recolouring the title. */}
                  {isCurrent && (
                    <IconVolume size={14} className="shrink-0 text-brand" aria-hidden />
                  )}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onPlay(track.id);
                    }}
                    className="truncate text-left text-sm outline-none focus-visible:underline"
                  >
                    {track.title}
                  </button>
                </span>
                <Byline track={track} onOpen={onOpen} hideAlbum={hideAlbum} />
              </span>
              <IconButton
                label="Add to queue"
                onClick={(event) => {
                  event.stopPropagation();
                  onEnqueue(track);
                }}
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

/** "Artist, Artist — Album", each part a link when it has a page to open. */
function Byline({
  track,
  onOpen,
  hideAlbum,
}: {
  track: Track;
  onOpen: ((route: Route) => void) | undefined;
  hideAlbum: boolean | undefined;
}) {
  const albumId = track.albumId;
  return (
    <span className="block truncate text-xs text-muted-foreground">
      {track.artists.map((artist, i) => (
        <Fragment key={`${artist.name}:${i}`}>
          {i > 0 && ", "}
          {onOpen && artist.channelId ? (
            <BylineLink onClick={() => onOpen({ kind: "artist", id: artist.channelId! })}>
              {artist.name}
            </BylineLink>
          ) : (
            artist.name
          )}
        </Fragment>
      ))}
      {!hideAlbum && track.album && (
        <>
          {track.artists.length > 0 && " — "}
          {onOpen && albumId ? (
            <BylineLink onClick={() => onOpen({ kind: "album", id: albumId })}>
              {track.album}
            </BylineLink>
          ) : (
            track.album
          )}
        </>
      )}
    </span>
  );
}

function BylineLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="outline-none hover:text-foreground hover:underline focus-visible:underline"
    >
      {children}
    </button>
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
  // The backdrop shows through if the image fails, which it does now and then
  // for a burst of artwork loaded at once.
  return <img src={art.url} alt="" className={cn(shared, "bg-secondary")} loading="lazy" />;
}
