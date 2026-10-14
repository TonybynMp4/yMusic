import { IconAlertTriangle } from "@tabler/icons-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Shown beside the title when the song plays below the best its account gets,
 * with the reason in a tooltip. There is nothing to do about it, so a click
 * does nothing, not even what a click on the bar around it would.
 */
export function DegradedBadge({ reason, size = 14 }: { reason: string | null; size?: number }) {
  if (reason === null) return null;
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
        <IconAlertTriangle size={size} stroke={1.75} />
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
