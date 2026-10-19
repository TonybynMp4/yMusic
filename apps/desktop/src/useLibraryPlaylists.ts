import { useEffect, useMemo, useRef, useState } from "react";
import type { BrowseCard } from "@ymusic/core";

import { engine } from "./engine.ts";

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

interface Listed {
  account: string;
  /** The `generation` fetched, so a newer request shows as loading. */
  generation: number;
  playlists: BrowseCard[];
  error: string | null;
}

/** How many times the list is fetched again while a new playlist is missing from it. */
const LIST_RETRIES = 5;

/**
 * The signed-in account's YouTube Music playlists, Liked Music first. Keyed
 * on who is signed in, so signing in or out swaps the list.
 */
export function useLibraryPlaylists(accountKey: string | null): LibraryPlaylistsState {
  const [generation, setGeneration] = useState(0);
  // Kept with the account that created them, so switching accounts drops them.
  const [pending, setPending] = useState<{ account: string | null; cards: BrowseCard[] }>({
    account: null,
    cards: [],
  });
  const [gone, setGone] = useState<{ account: string | null; ids: string[] }>({
    account: null,
    ids: [],
  });
  /** The last list fetched, and which fetch it answered. */
  const [listed, setListed] = useState<Listed | null>(null);
  useEffect(() => {
    if (accountKey === null) return;
    let cancelled = false;
    engine.libraryPlaylists().then(
      (playlists) => {
        if (cancelled) return;
        setListed({ account: accountKey, generation, playlists, error: null });
        setPending(({ account, cards }) => ({
          account,
          cards: cards.filter((card) => !playlists.some((p) => p.id === card.id)),
        }));
      },
      // The last good list stays, so a failed refetch (a retry for a new
      // playlist, say) does not blank the sidebar.
      (error: unknown) =>
        !cancelled &&
        setListed((last) => ({
          account: accountKey,
          generation,
          playlists: last?.account === accountKey ? last.playlists : [],
          error: error instanceof Error ? error.message : String(error),
        })),
    );
    return () => {
      cancelled = true;
    };
  }, [accountKey, generation]);
  // Another account's list never stays up while this one's loads.
  const mine = listed?.account === accountKey ? listed : null;
  const loading = accountKey !== null && mine?.generation !== generation;
  // A new playlist reaches YouTube's library list a while after it exists, so
  // the list is fetched again, further apart each time, until it has it. Its
  // entry then swaps the placeholder for YouTube's, with its art.
  const retries = useRef(0);
  const waiting = pending.account === accountKey && pending.cards.length > 0;
  useEffect(() => {
    if (!waiting || loading || retries.current >= LIST_RETRIES) return;
    const timer = setTimeout(
      () => {
        retries.current += 1;
        setGeneration((g) => g + 1);
      },
      (retries.current + 1) * 2000,
    );
    return () => clearTimeout(timer);
  }, [waiting, loading]);
  const reload = () => setGeneration((g) => g + 1);
  const created = (card: BrowseCard) => {
    retries.current = 0;
    setPending(({ account, cards }) => ({
      account: accountKey,
      cards: [card, ...(account === accountKey ? cards.filter((c) => c.id !== card.id) : [])],
    }));
    setGeneration((g) => g + 1);
  };
  const deleted = (id: string) => {
    setGone(({ account, ids }) => ({
      account: accountKey,
      ids: [id, ...(account === accountKey ? ids : [])],
    }));
    setPending(({ account, cards }) => ({
      account,
      cards: cards.filter((card) => card.id !== id),
    }));
    setGeneration((g) => g + 1);
  };
  // New playlists go where YouTube Music puts them: first, after Liked Music.
  const playlists = useMemo(() => {
    const hidden = gone.account === accountKey ? gone.ids : [];
    const kept = (mine?.playlists ?? []).filter((p) => !hidden.includes(p.id));
    if (pending.account !== accountKey) return kept;
    const shown = pending.cards.filter((card) => !kept.some((p) => p.id === card.id));
    if (shown.length === 0) return kept;
    const liked = kept.filter((p) => p.id === LIKED_MUSIC);
    const rest = kept.filter((p) => p.id !== LIKED_MUSIC);
    return [...liked, ...shown, ...rest];
  }, [pending, gone, accountKey, mine?.playlists]);
  return { playlists, loading, error: mine?.error ?? null, reload, created, deleted };
}
