import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Track } from "@ymusic/core";
import type { LocalTrack } from "@ymusic/ipc";

import { localByArtist } from "./artistLibrary.ts";
import { engine } from "./engine.ts";

/**
 * An artist page's "In your library": the account's songs by the artist, then
 * the local files tagged with the artist's name.
 */
export interface ArtistLibrary {
  tracks: Track[];
  /** The account's songs are still loading; local files show meanwhile. */
  loading: boolean;
}

/**
 * Under the library page's keys, so `forgetSaved` drops it along with the
 * lists a save or a like changes.
 */
export function artistLibraryKey(account: string, id: string) {
  return ["saved", account, "artist", id] as const;
}

/**
 * `account` null (signed out) leaves only the local files. A failed load of
 * the account's songs is logged and leaves the local files too: the section
 * is a bonus on the page, not worth an error of its own.
 */
export function useArtistLibrary(
  account: string | null,
  id: string,
  name: string,
  local: readonly LocalTrack[],
): ArtistLibrary {
  const { data, isPending } = useQuery({
    queryKey: artistLibraryKey(account ?? "", id),
    queryFn: () =>
      engine.libraryArtistSongs(id).catch((error: unknown) => {
        console.error(`could not load the library's songs by ${id}`, error);
        return [];
      }),
    enabled: account !== null,
  });
  const mine = useMemo(() => localByArtist(local, name), [local, name]);
  return useMemo(
    () => ({ tracks: [...(data ?? []), ...mine], loading: account !== null && isPending }),
    [data, mine, account, isPending],
  );
}
