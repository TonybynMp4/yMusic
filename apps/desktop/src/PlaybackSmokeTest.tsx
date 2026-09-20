import { useState } from "react";
import type { StreamLease, VideoId } from "@ytbm/core";
import { usePlayback } from "./usePlayback.ts";

/**
 * Temporary. Proves the whole chain — React to Tauri command to libmpv and back
 * out over the event channel — against a plain HTTPS audio URL, before any
 * YouTube code exists. Deleted once the real search and now-playing screens land.
 */
const SAMPLE_URL = "https://download.samplelib.com/mp3/sample-15s.mp3";

export function PlaybackSmokeTest() {
  const { state, engine, load } = usePlayback();
  const [volume, setVolume] = useState(0.8);

  const lease: StreamLease = {
    trackId: "smoke-test" as VideoId,
    url: SAMPLE_URL,
    itag: 0,
    codec: "unknown",
    bitrate: 128_000,
    isPremiumFormat: false,
    headers: { "User-Agent": "YTBM/0.1" },
    expiresAt: Date.now() + 60 * 60 * 1000,
  };

  const progress = state.durationMs ? (state.positionMs / state.durationMs) * 100 : 0;

  return (
    <section className="w-96 rounded-lg border border-white/10 bg-white/5 p-4">
      <p className="text-xs tracking-wide text-neutral-400 uppercase">Playback smoke test</p>

      <div className="mt-3 flex items-center gap-2">
        <Button onClick={() => void load(lease)}>Load</Button>
        <Button onClick={() => void engine.play()}>Play</Button>
        <Button onClick={() => void engine.pause()}>Pause</Button>
        <Button onClick={() => void engine.seek(state.positionMs + 5000)}>+5s</Button>
        <Button onClick={() => void engine.stop()}>Stop</Button>
      </div>

      <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="mt-2 flex justify-between font-mono text-xs text-neutral-400">
        <span>{formatTime(state.positionMs)}</span>
        <span>{state.status}</span>
        <span>{state.durationMs === null ? "--:--" : formatTime(state.durationMs)}</span>
      </div>

      <label className="mt-4 flex items-center gap-2 text-xs text-neutral-400">
        Volume
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(changeEvent) => {
            const next = changeEvent.currentTarget.valueAsNumber;
            setVolume(next);
            void engine.setVolume(next);
          }}
          className="flex-1 accent-[var(--accent)]"
        />
      </label>

      {state.error && <p className="mt-3 text-xs text-red-400">{state.error}</p>}
    </section>
  );
}

function Button({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:bg-white/20"
    >
      {children}
    </button>
  );
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
