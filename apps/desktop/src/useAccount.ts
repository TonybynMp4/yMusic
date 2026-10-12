import { useCallback, useEffect, useRef, useState } from "react";
import {
  accountCookie,
  accountImport,
  accountRefresh,
  accountRotate,
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
  // The cookie the engine has, which is the one an expiry is about.
  const current = useRef<string | null>(null);

  const adopt = useCallback(async (cookie: string | null) => {
    const expiry = expiries.current;
    let summary: AccountSummary | null;
    try {
      current.current = cookie;
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

  // A fresher copy is looked for (see `accountRefresh`). Without one, the
  // saved session stays on disk until signing in again replaces it. Signed
  // out in between, so the library reloads either way.
  useEffect(
    () =>
      onSessionExpired(() => {
        const stale = current.current;
        expiries.current += 1;
        setAccount(null);
        setBusy(true);
        void (async () => {
          try {
            const cookie = stale === null ? null : await accountRefresh(stale);
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

  // A session from the sign-in window has no browser rotating it, so it is
  // rotated here while signed in, as a browser would, starting at launch since
  // a saved session can be days old. An imported one is left to its browser.
  const signedIn = account !== null;
  useEffect(() => {
    if (!signedIn) return;
    const rotate = () => {
      void accountRotate()
        .then(async (cookie) => {
          if (cookie === null) return;
          // The same account, so neither a new client nor a new account check.
          current.current = cookie;
          await engine.renewCookie(cookie);
        })
        .catch(() => {});
    };
    rotate();
    const timer = setInterval(rotate, ROTATE_EVERY);
    return () => clearInterval(timer);
  }, [signedIn]);

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

/** Browsers rotate about every ten minutes; Google refuses more than about once a minute. */
const ROTATE_EVERY = 10 * 60 * 1000;

function describe(prefix: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${prefix}: ${message}`;
}
