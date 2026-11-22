import { Parser, YTNodes } from "youtubei.js";

/**
 * youtubei.js's song row, keeping two things it drops.
 *
 * A song the listener cannot play comes greyed out
 * (`musicItemRendererDisplayPolicy`), and when the reason is Premium its title
 * opens the Premium upsell instead of playing. With no watch endpoint to type
 * it by, youtubei.js parses that row as `unknown` and leaves out its video id,
 * which only `playlistItemData` carries. Without both, such a song vanishes
 * from album and playlist pages instead of showing as unavailable.
 */
class ListItem extends YTNodes.MusicResponsiveListItem {
  display_policy: string | null;

  constructor(data: RawListItem) {
    super(data as ConstructorParameters<typeof YTNodes.MusicResponsiveListItem>[0]);
    const policy = data.musicItemRendererDisplayPolicy;
    this.display_policy = typeof policy === "string" ? policy : null;
    const videoId = data.playlistItemData?.videoId;
    if (this.id === undefined && this.item_type === "unknown" && typeof videoId === "string") {
      this.id = videoId;
    }
  }
}

interface RawListItem {
  musicItemRendererDisplayPolicy?: unknown;
  playlistItemData?: { videoId?: unknown } | null;
}

/**
 * Parsers are looked up by renderer name, so registering this one under the
 * stock name makes every response parse rows through it. Idempotent.
 */
export function keepUnavailableRows(): void {
  Parser.addRuntimeParser("MusicResponsiveListItem", ListItem);
}
