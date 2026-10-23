# React performance

What to check when the UI feels slow, and what the work on long playlists ([#72](https://github.com/TonybynMp4/yMusic/pull/72)) turned up. The numbers below come from a dev build, where React is several times slower than in a release build.

## Measuring

- Profile a release build (`pnpm tauri build --no-bundle`) when the numbers matter. A dev build is fine for finding what renders, not for how long it takes.
- The WebKit inspector (right click, Inspect, in a dev build) has a Timelines tab. Record with "JavaScript & Events" and "Layout & Rendering" to see whether a slow frame is spent in React, in style and layout, or in paint.
- React DevTools runs standalone with `npx react-devtools`. Add `<script src="http://localhost:8097"></script>` to `index.html` for the session, and do not commit it. Turn on "Highlight updates when components render" and watch what flashes while you scroll or while a song plays.
- For scrolling, a frame probe beats eyeballing it. The one used for #72 logged, every 2 seconds: frames drawn, the longest gap between frames, React render time, and frames where the viewport showed no rows. It sent the line to the Rust log through `invoke("plugin:log|log", ...)`, which needs `log:default` in `capabilities/default.json`. It was never committed. Rebuild it when needed.

## Common causes

- **New props every render.** An inline arrow, an object literal or a `cn(...)` built by the parent gives a memoized child new props each time, so `memo` does nothing. The compiler fixes this for most components. Rows created inside a callback (a virtualized list's `renderRow`) are the exception, so they keep `memo`, get their handlers from `useStableHandler`, and take booleans instead of class names.
- **Context values rebuilt each render.** Every consumer re-renders whenever the provider's value is a new object.
- **Fast-changing state high in the tree.** Playback position, scroll position or a drag held in `App` re-renders everything under it.
- **Heavy components per row.** A Base UI Menu, ContextMenu, Popover or Tooltip root in each row costs far more than the row itself. Share one instance and have rows ask it to open.
- **Effects that re-run every render** because a dependency is a new array or function each time.
- **Long lists drawn in full.** Virtualize from about 60 rows, with a fixed row height and keys that stay stable when rows move.
- **Style changes on a big ancestor.** Setting a CSS variable, class or attribute on an element restyles everything inside it. On a scroll container, that happens on every scroll event.
- **Forced synchronous renders** (`flushSync`) inside scroll or pointer handlers.

## React Compiler

The React Compiler memoizes every component and hook in `apps/desktop/src` at build time, so most hand-written `useMemo`, `useCallback` and `memo` is unnecessary. Write plain code first and reach for those only when a profile shows a need.

### How it runs

`vite.config.ts` runs `babel-plugin-react-compiler` through `@rolldown/plugin-babel` with the `reactCompilerPreset()` that `@vitejs/plugin-react` 6 exports. Two constraints:

- `@babel/core` must stay on 7. With Babel 8 the compiler fails on every destructuring default ("Expected object property value to be an LVal").
- `include` limits Babel to the app's own `.ts` and `.tsx` files. Without the extension check it also gets `styles.css` and the build fails.

plugin-react also has `react({ compiler: true })`, which runs a Rust port through `oxc-transform-react`. It was experimental and pinned to an older oxc when this was set up, so it is not used.

The cost, measured on this machine: `vite build` goes from about 1.4 s to 3.8 s. In dev the first page load waits about 2.5 s longer while Babel and the compiler load, and each file then takes 30 to 650 ms to transform instead of 3 to 5 ms (`Interactions.tsx` is the slowest). HMR for one file stays well under a second.

### What it changed

The compiler assumes components are pure, so patterns that read or write refs during render, or keep values in a mutable object, had to go. The five oxlint rules that check this (`react/set-state-in-effect`, `react/refs`, `react/immutability`, `react/use-memo`, `react/incompatible-library`) are on.

- **Latest-value refs read from effects** are now `useEffectEvent` (`usePlayer`, `useResume`, `useMediaSession`, `CoverCropper`).
- **Latest-value refs behind handlers given to memoized rows** are now `useStableHandler`, which returns a function with a fixed identity that calls the latest handler. `useEffectEvent` cannot be passed to children, so it does not fit here. Never call the result during render.
- **Ratings** live in a `RatingStore` read through `useSyncExternalStore`. `ratingOf` gets a new identity whenever a rating changes, so rows that read it re-render then and only then. Before, they re-rendered on every `App` render, and rating changes relied on that.
- **State reset from an effect** is now adjusted during render, in `useLibrary`, `useSearchHistory` and the sort menus in `Library`.
- **Loading flags set from an effect** are derived instead: `useLibraryPlaylists` stores which fetch its list answered and compares it with the latest request.
- **A DOM node held in state** is fine to read, but not to assign to. Scroll restore in `App` calls `scrollTo` instead of setting `scrollTop`.
- The cover cropper's object URL is created with the picked file in `cover.ts`, not from an effect.

Manual `useCallback` was removed only where the compiled output is byte for byte the same without it. It stays where oxlint's `exhaustive-deps` needs it, because that rule does not know the compiler memoizes a function used as an effect dependency. `Art`'s `useMemo` stays because the compiler does not memoize across the `useState` call that follows it.

### Opting out

Put `"use no memo"` as the first statement of a component or hook, with a comment saying why:

```tsx
export function VirtualList(props: Props) {
  "use no memo"; // useVirtualizer returns one mutable object, which the compiler would cache stale.
```

oxlint ignores the directive, so silence the rule it hits on that line with `// oxlint-disable-next-line <rule> -- <reason>`. Use the same comment, without the directive, for the lint-only `set-state-in-effect` cases where the compiler handles the code fine (`useLibrary`, `useYouTubeSearch`). Never turn a rule off in `.oxlintrc.json`.

### Not compiled

The compiler skips a function it cannot handle and leaves it as written, so it behaves as before, without memoization. Today that is:

- `VirtualList`, opted out above.
- `useAccount` and `PlaylistTargets`, `NewPlaylistDialog`, `EditPlaylistForm` and `DeletePlaylistDialog` in `Interactions.tsx`, because they use `try`/`finally` or `throw` inside `try`.
- `useYouTubeSearch`, because `loadMore` has a conditional expression inside `try`.

To list them again, build with a `logger` passed to the compiler options (`reactCompilerPreset({ ... })`) that prints `CompileError` events.

## What #72 found

- Base UI's `ScrollArea` set CSS variables on its viewport on every scroll event, which restyled every row: about 7 frames a second on a fast scroll through 2000 songs. Native scrolling doubled that.
- A row with Base UI's ContextMenu and Menu took 435 µs to mount in jsdom, against 49 µs without them. In the app, a fast trackpad flick mounts about 40 rows per frame. One shared menu (`InteractionsProvider`) fixed most of the remaining lag.
- A `Menu.Root` with no `Menu.Trigger` breaks its submenus: Base UI links a submenu to its parent menu through the trigger's floating node. The shared menu keeps a hidden trigger and sets `triggerId` on the root.
- Base UI's detached triggers (`Menu.createHandle()` with `payload`) are the official shared menu, but `ContextMenu.Root` does not take a handle, and each row would still mount a `Menu.Trigger`.
- `@tanstack/react-virtual` renders synchronously inside the scroll event by default. `useFlushSync: false` lets React schedule it, and the overscan hides the delay.
- `contain: size layout style` on fixed-height rows and `contain: layout style` on the list keep a mounted row from re-laying out the page. Paint containment (`strict`) would clip a dragged row's shadow.
- WebKitGTK's scrollbar is unusable during a fast scroll. Styled through `::-webkit-scrollbar` or `scrollbar-width`, the thumb vanishes while moving. Unstyled, the GTK overlay indicator fades out. `ScrollArea` draws its own thumb outside the scrolled element instead.
- Queue rows were not memoized, and the queue drew 8 rows past the viewport against the playlist's 25.

## Not looked at yet

- Which `App` state changes during playback, and what re-renders when it does: the player bar, `NowPlaying`, `FullPlayer`.
- Browse pages: shelves and cards, which are not virtualized.
- Search results, the sidebar and `Art`.
