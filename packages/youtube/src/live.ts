import { describe, type TestContext } from "vitest";

/**
 * Gates the tests that talk to the real YouTube. Opt-in, because a test suite
 * that fails when the network is down or when YouTube is rate limiting is a
 * test suite people learn to ignore.
 *
 * Run with `YMUSIC_NETWORK_TESTS=1 pnpm --filter @ymusic/youtube test`.
 */
export const live = process.env.YMUSIC_NETWORK_TESTS === "1" ? describe : describe.skip;

/**
 * Awaits `work`, or skips the test when the player endpoint answers with its
 * bot check. YouTube asks that of many datacenter addresses, GitHub's runners
 * among them, so the answer says where the test ran and not that anything
 * changed. From a home connection the same test runs in full.
 *
 * Matches `NotPlayableError` by name, not class: one that crossed a message
 * port arrives as a plain `Error` that only keeps its name.
 */
export async function unlessBotChecked<T>(context: TestContext, work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof Error && error.name === "NotPlayableError" && /not a bot/i.test(error.message)) {
      context.skip(`YouTube bot-checked this machine: ${error.message}`);
    }
    throw error;
  }
}
