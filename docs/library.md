# Local library

Folders are scanned into SQLite (`library/scan.rs`). A song's id is a hash of its path, so retagging a file updates its row, and moving it makes a new one. A file whose modification time has not changed since the last scan is not read again.

## Cover art

A song's art is the first picture embedded in its tags (an ID3 `APIC` frame, a FLAC `PICTURE` block and so on), copied into the art cache once per song because the webview's asset protocol only reaches that directory. A song without one has no art. It never borrows a cover image from its folder.

A folder's sidebar row and page use the folder's own cover image: a file at its top level named `cover`, `folder`, `front` or `album` (in that order of preference, any case) with a `jpg`, `jpeg`, `png` or `webp` extension. Images in subfolders belong to their albums and are ignored. The app asks for every folder's cover after each scan, through `library_folder_cover`, which copies the image into the cache under a name that includes a hash of its bytes, so a replaced image gets a new URL the webview has not cached. It removes the old copy when the image is replaced or gone, and only answers for folders the user added.

On its page, a folder with no cover image uses the art of the album most of its songs are from (songs with no album tag count by their art), so one stray single does not stand for it. Its sidebar row keeps the folder icon. Under the title the page shows the song count, the total length and the folder's path.
