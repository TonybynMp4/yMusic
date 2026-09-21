import { isTauri } from "@ytbm/ipc";

/**
 * Custom titlebar. `data-tauri-drag-region` makes the bar draggable, and on
 * Windows the maximize button carries `data-snap-hover` so the Rust side can
 * expose snap layouts for it — the hit-testing half lives in the app's
 * platform module.
 */
export function TitleBar() {
  return (
    <header
      data-tauri-drag-region
      className="flex h-8 shrink-0 items-center justify-between pl-3 select-none"
    >
      <span data-tauri-drag-region className="text-xs font-medium text-muted-foreground">
        YTBM
      </span>
      <div className="flex h-full">
        <TitleBarButton label="Minimize" onClick={() => void windowAction("minimize")}>
          <rect x="3" y="7.5" width="10" height="1" />
        </TitleBarButton>
        <TitleBarButton
          label="Maximize"
          data-snap-hover
          onClick={() => void windowAction("toggleMaximize")}
        >
          <rect
            x="3.5"
            y="3.5"
            width="9"
            height="9"
            fill="none"
            strokeWidth="1"
            stroke="currentColor"
          />
        </TitleBarButton>
        <TitleBarButton label="Close" danger onClick={() => void windowAction("close")}>
          <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" strokeWidth="1" fill="none" />
        </TitleBarButton>
      </div>
    </header>
  );
}

async function windowAction(action: "minimize" | "toggleMaximize" | "close"): Promise<void> {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow()[action]();
}

function TitleBarButton({
  label,
  danger,
  onClick,
  children,
  ...rest
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
} & React.ComponentPropsWithoutRef<"button">) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-full w-12 place-items-center text-muted-foreground transition-colors ${
        danger ? "hover:bg-brand hover:text-white" : "hover:bg-accent hover:text-foreground"
      }`}
      {...rest}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        {children}
      </svg>
    </button>
  );
}
