import { describe, expect, it } from "vitest";

import { radioArtistFrom, radioChipsFrom, radioCoverFrom } from "./tuned-radio.ts";

/** A queue chip as `/next` answers it for an artist's mix, trimmed to what is read. */
const chip = (label: string, playlistId: string) => ({
  chipCloudChipRenderer: {
    text: { runs: [{ text: label }] },
    navigationEndpoint: {
      queueUpdateCommand: { fetchContentsCommand: { watchEndpoint: { playlistId } } },
    },
  },
});

const next = (...chips: unknown[]) => ({
  contents: {
    musicQueueRenderer: { subHeaderChipCloud: { chipCloudRenderer: { chips } } },
  },
});

describe("radioArtistFrom", () => {
  it("reads the artist off the first chip that names one", () => {
    const data = next(
      chip("All", "RDEMrxTesNM2UxWELZx2vsoG2A"),
      chip("2010s", "RDATd0Xa0tvhb2pE"),
      chip("Popular", "RDATpYa0tvhb2pE"),
    );
    expect(radioArtistFrom(data)).toBe("0tvhb2p");
  });

  it("is null when the mix has no tuning chips", () => {
    expect(radioArtistFrom(next(chip("All", "RDEMx")))).toBeNull();
    expect(radioArtistFrom({})).toBeNull();
  });
});

describe("radioChipsFrom", () => {
  it("reads each chip that queues a radio, in order", () => {
    const save = {
      chipCloudChipRenderer: {
        text: { runs: [{ text: "Save" }] },
        navigationEndpoint: { modalEndpoint: { modal: {} } },
      },
    };
    const data = next(
      save,
      chip("All", "RDAMVMyKNxeF4KMsY"),
      chip("Popular", "RDATpYvyKNxeF4KMsY"),
      chip("Popular", "RDATpYvyKNxeF4KMsY"),
      chip("Chill", "RDATmXvyKNxeF4KMsY"),
    );
    expect(radioChipsFrom(data)).toEqual([
      { title: "All", playlistId: "RDAMVMyKNxeF4KMsY" },
      { title: "Popular", playlistId: "RDATpYvyKNxeF4KMsY" },
      { title: "Chill", playlistId: "RDATmXvyKNxeF4KMsY" },
    ]);
  });
});

describe("radioCoverFrom", () => {
  const page = (header: unknown) => ({
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [header] } } } }],
      },
    },
  });

  it("reads the name and YouTube's drawn cover from the header", () => {
    const cover = radioCoverFrom(
      page({
        musicResponsiveHeaderRenderer: {
          title: { runs: [{ text: "Coldplay, Muse Mix" }] },
          subtitle: { runs: [{ text: "Muse, Coldplay, Blur, and more" }] },
          thumbnail: {
            musicThumbnailRenderer: {
              thumbnail: {
                thumbnails: [
                  { url: "https://music.youtube.com/image/radioart?r=a", width: 200, height: 200 },
                  { url: "https://music.youtube.com/image/radioart?r=b", width: 600, height: 600 },
                ],
              },
            },
          },
        },
      }),
    );
    expect(cover).toEqual({
      title: "Coldplay, Muse Mix",
      subtitle: "Muse, Coldplay, Blur, and more",
      thumbnails: [
        { url: "https://music.youtube.com/image/radioart?r=b", width: 600, height: 600 },
        { url: "https://music.youtube.com/image/radioart?r=a", width: 200, height: 200 },
      ],
    });
  });

  it("is null without a header", () => {
    expect(radioCoverFrom(page({}))).toBeNull();
    expect(radioCoverFrom({})).toBeNull();
  });
});
