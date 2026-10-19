import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BrowseCard } from "@ymusic/core";

import { engine } from "./engine.ts";
import { queryClient } from "./query.ts";

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

export const LIKED_MUSIC = "LM";

/** How many times the list is fetched again while a new playlist is missing from it. */
const LIST_RETRIES = 5;

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
  });
  const listed = useMemo(() => (accountKey === null ? [] : (list.data ?? [])), [accountKey, list.data]);
  // Kept with the account that created them, so switching accounts drops them.
  const [pending, setPending] = useState<{ account: string | null; cards: BrowseCard[] }>({
    account: null,
    cards: [],
  });
  const [gone, setGone] = useState<{ account: string | null; ids: string[] }>({
    account: null,
    ids: [],
  });
  const refetch = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ["library-playlists"] }),
    [],
  );
  // New playlists YouTube's list does not have yet.
  const missing = useMemo(
    () =>
      pending.account === accountKey
        ? pending.cards.filter((card) => !listed.some((p) => p.id === card.id))
        : [],
    [pending, accountKey, listed],
  );
  // A new playlist reaches YouTube's library list a while after it exists, so
  // the list is fetched again, further apart each time, until it has it. Its
  // entry then swaps the placeholder for YouTube's, with its art.
  const retries = useRef(0);
  const waiting = missing.length > 0;
  const loading = list.isFetching;
  useEffect(() => {
    if (!waiting || loading || retries.current >= LIST_RETRIES) return;
    const timer = setTimeout(
      () => {
        retries.current += 1;
        refetch();
      },
      (retries.current + 1) * 2000,
    );
    return () => clearTimeout(timer);
  }, [waiting, loading, refetch]);
  const created = useCallback(
    (card: BrowseCard) => {
      retries.current = 0;
      setPending(({ account, cards }) => ({
        account: accountKey,
        cards: [card, ...(account === accountKey ? cards.filter((c) => c.id !== card.id) : [])],
      }));
      refetch();
    },
    [accountKey, refetch],
  );
  const deleted = useCallback(
    (id: string) => {
      setGone(({ account, ids }) => ({
        account: accountKey,
        ids: [id, ...(account === accountKey ? ids : [])],
      }));
      setPending(({ account, cards }) => ({
        account,
        cards: cards.filter((card) => card.id !== id),
      }));
      refetch();
    },
    [accountKey, refetch],
  );
  // New playlists go where YouTube Music puts them: first, after Liked Music.
  const playlists = useMemo(() => {
    const hidden = gone.account === accountKey ? gone.ids : [];
    const kept = listed.filter((p) => !hidden.includes(p.id));
    if (missing.length === 0) return kept;
    const liked = kept.filter((p) => p.id === LIKED_MUSIC);
    const rest = kept.filter((p) => p.id !== LIKED_MUSIC);
    return [...liked, ...missing, ...rest];
  }, [missing, gone, accountKey, listed]);
  const error = accountKey !== null && list.error ? message(list.error) : null;
  return { playlists, loading: accountKey !== null && loading, error, reload: refetch, created, deleted };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
