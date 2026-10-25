import { describe, expect, it } from "vitest";

import { subscriberFromPage } from "./premium.ts";

describe("subscriberFromPage", () => {
  it("reads IS_SUBSCRIBER from a signed-in page", () => {
    expect(subscriberFromPage('{"LOGGED_IN":true,"IS_SUBSCRIBER":true}')).toBe(true);
    expect(subscriberFromPage('{"LOGGED_IN":true,"IS_SUBSCRIBER":false}')).toBe(false);
  });

  // A stale session gets the signed-out page, which says nothing about the account.
  it("has no answer for a signed-out page", () => {
    expect(subscriberFromPage('{"LOGGED_IN":false,"IS_SUBSCRIBER":false}')).toBeNull();
  });

  it("has no answer when the page does not say", () => {
    expect(subscriberFromPage('{"LOGGED_IN":true}')).toBeNull();
  });
});
