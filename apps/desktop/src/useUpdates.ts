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
  // Once per start: turning the setting on later does not check straight
  // away, the button in Settings does.
  const [startup] = useState(automatic && isTauri);
  const [update, setUpdate] = useState<Update | null>(null);
  const [checking, setChecking] = useState(startup);
  const [status, setStatus] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  /** Asks for the latest release, with `checking` already set. */
  const ask = useCallback(
    () =>
      updateCheck()
        .then(
          (found) => {
            setUpdate(found);
            setStatus(found ? `Version ${found.version} is available.` : "yMusic is up to date.");
          },
          (error: unknown) => {
            console.warn("update check failed", error);
            setStatus("Could not check for updates.");
          },
        )
        .finally(() => setChecking(false)),
    [],
  );

  const check = async () => {
    if (!isTauri) return;
    setChecking(true);
    await ask();
  };

  useEffect(() => {
    if (startup) void ask();
  }, [startup, ask]);

  return { update, checking, status, dismissed, check, dismiss: () => setDismissed(true) };
}
