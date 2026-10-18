import type { FetchLike } from "./client.ts";

/**
 * The formats only YouTube Music Premium serves: 774 is Opus, 141 is AAC, both
 * about 256 kbps. The order is the preference: Opus first, as YouTube Music's
 * own web player picks it when the browser can play it.
 */
export const PREMIUM_ITAGS: readonly number[] = [774, 141];

/** The best format a free account gets: Opus at about 160 kbps. */
export const FREE_BEST_ITAG = 251;

/**
 * A desktop browser's user agent. music.youtube.com serves an "update your
 * browser" page, with no config in it, to one it does not recognise.
 */
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/**
 * Whether the signed-in account has YouTube Music Premium, from the page
 * config music.youtube.com embeds in its HTML (`IS_SUBSCRIBER`). InnerTube's
 * account endpoints do not say. Null when the page carries no answer, which
 * also covers a session YouTube no longer accepts.
 */
export async function isSubscriber(fetch: FetchLike, cookie: string): Promise<boolean | null> {
  const response = await fetch("https://music.youtube.com/", {
    headers: { Cookie: cookie, "User-Agent": BROWSER_USER_AGENT, "Accept-Language": "en-US" },
  });
  if (!response.ok) throw new Error(`music.youtube.com answered ${response.status}`);
  return subscriberFromPage(await response.text());
}

export function subscriberFromPage(html: string): boolean | null {
  if (!/"LOGGED_IN":true/.test(html)) return null;
  const match = /"IS_SUBSCRIBER":(true|false)/.exec(html);
  return match ? match[1] === "true" : null;
}
