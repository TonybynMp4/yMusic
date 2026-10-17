import { useCallback, useEffect, useRef, useState } from "react";
import type { Track } from "@ymusic/core";

import { engine } from "./engine.ts";

export interface YouTubeSearchState {
  tracks: Track[];
  loading: boolean;
  error: string | null;
  /**
   * Searches `query` with the account now, which records it there and shows
   * its personalised results. What Enter and picking a past search do.
   */
  submit: (query: string) => void;
  /**
   * Records `query` on the account without changing what is shown. What
   * playing or opening a result does.
   */
  record: (query: string) => void;
}

/**
 * Debounced song search against YouTube Music, run in the engine worker. The
 * worker keeps one InnerTube session for every search, and drops it after a
 * failure so the next search starts clean.
 *
 * Searches made while typing go out without the account, even with
 * `onAccount`: YouTube records every signed-in search, so each pause in typing
 * would land in the account's history. Only a submitted query searches with
 * the account.
 */
export function useYouTubeSearch(
  query: string,
  enabled: boolean,
  onAccount: boolean,
): YouTubeSearchState {
  const [state, setState] = useState<Omit<YouTubeSearchState, "submit" | "record">>({
    tracks: [],
    loading: false,
    error: null,
  });
  const [submitted, setSubmitted] = useState<string | null>(null);
  const recorded = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setState({ tracks: [], loading: false, error: null });
      return;
    }

    const signedIn = onAccount && trimmed === submitted;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    // Longer than the library's 150ms: this one leaves the machine, and a
    // request per keystroke is both slow and a good way to get rate limited.
    // A submitted query goes at once.
    const timer = setTimeout(
      () => {
        void (async () => {
          try {
            const tracks = await engine.search(trimmed, { signedOut: !signedIn });
            if (!cancelled) setState({ tracks, loading: false, error: null });
          } catch (error) {
            if (!cancelled) {
              setState({ tracks: [], loading: false, error: describe(error) });
            }
          }
        })();
      },
      signedIn ? 0 : 350,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, enabled, onAccount, submitted]);

  const submit = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      if (!onAccount || trimmed.length === 0) return;
      recorded.current = trimmed;
      setSubmitted(trimmed);
    },
    [onAccount],
  );

  const record = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      // Playing a second result from the same search records nothing new.
      if (!onAccount || trimmed.length === 0 || trimmed === recorded.current) return;
      recorded.current = trimmed;
      engine
        .search(trimmed, { signedOut: false })
        .catch((error: unknown) => console.error("could not record a search", error));
    },
    [onAccount],
  );

  return { ...state, submit, record };
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `YouTube search failed: ${message}`;
}
