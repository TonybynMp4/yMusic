import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * The browser's own scrolling, with a thin scrollbar drawn in CSS. Base UI's
 * scroll area moved its thumb in JavaScript and set CSS variables on the
 * scrolled element on every scroll event, which restyled everything inside
 * it: a fast scroll through a long playlist ran at a few frames a second.
 */
function ScrollArea({
  className,
  viewportRef,
  ...props
}: React.ComponentProps<"div"> & {
  /** The element that actually scrolls, for virtualized lists and scroll restoration. */
  viewportRef?: React.Ref<HTMLDivElement>
}) {
  return (
    <div
      ref={viewportRef}
      data-slot="scroll-area"
      className={cn("thin-scrollbar overflow-auto outline-none", className)}
      {...props}
    />
  )
}

export { ScrollArea }
