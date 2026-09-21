import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Thumbnail } from "@ytbm/core";

import { cn } from "@/lib/utils";

/**
 * Google's image CDN answers a burst of requests with an error page for some
 * of them: an artist page asks for forty covers at once, and a handful come
 * back as HTML. So artwork loads through a small queue, only once it is on
 * screen, and a failure is retried after a pause instead of given up on.
 */
const CONCURRENT = 4;
const ATTEMPTS = 4;
const BACKOFF_MS = 800;

let running = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(run: () => Promise<T>): Promise<T> {
  if (running >= CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await run();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** URLs already fetched, so a remount draws them at once instead of queueing again. */
const loaded = new Set<string>();

function fetchImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Props {
  thumbnails: readonly Thumbnail[];
  /** The rendered width in CSS pixels, to pick the smallest size that stays sharp. */
  width: number;
  className?: string;
  style?: CSSProperties;
  /** Drawn when there is no artwork, or none of it would load. */
  fallback?: ReactNode;
  /** Load at once rather than when scrolled into view. */
  lazy?: boolean;
}

export function Art({ thumbnails, width, className, style, fallback, lazy = true }: Props) {
  const urls = useMemo(() => candidates(thumbnails, width), [thumbnails, width]);
  const key = urls.join(" ");
  const ready = urls.find((url) => loaded.has(url)) ?? null;
  const [result, setResult] = useState<{ key: string; url: string | null } | null>(null);
  const [visible, setVisible] = useState(!lazy);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (visible || ready) return;
    const element = box.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible, ready]);

  useEffect(() => {
    if (!visible || ready || urls.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (let attempt = 0; attempt < ATTEMPTS && !cancelled; attempt++) {
        // The best fit first, then the other sizes in turn.
        const url = urls[attempt % urls.length]!;
        if (await withSlot(() => (cancelled ? Promise.resolve(false) : fetchImage(url)))) {
          loaded.add(url);
          if (!cancelled) setResult({ key, url });
          return;
        }
        await sleep(BACKOFF_MS * 2 ** attempt);
      }
      if (!cancelled) setResult({ key, url: null });
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, ready, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const url = ready ?? (result?.key === key ? result.url : undefined);
  if (url) {
    return <img src={url} alt="" className={cn("bg-secondary object-cover", className)} style={style} />;
  }
  const failed = urls.length === 0 || url === null;
  return (
    <span
      ref={box}
      className={cn("flex items-center justify-center bg-secondary text-muted-foreground", className)}
      style={style}
    >
      {failed && fallback}
    </span>
  );
}

/**
 * The smallest size that covers `width` at this screen's density goes first,
 * then the rest largest to smallest.
 */
function candidates(thumbnails: readonly Thumbnail[], width: number): string[] {
  const needed = width * (globalThis.devicePixelRatio || 1);
  const bySize = [...thumbnails].sort((a, b) => b.width - a.width);
  const fit = bySize.findLast((t) => t.width >= needed) ?? bySize[0];
  if (!fit) return [];
  const rest = bySize.filter((t) => t !== fit).map((t) => t.url);
  return [...new Set([fit.url, ...rest])];
}
