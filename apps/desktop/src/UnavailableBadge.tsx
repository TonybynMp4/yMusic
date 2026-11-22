import { IconBan, IconCrown } from "@tabler/icons-react";
import type { Availability } from "@ymusic/core";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Shown on a song row YouTube Music greys out, with why in a tooltip: a crown
 * for a song only Premium members can play, a ban sign for any other reason.
 * Like the rest of such a row, a click on it does nothing.
 */
export function UnavailableBadge({ availability }: { availability: Availability }) {
  if (availability === "available") return null;
  const premium = availability === "premium";
  const reason = premium ? "Needs YouTube Music Premium" : "Unavailable on YouTube Music";
  const Icon = premium ? IconCrown : IconBan;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            aria-label={reason}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex shrink-0 text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
          />
        }
      >
        <Icon size={16} stroke={1.75} />
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
