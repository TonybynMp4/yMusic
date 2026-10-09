import { type PointerEvent, useRef, useState } from "react";
import {
  IconArrowsShuffle,
  IconChevronUp,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipBackFilled,
  IconPlayerSkipForwardFilled,
  IconRepeat,
  IconRepeatOnce,
  IconVolume,
  IconVolume2,
  IconVolume3,
} from "@tabler/icons-react";
import { decibelsForVolume, type RepeatMode, type Track } from "@ymusic/core";

import { FromDevice } from "@/components/FromDevice";
import { IconButton } from "@/components/IconButton";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { InteractionArea } from "./Interactions.tsx";
import { RatingButtons, type RatingProps } from "./Rating.tsx";
import { Artwork, Byline, TitleLink } from "./TrackList.tsx";
import { formatDuration } from "./format.ts";
import type { Route } from "./useBrowse.ts";
import { usePosition, type PlaybackState, type PositionStore } from "./usePlayback.ts";
import { useSongYear } from "./useSongYear.ts";

interface Props {
  track: Track | null;
  playback: PlaybackState;
  position: PositionStore;
  repeat: RepeatMode;
  shuffle: boolean;
  onToggle: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (positionMs: number) => void;
  /** A slider position in 0..1, not an amplitude. See `@ymusic/core`. */
  volume: number;
  /** The saved level to unmute to, for a launch that starts muted. */
  unmutedVolume: number;
  onVolume: (position: number) => void;
  onRepeat: (repeat: RepeatMode) => void;
  onShuffle: (shuffle: boolean) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** The device the queue was picked up from, in the account's words. */
  device: string | null;
  /** Null when the song can't be rated: a local file, or signed out. */
  rating: RatingProps | null;
  /** Opens the album or an artist from the song's title and byline. */
  onOpen: (route: Route) => void;
}

/**
 * Whether a click landed on one of the bar's controls rather than the bar.
 * Sliders are matched by their control: a slider rendered as a tooltip trigger,
 * like the volume one, has its root's slot replaced by the trigger's.
 */
function onControl(target: EventTarget): boolean {
  return (
    target instanceof Element &&
    target.closest("button, [role=button], input, a, [data-slot=slider-control]") !== null
  );
}

const REPEAT_CYCLE: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };
const REPEAT_LABEL: Record<RepeatMode, string> = {
  off: "Repeat off",
  all: "Repeat all",
  one: "Repeat one",
};

/** Red fill, as YouTube Music's progress bar is; the volume bar stays white. */
const BRAND_SLIDER = "[&_[data-slot=slider-range]]:bg-brand";

export function NowPlaying(props: Props) {
  const { track, playback, repeat, shuffle } = props;
  /** The slider works in whole percent; the curve lives in `@ymusic/core`. */
  const volume = Math.round(props.volume * 100);
  /**
   * While dragging, the scrubber shows the dragged value rather than the
   * position events still arriving from mpv, which would otherwise yank the
   * handle back under the cursor.
   */
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const pressedControl = useRef(false);
  const year = useSongYear(track);

  const duration = playback.durationMs ?? track?.durationMs ?? null;
  const playing = usePosition(props.position);
  const position = scrubbing ?? playing;
  const isPlaying = playback.status === "playing";
  const decibels = decibelsForVolume(volume / 100);
  /**
   * The level to go back to on unmute: the last one the slider shows above
   * zero. It is held while the slider is dragged, so a drag down to zero
   * restores the level from before the drag, not the last step on the way.
   */
  const unmuted = useRef(props.unmutedVolume);
  const draggingVolume = useRef(false);
  if (volume > 0 && !draggingVolume.current) unmuted.current = props.volume;
  // Shared by the inline slider and the vertical one in the narrow popup.
  const volumeSlider = {
    min: 0,
    max: 100,
    value: volume,
    // The position is sent as a fraction; the perceptual curve is applied
    // downstream, by mpv, and pinned by tests on both sides.
    onValueChange: (value: number | readonly number[]) => props.onVolume((value as number) / 100),
    onPointerDownCapture: (event: PointerEvent) => {
      draggingVolume.current = event.button === 0;
    },
    // A press that leaves the value unchanged commits nothing.
    onPointerUpCapture: () => {
      draggingVolume.current = false;
    },
    onValueCommitted: (value: number | readonly number[]) => {
      draggingVolume.current = false;
      if ((value as number) > 0) unmuted.current = (value as number) / 100;
    },
  };

  return (
    // As in YouTube Music: a click on the bar, anywhere but its controls,
    // opens the player, and a right click the song's menu.
    <InteractionArea
      subject={track ? { kind: "song", track } : null}
      render={<footer />}
      // Checked on the press too: a seek dragged off the slider ends in a
      // click on the bar itself.
      onPointerDown={(event) => {
        pressedControl.current = onControl(event.target);
      }}
      onClick={(event) => {
        if (track && !pressedControl.current && !onControl(event.target)) props.onToggleExpanded();
      }}
      className={cn("border-t bg-card px-4 py-3", track && "cursor-pointer")}
    >
      {playback.error && (
        <p className="mb-2 truncate text-xs text-destructive" title={playback.error}>
          {playback.error}
        </p>
      )}
      {/* No side shrinks past its own controls, so nothing overlaps; only the
          title gives way. Below 768 px the song side takes the spare room, the
          controls keep their own width and the volume slider moves into a
          popup over its button. Below 640 px the rating is hidden, and below
          520 px the song side is the cover alone, which still opens the player. */}
      <div className="flex items-center gap-4">
        <div className="flex flex-1 items-center gap-3">
          <IconButton
            label={props.expanded ? "Collapse player" : "Expand player"}
            onClick={props.onToggleExpanded}
            disabled={!track}
            className={cn(track && "max-[520px]:hidden")}
          >
            <IconChevronUp
              size={18}
              stroke={1.75}
              className={cn("transition-transform", props.expanded && "rotate-180")}
            />
          </IconButton>
          {track ? (
            <>
              <Artwork track={track} size={48} />
              {/* A grid so the title can shrink to nothing without counting
                  towards the side's minimum width. The device icon does count,
                  or it would overflow onto the controls. */}
              <span
                className={cn(
                  "grid grid-cols-[minmax(0,max-content)] max-[520px]:hidden",
                  props.device && "min-w-5",
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <TitleLink track={track} onOpen={props.onOpen} className="min-w-0 text-sm" />
                  {props.device && <FromDevice device={props.device} />}
                </span>
                <Byline track={track} onOpen={props.onOpen} year={year} />
              </span>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">Nothing playing</span>
          )}
        </div>

        <div className="flex flex-[2] flex-col items-center gap-1 max-md:flex-[0_1_18rem]">
          <div className="flex items-center gap-1">
            <IconButton
              label={shuffle ? "Shuffle on" : "Shuffle off"}
              active={shuffle}
              onClick={() => props.onShuffle(!shuffle)}
            >
              <IconArrowsShuffle size={18} stroke={1.75} />
            </IconButton>
            <IconButton label="Previous" onClick={props.onPrevious}>
              <IconPlayerSkipBackFilled size={18} />
            </IconButton>
            <IconButton
              label={isPlaying ? "Pause" : "Play"}
              onClick={props.onToggle}
              disabled={!track}
              size="icon-lg"
              // The one filled control in the bar, as on YouTube Music.
              variant="default"
            >
              {isPlaying ? (
                <IconPlayerPauseFilled size={18} />
              ) : (
                // Nudged right so the triangle looks centred in the circle.
                <IconPlayerPlayFilled size={18} className="translate-x-px" />
              )}
            </IconButton>
            <IconButton label="Next" onClick={props.onNext}>
              <IconPlayerSkipForwardFilled size={18} />
            </IconButton>
            <IconButton
              label={REPEAT_LABEL[repeat]}
              active={repeat !== "off"}
              onClick={() => props.onRepeat(REPEAT_CYCLE[repeat])}
            >
              {repeat === "one" ? (
                <IconRepeatOnce size={18} stroke={1.75} />
              ) : (
                <IconRepeat size={18} stroke={1.75} />
              )}
            </IconButton>
          </div>

          <div className="flex w-full items-center gap-2">
            <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
              {formatDuration(position)}
            </span>
            <Slider
              min={0}
              // A zero-width range is not a range: Base UI warns, and the
              // handle has nowhere to sit. Before a duration arrives the
              // scrubber is disabled anyway, so the number is arbitrary.
              max={duration ?? 1}
              value={Math.min(position, duration ?? 0)}
              disabled={duration === null}
              // Dragging only moves the handle; the seek is sent on commit, so
              // a drag across a track is one seek rather than a hundred.
              onValueChange={(value) => setScrubbing(value as number)}
              onValueCommitted={(value) => {
                props.onSeek(value as number);
                setScrubbing(null);
              }}
              className={`flex-1 ${BRAND_SLIDER}`}
            />
            <span className="w-10 text-[11px] tabular-nums text-muted-foreground">
              {formatDuration(duration)}
            </span>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-end gap-2 max-md:flex-none">
          {props.rating && (
            <span className="flex items-center max-sm:hidden">
              <RatingButtons {...props.rating} />
            </span>
          )}
          {/* The padding lets the pointer cross from the button to the popup. */}
          <div className="group relative">
            <IconButton
              label={volume === 0 ? "Unmute" : "Mute"}
              onClick={() => props.onVolume(volume === 0 ? unmuted.current : 0)}
            >
              <VolumeIcon volume={volume} />
            </IconButton>
            <div className="absolute bottom-full left-1/2 hidden -translate-x-1/2 pb-2 max-md:group-focus-within:block max-md:group-hover:block">
              <div className="rounded-md border bg-popover px-2 py-3 shadow-md">
                <Slider
                  {...volumeSlider}
                  orientation="vertical"
                  aria-label="Volume"
                  className="h-20 [&_[data-slot=slider-control]]:min-h-20!"
                />
              </div>
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger render={<Slider {...volumeSlider} className="w-24 max-md:hidden" />} />
            <TooltipContent>
              {`Volume ${volume}% (${
                decibels === Number.NEGATIVE_INFINITY ? "muted" : `${decibels.toFixed(1)} dB`
              })`}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </InteractionArea>
  );
}

/** Reflects the slider position, so the icon tracks the handle rather than the
 *  amplitude, which at a quarter travel would already look muted. */
function VolumeIcon({ volume }: { volume: number }) {
  if (volume === 0) return <IconVolume3 size={16} />;
  if (volume < 50) return <IconVolume2 size={16} />;
  return <IconVolume size={16} />;
}
