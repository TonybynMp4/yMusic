import { useEffect, useRef, useState } from "react";
import type { Track } from "@ytbm/core";
import { appFetch } from "@ytbm/ipc";
import { createYouTube, searchSongs } from "@ytbm/youtube";
import type { Innertube } from "youtubei.js";

export interface YouTubeSearchState {
  tracks: Track[];
  loading: boolean;
  error: string | null;
}

/**
 * Debounced song search against YouTube Music.
 *
 * The client is created once and reused: `Innertube.create` performs a network
 * round trip for its session context, so making one per keystroke would be
 * slower than the search itself.
 */
export function useYouTubeSearch(query: string, enabled: boolean): YouTubeSearchState {
  const [state, setState] = useState<YouTubeSearchState>({
    tracks: [],
    loading: false,
    error: null,
  });
  const client = useRef<Promise<Innertube> | null>(null);

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
          client.current ??= createYouTube({ fetch: appFetch });
          const tracks = await searchSongs(await client.current, trimmed);
          if (!cancelled) setState({ tracks, loading: false, error: null });
        } catch (error) {
          // A failed create must not be cached, or every later search reuses
          // the same rejected promise and the tab never recovers.
          client.current = null;
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
