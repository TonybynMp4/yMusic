import { useCallback, useEffect, useMemo, useState } from "react";
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
}

const LIKED_MUSIC = "LM";

/**
 * The signed-in account's YouTube Music playlists, Liked Music first. Keyed
 * on who is signed in, so signing in or out swaps the list.
 */
export function useLibraryPlaylists(accountKey: string | null): LibraryPlaylistsState {
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<Omit<LibraryPlaylistsState, "reload" | "created">>({
    playlists: [],
    loading: false,
    error: null,
  });
  // Kept with the account that created them, so switching accounts drops them.
  const [pending, setPending] = useState<{ account: string | null; cards: BrowseCard[] }>({
    account: null,
    cards: [],
  });
  useEffect(() => {
    if (accountKey === null) {
      setState({ playlists: [], loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    engine.libraryPlaylists().then(
      (playlists) => {
        if (cancelled) return;
        setState({ playlists, loading: false, error: null });
        setPending(({ account, cards }) => ({
          account,
          cards: cards.filter((card) => !playlists.some((p) => p.id === card.id)),
        }));
      },
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
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- generation reloads the list after a change
  }, [accountKey, generation]);
  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  const created = useCallback(
    (card: BrowseCard) => {
      setPending(({ account, cards }) => ({
        account: accountKey,
        cards: [card, ...(account === accountKey ? cards.filter((c) => c.id !== card.id) : [])],
      }));
      setGeneration((g) => g + 1);
    },
    [accountKey],
  );
  // New playlists go where YouTube Music puts them: first, after Liked Music.
  const playlists = useMemo(() => {
    if (pending.account !== accountKey) return state.playlists;
    const shown = pending.cards.filter((card) => !state.playlists.some((p) => p.id === card.id));
    if (shown.length === 0) return state.playlists;
    const liked = state.playlists.filter((p) => p.id === LIKED_MUSIC);
    const rest = state.playlists.filter((p) => p.id !== LIKED_MUSIC);
    return [...liked, ...shown, ...rest];
  }, [pending, accountKey, state.playlists]);
  return { ...state, playlists, reload, created };
}
