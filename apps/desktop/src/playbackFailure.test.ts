import { describe, expect, it } from "vitest";

import { classifyFailure, failureAction } from "./playbackFailure.ts";

describe("classifyFailure", () => {
  it("reads a local file gone from disk or from the library as missing", () => {
    expect(
      classifyFailure("the file for `local:12` is no longer on disk: /music/a.flac"),
    ).toBe("missing");
    expect(classifyFailure("no track in the library with id `local:12`")).toBe("missing");
  });

  it("reads YouTube's ERROR status as unavailable, and no other status", () => {
    expect(classifyFailure("ERROR: This video has been removed by the uploader")).toBe(
      "unavailable",
    );
    expect(classifyFailure("ERROR")).toBe("unavailable");
    expect(classifyFailure("LOGIN_REQUIRED: Sign in to confirm you're not a bot")).toBe(
      "failed",
    );
    expect(classifyFailure("could not resolve a stream: ERRORS; then UNPLAYABLE")).toBe("failed");
  });

  it("reads a request that never reached YouTube as offline", () => {
    expect(
      classifyFailure(
        "could not resolve a stream: error sending request for url (https://music.youtube.com/youtubei/v1/player): client error (Connect)",
      ),
    ).toBe("offline");
    expect(classifyFailure("Failed to fetch")).toBe("offline");
  });

  it("calls anything while the system says it is offline offline", () => {
    expect(classifyFailure("playback failed: the stream may have expired", false)).toBe(
      "offline",
    );
  });

  it("leaves a refused stream as a plain failure", () => {
    expect(
      classifyFailure(
        "playback failed: the stream may have expired or been rejected (loading failed)",
      ),
    ).toBe("failed");
  });
});

describe("failureAction", () => {
  it("offers Retry when trying again can help, skipping or not", () => {
    expect(failureAction({ kind: "offline", canSkip: true })).toBe("retry");
    expect(failureAction({ kind: "failed", canSkip: false })).toBe("retry");
  });

  it("offers Skip for a failure for good, when there is a song to move on to", () => {
    expect(failureAction({ kind: "missing", canSkip: true })).toBe("skip");
    expect(failureAction({ kind: "unavailable", canSkip: false })).toBeNull();
  });
});
