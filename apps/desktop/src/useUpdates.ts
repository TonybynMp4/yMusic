import { isTauri, type Update, updateCheck } from "@ymusic/ipc";
import { useCallback, useEffect, useState } from "react";

export interface UpdatesState {
  /** The newer release, once a check has found one. */
  update: Update | null;
  checking: boolean;
  /** The last check's outcome, for the About section. */
  status: string | null;
  /** Hides the notice until the next start. */
  dismissed: boolean;
  check: () => Promise<void>;
  dismiss: () => void;
}

/** Checks for a newer release once at startup when `automatic`, and on request. */
export function useUpdates(automatic: boolean): UpdatesState {
  const [update, setUpdate] = useState<Update | null>(null);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    if (!isTauri) return;
    setChecking(true);
    try {
      const found = await updateCheck();
      setUpdate(found);
      setStatus(found ? `Version ${found.version} is available.` : "yMusic is up to date.");
    } catch (error) {
      console.warn("update check failed", error);
      setStatus("Could not check for updates.");
    } finally {
      setChecking(false);
    }
  }, []);

  // Once per start: turning the setting on later does not check straight
  // away, the button in Settings does.
  const [startup] = useState(automatic);
  useEffect(() => {
    if (startup) void check();
  }, [startup, check]);

  return { update, checking, status, dismissed, check, dismiss: () => setDismissed(true) };
}
