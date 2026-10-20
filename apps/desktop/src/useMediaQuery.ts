import { useCallback, useSyncExternalStore } from "react";

/** Whether a CSS media query matches, following it as the window resizes. */
export function useMediaQuery(query: string): boolean {
  // Stable per query, or React would resubscribe on every render.
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
