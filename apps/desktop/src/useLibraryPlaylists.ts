import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BrowseCard } from "@ymusic/core";

import { engine } from "./engine.ts";
import { errorMessage } from "./errors.ts";
import { mergePlaylists } from "./libraryPlaylists.ts";
import { queryClient } from "./query.ts";
import { useListRetries } from "./useListRetries.ts";
import { usePlaylistOverlays } from "./usePlaylistOverlays.ts";

export interface LibraryPlaylistsState {
  playlists: BrowseCard[];
  loading: boolean;
  error: string | null;
  /** Fetches the list again, after saving or removing a playlist. */
  reload: () => void;
  /**
   * Shows a playlist just created, and fetches the list again. YouTube's
   * library can take a while to list a new playlist, so it stays shown until
   * a fetch has it.
   */
  created: (card: BrowseCard) => void;
  /** Hides a playlist just deleted, which YouTube's library can list for a while yet. */
  deleted: (id: string) => void;
}

const NO_PLAYLISTS: BrowseCard[] = [];

/**
 * The signed-in account's YouTube Music playlists, Liked Music first. Keyed
 * on who is signed in, so signing in or out swaps the list, and another
 * account's list never stays up while this one's loads. A failed refetch
 * keeps the last good list, so a retry for a new playlist does not blank the
 * sidebar.
 */
export function useLibraryPlaylists(accountKey: string | null): LibraryPlaylistsState {
  const list = useQuery({
    queryKey: ["library-playlists", accountKey],
    queryFn: () => engine.libraryPlaylists(),
    enabled: accountKey !== null,
    // Fetched again each time an account's list comes up, signing back in
    // included, since playlists change from other devices. The last list
    // shows meanwhile.
    staleTime: 0,
  });
  const listed = accountKey === null ? NO_PLAYLISTS : (list.data ?? NO_PLAYLISTS);
  const refetch = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ["library-playlists"] }),
    [],
  );
  const overlays = usePlaylistOverlays(accountKey, listed);
  const loading = list.isFetching;
  const restartRetries = useListRetries(overlays.pending.length > 0, loading, refetch);
  const { created: addCreated, deleted: addDeleted } = overlays;
  const created = useCallback(
    (card: BrowseCard) => {
      restartRetries();
      addCreated(card);
      refetch();
    },
    [restartRetries, addCreated, refetch],
  );
  const deleted = useCallback(
    (id: string) => {
      addDeleted(id);
      refetch();
    },
    [addDeleted, refetch],
  );
  const playlists = useMemo(
    () => mergePlaylists(listed, overlays.pending, overlays.gone),
    [listed, overlays.pending, overlays.gone],
  );
  const error = accountKey !== null && list.error ? errorMessage(list.error) : null;
  return { playlists, loading: accountKey !== null && loading, error, reload: refetch, created, deleted };
}
