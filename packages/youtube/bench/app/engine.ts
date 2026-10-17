import type { YouTubeEngine } from "../../src/engine.ts";

/**
 * Stands in for `apps/desktop/src/engine.ts` when the bench loads the app's
 * modules (see `app.ts`): the bench's engine, with every argument and result
 * copied, as the messages to and from the app's engine worker copy them. So
 * what the app keeps is its own copy, as in the app, and not the engine's.
 */

let target: YouTubeEngine | null = null;
const inFlight = new Set<Promise<unknown>>();
const counts = new Map<string, number>();

export function connect(engine: YouTubeEngine): void {
  target = engine;
}

export const engine = new Proxy({} as YouTubeEngine, {
  get: (_, name: string) =>
    (...args: unknown[]) => {
      if (target === null) throw new Error("the bench's engine is not connected");
      const method = (target as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[name]!;
      counts.set(name, (counts.get(name) ?? 0) + 1);
      const call = method.apply(target, structuredClone(args)).then((result) => structuredClone(result));
      inFlight.add(call);
      void call.catch(() => {}).finally(() => inFlight.delete(call));
      return call;
    },
});

/** Waits until every call the app made has finished, including ones made meanwhile. */
export async function settle(): Promise<void> {
  while (inFlight.size > 0) await Promise.allSettled(inFlight);
}

/** How many times the app called `method` so far. */
export function calls(method: keyof YouTubeEngine): number {
  return counts.get(method) ?? 0;
}
