import { useCallback, useEffect, useState } from "react";
import {
  isTauri,
  libraryAddFolder,
  libraryFolders,
  libraryRemoveFolder,
  libraryScan,
  librarySearch,
  type LocalTrack,
  pickMusicFolder,
  type ScanReport,
} from "@ytbm/ipc";

export interface LibraryState {
  /** Every local track, for the folder pages. */
  all: LocalTrack[];
  /** Local tracks matching the search, empty for a blank one. */
  matches: LocalTrack[];
  folders: string[];
  loading: boolean;
  /** The last scan's result, shown so an unreadable file is not silent. */
  report: ScanReport | null;
  error: string | null;
}

export function useLibrary(query: string) {
  const [state, setState] = useState<LibraryState>({
    all: [],
    matches: [],
    folders: [],
    loading: isTauri,
    report: null,
    error: null,
  });

  const reload = useCallback(async () => {
    if (!isTauri) {
      setState((s) => ({ ...s, loading: false, error: "Local files need the desktop app." }));
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    try {
      // A blank search is everything, matching the Rust side.
      const [all, folders] = await Promise.all([librarySearch(""), libraryFolders()]);
      setState((s) => ({ ...s, all, folders, loading: false, error: null }));
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error: String(error) }));
    }
  }, []);

  useEffect(() => void reload(), [reload]);

  // Debounced so typing does not fire a query per keystroke; the Rust side is
  // fast enough that 150ms is imperceptible but collapses a burst into one.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const trimmed = query.trim();
    if (!isTauri || trimmed.length === 0) {
      setState((s) => (s.matches.length === 0 ? s : { ...s, matches: [] }));
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      librarySearch(trimmed).then(
        (matches) => !cancelled && setState((s) => ({ ...s, matches })),
        () => !cancelled && setState((s) => ({ ...s, matches: [] })),
      );
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, version]);

  /** Runs a change to the library, then reloads it and any search showing. */
  const change = useCallback(
    async (run: () => Promise<ScanReport | void>) => {
      setState((s) => ({ ...s, loading: true }));
      try {
        const report = await run();
        if (report) setState((s) => ({ ...s, report }));
      } catch (error) {
        setState((s) => ({ ...s, error: String(error) }));
      }
      await reload();
      setVersion((v) => v + 1);
    },
    [reload],
  );

  const addFolder = useCallback(async () => {
    const chosen = await pickMusicFolder();
    if (chosen !== null) await change(() => libraryAddFolder(chosen));
  }, [change]);

  const removeFolder = useCallback(
    (path: string) => change(() => libraryRemoveFolder(path)),
    [change],
  );

  const rescan = useCallback(() => change(libraryScan), [change]);

  return { ...state, addFolder, removeFolder, rescan };
}

/** The tracks under `folder`, by path prefix. Either separator, for Windows. */
export function tracksIn(all: readonly LocalTrack[], folder: string): LocalTrack[] {
  const normal = (path: string) => path.replaceAll("\\", "/");
  const base = normal(folder);
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return all.filter((track) => normal(track.path).startsWith(prefix));
}

/** The last path segment, for a folder's display name. */
export function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
