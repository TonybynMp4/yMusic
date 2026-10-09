import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export const LIKED_MUSIC = "LM";

/** How many times the list is fetched again while a new playlist is missing from it. */
const LIST_RETRIES = 5;

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
  // Whose list `state.playlists` is.
  const listed = useRef<string | null>(null);
  useEffect(() => {
    if (accountKey === null) {
      setState({ playlists: [], loading: false, error: null });
      return;
    }
    let cancelled = false;
    // Another account's list never stays up while this one's loads.
    const same = listed.current === accountKey;
    setState((s) => ({ ...s, playlists: same ? s.playlists : [], loading: true }));
    engine.libraryPlaylists().then(
      (playlists) => {
        if (cancelled) return;
        listed.current = accountKey;
        setState({ playlists, loading: false, error: null });
        setPending(({ account, cards }) => ({
          account,
          cards: cards.filter((card) => !playlists.some((p) => p.id === card.id)),
        }));
      },
      // The last good list stays, so a failed refetch (a retry for a new
      // playlist, say) does not blank the sidebar.
      (error: unknown) =>
        !cancelled &&
        setState((s) => ({
          ...s,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        })),
    );
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- generation reloads the list after a change
  }, [accountKey, generation]);
  // A new playlist reaches YouTube's library list a while after it exists, so
  // the list is fetched again, further apart each time, until it has it. Its
  // entry then swaps the placeholder for YouTube's, with its art.
  const retries = useRef(0);
  const waiting = pending.account === accountKey && pending.cards.length > 0;
  useEffect(() => {
    if (!waiting || state.loading || retries.current >= LIST_RETRIES) return;
    const timer = setTimeout(
      () => {
        retries.current += 1;
        setGeneration((g) => g + 1);
      },
      (retries.current + 1) * 2000,
    );
    return () => clearTimeout(timer);
  }, [waiting, state.loading]);
  const reload = useCallback(() => setGeneration((g) => g + 1), []);
  const created = useCallback(
    (card: BrowseCard) => {
      retries.current = 0;
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
