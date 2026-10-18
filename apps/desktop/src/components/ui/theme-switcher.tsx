import { Toggle } from "@base-ui/react/toggle"
import { ToggleGroup } from "@base-ui/react/toggle-group"
import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react"

import { cn } from "@/lib/utils"

type Theme = "system" | "light" | "dark"

const themes = [
  { value: "system", icon: IconDeviceDesktop, label: "Follow the system" },
  { value: "light", icon: IconSun, label: "Light" },
  { value: "dark", icon: IconMoon, label: "Dark" },
] as const

/**
 * Kibo UI's three-way theme switch on Base UI's toggle group, for the
 * settings page once the app has a light theme. Always controlled: the
 * choice belongs in the settings, not here.
 */
function ThemeSwitcher({
  value,
  onValueChange,
  className,
}: {
  value: Theme
  onValueChange: (theme: Theme) => void
  className?: string
}) {
  return (
    <ToggleGroup
      data-slot="theme-switcher"
      aria-label="Theme"
      value={[value]}
      onValueChange={(next) => {
        // A press on the current theme would empty the group; keep it instead.
        const [theme] = next as Theme[]
        if (theme) onValueChange(theme)
      }}
      className={cn("inline-flex h-8 rounded-full bg-background p-1 ring-1 ring-border", className)}
    >
      {themes.map(({ value: theme, icon: Icon, label }) => (
        <Toggle
          key={theme}
          value={theme}
          aria-label={label}
          className="flex size-6 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-[pressed]:bg-secondary data-[pressed]:text-foreground"
        >
          <Icon size={16} />
        </Toggle>
      ))}
    </ToggleGroup>
  )
}

export { ThemeSwitcher, type Theme }
