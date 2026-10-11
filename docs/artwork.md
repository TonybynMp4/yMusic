# Artwork

Remote artwork goes through the core rather than the webview: the page asks for `img://localhost/<encoded url>` and `images.rs` answers. Only Google's image hosts are fetched.

## Fetching

One pooled client fetches each image, with three attempts and a backoff, because Google's CDN answers a share of requests with errors when a page asks for many at once.

Where it saves bytes, the core asks for WebP instead of the JPEG the URL names. Google's image hosts take options after the last `=`: `rj` asks for JPEG and `rw` for WebP, at the same quality. Measured on album covers, WebP is 35 to 45% smaller up to about 800 px wide and larger past that, so wider images stay JPEG. Video thumbnails on `i.ytimg.com` have a WebP copy under `vi_webp`, about half the size; URLs signed with a query are left alone. If the WebP request fails, the original URL is fetched instead.

## Disk cache

Each image is stored under the SHA-256 of the URL the page asked for, not the one fetched, so files cached as JPEG before the WebP change still answer. The type comes from the file's bytes, so nothing is stored beside it.

A download is written to a temporary name of its own and renamed, so a crash leaves no half image and two downloads of the same image do not collide.

The folder is capped at 100 MB. After every 4 MB written, and once at startup, a background thread adds up the folder and, past the cap, deletes the least recently drawn images until 90 MB remain. Drawing a cached image updates its modification time, which is what the trim sorts by. Temporary files older than an hour go in the same pass.
