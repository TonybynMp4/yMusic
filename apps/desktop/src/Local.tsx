import { IconDeviceDesktop, IconFolder } from "@tabler/icons-react";
import type { Thumbnail } from "@ymusic/core";
import type { LocalTrack } from "@ymusic/ipc";

import { Header, type BrowseActions } from "./Browse.tsx";
import { formatTotal } from "./format.ts";
import { TrackList } from "./TrackList.tsx";
import { folderName, tracksIn } from "./useLibrary.ts";

/** Local files as a page like a playlist: every one, or one folder's. */
export function LocalView(props: {
  folder: string;
  all: readonly LocalTrack[];
  actions: BrowseActions;
}) {
  const { folder, actions } = props;
  const tracks = folder ? tracksIn(props.all, folder) : [...props.all];
  const count = `${tracks.length} song${tracks.length === 1 ? "" : "s"}`;
  const length = tracks.reduce((sum, track) => sum + (track.durationMs ?? 0), 0);
  const details = length > 0 ? `${count} • ${formatTotal(length)}` : count;
  return (
    <>
      <Header
        thumbnails={folder ? commonArt(tracks) : []}
        fallback={
          folder ? (
            <IconFolder size={64} stroke={1.25} />
          ) : (
            <IconDeviceDesktop size={64} stroke={1.25} />
          )
        }
        title={folder ? folderName(folder) : "Local files"}
        subtitle={folder ? `${details} • ${folder}` : details}
        tracks={tracks}
        actions={actions}
        subject={folder ? { kind: "folder", path: folder } : undefined}
      />
      {tracks.length === 0 ? (
        <p className="px-3 py-12 text-center text-sm text-muted-foreground">
          {folder ? "No songs found in this folder." : "Add a music folder to see your files here."}
        </p>
      ) : (
        <TrackList
          tracks={tracks}
          currentId={actions.currentId}
          playing={actions.playing}
          onToggle={actions.onToggle}
          onPlay={(id) => actions.onPlay(tracks, id)}
          onOpen={actions.onOpen}
        />
      )}
    </>
  );
}

/** A folder's art: the cover of the album most of its songs are from, so a stray single does not stand for it. */
function commonArt(tracks: readonly LocalTrack[]): Thumbnail[] {
  const counts = new Map<string, { thumbnails: Thumbnail[]; count: number }>();
  for (const track of tracks) {
    const url = track.thumbnails[0]?.url;
    if (!url) continue;
    // Embedded art is cached per song, so an album groups by its name and
    // album artist (two artists can each have a "Greatest Hits"), not its art's URL.
    const key = track.album === null ? url : `${track.albumArtist ?? ""}\n${track.album}`;
    const entry = counts.get(key) ?? { thumbnails: track.thumbnails, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  let best: { thumbnails: Thumbnail[]; count: number } | undefined;
  for (const entry of counts.values()) if (!best || entry.count > best.count) best = entry;
  return best?.thumbnails ?? [];
}
