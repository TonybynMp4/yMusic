/**
 * Stands in for React when the bench loads the app's hooks (see `app.ts`).
 * Calling a hook here is one render of a component that uses it: effects run
 * at once, state never changes, and `unmount` runs the cleanups. Enough for
 * the module-level caches the hooks fill, which is what is measured; nothing
 * renders.
 */

const cleanups: (() => void)[] = [];

export function useState<T>(initial: T | (() => T)): [T, (next: T) => void] {
  return [typeof initial === "function" ? (initial as () => T)() : initial, () => {}];
}

export function useEffect(effect: () => void | (() => void)): void {
  const cleanup = effect();
  if (typeof cleanup === "function") cleanups.push(cleanup);
}

export function useCallback<T>(callback: T): T {
  return callback;
}

export function useMemo<T>(create: () => T): T {
  return create();
}

export function useRef<T>(current: T): { current: T } {
  return { current };
}

export function useSyncExternalStore<T>(_subscribe: unknown, snapshot: () => T): T {
  return snapshot();
}

/** Unmounts everything rendered so far. */
export function unmount(): void {
  for (const cleanup of cleanups.splice(0)) cleanup();
}
