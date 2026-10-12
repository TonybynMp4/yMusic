# React performance

What to check when the UI feels slow, and what the work on long playlists ([#72](https://github.com/TonybynMp4/yMusic/pull/72)) turned up. The numbers below come from a dev build, where React is several times slower than in a release build.

## Measuring

- Profile a release build (`pnpm tauri build --no-bundle`) when the numbers matter. A dev build is fine for finding what renders, not for how long it takes.
- The WebKit inspector (right click, Inspect, in a dev build) has a Timelines tab. Record with "JavaScript & Events" and "Layout & Rendering" to see whether a slow frame is spent in React, in style and layout, or in paint.
- React DevTools runs standalone with `npx react-devtools`. Add `<script src="http://localhost:8097"></script>` to `index.html` for the session, and do not commit it. Turn on "Highlight updates when components render" and watch what flashes while you scroll or while a song plays.
- For scrolling, a frame probe beats eyeballing it. The one used for #72 logged, every 2 seconds: frames drawn, the longest gap between frames, React render time, and frames where the viewport showed no rows. It sent the line to the Rust log through `invoke("plugin:log|log", ...)`, which needs `log:default` in `capabilities/default.json`. It was never committed. Rebuild it when needed.

## Common causes

- **New props every render.** An inline arrow, an object literal or a `cn(...)` built by the parent gives a memoized child new props each time, so `memo` does nothing. Pass handlers that never change and read the latest props from a ref (`TrackList.tsx` and `Queue.tsx` do this), and pass booleans instead of class names.
- **Context values rebuilt each render.** Every consumer re-renders whenever the provider's value is a new object.
- **Fast-changing state high in the tree.** Playback position, scroll position or a drag held in `App` re-renders everything under it.
- **Heavy components per row.** A Base UI Menu, ContextMenu, Popover or Tooltip root in each row costs far more than the row itself. Share one instance and have rows ask it to open.
- **Effects that re-run every render** because a dependency is a new array or function each time.
- **Long lists drawn in full.** Virtualize from about 60 rows, with a fixed row height and keys that stay stable when rows move.
- **Style changes on a big ancestor.** Setting a CSS variable, class or attribute on an element restyles everything inside it. On a scroll container, that happens on every scroll event.
- **Forced synchronous renders** (`flushSync`) inside scroll or pointer handlers.

## What #72 found

- Base UI's `ScrollArea` set CSS variables on its viewport on every scroll event, which restyled every row: about 7 frames a second on a fast scroll through 2000 songs. Native scrolling doubled that.
- A row with Base UI's ContextMenu and Menu took 435 µs to mount in jsdom, against 49 µs without them. In the app, a fast trackpad flick mounts about 40 rows per frame. One shared menu (`InteractionsProvider`) fixed most of the remaining lag.
- A `Menu.Root` with no `Menu.Trigger` breaks its submenus: Base UI links a submenu to its parent menu through the trigger's floating node. The shared menu keeps a hidden trigger and sets `triggerId` on the root.
- Base UI's detached triggers (`Menu.createHandle()` with `payload`) are the official shared menu, but `ContextMenu.Root` does not take a handle, and each row would still mount a `Menu.Trigger`.
- `@tanstack/react-virtual` renders synchronously inside the scroll event by default. `useFlushSync: false` lets React schedule it, and the overscan hides the delay.
- `contain: strict` on fixed-height rows and `contain: layout paint` on the list keep a mounted row from re-laying out the page.
- WebKitGTK's scrollbar is unusable during a fast scroll. Styled through `::-webkit-scrollbar` or `scrollbar-width`, the thumb vanishes while moving. Unstyled, the GTK overlay indicator fades out. `ScrollArea` draws its own thumb outside the scrolled element instead.
- Queue rows were not memoized, and the queue drew 8 rows past the viewport against the playlist's 25.

## Not looked at yet

- `InteractionsProvider` builds a new context value on every `App` render, so every row using `useDisliked` re-renders with it. Rating changes rely on that today, so a fix needs a store or a version number that changes only with ratings.
- Which `App` state changes during playback, and what re-renders when it does: the player bar, `NowPlaying`, `FullPlayer`.
- Browse pages: shelves and cards, which are not virtualized.
- Search results, the sidebar and `Art`.
