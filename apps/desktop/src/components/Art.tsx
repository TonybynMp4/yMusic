import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Thumbnail } from "@ytbm/core";
import { isTauri } from "@ytbm/ipc";

import { cn } from "@/lib/utils";

/**
 * In the app, remote artwork loads through the Rust `img` scheme
 * (`src-tauri/src/images.rs`), which retries and caches it on disk: loaded
 * straight from Google's CDN, a share of images fails in the webview. Local
 * artwork, and everything in a plain browser, loads as is.
 */
function source(url: string): string {
  return isTauri && url.startsWith("https://") ? convertFileSrc(url, "img") : url;
}

interface Props {
  thumbnails: readonly Thumbnail[];
  /** The rendered width in CSS pixels, to pick the smallest size that stays sharp. */
  width: number;
  className?: string;
  style?: CSSProperties;
  /** Drawn when there is no artwork, or none of it would load. */
  fallback?: ReactNode;
  /** Load at once rather than when scrolled near. */
  lazy?: boolean;
}

export function Art({ thumbnails, width, className, style, fallback, lazy = true }: Props) {
  const urls = useMemo(() => candidates(thumbnails, width), [thumbnails, width]);
  const key = urls.join(" ");
  // Which candidate is showing; past the end means all of them failed.
  const [failed, setFailed] = useState({ key, count: 0 });
  const index = failed.key === key ? failed.count : 0;

  if (index >= urls.length) {
    return (
      <span
        className={cn("flex items-center justify-center bg-secondary text-muted-foreground", className)}
        style={style}
      >
        {fallback}
      </span>
    );
  }
  return (
    <img
      key={index}
      src={source(urls[index]!)}
      alt=""
      loading={lazy ? "lazy" : "eager"}
      decoding="async"
      onError={() => setFailed({ key, count: index + 1 })}
      className={cn("bg-secondary object-cover", className)}
      style={style}
    />
  );
}

/**
 * The smallest size that covers `width` at this screen's density goes first,
 * then the rest largest to smallest, so a failure steps to another size.
 */
function candidates(thumbnails: readonly Thumbnail[], width: number): string[] {
  const needed = width * (globalThis.devicePixelRatio || 1);
  const bySize = [...thumbnails].sort((a, b) => b.width - a.width);
  const fit = bySize.findLast((t) => t.width >= needed) ?? bySize[0];
  if (!fit) return [];
  const rest = bySize.filter((t) => t !== fit).map((t) => t.url);
  return [...new Set([fit.url, ...rest])];
}
