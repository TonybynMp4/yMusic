import { IconDeviceDesktop, IconFolder } from "@tabler/icons-react";
import type { LocalTrack } from "@ytbm/ipc";

import { Header, type BrowseActions } from "./Browse.tsx";
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
  return (
    <>
      <Header
        thumbnails={[]}
        fallback={
          folder ? (
            <IconFolder size={64} stroke={1.25} />
          ) : (
            <IconDeviceDesktop size={64} stroke={1.25} />
          )
        }
        title={folder ? folderName(folder) : "Local files"}
        subtitle={folder ? `${count} • ${folder}` : count}
        tracks={tracks}
        actions={actions}
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
          onEnqueue={actions.onEnqueue}
          onOpen={actions.onOpen}
        />
      )}
    </>
  );
}
