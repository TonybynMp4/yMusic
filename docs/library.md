# Local library

Folders are scanned into SQLite (`library/scan.rs`). A song's id is a hash of its path, so retagging a file updates its row, and moving it makes a new one. A file whose modification time has not changed since the last scan is not read again.

## Cover art

A song's art is the first picture embedded in its tags. A song with none takes the folder's cover image: a file directly beside it named `cover`, `folder`, `front` or `album` (in that order of preference, any case) with a `jpg`, `jpeg`, `png` or `webp` extension.

Both are copied into the art cache, because the webview's asset protocol only reaches that directory. Embedded art is saved once per song, folder covers once per directory, shared by its songs. A rescan gives unchanged songs with no art a cover added to their folder since.

A folder's page uses the cover most of its songs share, so one stray single does not stand for the album. Under the title it shows the song count, the total length and the folder's path.
