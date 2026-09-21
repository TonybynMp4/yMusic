import {
  IconDots,
  IconDotsVertical,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerTrackNext,
  IconPlaylistAdd,
} from "@tabler/icons-react";
import type { Track, TrackId } from "@ymusic/core";
import { Fragment, type ReactNode } from "react";

import { Art } from "@/components/Art";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { VirtualList } from "@/components/VirtualList";
import { cn } from "@/lib/utils";
import { formatDuration } from "./format.ts";
import { useScrollParent } from "./scroll.ts";
import type { Route } from "./useBrowse.ts";

interface Props {
  /** Any source: a local file and a YouTube result render identically. */
  tracks: readonly Track[];
  currentId: TrackId | null;
  /** Whether the current track is playing rather than paused. */
  playing: boolean;
  onPlay: (id: TrackId) => void;
  /** Pauses or resumes the current track, from its row. */
  onToggle: () => void;
  /** Queues a track after the current one (`next`) or at the end (`last`). */
  onEnqueue: (track: Track, at: "next" | "last") => void;
  /** Opens an artist or album page. Without it, bylines are plain text. */
  onOpen?: ((route: Route) => void) | undefined;
  /** Leave the album out of the byline, as on the album's own page. */
  hideAlbum?: boolean;
}

/** Every row is this tall, which is what lets long lists skip rendering most of them. */
const ROW_HEIGHT = 48;
/** Below this, rendering every row is cheaper than keeping track of which to render. */
const VIRTUAL_FROM = 60;

export function TrackList(props: Props) {
  const scroller = useScrollParent();
  const { tracks } = props;
  if (tracks.length === 0) return null;

  if (scroller && tracks.length >= VIRTUAL_FROM) {
    return (
      <VirtualList
        count={tracks.length}
        scroller={scroller}
        rowHeight={ROW_HEIGHT}
        // By position too: a playlist can hold the same track twice.
        getKey={(index) => `${index}:${tracks[index]!.id}`}
        renderRow={(index) => <Row {...props} track={tracks[index]!} />}
      />
    );
  }
  return (
    <ul>
      {tracks.map((track, index) => (
        <li key={`${index}:${track.id}`}>
          <Row {...props} track={track} />
        </li>
      ))}
    </ul>
  );
}

function Row({
  track,
  currentId,
  playing,
  onPlay,
  onToggle,
  onEnqueue,
  onOpen,
  hideAlbum,
}: Props & { track: Track }) {
  const isCurrent = track.id === currentId;
  const play = () => (isCurrent ? onToggle() : onPlay(track.id));
  return (
    // The whole row plays on click, for the mouse; the title is the real
    // button, for the keyboard. Byline links sit inside the row but not
    // inside that button, which cannot nest them.
    <div
      onClick={() => onPlay(track.id)}
      style={{ height: ROW_HEIGHT }}
      className={cn(
        "group flex cursor-default items-center gap-3 rounded-lg px-3 transition-colors",
        isCurrent ? "bg-accent" : "hover:bg-accent/60",
      )}
    >
      <RowArt track={track} isCurrent={isCurrent} playing={playing} onClick={play} />
      <span className="min-w-0 flex-1">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onPlay(track.id);
          }}
          className="block max-w-full truncate text-left text-sm outline-none focus-visible:underline"
        >
          {track.title}
        </button>
        <Byline track={track} onOpen={onOpen} hideAlbum={hideAlbum} />
      </span>
      <TrackMenu track={track} onEnqueue={onEnqueue} />
      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {formatDuration(track.durationMs)}
      </span>
    </div>
  );
}

/** The row's action menu, shown on hover as in YouTube Music. */
function TrackMenu({ track, onEnqueue }: Pick<Props, "onEnqueue"> & { track: Track }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onClick={(event) => event.stopPropagation()}
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="More actions"
            className="rounded-full text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 data-popup-open:opacity-100"
          />
        }
      >
        <IconDotsVertical size={17} stroke={1.75} />
      </DropdownMenuTrigger>
      {/* The popup is portalled, but React still bubbles its clicks to the
          row, which would play the track. */}
      <DropdownMenuContent align="end" className="w-44" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onClick={() => onEnqueue(track, "next")}>
          <IconPlayerTrackNext />
          Play next
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onEnqueue(track, "last")}>
          <IconPlaylistAdd />
          Add to queue
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The cover, and over it what YouTube Music shows there: bars moving while
 * the row plays, dots while it is paused, and a play (or pause) button on hover.
 */
function RowArt(props: {
  track: Track;
  isCurrent: boolean;
  playing: boolean;
  onClick: () => void;
}) {
  const { isCurrent, playing } = props;
  const pauses = isCurrent && playing;
  return (
    <span className="relative shrink-0">
      <Artwork track={props.track} size={36} />
      {isCurrent && (
        <span className="absolute inset-0 flex items-center justify-center rounded bg-black/50 text-white group-hover:opacity-0">
          {playing ? <Equalizer /> : <IconDots size={18} stroke={2} />}
        </span>
      )}
      <button
        type="button"
        aria-label={pauses ? "Pause" : "Play"}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
          props.onClick();
        }}
        className="absolute inset-0 flex items-center justify-center rounded bg-black/50 text-white opacity-0 outline-none group-hover:opacity-100"
      >
        {pauses ? <IconPlayerPauseFilled size={16} /> : <IconPlayerPlayFilled size={16} />}
      </button>
    </span>
  );
}

/** Three bars rising and falling out of step. The animation lives in `styles.css`. */
function Equalizer() {
  return (
    <span className="flex h-3.5 items-end gap-0.5" aria-hidden>
      {[0, 1, 2].map((bar) => (
        <span key={bar} className="equalizer-bar h-full w-[3px] rounded-[1px] bg-current" />
      ))}
    </span>
  );
}

/** "Artist, Artist • Album", each part a link when it has a page to open. */
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
          {track.artists.length > 0 && " • "}
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
export function Artwork({ track, size = 36 }: { track: Track; size?: number }) {
  return (
    <Art
      thumbnails={track.thumbnails}
      width={size}
      className="shrink-0 rounded text-xs"
      style={{ width: size, height: size }}
      fallback={track.title.slice(0, 1).toUpperCase()}
    />
  );
}
