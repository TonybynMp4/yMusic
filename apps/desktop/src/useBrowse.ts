import { useEffect, useState } from "react";
import type { AlbumPage, ArtistPage, PlaylistPage } from "@ytbm/core";

import { engine } from "./engine.ts";

/** A browse page, by what opens it. The app's navigation stack holds these. */
export type Route =
  | { kind: "album"; id: string }
  | { kind: "artist"; id: string }
  | { kind: "playlist"; id: string };

/**
 * Anything the main area can show besides search: a YouTube Music page, or
 * local files (`id` is a folder path, or empty for all of them).
 */
export type View = Route | { kind: "local"; id: string };

export function viewKey(view: View): string {
  return `${view.kind}:${view.id}`;
}

export type Page =
  | { kind: "album"; page: AlbumPage }
  | { kind: "artist"; page: ArtistPage }
  | { kind: "playlist"; page: PlaylistPage };

export type BrowseState =
  | { status: "loading" }
  | { status: "ready"; page: Page }
  | { status: "error"; error: string };

/**
 * Pages already fetched this run, so going back is instant and does not refetch.
 * Bounded by how much browsing one session does, which is not much; a page
 * that changes upstream — a playlist gaining tracks — is fresh on next launch.
 */
const cache = new Map<string, Promise<Page>>();

function load(route: Route): Promise<Page> {
  const key = `${route.kind}:${route.id}`;
  let page = cache.get(key);
  if (!page) {
    page = fetchPage(route);
    // A failure is not cached: offline for a moment should not stick.
    page.catch(() => cache.delete(key));
    cache.set(key, page);
  }
  return page;
}

async function fetchPage(route: Route): Promise<Page> {
  switch (route.kind) {
    case "album":
      return { kind: "album", page: await engine.album(route.id) };
    case "artist":
      return { kind: "artist", page: await engine.artist(route.id) };
    case "playlist":
      return { kind: "playlist", page: await engine.playlist(route.id) };
  }
}

export function useBrowse(route: Route): BrowseState {
  const [state, setState] = useState<BrowseState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    load(route).then(
      (page) => !cancelled && setState({ status: "ready", page }),
      (error: unknown) =>
        !cancelled &&
        setState({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [route.kind, route.id]);
  return state;
}
