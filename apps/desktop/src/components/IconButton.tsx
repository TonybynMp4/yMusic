import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  /** Used for both the tooltip and the accessible name, so they cannot drift. */
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  /** Renders pressed-on, the way YouTube Music marks shuffle and repeat. */
  active?: boolean;
  size?: "icon-xs" | "icon-sm" | "icon" | "icon-lg";
  className?: string;
}

/**
 * An icon-only button that always carries a name.
 *
 * Nearly every control in this app is a bare glyph, and a bare glyph with no
 * tooltip and no `aria-label` is unusable twice over. Making that the single
 * component means there is no version of the control that can omit it.
 */
export function IconButton({ label, active, size = "icon-sm", className, ...props }: Props) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size={size}
            aria-label={label}
            aria-pressed={active}
            className={cn(
              "rounded-full text-muted-foreground hover:text-foreground",
              active && "text-foreground",
              className,
            )}
            {...props}
          />
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
