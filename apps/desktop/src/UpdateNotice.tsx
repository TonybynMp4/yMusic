import { IconX } from "@tabler/icons-react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { IconButton } from "@/components/IconButton";
import { Button } from "@/components/ui/button";
import type { UpdatesState } from "./useUpdates.ts";

/** A newer release, until dismissed: where to get it, not an installer. */
export function UpdateNotice({ updates }: { updates: UpdatesState }) {
  const { update, dismissed } = updates;
  if (update === null || dismissed) return null;
  return (
    <div
      role="status"
      className="fixed right-4 bottom-28 z-50 flex items-center gap-3 rounded-lg border bg-popover py-2 pr-2 pl-4 text-sm text-popover-foreground shadow-lg"
    >
      <span>yMusic {update.version} is available</span>
      <Button size="sm" onClick={() => void openUrl(update.url)}>
        Get it
      </Button>
      <IconButton label="Dismiss" onClick={updates.dismiss}>
        <IconX size={16} />
      </IconButton>
    </div>
  );
}
