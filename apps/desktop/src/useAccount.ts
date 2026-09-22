import { useCallback, useEffect, useState } from "react";
import { accountCookie, accountImport, accountSignIn, accountSignOut } from "@ymusic/ipc";
import type { AccountSummary } from "@ymusic/youtube";

import { engine } from "./engine.ts";

export interface AccountState {
  account: AccountSummary | null;
  busy: boolean;
  error: string | null;
  signIn: () => void;
  /** Takes the session from a browser profile, by its id from `accountBrowsers`. */
  importFrom: (browserId: string) => void;
  signOut: () => void;
}

/**
 * The signed-in YouTube account. The session itself lives in Rust, sealed; this
 * hands its cookie to the engine worker and asks YouTube who it belongs to,
 * which doubles as the check that the saved session still works.
 */
export function useAccount(): AccountState {
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const adopt = useCallback(async (cookie: string | null) => {
    await engine.setCookie(cookie);
    setAccount(cookie === null ? null : await engine.account());
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cookie = await accountCookie();
        if (!cancelled) await adopt(cookie);
      } catch (e) {
        if (!cancelled) setError(describe("Could not restore your YouTube session", e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adopt]);

  const signIn = useCallback(() => {
    setBusy(true);
    void (async () => {
      try {
        const cookie = await accountSignIn();
        // Null is the user closing the window: a cancel, not a failure.
        if (cookie !== null) await adopt(cookie);
      } catch (e) {
        setError(describe("Sign-in failed", e));
      } finally {
        setBusy(false);
      }
    })();
  }, [adopt]);

  const importFrom = useCallback(
    (browserId: string) => {
      setBusy(true);
      void (async () => {
        try {
          await adopt(await accountImport(browserId));
        } catch (e) {
          setError(describe("Import failed", e));
        } finally {
          setBusy(false);
        }
      })();
    },
    [adopt],
  );

  const signOut = useCallback(() => {
    setBusy(true);
    void (async () => {
      try {
        await accountSignOut();
        await adopt(null);
      } catch (e) {
        setError(describe("Sign-out failed", e));
      } finally {
        setBusy(false);
      }
    })();
  }, [adopt]);

  return { account, busy, error, signIn, importFrom, signOut };
}

function describe(prefix: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${prefix}: ${message}`;
}
