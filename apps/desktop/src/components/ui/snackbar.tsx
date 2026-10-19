"use client"

import { Toast } from "@base-ui/react/toast"
import { snackbarManager } from "@/lib/snackbar"
import { cn } from "@/lib/utils"

/**
 * YouTube Music's snackbar: one short message at the bottom left, over the
 * content and above the player bar, with at most one action. Show one with
 * `showSnackbar` from `@/lib/snackbar`.
 */
function SnackbarProvider({ children }: { children?: React.ReactNode }) {
  return (
    <Toast.Provider toastManager={snackbarManager} limit={1}>
      {children}
      <Toast.Portal>
        <Toast.Viewport
          data-slot="snackbar-viewport"
          className="fixed bottom-28 left-4 z-50 w-[min(36rem,calc(100vw-2rem))] outline-none"
        >
          <SnackbarList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  )
}

function SnackbarList() {
  const { toasts } = Toast.useToastManager()
  return toasts.map((toast) => <Snackbar key={toast.id} toast={toast} />)
}

function Snackbar({
  className,
  ...props
}: Toast.Root.Props) {
  return (
    <Toast.Root
      data-slot="snackbar"
      swipeDirection="down"
      className={cn(
        "absolute bottom-0 left-0 flex w-fit max-w-full min-w-72 items-center gap-4 rounded-md bg-foreground py-1.5 pr-2 pl-4 text-sm text-background shadow-lg select-none",
        "translate-y-(--toast-swipe-movement-y) transition-[translate,opacity] duration-200 ease-out",
        "data-starting-style:translate-y-4 data-starting-style:opacity-0 data-ending-style:opacity-0 data-limited:opacity-0",
        className
      )}
      {...props}
    >
      <Toast.Title data-slot="snackbar-message" className="min-w-0 flex-1 py-1.5" />
      <Toast.Action
        data-slot="snackbar-action"
        className="shrink-0 rounded-md px-3 py-1.5 font-medium outline-none hover:bg-background/10 focus-visible:ring-3 focus-visible:ring-ring/50"
      />
    </Toast.Root>
  )
}

export { SnackbarProvider }
