# Testing

- Unit tests for the `packages/core` queue and the zod parsers against recorded InnerTube fixtures, with no Tauri. `tsc` across the workspace.
- Network tests are opt-in: `YMUSIC_NETWORK_TESTS=1 pnpm --filter @ymusic/youtube test`. They cover search, browse, radio, stream resolution, the requests mpv really makes, and the PO-token path (the frame's `frame.js` in jsdom, asserting 206 with a token and 403 without).
