import { IconAlertTriangle, IconLoader2, IconLogin2, IconLogout } from "@tabler/icons-react";
import { isTauri } from "@ytbm/ipc";

import { Art } from "@/components/Art";
import { IconButton } from "@/components/IconButton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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
        <Art
          thumbnails={account.photoUrl ? [{ url: account.photoUrl, width: 88, height: 88 }] : []}
          width={32}
          lazy={false}
          className="size-full"
          fallback={account.name.slice(0, 1).toUpperCase()}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* Base UI throws when a label sits outside a group. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="py-2">
            <p className="truncate text-sm text-foreground">{account.name}</p>
            {account.handle && <p className="truncate">{account.handle}</p>}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={state.signOut}>
          <IconLogout />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
