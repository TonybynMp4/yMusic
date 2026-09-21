import { getChallenge } from "bgutils-js/botguard";

import type { FetchLike } from "./client.ts";

/**
 * PO ("proof of origin") tokens, minted through BotGuard.
 *
 * The fallback stream path needs one: its client's URLs answer 403 without a
 * token and 206 with (measured, `tv_simply`). Minting is four steps, and only
 * the middle two need BotGuard's VM, which needs a real DOM:
 *
 * 1. fetch a challenge: the VM's interpreter and a program for it (here);
 * 2. run it, getting an attestation (the VM);
 * 3. trade the attestation for an integrity token (here) and hand that to the
 *    VM, which returns a minter;
 * 4. mint a token per content binding (the VM).
 *
 * The VM lives behind `BotGuardVm` (an isolated frame in the app, jsdom in
 * tests), and everything that touches the network stays in the worker.
 */

/** YouTube's BotGuard request key, as the web player sends it. */
const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
/** Google's public key for the WAA API, embedded in every YouTube page. */
const WAA_API_KEY = "AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw";
const GENERATE_IT_URL = "https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT";

export interface BotGuardChallenge {
  interpreterJavascript: string;
  program: string;
  globalName: string;
}

/** The VM-side operations; see `botguard/frame.js`. */
export interface BotGuardVm {
  load(challenge: BotGuardChallenge): Promise<string>;
  createMinter(integrityToken: string): Promise<void>;
  mint(binding: string): Promise<string>;
}

export class PoTokenMinter {
  readonly #fetch: FetchLike;
  readonly #vm: BotGuardVm;
  readonly #now: () => number;
  /** When the current minter's integrity token stops being worth using. */
  #ready: Promise<number> | null = null;

  constructor(fetch: FetchLike, vm: BotGuardVm, now: () => number = Date.now) {
    this.#fetch = withoutOrigin(fetch);
    this.#vm = vm;
    this.#now = now;
  }

  /** A token bound to `binding`: a visitor id for streams, a video id for the player request. */
  async mint(binding: string): Promise<string> {
    let ready = this.#ready;
    if (ready === null || (await ready) <= this.#now()) {
      ready = this.#ready = this.#initialize().catch((error: unknown) => {
        this.#ready = null;
        throw error;
      });
    }
    await ready;
    return this.#vm.mint(binding);
  }

  async #initialize(): Promise<number> {
    const challenge = await getChallenge({
      requestKey: REQUEST_KEY,
      fetchFunction: this.#fetch as never,
    });
    if (!challenge.program || !challenge.globalName) {
      throw new Error("BotGuard challenge was incomplete");
    }
    const attestation = await this.#vm.load({
      interpreterJavascript: await this.#interpreter(challenge),
      program: challenge.program,
      globalName: challenge.globalName,
    });

    const response = await this.#fetch(GENERATE_IT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json+protobuf",
        "x-goog-api-key": WAA_API_KEY,
        "x-user-agent": "grpc-web-javascript/0.1",
      },
      body: JSON.stringify([REQUEST_KEY, attestation]),
    });
    if (!response.ok) throw new Error(`integrity token request failed: ${response.status}`);
    const [integrityToken, ttlSeconds, refreshThresholdSeconds] = (await response.json()) as [
      string | undefined,
      number | undefined,
      number | undefined,
    ];
    if (!integrityToken) throw new Error("BotGuard's attestation was refused");

    await this.#vm.createMinter(integrityToken);
    // Refresh early by the threshold Google suggests, so a token is never
    // minted from an integrity token about to lapse mid-track.
    const usableSeconds = Math.max(60, (ttlSeconds ?? 3600) - (refreshThresholdSeconds ?? 300));
    return this.#now() + usableSeconds * 1000;
  }

  async #interpreter(challenge: Awaited<ReturnType<typeof getChallenge>>): Promise<string> {
    const inline = challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (inline) return inline;
    const url = challenge.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
    if (!url) throw new Error("BotGuard challenge had no interpreter");
    const response = await this.#fetch(url.startsWith("//") ? `https:${url}` : url);
    if (!response.ok) throw new Error(`BotGuard interpreter fetch failed: ${response.status}`);
    return response.text();
  }
}

/**
 * The challenge is bound to the `Origin` it was requested from, and the
 * attestation for it is refused later if that origin was one Google did not
 * expect. Measured: no Origin and `tauri://localhost` pass;
 * `https://www.youtube.com`, `https://music.youtube.com` and the dev server's
 * `http://localhost:1420` are refused. The app's fetch would send YouTube's
 * origin, and its HTTP plugin the webview's; an empty value is how both are
 * told to send none. Plain `fetch` sends none to begin with.
 */
function withoutOrigin(fetch: FetchLike): FetchLike {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Origin", "");
    return fetch(input, { ...init, headers });
  };
}
