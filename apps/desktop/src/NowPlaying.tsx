import { useState } from "react";
import {
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconRepeat,
  IconRepeatOnce,
  IconVolume,
  IconVolume2,
  IconVolume3,
  IconArrowsShuffle,
} from "@tabler/icons-react";
import { decibelsForVolume, type RepeatMode, type Track } from "@ytbm/core";

import { Artwork } from "./TrackList.tsx";
import { formatDuration } from "./format.ts";
import type { PlaybackState } from "./usePlayback.ts";

interface Props {
  track: Track | null;
  playback: PlaybackState;
  repeat: RepeatMode;
  shuffle: boolean;
  onToggle: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (positionMs: number) => void;
  /** Takes a slider position in 0..1, not an amplitude. See `@ytbm/core`. */
  onVolume: (position: number) => void;
  onRepeat: (repeat: RepeatMode) => void;
  onShuffle: (shuffle: boolean) => void;
}

const REPEAT_CYCLE: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };
const REPEAT_LABEL: Record<RepeatMode, string> = {
  off: "Repeat off",
  all: "Repeat all",
  one: "Repeat one",
};

export function NowPlaying(props: Props) {
  const { track, playback, repeat, shuffle } = props;
  /** The slider's own position, 0..100. The curve lives in `@ytbm/core`. */
  const [volume, setVolume] = useState(100);
  /**
   * While dragging, the scrubber shows the dragged value rather than the
   * position events still arriving from mpv, which would otherwise yank the
   * handle back under the cursor.
   */
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  const duration = playback.durationMs ?? track?.durationMs ?? null;
  const position = scrubbing ?? playback.positionMs;
  const isPlaying = playback.status === "playing";
  const decibels = decibelsForVolume(volume / 100);

  return (
    <footer className="border-t border-white/10 bg-neutral-950/90 px-4 py-3">
      {playback.error && (
        <p className="mb-2 truncate text-xs text-red-400" title={playback.error}>
          {playback.error}
        </p>
      )}
      <div className="flex items-center gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {track ? (
            <>
              <Artwork track={track} size="h-12 w-12" />
              <span className="min-w-0">
                <span className="block truncate text-sm text-neutral-100">{track.title}</span>
                <span className="block truncate text-xs text-neutral-400">
                  {track.artists[0]?.name}
                </span>
              </span>
            </>
          ) : (
            <span className="text-sm text-neutral-500">Nothing playing</span>
          )}
        </div>

        <div className="flex flex-[2] flex-col items-center gap-1">
          <div className="flex items-center gap-2">
            <Toggle
              active={shuffle}
              onClick={() => props.onShuffle(!shuffle)}
              title={shuffle ? "Shuffle on" : "Shuffle off"}
            >
              <IconArrowsShuffle size={18} stroke={1.75} />
            </Toggle>
            <Control onClick={props.onPrevious} title="Previous">
              <IconPlayerSkipBackFilled size={18} />
            </Control>
            <button
              type="button"
              onClick={props.onToggle}
              disabled={!track}
              title={isPlaying ? "Pause" : "Play"}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-neutral-900 transition hover:bg-white disabled:opacity-30"
            >
              {isPlaying ? (
                <IconPlayerPauseFilled size={18} />
              ) : (
                // Nudged right so the triangle looks centred in the circle.
                <IconPlayerPlayFilled size={18} className="translate-x-px" />
              )}
            </button>
            <Control onClick={props.onNext} title="Next">
              <IconPlayerSkipForwardFilled size={18} />
            </Control>
            <Toggle
              active={repeat !== "off"}
              onClick={() => props.onRepeat(REPEAT_CYCLE[repeat])}
              title={REPEAT_LABEL[repeat]}
            >
              {repeat === "one" ? (
                <IconRepeatOnce size={18} stroke={1.75} />
              ) : (
                <IconRepeat size={18} stroke={1.75} />
              )}
            </Toggle>
          </div>

          <div className="flex w-full items-center gap-2">
            <span className="w-10 text-right text-[11px] tabular-nums text-neutral-500">
              {formatDuration(position)}
            </span>
            <input
              type="range"
              min={0}
              max={duration ?? 0}
              value={Math.min(position, duration ?? 0)}
              disabled={duration === null}
              onChange={(e) => setScrubbing(Number(e.target.value))}
              onMouseUp={(e) => {
                props.onSeek(Number(e.currentTarget.value));
                setScrubbing(null);
              }}
              onKeyUp={(e) => {
                props.onSeek(Number(e.currentTarget.value));
                setScrubbing(null);
              }}
              className="h-1 flex-1 accent-emerald-400"
            />
            <span className="w-10 text-[11px] tabular-nums text-neutral-500">
              {formatDuration(duration)}
            </span>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-end gap-2">
          <VolumeIcon volume={volume} />
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            // The position is sent as a fraction; the perceptual curve is
            // applied downstream, by mpv, and pinned by tests on both sides.
            title={`Volume ${volume}% (${decibels === Number.NEGATIVE_INFINITY ? "muted" : `${decibels.toFixed(1)} dB`})`}
            onChange={(e) => {
              const next = Number(e.target.value);
              setVolume(next);
              props.onVolume(next / 100);
            }}
            className="h-1 w-24 accent-emerald-400"
          />
        </div>
      </div>
    </footer>
  );
}

/** Reflects the slider position, so the icon tracks the handle rather than the
 *  amplitude — which at a quarter travel would already look muted. */
function VolumeIcon({ volume }: { volume: number }) {
  const className = "shrink-0 text-neutral-500";
  if (volume === 0) return <IconVolume3 size={16} className={className} />;
  if (volume < 50) return <IconVolume2 size={16} className={className} />;
  return <IconVolume size={16} className={className} />;
}

function Control(props: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.title}
      aria-label={props.title}
      className="rounded p-1.5 text-neutral-300 transition hover:bg-white/10 hover:text-neutral-100"
    >
      {props.children}
    </button>
  );
}

function Toggle(props: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.active}
      className={`rounded p-1.5 transition hover:bg-white/10 ${
        props.active ? "text-emerald-400" : "text-neutral-500"
      }`}
    >
      {props.children}
    </button>
  );
}
