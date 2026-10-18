import { openUrl } from "@tauri-apps/plugin-opener";

import { Banner, BannerAction, BannerClose, BannerTitle } from "@/components/ui/banner";
import type { UpdatesState } from "./useUpdates.ts";

/** A newer release, until dismissed: where to get it, not an installer. */
export function UpdateNotice({ updates }: { updates: UpdatesState }) {
  const { update, dismissed } = updates;
  if (update === null || dismissed) return null;
  return (
    <Banner onClose={updates.dismiss} className="fixed right-4 bottom-28 z-50">
      <BannerTitle>yMusic {update.version} is available</BannerTitle>
      <BannerAction onClick={() => void openUrl(update.url)}>Get it</BannerAction>
      <BannerClose />
    </Banner>
  );
}
