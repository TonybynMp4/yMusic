import {
  IconThumbDown,
  IconThumbDownFilled,
  IconThumbUp,
  IconThumbUpFilled,
} from "@tabler/icons-react";
import type { Rating } from "@ymusic/youtube/host";

import { IconButton } from "@/components/IconButton";

export interface RatingProps {
  rating: Rating | null;
  onRate: (rating: Rating) => void;
}

/**
 * Thumbs down and up, as YouTube Music puts them beside the song playing.
 * Pressing the one already on clears it. Until YouTube has said how the song
 * is rated, both show off and still work.
 */
export function RatingButtons(props: RatingProps & { size?: number }) {
  const { rating, onRate, size = 18 } = props;
  const liked = rating === "like";
  const disliked = rating === "dislike";
  return (
    <>
      <IconButton
        label={disliked ? "Remove dislike" : "Dislike"}
        onClick={() => onRate(disliked ? "none" : "dislike")}
      >
        {disliked ? <IconThumbDownFilled size={size} /> : <IconThumbDown size={size} stroke={1.75} />}
      </IconButton>
      <IconButton
        label={liked ? "Remove like" : "Like"}
        onClick={() => onRate(liked ? "none" : "like")}
      >
        {liked ? <IconThumbUpFilled size={size} /> : <IconThumbUp size={size} stroke={1.75} />}
      </IconButton>
    </>
  );
}
