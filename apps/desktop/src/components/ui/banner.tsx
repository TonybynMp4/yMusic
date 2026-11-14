import { IconX } from "@tabler/icons-react";
import { createContext, use, type ComponentProps, type HTMLAttributes } from "react";

import { IconButton } from "@/components/IconButton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BannerContext = createContext<{ close: () => void }>({ close: () => {} });

/**
 * A strip with a message, an action and a close button, from Kibo UI's
 * banner. Whoever shows it decides when it goes, so it takes `onClose` and
 * no visibility state of its own: render it or don't.
 */
function Banner({
  onClose = () => {},
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { onClose?: () => void }) {
  return (
    <BannerContext value={{ close: onClose }}>
      <div
        data-slot="banner"
        role="status"
        className={cn(
          "flex items-center gap-3 rounded-lg border bg-popover py-2 pr-2 pl-4 text-sm text-popover-foreground shadow-lg",
          className,
        )}
        {...props}
      />
    </BannerContext>
  );
}

function BannerTitle({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p data-slot="banner-title" className={cn("flex-1", className)} {...props} />;
}

function BannerAction({ size = "sm", ...props }: ComponentProps<typeof Button>) {
  return <Button data-slot="banner-action" size={size} {...props} />;
}

function BannerClose({ label = "Dismiss" }: { label?: string }) {
  const { close } = use(BannerContext);
  return (
    <IconButton label={label} onClick={close}>
      <IconX size={16} />
    </IconButton>
  );
}

export { Banner, BannerAction, BannerClose, BannerTitle };
