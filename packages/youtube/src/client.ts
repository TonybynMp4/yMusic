import { ClientType, Innertube, Platform } from "youtubei.js";

export type FetchLike = typeof fetch;

export interface YouTubeOptions {
  /**
   * How InnerTube is reached.
   *
   * Required rather than defaulted, because the default is wrong in the place
   * this actually runs: YouTube's endpoints send no CORS headers, so the
   * webview's own `fetch` is blocked before the request leaves. The desktop app
   * passes a fetch that goes out through Rust. Node (tests, probes) passes the
   * global one.
   */
  fetch: FetchLike;
  /**
   * A signed-in browser session's `Cookie` header. youtubei.js derives the
   * `Authorization: SAPISIDHASH` header from it, so this alone signs requests in.
   */
  cookie?: string | undefined;
}

/**
 * An InnerTube client for read-only browsing.
 *
 * `retrieve_player: false` skips downloading and interpreting YouTube's player
 * JavaScript. Search does not need it, and it is the slowest and most brittle
 * part of startup, so nothing that only reads metadata should pay for it. Stream
 * resolution will need a client that does.
 */
export async function createYouTube(options: YouTubeOptions): Promise<Innertube> {
  return Innertube.create({
    retrieve_player: false,
    fetch: options.fetch,
    ...(options.cookie ? { cookie: options.cookie } : {}),
  });
}

/**
 * An InnerTube client that can resolve playable stream URLs.
 *
 * The client type is the entire trick, and it was measured rather than chosen.
 * YouTube has moved the default web player onto SABR: `WEB` still returns
 * twenty-two formats for a track, but every one of them arrives with no `url`
 * and no `signatureCipher`, only a `serverAbrStreamingUrl` — there is nothing
 * to hand mpv. Of the fifteen client types, these are the ones that still
 * return direct URLs and need neither a PO token nor a JavaScript evaluator
 * for the signature:
 *
 * | client       | plain GET | `Range: bytes=0-` | `Range: bytes=0-65535` |
 * | ------------ | --------- | ----------------- | ---------------------- |
 * | `IOS`        | 403       | 403               | 206                    |
 * | `ANDROID_VR` | 403       | 403               | 206                    |
 * | `VISIONOS`   | 200       | 206               | 206                    |
 *
 * mpv asks for `Range: bytes=0-` — open-ended — and re-asks the same way when
 * it seeks, so the first two columns are the ones that decide this. Under
 * `IOS` or `ANDROID_VR` mpv reports itself as playing and then sits at zero
 * forever, with no error to show the user, because the 403 never becomes a
 * decode failure. `VISIONOS` is the only client whose URLs answer the requests
 * mpv actually makes, which is why it is here and why swapping it for a
 * plausible-looking alternative will quietly break playback rather than fail.
 *
 * `retrieve_player: true` unlike the search client: the signature has to be
 * deciphered before a URL is playable.
 */
export async function createPlayer(options: YouTubeOptions): Promise<Innertube> {
  return Innertube.create({
    retrieve_player: true,
    client_type: ClientType.VISIONOS,
    fetch: options.fetch,
  });
}

/**
 * The client for when `VISIONOS` stops working, which is a question of when.
 *
 * `TV_SIMPLY` was the one other client whose URLs answer mpv's open-ended
 * range request — but only with a PO token bound to the session's visitor id:
 * 403 without, 206 with. Its formats are also signature-ciphered, which
 * `VISIONOS`'s are not, so this is the path that needs both BotGuard and a
 * JavaScript evaluator. `sessionToken` must have been minted for
 * `visitorData`; youtubei.js appends it to every deciphered URL.
 */
export async function createFallbackPlayer(
  options: YouTubeOptions & { visitorData: string; sessionToken: string },
): Promise<Innertube> {
  installEvaluator();
  return Innertube.create({
    retrieve_player: true,
    client_type: ClientType.TV_SIMPLY,
    visitor_data: options.visitorData,
    po_token: options.sessionToken,
    fetch: options.fetch,
  });
}

/** A fresh anonymous visitor id, for binding a session token to. */
export async function createVisitor(options: YouTubeOptions): Promise<string> {
  const youtube = await Innertube.create({ retrieve_player: false, fetch: options.fetch });
  const visitorData = youtube.session.context.client.visitorData;
  if (!visitorData) throw new Error("YouTube did not issue a visitor id");
  return visitorData;
}

/**
 * youtubei.js extracts the signature and `n` transforms from YouTube's player
 * script but ships no way to run them, leaving that to the platform. This runs
 * them with `new Function`, which is why it only belongs in the engine worker:
 * worker scripts carry no CSP in the app, the page does, and the page's
 * forbids eval. Everything evaluated here is YouTube's own player code.
 */
function installEvaluator(): void {
  Platform.shim.eval = (data, env) => {
    const calls: string[] = [];
    if (env.n) calls.push(`n: exportedVars.nFunction(${JSON.stringify(env.n)})`);
    if (env.sig) calls.push(`sig: exportedVars.sigFunction(${JSON.stringify(env.sig)})`);
    return new Function(`${data.output}\nreturn { ${calls.join(", ")} }`)() as never;
  };
}
