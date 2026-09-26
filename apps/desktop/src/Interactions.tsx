import {
  IconArrowsShuffle,
  IconBroadcast,
  IconDisc,
  IconDotsVertical,
  IconLibraryMinus,
  IconLibraryPlus,
  IconLoader2,
  IconPlayerTrackNext,
  IconPlaylist,
  IconPlaylistAdd,
  IconUser,
  IconUserMinus,
  IconUserPlus,
} from "@tabler/icons-react";
import { videoIdFromTrackId, type Artist, type Track, type TrackId, type VideoId } from "@ymusic/core";
import type { PlaylistTarget } from "@ymusic/youtube/host";
import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { engine } from "./engine.ts";
import { patchPage, settledPage, useBrowse, type Page, type Route } from "./useBrowse.ts";
import type { PlayFrom } from "./usePlayer.ts";

/**
 * An interaction is what you can do with a song, album, playlist or artist:
 * the menu behind a right click and behind the dots button, which show the
 * same list. What they act on comes from here, provided once by the app.
 */
export interface Interactions {
  signedIn: boolean;
  /** Plays `tracks` from `id`; with no `id`, from a random track, shuffled. */
  play: (tracks: Track[], id: TrackId | null, from?: PlayFrom) => void;
  enqueue: (tracks: Track[], at: "next" | "last") => void;
  open: (route: Route) => void;
  /** A short message about how an action went. */
  notify: (message: string) => void;
  /** The library's playlists changed, so the sidebar should refetch them. */
  libraryChanged: () => void;
}

const InteractionsContext = createContext<Interactions | null>(null);
export const InteractionsProvider = InteractionsContext.Provider;

function useInteractions(): Interactions {
  const value = useContext(InteractionsContext);
  if (value === null) throw new Error("interactions used outside InteractionsProvider");
  return value;
}

/** What a menu acts on. A collection is anything with a page of its own. */
export type Subject = { kind: "song"; track: Track } | { kind: "collection"; route: Route };

type TriggerProps = Omit<React.ComponentProps<typeof ContextMenuTrigger>, "children"> & {
  children?: ReactNode;
};

/**
 * Right-clicking anywhere in it opens the subject's menu. Renders a `div`
 * unless given `render`; with no subject, just that element.
 */
export function InteractionArea({ subject, ...props }: TriggerProps & { subject: Subject | null }) {
  if (subject === null) {
    const { render, ...rest } = props;
    const plain = rest as React.HTMLAttributes<HTMLElement>;
    return isValidElement(render) ? cloneElement(render, plain) : <div {...plain} />;
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger {...props} />
      <ContextMenuContent className="w-56" {...contained}>
        <Items subject={subject} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The same menu behind a dots button, as YouTube Music puts on rows, cards and headers. */
export function InteractionButton({
  subject,
  className,
  size = "icon-sm",
}: {
  subject: Subject;
  className?: string;
  size?: "icon-sm" | "icon";
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onClick={(event) => event.stopPropagation()}
        render={
          <Button
            variant="ghost"
            size={size}
            aria-label="More actions"
            className={cn("rounded-full", className)}
          />
        }
      >
        <IconDotsVertical size={17} stroke={1.75} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" {...contained}>
        <Items subject={subject} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The popup is portalled, but React still bubbles its events to whatever
 * holds the menu: a click would play the row, a right click reopen the menu.
 */
const contained = {
  onClick: (event: React.MouseEvent) => event.stopPropagation(),
  onContextMenu: (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  },
};

function Items({ subject }: { subject: Subject }) {
  return subject.kind === "song" ? (
    <SongItems track={subject.track} />
  ) : (
    <CollectionItems route={subject.route} />
  );
}

function SongItems({ track }: { track: Track }) {
  const x = useInteractions();
  const videoId = videoIdFromTrackId(track.id);
  const albumId = track.albumId;
  // A local file has no radio, playlists or pages to go to.
  return (
    <>
      {videoId && (
        <DropdownMenuItem onClick={() => x.play([track], track.id, { kind: "radio" })}>
          <IconBroadcast />
          Start mix
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={() => x.enqueue([track], "next")}>
        <IconPlayerTrackNext />
        Play next
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => x.enqueue([track], "last")}>
        <IconPlaylist />
        Add to queue
      </DropdownMenuItem>
      {videoId && x.signedIn && <SaveToPlaylist videoIds={() => Promise.resolve([videoId])} />}
      {(albumId || linked(track.artists).length > 0) && <DropdownMenuSeparator />}
      {albumId && (
        <DropdownMenuItem onClick={() => x.open({ kind: "album", id: albumId })}>
          <IconDisc />
          Go to album
        </DropdownMenuItem>
      )}
      <GoToArtist artists={track.artists} />
    </>
  );
}

/**
 * An album, playlist or artist. Its page loads when the menu opens, through
 * the same cache opening it would use, for its tracks and its saved state.
 */
function CollectionItems({ route }: { route: Route }) {
  const x = useInteractions();
  const state = useBrowse(route);
  const page = state.status === "ready" ? state.page : null;

  /** Runs `action` once the page, every row included, is in. */
  const run = (action: (page: Page) => Promise<void> | void) => () => {
    void (async () => {
      try {
        await action(await settledPage(route));
      } catch (error) {
        x.notify(error instanceof Error ? error.message : String(error));
      }
    })();
  };
  const queue = (at: "next" | "last") =>
    run(async (page) => {
      const { tracks } = await tracksOf(page);
      x.enqueue(tracks, at);
      x.notify(at === "next" ? "Playing next" : "Added to queue");
    });

  return (
    <>
      <DropdownMenuItem
        onClick={run(async (page) => {
          const { tracks, from } = await tracksOf(page);
          x.play(tracks, null, from);
        })}
      >
        <IconArrowsShuffle />
        Shuffle play
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={run(async (page) => {
          const mix = mixOf(page);
          if (!mix) throw new Error("YouTube Music has no mix for this");
          const tracks = await engine.mix(mix.playlistId, mix.videoId);
          if (tracks.length > 0) x.play(tracks, tracks[0]!.id);
        })}
      >
        <IconBroadcast />
        Start mix
      </DropdownMenuItem>
      <DropdownMenuItem onClick={queue("next")}>
        <IconPlayerTrackNext />
        Play next
      </DropdownMenuItem>
      <DropdownMenuItem onClick={queue("last")}>
        <IconPlaylist />
        Add to queue
      </DropdownMenuItem>
      {x.signedIn && <Membership route={route} page={page} run={run} />}
      {x.signedIn && route.kind !== "artist" && (
        <SaveToPlaylist
          videoIds={async () => videoIds((await tracksOf(await settledPage(route))).tracks)}
        />
      )}
      {page?.kind === "album" && linked(page.page.artists).length > 0 && (
        <>
          <DropdownMenuSeparator />
          <GoToArtist artists={page.page.artists} />
        </>
      )}
    </>
  );
}

/** "Save to library" on albums and playlists, "Subscribe" on artists. */
function Membership({
  route,
  page,
  run,
}: {
  route: Route;
  page: Page | null;
  run: (action: (page: Page) => Promise<void>) => () => void;
}) {
  const x = useInteractions();
  if (route.kind === "artist") {
    const subscribed = page?.kind === "artist" ? page.page.subscribed : undefined;
    if (subscribed === null) return null;
    return (
      <DropdownMenuItem
        disabled={subscribed === undefined}
        onClick={run(async () => {
          await engine.setSubscribed(route.id, !subscribed);
          patchPage(route, (p) =>
            p.kind === "artist" ? { ...p, page: { ...p.page, subscribed: !subscribed } } : p,
          );
          x.notify(subscribed ? "Unsubscribed" : "Subscribed");
        })}
      >
        {subscribed ? <IconUserMinus /> : <IconUserPlus />}
        {subscribed ? "Unsubscribe" : "Subscribe"}
      </DropdownMenuItem>
    );
  }

  const saved = page && page.kind !== "artist" ? page.page.saved : undefined;
  // Your own playlists, and anything YouTube does not say, cannot be saved.
  if (saved === null) return null;
  const id =
    page?.kind === "album" ? page.page.audioPlaylistId : page?.kind === "playlist" ? route.id : null;
  return (
    <DropdownMenuItem
      disabled={saved === undefined || id === null}
      onClick={run(async () => {
        if (id === null) return;
        await engine.setSaved(id, !saved);
        patchPage(route, (p) =>
          p.kind === "artist" ? p : ({ ...p, page: { ...p.page, saved: !saved } } as Page),
        );
        x.libraryChanged();
        x.notify(saved ? "Removed from library" : "Saved to library");
      })}
    >
      {saved ? <IconLibraryMinus /> : <IconLibraryPlus />}
      {saved ? "Remove from library" : "Save to library"}
    </DropdownMenuItem>
  );
}

/** Your playlists, fetched when the submenu opens. */
function SaveToPlaylist({ videoIds }: { videoIds: () => Promise<VideoId[]> }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <IconPlaylistAdd />
        Save to playlist
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 w-56" {...contained}>
        <PlaylistTargets videoIds={videoIds} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function PlaylistTargets({ videoIds }: { videoIds: () => Promise<VideoId[]> }) {
  const x = useInteractions();
  const [state, setState] = useState<
    { ids: VideoId[]; targets: PlaylistTarget[] } | { error: string } | null
  >(null);
  // Once per opening: the submenu mounts this when it opens.
  const [load] = useState(() => videoIds);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const ids = await load();
        if (ids.length === 0) throw new Error("There are no songs to add");
        const targets = await engine.playlistTargets(ids[0]!);
        if (live) setState({ ids, targets });
      } catch (error) {
        if (live) setState({ error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return () => {
      live = false;
    };
  }, [load]);

  if (state === null) {
    return (
      <DropdownMenuItem disabled>
        <IconLoader2 className="animate-spin" />
        Loading playlists
      </DropdownMenuItem>
    );
  }
  if ("error" in state) return <DropdownMenuItem disabled>{state.error}</DropdownMenuItem>;
  if (state.targets.length === 0) {
    return <DropdownMenuItem disabled>You have no playlists yet</DropdownMenuItem>;
  }
  return state.targets.map((target) => (
    <DropdownMenuItem
      key={target.id}
      onClick={() => {
        engine.addToPlaylist(target.id, state.ids).then(
          () => x.notify(`Saved to ${target.title}`),
          (error: unknown) =>
            x.notify(error instanceof Error ? error.message : String(error)),
        );
      }}
    >
      <span className="truncate">{target.title}</span>
    </DropdownMenuItem>
  ));
}

/** One item for a single artist; a submenu naming each when there are several. */
function GoToArtist({ artists }: { artists: readonly Artist[] }) {
  const x = useInteractions();
  const pages = linked(artists);
  if (pages.length === 0) return null;
  if (pages.length === 1) {
    return (
      <DropdownMenuItem onClick={() => x.open({ kind: "artist", id: pages[0]!.channelId })}>
        <IconUser />
        Go to artist
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <IconUser />
        Go to artist
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-48" {...contained}>
        {pages.map((artist) => (
          <DropdownMenuItem
            key={artist.channelId}
            onClick={() => x.open({ kind: "artist", id: artist.channelId })}
          >
            <span className="truncate">{artist.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function linked(artists: readonly Artist[]): { name: string; channelId: string }[] {
  return artists.flatMap((a) => (a.channelId ? [{ name: a.name, channelId: a.channelId }] : []));
}

/**
 * What playing a collection queues, and where the queue keeps growing from.
 * An artist plays their top songs, the whole list when YouTube has one.
 */
async function tracksOf(page: Page): Promise<{ tracks: Track[]; from?: PlayFrom }> {
  switch (page.kind) {
    case "album":
      return { tracks: page.page.tracks };
    case "playlist":
      return { tracks: page.page.tracks, from: { kind: "playlist", id: page.page.id } };
    case "artist": {
      const id = page.page.topSongsPlaylistId;
      if (id === null) return { tracks: page.page.topSongs };
      const all = await settledPage({ kind: "playlist", id });
      return {
        tracks: all.kind === "playlist" ? all.page.tracks : page.page.topSongs,
        from: { kind: "playlist", id },
      };
    }
  }
}

/** The radio behind "Start mix", as YouTube Music's own buttons name it. */
function mixOf(page: Page): { playlistId: string; videoId: string | null } | null {
  switch (page.kind) {
    case "album": {
      const id = page.page.audioPlaylistId;
      return id ? { playlistId: `RDAMPL${id}`, videoId: null } : null;
    }
    case "playlist":
      return { playlistId: `RDAMPL${page.page.id}`, videoId: null };
    case "artist":
      return page.page.mix;
  }
}

function videoIds(tracks: readonly Track[]): VideoId[] {
  return tracks.flatMap((t) => {
    const id = videoIdFromTrackId(t.id);
    return id ? [id] : [];
  });
}
