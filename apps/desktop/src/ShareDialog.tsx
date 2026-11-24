import { useState } from "react";
import {
  IconBrandFacebook,
  IconBrandReddit,
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconBrandX,
  IconCheck,
  IconCopy,
  IconMail,
  type Icon,
} from "@tabler/icons-react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { shareTargets, type ShareTarget } from "./share.ts";

/** A link to share, and the name of what it opens, for the sites that take one. */
export interface Sharing {
  url: string;
  title: string | null;
}

const ICONS: Record<ShareTarget["id"], Icon> = {
  whatsapp: IconBrandWhatsapp,
  facebook: IconBrandFacebook,
  x: IconBrandX,
  email: IconMail,
  reddit: IconBrandReddit,
  telegram: IconBrandTelegram,
};

/**
 * Share where the system has no share sheet (Linux), as YouTube Music's web
 * player does it: a row of sites the link opens in the browser, and the link
 * itself to copy. Open while `sharing` is set.
 */
export function ShareDialog({
  sharing,
  onClose,
  onError,
}: {
  sharing: Sharing | null;
  onClose: () => void;
  onError: (error: unknown) => void;
}) {
  return (
    <Dialog open={sharing !== null} onOpenChange={(open) => open || onClose()}>
      <DialogContent className="max-w-md">
        {/* Mounted afresh on each opening, so "Copied" does not carry over. */}
        {sharing && <ShareBody sharing={sharing} onError={onError} />}
      </DialogContent>
    </Dialog>
  );
}

function ShareBody({ sharing, onError }: { sharing: Sharing; onError: (error: unknown) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Share</DialogTitle>
      </DialogHeader>
      <ul className="flex flex-wrap justify-between gap-2">
        {shareTargets(sharing.url, sharing.title).map((target) => {
          const TargetIcon = ICONS[target.id];
          return (
            <li key={target.id}>
              <button
                type="button"
                onClick={() => openUrl(target.url).catch(onError)}
                className="group flex w-16 flex-col items-center gap-1.5 text-xs outline-none"
              >
                <span className="flex size-12 items-center justify-center rounded-full bg-secondary transition-colors group-hover:bg-foreground/15 group-focus-visible:ring-2 group-focus-visible:ring-ring">
                  <TargetIcon size={22} stroke={1.75} />
                </span>
                {target.label}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <Input
          readOnly
          aria-label="Link"
          value={sharing.url}
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          onClick={() =>
            navigator.clipboard.writeText(sharing.url).then(() => setCopied(true), onError)
          }
        >
          {copied ? <IconCheck /> : <IconCopy />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </>
  );
}
