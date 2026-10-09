import { useCallback, useEffect, useRef, useState } from "react";
import {
  accountCookie,
  accountImport,
  accountRefresh,
  accountSignIn,
  accountSignOut,
} from "@ymusic/ipc";
import type { AccountSummary } from "@ymusic/youtube";

import { engine, onSessionExpired } from "./engine.ts";

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

  // Counts expiries, so an `adopt` the session expired under drops its result:
  // the expiry is read from a copy of a response and can land before the
  // answer to `engine.account()` does.
  const expiries = useRef(0);

  const adopt = useCallback(async (cookie: string | null) => {
    const expiry = expiries.current;
    let summary: AccountSummary | null;
    try {
      await engine.setCookie(cookie);
      summary = cookie === null ? null : await engine.account();
    } catch (e) {
      if (expiries.current !== expiry) return;
      throw e;
    }
    if (expiries.current !== expiry) return;
    setAccount(summary);
    setError(null);
  }, []);

  // An imported session is read again from its browser, which keeps its copy
  // fresh. Otherwise the saved session stays on disk until signing in again
  // replaces it. Signed out in between, so the library reloads either way.
  useEffect(
    () =>
      onSessionExpired(() => {
        expiries.current += 1;
        setAccount(null);
        setBusy(true);
        void (async () => {
          try {
            const cookie = await accountRefresh();
            if (cookie === null) throw new Error("no newer session to read");
            await adopt(cookie);
          } catch {
            setError("Your YouTube session has expired. Sign in again");
          } finally {
            setBusy(false);
          }
        })();
      }),
    [adopt],
  );

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
