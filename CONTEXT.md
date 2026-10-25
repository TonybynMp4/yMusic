# yMusic

A desktop YouTube Music client. These are the words the code, docs and plans use for YouTube's side of playback.

## Language

**Player client**:
The InnerTube client a song's stream is resolved through, such as `VISIONOS`, `TV_SIMPLY` or `WEB_REMIX`.
_Avoid_: stream client, resolver client

**Browsing client**:
The InnerTube client that loads pages, search, the library and the account. It carries the session when signed in.
_Avoid_: web client, music client

**Premium format**:
An audio format only YouTube Music Premium serves: itag 774 (Opus) or 141 (AAC), both about 256 kbps.
_Avoid_: HQ format, high-quality stream

**Degraded**:
Said of a song playing below the best format its account gets at the chosen quality, such as a Premium account on "high" playing 251 instead of a premium format.
_Avoid_: fallback quality, low quality

**Stream lease**:
A resolved stream for one song: its URL, the headers mpv must send with it, the format, and when the URL expires.
_Avoid_: stream URL, resolution
