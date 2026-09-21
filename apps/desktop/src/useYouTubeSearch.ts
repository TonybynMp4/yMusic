import { useEffect, useState } from "react";
import type { Track } from "@ytbm/core";

import { engine } from "./engine.ts";

export interface YouTubeSearchState {
  tracks: Track[];
  loading: boolean;
  error: string | null;
}

/**
 * Debounced song search against YouTube Music, run in the engine worker. The
 * worker keeps one InnerTube session for every search, and drops it after a
 * failure so the next search starts clean.
 */
export function useYouTubeSearch(query: string, enabled: boolean): YouTubeSearchState {
  const [state, setState] = useState<YouTubeSearchState>({
    tracks: [],
    loading: false,
    error: null,
  });
  useEffect(() => {
    if (!enabled) return;
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setState({ tracks: [], loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    // Longer than the library's 150ms: this one leaves the machine, and a
    // request per keystroke is both slow and a good way to get rate limited.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const tracks = await engine.search(trimmed);
          if (!cancelled) setState({ tracks, loading: false, error: null });
        } catch (error) {
          if (!cancelled) {
            setState({ tracks: [], loading: false, error: describe(error) });
          }
        }
      })();
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, enabled]);

  return state;
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `YouTube search failed: ${message}`;
}
