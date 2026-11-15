import { Children, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Overlapping round pictures, from Kibo UI's avatar stack: the collaborators
 * on a playlist, the way YouTube Music draws them in the header. Each picture
 * after the first is masked where the one before it overlaps, so the gap
 * shows the background rather than a ring of a fixed colour.
 */
function AvatarStack({
  children,
  size = 24,
  className,
}: {
  children: ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <div data-slot="avatar-stack" className={cn("flex items-center -space-x-1", className)}>
      {Children.toArray(children).map((child, index) => (
        <div
          key={index}
          className="shrink-0 overflow-hidden rounded-full [&>*]:size-full"
          style={{
            width: size,
            height: size,
            maskImage: index
              ? `radial-gradient(circle ${size / 2}px at -${size / 4 + size / 10}px 50%, transparent 99%, white 100%)`
              : undefined,
          }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}

export { AvatarStack };
