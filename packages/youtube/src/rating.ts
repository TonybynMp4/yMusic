import type { Innertube } from "youtubei.js";
import type { VideoId } from "@ymusic/core";

/** A song's thumbs up or down on the account. `none` is YouTube's `INDIFFERENT`. */
export type Rating = "like" | "dislike" | "none";

/** The part of a `/next` answer the rating is read from. */
export interface RawNext {
  playerOverlays?: {
    playerOverlayRenderer?: {
      /** Signed in: the like and dislike pair, as a view model. */
      videoActionBar?: {
        videoActionBarViewModel?: {
          buttons?: readonly {
            buttonViewModel?: {
              segmentedLikeDislikeButtonViewModel?: {
                likeButtonViewModel?: {
                  likeButtonViewModel?: { likeStatusEntity?: { likeStatus?: unknown } };
                };
              };
            };
          }[];
        };
      };
      /** Signed out: the older like button renderer. */
      actions?: readonly { likeButtonRenderer?: { likeStatus?: unknown } }[];
    };
  };
}

function toRating(status: unknown): Rating | null {
  if (status === "LIKE") return "like";
  if (status === "DISLIKE") return "dislike";
  if (status === "INDIFFERENT") return "none";
  return null;
}

/**
 * The account's rating of a song, from the like button YouTube Music's
 * `/next` puts in the player overlay. Signed in, that button is a view model
 * in `videoActionBar`; signed out, it is a `likeButtonRenderer` in `actions`
 * and always `none`.
 */
export function ratingFrom(data: RawNext): Rating {
  const overlay = data.playerOverlays?.playerOverlayRenderer;
  for (const button of overlay?.videoActionBar?.videoActionBarViewModel?.buttons ?? []) {
    const like = button.buttonViewModel?.segmentedLikeDislikeButtonViewModel?.likeButtonViewModel;
    const rating = toRating(like?.likeButtonViewModel?.likeStatusEntity?.likeStatus);
    if (rating !== null) return rating;
  }
  for (const action of overlay?.actions ?? []) {
    const rating = toRating(action.likeButtonRenderer?.likeStatus);
    if (rating !== null) return rating;
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
