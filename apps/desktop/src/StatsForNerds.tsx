import { useEffect, useState } from "react";
import { IconX } from "@tabler/icons-react";
import { playerStats, type AudioStats } from "@ymusic/ipc";

import { IconButton } from "@/components/IconButton";

/** How often the readings refresh. The meters update far faster than anyone reads. */
const POLL_MS = 1000;

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
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 tabular-nums">
        {rows(stats).map(([label, value]) => (
          <Stat key={label} label={label} value={value} />
        ))}
      </dl>
    </div>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <>
      <dt className="text-white/60">{props.label}</dt>
      <dd className="text-right">{props.value}</dd>
    </>
  );
}

const NONE = "-";

function rows(s: AudioStats | null): [string, string][] {
  return [
    ["Codec", format(s)],
    ["Bitrate", s?.bitrate ? `${Math.round(s.bitrate / 1000)} kbps` : NONE],
    ["YouTube loudness", signed(s?.youtubeLoudnessDb, "dB")],
    ["Stable volume", stableVolume(s)],
    ["Average loudness", unit(s?.integratedLufs, "LUFS")],
    ["Loudness now", unit(s?.momentaryLufs, "LUFS")],
    ["Peak", unit(s?.peakDb, "dBTP")],
    ["Peak after stable volume", unit(s?.outputPeakDb, "dBTP")],
    ["Limiter", s?.limiterDb == null ? "Not in use" : limiter(s.limiterDb)],
  ];
}

/** A local file's ReplayGain is applied after both meters, so it is named as such. */
function stableVolume(s: AudioStats | null): string {
  if (s?.gainDb != null) return signed(s.gainDb, "dB");
  if (s?.replaygainDb != null) return `${signed(s.replaygainDb, "dB")} (ReplayGain)`;
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

function unit(value: number | null | undefined, name: string): string {
  return value == null ? NONE : `${value.toFixed(1)} ${name}`;
}

function signed(value: number | null | undefined, name: string): string {
  if (value == null) return NONE;
  const text = unit(value, name);
  return value > 0 ? `+${text}` : text;
}

function limiter(reduction: number): string {
  return reduction === 0 ? "Idle" : `-${reduction.toFixed(1)} dB`;
}
