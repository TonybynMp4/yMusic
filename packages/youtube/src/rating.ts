import type { Innertube } from "youtubei.js";
import type { VideoId } from "@ymusic/core";

/** A song's thumbs up or down on the account. `none` is YouTube's `INDIFFERENT`. */
export type Rating = "like" | "dislike" | "none";

interface RawNext {
  playerOverlays?: {
    playerOverlayRenderer?: {
      actions?: readonly { likeButtonRenderer?: { likeStatus?: unknown } }[];
    };
  };
}

/**
 * The account's rating of `videoId`, from the like button YouTube Music's
 * `/next` puts in the player overlay. Signed out, it is always `none`.
 */
export async function getRating(youtube: Innertube, videoId: VideoId): Promise<Rating> {
  const response = await youtube.actions.execute("/next", { videoId, client: "YTMUSIC" });
  return ratingFrom(response.data as RawNext);
}

/** Exported for tests. */
export function ratingFrom(data: RawNext): Rating {
  for (const action of data.playerOverlays?.playerOverlayRenderer?.actions ?? []) {
    const status = action.likeButtonRenderer?.likeStatus;
    if (status === "LIKE") return "like";
    if (status === "DISLIKE") return "dislike";
    if (status !== undefined) return "none";
  }
  return "none";
}

const ENDPOINTS: Record<Rating, string> = {
  like: "/like/like",
  dislike: "/like/dislike",
  none: "/like/removelike",
};

/**
 * Sent as YouTube Music's web client does. youtubei.js's own `interact.like`
 * goes through the TV client, and a web session's cookie on another client
 * is the mismatch YouTube flags.
 */
export async function setRating(
  youtube: Innertube,
  videoId: VideoId,
  rating: Rating,
): Promise<void> {
  await youtube.actions.execute(ENDPOINTS[rating], { target: { videoId }, client: "YTMUSIC" });
}
