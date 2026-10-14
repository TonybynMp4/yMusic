import { IconDevicesShare } from "@tabler/icons-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Marks a queue that was picked up from another device. `device` is the
 * account's own sentence for it ("From your Android device"), which is both
 * the tooltip and the accessible name.
 */
export function FromDevice({ device, className }: { device: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={device}
            className={cn("inline-flex shrink-0 text-muted-foreground", className)}
          />
        }
      >
        <IconDevicesShare size={14} stroke={1.75} />
      </TooltipTrigger>
      <TooltipContent>{device}</TooltipContent>
    </Tooltip>
  );
}
