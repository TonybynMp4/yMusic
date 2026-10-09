# yMusic documentation

How the parts that are built work, and why they are built that way. Plans for what is not built yet live in [PLAN.md](../PLAN.md).

- [Architecture](architecture.md): the Tauri shell, platform integration, libraries and the monorepo layout.
- [Playback](playback.md): libmpv, stream leases and volume.
- [The data engine](engine.md): youtubei.js in a worker, CORS, stream resolution, PO tokens, reporting plays, search history, resume, and the queue across restarts.
- [Sign-in](sign-in.md): the cookie session, browser import and why OAuth is out.
- [Settings](settings.md): the settings file, and how each setting reaches mpv, the engine or the window.
- [Browse pages and long lists](browse.md): album, artist and playlist pages, loading long playlists, and virtualized track lists.
- [Interactions](interactions.md): the menus on songs, albums, playlists and artists, and liking songs.
- [Artwork](artwork.md): the `img` scheme, WebP requests and the capped disk cache.
- [Local library](library.md): scanning folders, and where songs and folder pages get their cover art.
- [Versions and releases](releases.md): versioning, the release workflow and CI.
- [Memory](memory.md): where memory goes, and what has been cut.
- [Testing](testing.md): unit tests and the opt-in network tests.
- [React performance](react-performance.md): how to profile the UI, common causes of slow renders, and what is left to look at.
