import { useCallback, useEffect, useState } from "react";
import type { BrowseCard } from "@ymusic/core";

import { engine } from "./engine.ts";

export interface LibraryPlaylistsState {
  playlists: BrowseCard[];
  loading: boolean;
  error: string | null;
  /** Fetches the list again, after saving or removing a playlist. */
  reload: () => void;
}

/**
 * The signed-in account's YouTube Music playlists, Liked Music first. Keyed
 * on who is signed in, so signing in or out swaps the list.
 */
export function useLibraryPlaylists(accountKey: string | null): LibraryPlaylistsState {
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<Omit<LibraryPlaylistsState, "reload">>({
    playlists: [],
    loading: false,
    error: null,
  });
  useEffect(() => {
    if (accountKey === null) {
      setState({ playlists: [], loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    engine.libraryPlaylists().then(
      (playlists) => !cancelled && setState({ playlists, loading: false, error: null }),
      (error: unknown) =>
        !cancelled &&
        setState({
          playlists: [],
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [accountKey, generation]);
  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  return { ...state, reload };
}
