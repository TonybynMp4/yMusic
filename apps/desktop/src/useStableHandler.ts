import { useCallback, useInsertionEffect, useRef } from "react";

/**
 * A function that keeps its identity across renders and calls the latest
 * `handler`, for event handlers given to memoized rows: a row re-renders only
 * when its own song or state does. Never call it during render. Effects read
 * the latest values through `useEffectEvent` instead.
 */
export function useStableHandler<Args extends unknown[], Result>(
  handler: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(handler);
  // Before any layout effect, so one that calls the handler gets this render's.
  useInsertionEffect(() => {
    latest.current = handler;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}
