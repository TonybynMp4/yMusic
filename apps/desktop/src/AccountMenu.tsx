import { useState } from "react";
import {
  IconAlertTriangle,
  IconBrandChrome,
  IconBrandEdge,
  IconBrandFirefox,
  IconBrandGoogle,
  IconBrandOpera,
  IconBrandVivaldi,
  IconBrowser,
  IconLoader2,
  IconLogin2,
  IconLogout,
} from "@tabler/icons-react";
import { accountBrowsers, isTauri, type Browser } from "@ymusic/ipc";

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
        <SignInMenu state={state} />
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

/**
 * Signing in through Google's page, or taking the session from a browser that
 * is already signed in. The browsers are looked up each time the menu opens.
 */
function SignInMenu({ state }: { state: AccountState }) {
  const [browsers, setBrowsers] = useState<Browser[] | null>(null);
  const load = (open: boolean) => {
    if (!open) return;
    accountBrowsers()
      .then(setBrowsers)
      .catch((error: unknown) => {
        console.error("could not list browsers", error);
        setBrowsers([]);
      });
  };
  return (
    <DropdownMenu onOpenChange={load}>
      <DropdownMenuTrigger
        render={<Button variant="outline" className="h-9 rounded-full" />}
      >
        <IconLogin2 size={16} stroke={1.75} />
        Sign in
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onClick={state.signIn}>
          <IconBrandGoogle />
          Sign in with Google
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Import from a browser</DropdownMenuLabel>
          {browsers === null ? (
            <DropdownMenuItem disabled>
              <IconLoader2 className="animate-spin" />
              Looking for browsers
            </DropdownMenuItem>
          ) : browsers.length === 0 ? (
            <DropdownMenuItem disabled>No supported browser found</DropdownMenuItem>
          ) : (
            browsers.map((browser) => (
              <DropdownMenuItem key={browser.id} onClick={() => state.importFrom(browser.id)}>
                <BrowserIcon name={browser.name} />
                <span className="truncate">{browser.name}</span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The browser's logo where Tabler has one. */
function BrowserIcon({ name }: { name: string }) {
  const browser = name.split(" (")[0];
  switch (browser) {
    case "Firefox":
      return <IconBrandFirefox />;
    case "Chrome":
      return <IconBrandChrome />;
    case "Edge":
      return <IconBrandEdge />;
    case "Opera":
      return <IconBrandOpera />;
    case "Vivaldi":
      return <IconBrandVivaldi />;
    default:
      return <IconBrowser />;
  }
}
