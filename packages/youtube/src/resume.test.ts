import { describe, expect, it } from "vitest";

import { queueOriginFrom, serverQueueFrom } from "./resume.ts";

const text = (value: string) => ({ toString: () => value });

const row = (id: string, selected = false) => ({
  type: "PlaylistPanelVideo",
  video_id: id,
  title: text(id),
  duration: { text: "2:30", seconds: 150 },
  artists: [{ name: "Someone", channel_id: "UCx" }],
  selected,
});

describe("serverQueueFrom", () => {
  it("keeps the whole queue and points at the song that was playing", () => {
    const queue = serverQueueFrom({
      playlist_id: "RDAMVMone",
      contents: [row("one"), row("two", true), row("three")],
    });
    expect(queue?.tracks.map((t) => t.id)).toEqual(["yt:one", "yt:two", "yt:three"]);
    expect(queue?.index).toBe(1);
    expect(queue?.playlistId).toBe("RDAMVMone");
  });

  it("finds the selected song inside a wrapped row", () => {
    const queue = serverQueueFrom({
      contents: [row("one"), { type: "PlaylistPanelVideoWrapper", primary: row("two", true) }],
    });
    expect(queue?.index).toBe(1);
    expect(queue?.playlistId).toBeNull();
  });

  it("starts at the top when nothing is selected, and is null when empty", () => {
    expect(serverQueueFrom({ contents: [row("one"), row("two")] })?.index).toBe(0);
    expect(serverQueueFrom({ contents: [] })).toBeNull();
  });
});

/** A `GET_QUEUE` answer, trimmed to the parts `queueOriginFrom` reads. */
const answer = (crossDevice: boolean) => ({
  contents: {
    singleColumnMusicWatchNextResultsRenderer: {
      tabbedRenderer: {
        watchNextTabbedResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  musicQueueRenderer: {
                    header: {
                      musicQueueHeaderRenderer: {
                        title: { runs: [{ text: "Playing from" }] },
                        subtitle: { runs: [{ text: "My Supermix" }] },
                      },
                    },
                    musicQueueConfig: {
                      musicQueueRestorationInfo: {
                        lastWatchTimestamp: { seconds: "1791935518", nanos: 753255000 },
                        onQueueRestoredCommand: {
                          miniplayerAnnouncementCommand: {
                            miniPlayerBylineRenderer: {
                              miniPlayerBylineRenderer: {
                                text: { runs: [{ text: "From your Android device" }] },
                                durationMs: "10000",
                              },
                            },
                          },
                        },
                        isCrossDeviceQueue: crossDevice,
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      },
    },
  },
});

describe("queueOriginFrom", () => {
  it("names the queue and the device it was left on", () => {
    expect(queueOriginFrom(answer(true))).toEqual({
      title: "My Supermix",
      device: "From your Android device",
    });
  });

  it("names no device for a queue left on this kind of client", () => {
    expect(queueOriginFrom(answer(false))).toEqual({ title: "My Supermix", device: null });
  });

  it("is empty for an answer without a queue", () => {
    expect(queueOriginFrom({})).toEqual({ title: null, device: null });
    expect(queueOriginFrom(null)).toEqual({ title: null, device: null });
  });
});
