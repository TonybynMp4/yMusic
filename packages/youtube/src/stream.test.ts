import { describe, expect, it } from "vitest";
import { type TrackId } from "@ytbm/core";

import {
  bestAudioFormat,
  codecFromMimeType,
  expiryFromUrl,
  leaseFrom,
  type RawFormat,
} from "./stream.ts";

/**
 * A format with the fields a test cares about, and genuinely *missing* fields
 * where a test passes `undefined`.
 *
 * `exactOptionalPropertyTypes` draws a distinction the real responses also
 * draw: an optional field set to `undefined` is not the same as one that never
 * arrived, and several of these tests are about the latter. Deleting the key
 * is what actually reproduces it.
 */
type Fields = Omit<RawFormat, "decipher">;

function format(overrides: { [K in keyof Fields]?: Fields[K] | undefined } = {}): RawFormat {
  const merged: Record<string, unknown> = {
    itag: 251,
    mime_type: 'audio/webm; codecs="opus"',
    bitrate: 160_000,
    has_audio: true,
    has_video: false,
    decipher: () => "https://example.com/stream",
    ...overrides,
  };
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete merged[key];
  }
  return merged as unknown as RawFormat;
}

const URL_WITH_EXPIRY = "https://rr5.googlevideo.com/videoplayback?expire=1789969190&itag=251";

describe("bestAudioFormat", () => {
  it("takes the highest bitrate among audio-only formats", () => {
    const chosen = bestAudioFormat([
      format({ itag: 249, bitrate: 50_000 }),
      format({ itag: 251, bitrate: 160_000 }),
      format({ itag: 250, bitrate: 70_000 }),
    ]);

    expect(chosen?.itag).toBe(251);
  });

  // The video formats carry audio too, at several times the bitrate for a
  // picture a music player never shows. Picking one would work and waste
  // bandwidth silently, which is why this is asserted rather than assumed.
  it("never picks a format that carries video, however high its bitrate", () => {
    const chosen = bestAudioFormat([
      format({ itag: 137, bitrate: 500_000, has_video: true }),
      format({ itag: 251, bitrate: 160_000 }),
    ]);

    expect(chosen?.itag).toBe(251);
  });

  // DRC is the same audio with the dynamic range squashed. Choosing it means
  // silently applying a mastering decision the listener did not ask for.
  it("skips DRC formats even when they are the loudest option", () => {
    const chosen = bestAudioFormat([
      format({ itag: 251, bitrate: 160_000, is_drc: true }),
      format({ itag: 250, bitrate: 70_000 }),
    ]);

    expect(chosen?.itag).toBe(250);
  });

  it("returns null when nothing is audio-only", () => {
    expect(bestAudioFormat([format({ has_video: true })])).toBeNull();
    expect(bestAudioFormat([])).toBeNull();
  });

  it("still chooses when bitrates are missing", () => {
    const chosen = bestAudioFormat([
      format({ itag: 249, bitrate: undefined }),
      format({ itag: 251, bitrate: 160_000 }),
    ]);

    expect(chosen?.itag).toBe(251);
  });
});

describe("codecFromMimeType", () => {
  it.each([
    ['audio/webm; codecs="opus"', "opus"],
    ['audio/mp4; codecs="mp4a.40.2"', "aac"],
    ['audio/webm; codecs="vorbis"', "vorbis"],
    ["audio/mpeg", "unknown"],
    [undefined, "unknown"],
  ])("reads %s as %s", (mime, expected) => {
    expect(codecFromMimeType(mime)).toBe(expected);
  });
});

describe("expiryFromUrl", () => {
  // The lease is re-resolved against this, so seconds read as milliseconds
  // would put expiry in 1970 and re-resolve before every single play.
  it("reads the expire parameter as seconds and returns milliseconds", () => {
    expect(expiryFromUrl(URL_WITH_EXPIRY)).toBe(1_789_969_190_000);
  });

  it("returns null when there is no expiry to read", () => {
    expect(expiryFromUrl("https://example.com/stream")).toBeNull();
    expect(expiryFromUrl("https://example.com/stream?expire=soon")).toBeNull();
  });
});

describe("leaseFrom", () => {
  const trackId = "yt:SM4tQcUt_mQ" as TrackId;

  it("carries the format's identity onto the lease", () => {
    const lease = leaseFrom(trackId, format(), URL_WITH_EXPIRY);

    expect(lease).toMatchObject({
      trackId,
      url: URL_WITH_EXPIRY,
      itag: 251,
      codec: "opus",
      bitrate: 160_000,
      expiresAt: 1_789_969_190_000,
    });
  });

  // Measured: these URLs serve any client that asks, so there is nothing for
  // mpv to replay. A header invented here would be a guess mpv then depends on.
  it("sends no headers, because the stream needs none", () => {
    expect(leaseFrom(trackId, format(), URL_WITH_EXPIRY).headers).toEqual({});
  });

  it("reports an unknown bitrate as null rather than zero", () => {
    expect(leaseFrom(trackId, format({ bitrate: 0 }), URL_WITH_EXPIRY).bitrate).toBeNull();
    expect(leaseFrom(trackId, format({ bitrate: undefined }), URL_WITH_EXPIRY).bitrate).toBeNull();
  });
});
