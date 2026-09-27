# yMusic documentation

How the parts that are built work, and why they are built that way. Plans for what is not built yet live in [PLAN.md](../PLAN.md).

- [Architecture](architecture.md): the Tauri shell, platform integration, libraries and the monorepo layout.
- [Playback](playback.md): libmpv, stream leases and volume.
- [The data engine](engine.md): youtubei.js in a worker, CORS, stream resolution, PO tokens, reporting plays and resume.
- [Sign-in](sign-in.md): the cookie session, browser import and why OAuth is out.
- [Interactions](interactions.md): the menus on songs, albums, playlists and artists.
- [Versions and releases](releases.md): versioning, the release workflow and CI.
- [Testing](testing.md): unit tests and the opt-in network tests.
