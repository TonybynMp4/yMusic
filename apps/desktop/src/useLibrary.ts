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
  tracks: LocalTrack[];
  folders: string[];
  loading: boolean;
  /** The last scan's result, shown so an unreadable file is not silent. */
  report: ScanReport | null;
  error: string | null;
}

export function useLibrary(query: string) {
  const [state, setState] = useState<LibraryState>({
    tracks: [],
    folders: [],
    loading: isTauri,
    report: null,
    error: null,
  });

  const refresh = useCallback(async (search: string) => {
    if (!isTauri) {
      setState((s) => ({ ...s, loading: false, error: "The library needs the desktop app." }));
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    try {
      const [tracks, folders] = await Promise.all([librarySearch(search), libraryFolders()]);
      setState((s) => ({ ...s, tracks, folders, loading: false, error: null }));
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error: String(error) }));
    }
  }, []);

  // Debounced so typing does not fire a query per keystroke; the Rust side is
  // fast enough that 150ms is imperceptible but collapses a burst into one.
  useEffect(() => {
    const timer = setTimeout(() => void refresh(query), 150);
    return () => clearTimeout(timer);
  }, [query, refresh]);

  const addFolder = useCallback(async () => {
    const chosen = await pickMusicFolder();
    if (chosen === null) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const report = await libraryAddFolder(chosen);
      setState((s) => ({ ...s, report }));
    } catch (error) {
      setState((s) => ({ ...s, error: String(error) }));
    }
    await refresh(query);
  }, [query, refresh]);

  const removeFolder = useCallback(
    async (path: string) => {
      await libraryRemoveFolder(path);
      await refresh(query);
    },
    [query, refresh],
  );

  const rescan = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const report = await libraryScan();
      setState((s) => ({ ...s, report }));
    } catch (error) {
      setState((s) => ({ ...s, error: String(error) }));
    }
    await refresh(query);
  }, [query, refresh]);

  return { ...state, addFolder, removeFolder, rescan };
}
