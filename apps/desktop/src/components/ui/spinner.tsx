import { IconLoader2 } from "@tabler/icons-react"

import { cn } from "@/lib/utils"

/**
 * The app's one loading glyph, from Kibo UI's spinner with Tabler's loader.
 *
 * Pass `label` when the spinner is the only sign that something is loading;
 * without one it is hidden from screen readers, for spinners that sit beside
 * text that already says so.
 */
function Spinner({
  size = 16,
  label,
  className,
}: {
  size?: number
  label?: string
  className?: string
}) {
  return (
    <IconLoader2
      data-slot="spinner"
      size={size}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("shrink-0 animate-spin", className)}
    />
  )
}

export { Spinner }
