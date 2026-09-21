import { useEffect, useState } from "react";
import type { BrowseCard } from "@ytbm/core";

import { engine } from "./engine.ts";

export interface LibraryPlaylistsState {
  playlists: BrowseCard[];
  loading: boolean;
  error: string | null;
}

/**
 * The signed-in account's YouTube Music playlists, Liked Music first. Keyed
 * on who is signed in, so signing in or out swaps the list.
 */
export function useLibraryPlaylists(accountKey: string | null): LibraryPlaylistsState {
  const [state, setState] = useState<LibraryPlaylistsState>({
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
  }, [accountKey]);
  return state;
}
