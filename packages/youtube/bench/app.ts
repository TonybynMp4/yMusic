import { join } from "node:path";

import type { YouTubeEngine } from "../src/engine.ts";

/**
 * The app's own caches, loaded from the branch under test: `useBrowse.ts`
 * (the pages it keeps) and `useSongYear.ts` (the years it looked up). They
 * import `./engine.ts`, which starts a worker over Tauri's HTTP, and React;
 * for these modules alone, those resolve to the bench's engine
 * (`app/engine.ts`) and a stand-in for React (`app/react.ts`).
 */

const APP = join(import.meta.dir, "../../../apps/desktop/src");

// Bun's runtime plugins do not see these imports in `onResolve`, so they are
// rewritten in the source as it loads instead.
const STAND_INS: Record<string, string> = {
  react: join(import.meta.dir, "app/react.ts"),
  "./engine.ts": join(import.meta.dir, "app/engine.ts"),
};

Bun.plugin({
  name: "bench app",
  setup(build) {
    build.onLoad({ filter: /\/apps\/desktop\/src\/[^/]+\.ts$/ }, async (args) => {
      let contents = await Bun.file(args.path).text();
      for (const [from, to] of Object.entries(STAND_INS)) {
        contents = contents.replaceAll(`from "${from}";`, `from ${JSON.stringify(to)};`);
      }
      return { contents, loader: "ts" };
    });
  },
});

const bridge = await import("./app/engine.ts");
const react = await import("./app/react.ts");

export async function loadApp(engine: YouTubeEngine) {
  bridge.connect(engine);
  const [browse, songYear] = await Promise.all([
    import(join(APP, "useBrowse.ts")) as Promise<typeof import("../../../apps/desktop/src/useBrowse.ts")>,
    import(join(APP, "useSongYear.ts")) as Promise<typeof import("../../../apps/desktop/src/useSongYear.ts")>,
  ]);
  return {
    engine: bridge.engine,
    settle: bridge.settle,
    calls: bridge.calls,
    unmount: react.unmount,
    settledPage: browse.settledPage,
    useSongYear: songYear.useSongYear,
  };
}

export type App = Awaited<ReturnType<typeof loadApp>>;
