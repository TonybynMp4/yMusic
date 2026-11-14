import { useCallback, useMemo, useState } from "react";
import type { BrowseCard } from "@ymusic/core";

import {
  addGone,
  addPending,
  dropPending,
  itemsFor,
  prunePending,
  unscoped,
  type Scoped,
} from "./libraryPlaylists.ts";

export interface PlaylistOverlays {
  /** New playlists the fetched list does not have yet. */
  missing: readonly BrowseCard[];
  /** Deleted playlists the fetched list may still have. */
  hidden: readonly string[];
  created: (card: BrowseCard) => void;
  deleted: (id: string) => void;
}

/**
 * Playlists just created or deleted that YouTube's library list does not
 * reflect yet, kept with the account they were made under.
 */
export function usePlaylistOverlays(
  accountKey: string | null,
  listed: readonly BrowseCard[],
): PlaylistOverlays {
  const [pending, setPending] = useState<Scoped<BrowseCard>>(unscoped);
  const [gone, setGone] = useState<Scoped<string>>(unscoped);
  const pruned = useMemo(() => prunePending(pending, accountKey, listed), [pending, accountKey, listed]);
  if (pruned !== pending) setPending(pruned);
  const created = useCallback(
    (card: BrowseCard) => setPending((current) => addPending(current, accountKey, card)),
    [accountKey],
  );
  const deleted = useCallback(
    (id: string) => {
      setGone((current) => addGone(current, accountKey, id));
      setPending((current) => dropPending(current, id));
    },
    [accountKey],
  );
  return {
    missing: itemsFor(pruned, accountKey),
    hidden: itemsFor(gone, accountKey),
    created,
    deleted,
  };
}
