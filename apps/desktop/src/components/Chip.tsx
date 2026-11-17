import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** YouTube Music's toggle chip: search filters, radio tuning. */
export function Chip(props: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-pressed={props.selected}
      onClick={props.onClick}
      className={cn(
        "rounded-lg",
        props.selected && "bg-foreground text-background hover:bg-foreground/90",
      )}
    >
      {props.children}
    </Button>
  );
}
