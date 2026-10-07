import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconX } from "@tabler/icons-react";
import { playerStats, type AudioStats } from "@ymusic/ipc";

import { IconButton } from "@/components/IconButton";
import { ClipIndicator, type ClipIndicatorActions } from "@/components/ui/clip-indicator";
import { DbReadout } from "@/components/ui/db-readout";
import { formatDb, SILENCE_DB } from "@/lib/audio/decibels";
import type { MeterZone } from "@/lib/audio/types";
import { cn } from "@/lib/utils";

/** How often the readings refresh: fast enough that "Loudness now" moves with the music. */
const POLL_MS = 250;

/**
 * A true peak at or over 0 dBTP clips. Stable volume's limiter holds boosted
 * peaks at -1, so anything between is close but caught.
 */
const CLIP_DB = 0;
const PEAK_ZONES: MeterZone[] = [
  { fromDb: Number.NEGATIVE_INFINITY, zone: "ok" },
  { fromDb: -1, zone: "warn" },
  { fromDb: CLIP_DB, zone: "clip" },
];

/**
 * YouTube's "Stats for nerds" panel, for the audio: the stream, stable volume's
 * gain, and what meters either side of that gain measure. Key it on the track,
 * so a new song starts with empty readings rather than the last song's.
 */
export function StatsForNerds(props: { onClose: () => void }) {
  const [stats, setStats] = useState<AudioStats | null>(null);

  useEffect(() => {
    let live = true;
    const read = () =>
      void playerStats()
        .then((next) => live && setStats(next))
        .catch((error: unknown) => console.warn("could not read player stats", error));
    read();
    const timer = window.setInterval(read, POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="absolute top-2 left-2 z-10 w-80 rounded-lg bg-black/75 p-3 pr-2 text-xs text-white/90 shadow-lg backdrop-blur-sm">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium">Stats for nerds</span>
        <IconButton label="Close stats for nerds" onClick={props.onClose}>
          <IconX size={14} />
        </IconButton>
      </div>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 tabular-nums">
        {rows(stats).map(([label, value]) => (
          <Stat key={label} label={label} value={value} />
        ))}
      </dl>
    </div>
  );
}

function Stat(props: { label: string; value: ReactNode }) {
  return (
    <>
      <dt className="text-white/60">{props.label}</dt>
      <dd className="flex justify-end">{props.value}</dd>
    </>
  );
}

const NONE = "-";

function rows(s: AudioStats | null): [string, ReactNode][] {
  return [
    ["Codec", format(s)],
    ["Bitrate", s?.bitrate ? `${Math.round(s.bitrate / 1000)} kbps` : NONE],
    ["YouTube loudness", reading(s?.youtubeLoudnessDb, "dB")],
    ["Stable volume", stableVolume(s)],
    ["Average loudness", reading(s?.integratedLufs, "LUFS")],
    ["Loudness now", reading(s?.momentaryLufs, "LUFS")],
    ["Peak", peak(s?.peakDb)],
    ["Peak after stable volume", peak(s?.outputPeakDb)],
    // With no limiter in the chain, nothing stops the output clipping.
    s?.gainDb != null && s.gainDb > 0
      ? ["Limiter", limiter(s.limiterDb)]
      : ["Clipping", <ClipLight key="clip" peakDb={s?.outputPeakDb ?? null} />],
  ];
}

/** A local file's ReplayGain is applied after both meters, so it is named as such. */
function stableVolume(s: AudioStats | null): ReactNode {
  if (s?.gainDb != null) return reading(s.gainDb, "dB");
  if (s?.replaygainDb != null) return reading(s.replaygainDb, "dB (ReplayGain)");
  return "No change";
}

function format(s: AudioStats | null): string {
  const parts = [
    s?.codec,
    s?.sampleRate ? `${s.sampleRate / 1000} kHz` : null,
    s?.channels,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : NONE;
}

/** A level that stays the same width as it changes, so the column doesn't jitter. */
function reading(value: number | null | undefined, unit: string, className?: string): ReactNode {
  if (value == null) return NONE;
  return (
    <DbReadout
      className={cn("font-sans", className)}
      format={(db) => `${formatDb(db, { unit: false })} ${unit}`}
      value={value}
      zones={PEAK_ZONES}
    />
  );
}

/** A true peak, amber close to clipping and red once it clips. */
function peak(value: number | null | undefined): ReactNode {
  return reading(
    value,
    "dBTP",
    "data-[zone=warn]:text-meter-warn data-[zone=clip]:text-meter-clip",
  );
}

function limiter(reduction: number | null): ReactNode {
  if (reduction == null) return NONE;
  return reduction === 0 ? "Idle" : reading(-reduction, "dB");
}

/**
 * Lights when the output's true peak reaches 0 dBTP, and stays lit until
 * clicked. The meter reports the loudest peak so far, so only a changed
 * reading counts: higher is a new peak, lower means mpv rebuilt the meter
 * (the same song reloaded, a stable volume change) and it counts from there.
 */
function ClipLight(props: { peakDb: number | null }) {
  const actions = useRef<ClipIndicatorActions>(null);
  const last = useRef(SILENCE_DB);

  useEffect(() => {
    const peak = props.peakDb ?? SILENCE_DB;
    const changed = peak !== last.current;
    last.current = peak;
    actions.current?.report(changed ? peak : SILENCE_DB);
  }, [props.peakDb]);

  return <ClipIndicator actionsRef={actions} holdMs={Infinity} thresholdDb={CLIP_DB} />;
}
