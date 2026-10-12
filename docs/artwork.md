# Artwork

Remote artwork goes through the core rather than the webview: the page asks for `img://localhost/<encoded url>` and `images.rs` answers. Only Google's image hosts are fetched.

## Fetching

One pooled client fetches each image, with three attempts and a backoff, because Google's CDN answers a share of requests with errors when a page asks for many at once. Only a 404 or 410 is final and not retried, since the CDN may block a burst with other errors, a 403 included. Each attempt gives up after 10 seconds, 5 of them to connect, so one stalled request does not hold an image back for long.

Where it saves bytes, the core asks for WebP instead of the JPEG the URL names. Google's image hosts take options after the last `=`: `rj` asks for JPEG and `rw` for WebP, at the same quality. Measured on album covers, WebP is 35 to 45% smaller on small covers, less as they grow, and larger past about 800 px, so wider images stay JPEG. Video thumbnails on `i.ytimg.com` have a WebP copy under `vi_webp`, about half the size; URLs signed with a query are left alone. The WebP copy gets a single attempt: if it fails for any reason, the original URL is fetched straight away, with its own retries. Retrying the WebP copy too would hold the image back by two backoffs before the original was even asked for.

## Disk cache

Each image is stored under the SHA-256 of the URL the page asked for, not the one fetched, so files cached as JPEG before the WebP change still answer. The type comes from the file's bytes, so nothing is stored beside it.

The page gets a downloaded image as soon as it arrives. Writing it to disk is blocking work, so it runs on Tokio's blocking pool afterwards, never on the async workers that the page's requests to YouTube share. A download is written to a temporary name of its own and renamed, so a crash leaves no half image and two downloads of the same image do not collide.

The folder is capped at 100 MB. After every 4 MB written, and once at startup, a background thread adds up the folder and, past the cap, deletes the least recently drawn images until 90 MB remain. Drawing a cached image updates its modification time, which is what the trim sorts by. Temporary files older than an hour go in the same pass.

## Clearing

Settings has a Cache row showing the folder's size, with a Clear button (`cache_size` and `cache_clear`). A clear deletes every file in the folder, temporary ones included. Library art in `<cache>/art` is not touched, since only a rescan would bring it back.

The same Clear empties every other cache, so the app behaves like a cold start: on Linux, `cache_clear` asks WebKitGTK's `WebsiteDataManager` to clear its memory, disk and offline application caches and waits for it, and the page drops its browse pages (`clearBrowseCache`, keeping the one on screen) and song years (`clearSongYears`). Cookies, local storage (ratings) and IndexedDB stay. Windows and macOS keep their webview caches until restart. Images already on screen stay drawn.

A clear can land while downloads are in flight. Each write takes a read lock just to write and rename its file, never across the download, and a clear takes the write lock while it deletes. A counter goes up with each clear, and a write lands only if the counter is the same as when its download began, so nothing fetched before a clear reappears after it.
