import { IconAlertTriangle, IconLoader2, IconLogin2, IconLogout } from "@tabler/icons-react";
import { isTauri } from "@ytbm/ipc";

import { IconButton } from "@/components/IconButton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AccountState } from "./useAccount.ts";

/** The avatar in the top-right corner, where YouTube Music keeps it. */
export function AccountMenu({ state }: { state: AccountState }) {
  if (!isTauri) return null;
  if (state.busy) {
    return (
      <span className="grid size-8 place-items-center text-muted-foreground" aria-label="Signing in">
        <IconLoader2 size={16} className="animate-spin" />
      </span>
    );
  }

  const { account } = state;
  if (account === null) {
    return (
      <div className="flex items-center gap-1">
        {state.error && (
          <IconButton label={state.error} onClick={state.signIn}>
            <IconAlertTriangle size={16} className="text-amber-500" />
          </IconButton>
        )}
        <Button variant="outline" onClick={state.signIn} className="h-9 rounded-full">
          <IconLogin2 size={16} stroke={1.75} />
          Sign in
        </Button>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Signed in as ${account.name}`}
            className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        {account.photoUrl ? (
          <img src={account.photoUrl} alt="" className="size-full object-cover" />
        ) : (
          account.name.slice(0, 1).toUpperCase()
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="py-2">
          <p className="truncate text-sm text-foreground">{account.name}</p>
          {account.handle && <p className="truncate">{account.handle}</p>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={state.signOut}>
          <IconLogout />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
