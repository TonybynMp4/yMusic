import {
  IconArrowsShuffle,
  IconBroadcast,
  IconDisc,
  IconDotsVertical,
  IconFolderOpen,
  IconFolderSearch,
  IconLibraryMinus,
  IconLibraryPlus,
  IconLoader2,
  IconPencil,
  IconPhoto,
  IconCrop,
  IconPhotoEdit,
  IconPlayerTrackNext,
  IconPlaylist,
  IconPlaylistAdd,
  IconPlaylistX,
  IconPlus,
  IconThumbDown,
  IconThumbDownFilled,
  IconThumbUp,
  IconThumbUpFilled,
  IconTrash,
  IconUser,
  IconUserMinus,
  IconUserPlus,
} from "@tabler/icons-react";
import { libraryOpenFolder, libraryReveal } from "@ymusic/ipc";
import {
  sourceOf,
  videoIdFromTrackId,
  type Artist,
  type BrowseCard,
  type PlaylistPage,
  type PlaylistPrivacy,
  type Track,
  type TrackId,
  type VideoId,
} from "@ymusic/core";
import type { PlaylistTarget, Rating } from "@ymusic/youtube/host";
import {
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { Art } from "@/components/Art";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  centredCrop,
  closePicked,
  cropCover,
  isCustomCover,
  openImage,
  type Cover,
  type Crop,
  type Picked,
} from "./cover.ts";
import { CoverCropper } from "./CoverCropper.tsx";
import { engine } from "./engine.ts";
import { toggled } from "./Rating.tsx";
import {
  newPlaylistRoute,
  patchPage,
  refreshPage,
  settledPage,
  useBrowse,
  type Page,
  type Route,
} from "./useBrowse.ts";
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
  /** A playlist was just created, so the sidebar shows it before YouTube lists it. */
  playlistCreated: (card: BrowseCard) => void;
  /** A playlist was just deleted, so nothing should show it any more. */
  playlistDeleted: (id: string, title: string) => void;
  /** A song's rating as last seen; null while signed out. */
  ratingOf: (videoId: VideoId) => Rating | null;
  rate: (videoId: VideoId, rating: Rating) => void;
}

/** What the menus get: the app's interactions, and the dialogs this module owns. */
interface Context extends Interactions {
  /** Opens the "New playlist" dialog; the playlist starts with these songs. */
  createPlaylist: (videoIds: () => Promise<VideoId[]>) => void;
  /** Opens the edit dialog for one of your playlists. */
  editPlaylist: (page: PlaylistPage) => void;
  /** Asks before deleting one of your playlists. */
  deletePlaylist: (page: PlaylistPage) => void;
}

const InteractionsContext = createContext<Context | null>(null);

/** A menu to show: what it acts on, and the element it was asked from. */
interface MenuRequest {
  subject: Subject;
  element: HTMLElement;
  /** Under the dots button, or at the pointer for a right click. */
  from: "button" | { x: number; y: number };
}

const OpenMenuContext = createContext<((request: MenuRequest) => void) | null>(null);

const SHARED_TRIGGER = "interactions-menu-trigger";

/**
 * Holds the one menu every row, card and header opens, and the dialogs a menu
 * item opens. They outlive the menu, which unmounts as soon as an item is
 * picked. A menu each cost a long list two Base UI menus per row, most of what
 * a row costs to mount, and a fast scroll outran the list.
 */
export function InteractionsProvider({
  value,
  children,
}: {
  value: Interactions;
  children: ReactNode;
}) {
  const [songs, setSongs] = useState<(() => Promise<VideoId[]>) | null>(null);
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  const [open, setOpen] = useState(false);
  const openMenu = useCallback((request: MenuRequest) => {
    setMenu(request);
    setOpen(true);
  }, []);
  // What a trigger of its own would set, for the dots to stay shown while open.
  useEffect(() => {
    if (!open || menu?.from !== "button") return;
    const element = menu.element;
    element.setAttribute("data-popup-open", "");
    return () => element.removeAttribute("data-popup-open");
  }, [open, menu]);
  const [editing, setEditing] = useState<PlaylistPage | null>(null);
  const [deleting, setDeleting] = useState<PlaylistPage | null>(null);
  const context: Context = {
    ...value,
    createPlaylist: (ids) => setSongs(() => ids),
    editPlaylist: setEditing,
    deletePlaylist: setDeleting,
  };
  return (
    <OpenMenuContext.Provider value={openMenu}>
      <InteractionsContext.Provider value={context}>
        {children}
        <DropdownMenu
          open={open}
          onOpenChange={setOpen}
          triggerId={SHARED_TRIGGER}
          // Kept until the menu has faded out, so it does not empty as it goes.
          onOpenChangeComplete={(isOpen) => isOpen || setMenu(null)}
        >
          {/* Never seen or pressed. Base UI links a submenu to its menu
              through the trigger, so a menu without one breaks its submenus. */}
          <DropdownMenuTrigger
            id={SHARED_TRIGGER}
            nativeButton={false}
            render={<span aria-hidden tabIndex={-1} className="pointer-events-none fixed size-0" />}
          />
          {menu && <SharedMenu menu={menu} />}
        </DropdownMenu>
        <NewPlaylistDialog songs={songs} onClose={() => setSongs(null)} />
        <EditPlaylistDialog page={editing} onClose={() => setEditing(null)} />
        <DeletePlaylistDialog page={deleting} onClose={() => setDeleting(null)} />
      </InteractionsContext.Provider>
    </OpenMenuContext.Provider>
  );
}

function SharedMenu({ menu }: { menu: MenuRequest }) {
  const { from, element } = menu;
  const placement =
    from === "button"
      ? ({ anchor: element, align: "end" } as const)
      : ({
          anchor: {
            getBoundingClientRect: () =>
              DOMRect.fromRect({ x: from.x, y: from.y, width: 0, height: 0 }),
          },
          align: "start",
          sideOffset: 2,
        } as const);
  return (
    <DropdownMenuContent
      {...placement}
      // Back to the dots for the keyboard; a right-clicked row takes no focus.
      finalFocus={from === "button" ? () => element : false}
      className="w-56"
      {...contained}
    >
      <Items subject={menu.subject} />
    </DropdownMenuContent>
  );
}

function useOpenMenu(): (request: MenuRequest) => void {
  const open = useContext(OpenMenuContext);
  if (open === null) throw new Error("menu opened outside InteractionsProvider");
  return open;
}

/** Opens the "New playlist" dialog for an empty playlist, or null while signed out. */
export function useNewPlaylist(): (() => void) | null {
  const x = useInteractions();
  if (!x.signedIn) return null;
  return () => x.createPlaylist(() => Promise.resolve([]));
}

function useInteractions(): Context {
  const value = useContext(InteractionsContext);
  if (value === null) throw new Error("interactions used outside InteractionsProvider");
  return value;
}

/** What the owner of a playlist can do to it from its page. */
export interface PlaylistEditing {
  /** Opens the edit dialog. */
  edit: () => void;
  /** Removes the row at `index`. */
  remove: (index: number) => void;
  /** Moves the row at `from` to `to`, as a drag drops it. */
  move: (from: number, to: number) => void;
}

/**
 * Editing for a playlist page, or null when it is not yours. Each change
 * shows at once and goes to YouTube after; if YouTube refuses it, the page is
 * fetched again so it shows what YouTube has.
 */
export function usePlaylistEditing(page: PlaylistPage): PlaylistEditing | null {
  const x = useInteractions();
  if (!page.editable || !x.signedIn) return null;
  const route: Route = { kind: "playlist", id: page.id };
  const patch = (change: (page: PlaylistPage) => PlaylistPage) =>
    patchPage(route, (p) => (p.kind === "playlist" ? { ...p, page: change(p.page) } : p));
  const send = (action: Promise<void>, done: string) =>
    action.then(
      () => x.notify(done),
      (error: unknown) => {
        x.notify(error instanceof Error ? error.message : String(error));
        refreshPage(route);
      },
    );
  return {
    edit: () => x.editPlaylist(page),
    remove: (index) => {
      const track = page.tracks[index];
      const itemId = page.itemIds[index];
      const videoId = track && videoIdFromTrackId(track.id);
      if (!itemId || !videoId) {
        x.notify("YouTube did not say how to remove this song");
        return;
      }
      // Found again by its id, which is the row's own even if the page has moved on.
      patch((p) => {
        const at = p.itemIds.indexOf(itemId);
        if (at < 0) return p;
        return {
          ...p,
          tracks: p.tracks.toSpliced(at, 1),
          itemIds: p.itemIds.toSpliced(at, 1),
          trackCount: p.trackCount === null ? null : Math.max(0, p.trackCount - 1),
        };
      });
      void send(
        engine.removeFromPlaylist(page.id, [{ videoId, itemId }]),
        `Removed from ${page.title}`,
      );
    },
    move: (from, to) => {
      const itemId = page.itemIds[from];
      const track = page.tracks[from];
      if (!itemId || !track || from === to) return;
      const itemIds = page.itemIds.toSpliced(from, 1).toSpliced(to, 0, itemId);
      // YouTube places the row before the one that ends up after it.
      const before = itemIds[to + 1];
      if (before === null) {
        x.notify("YouTube did not say how to move this song");
        return;
      }
      patch((p) => {
        const at = p.itemIds.indexOf(itemId);
        if (at < 0) return p;
        const moved = p.tracks[at]!;
        return {
          ...p,
          tracks: p.tracks.toSpliced(at, 1).toSpliced(to, 0, moved),
          itemIds: p.itemIds.toSpliced(at, 1).toSpliced(to, 0, itemId),
        };
      });
      void send(engine.moveInPlaylist(page.id, itemId, before ?? null), "Playlist saved");
    },
  };
}

/**
 * Whether the account dislikes a song, as last seen. Its row is dimmed for
 * it, as YouTube Music dims disliked songs in a list.
 */
export function useDisliked(track: Track): boolean {
  const x = useInteractions();
  const videoId = videoIdFromTrackId(track.id);
  return videoId !== null && x.ratingOf(videoId) === "dislike";
}

/**
 * What a menu acts on. A collection is anything with a YouTube Music page of
 * its own; a folder is one of the local library's.
 */
export type Subject =
  /**
   * `onRemove` is set on a queue row, which the song can be removed from, and
   * `onRemoveFromPlaylist` on a row of one of your playlists.
   */
  | { kind: "song"; track: Track; onRemove?: () => void; onRemoveFromPlaylist?: () => void }
  | { kind: "collection"; route: Route }
  | { kind: "folder"; path: string };

type AreaProps = React.HTMLAttributes<HTMLElement> & {
  subject: Subject | null;
  render?: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
};

/**
 * Right-clicking anywhere in it opens the subject's menu. Renders a `div`
 * unless given `render`; with no subject, just that element.
 */
export function InteractionArea({ subject, render, ...props }: AreaProps) {
  const openMenu = useOpenMenu();
  const area: React.HTMLAttributes<HTMLElement> =
    subject === null
      ? props
      : {
          ...props,
          onContextMenu: (event) => {
            event.preventDefault();
            event.stopPropagation();
            const element = event.currentTarget;
            // The keyboard's menu key has no pointer: open at the element.
            const fromKeyboard = event.clientX === 0 && event.clientY === 0;
            const box = element.getBoundingClientRect();
            openMenu({
              subject,
              element,
              from: fromKeyboard
                ? { x: box.left, y: box.bottom }
                : { x: event.clientX, y: event.clientY },
            });
          },
        };
  return isValidElement(render) ? cloneElement(render, area) : <div {...area} />;
}

/** The same menu behind a dots button, as YouTube Music puts on rows, cards and headers. */
export function InteractionButton({
  subject,
  className,
  size = "icon-sm",
}: {
  subject: Subject;
  className?: string;
  size?: "icon-xs" | "icon-sm" | "icon";
}) {
  const openMenu = useOpenMenu();
  return (
    <Button
      variant="ghost"
      size={size}
      aria-label="More actions"
      aria-haspopup="menu"
      className={cn("rounded-full", className)}
      onClick={(event) => {
        event.stopPropagation();
        openMenu({ subject, element: event.currentTarget, from: "button" });
      }}
    >
      <IconDotsVertical size={17} stroke={1.75} />
    </Button>
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
  switch (subject.kind) {
    case "song":
      return (
        <SongItems
          track={subject.track}
          onRemove={subject.onRemove}
          onRemoveFromPlaylist={subject.onRemoveFromPlaylist}
        />
      );
    case "collection":
      return <CollectionItems route={subject.route} />;
    case "folder":
      return <FolderItems path={subject.path} />;
  }
}

/** Reports a failed action as a notice rather than letting it vanish. */
function reporting(x: Context, action: () => Promise<void>) {
  return () => {
    action().catch((error: unknown) =>
      x.notify(error instanceof Error ? error.message : String(error)),
    );
  };
}

function FolderItems({ path }: { path: string }) {
  const x = useInteractions();
  return (
    <DropdownMenuItem onClick={reporting(x, () => libraryOpenFolder(path))}>
      <IconFolderOpen />
      Open in files
    </DropdownMenuItem>
  );
}

function SongItems({
  track,
  onRemove,
  onRemoveFromPlaylist,
}: {
  track: Track;
  onRemove?: (() => void) | undefined;
  onRemoveFromPlaylist?: (() => void) | undefined;
}) {
  const x = useInteractions();
  const videoId = videoIdFromTrackId(track.id);
  const albumId = track.albumId;
  // A local file has no radio, playlists or pages to go to, but has a file.
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
      {onRemove && (
        <DropdownMenuItem onClick={onRemove}>
          <IconPlaylistX />
          Remove from queue
        </DropdownMenuItem>
      )}
      {videoId && x.signedIn && <SaveToPlaylist videoIds={() => Promise.resolve([videoId])} />}
      {onRemoveFromPlaylist && (
        <DropdownMenuItem onClick={onRemoveFromPlaylist}>
          <IconTrash />
          Remove from playlist
        </DropdownMenuItem>
      )}
      {videoId && <RatingItems videoId={videoId} />}
      {(albumId || linked(track.artists).length > 0) && <DropdownMenuSeparator />}
      {albumId && (
        <DropdownMenuItem onClick={() => x.open({ kind: "album", id: albumId })}>
          <IconDisc />
          Go to album
        </DropdownMenuItem>
      )}
      <GoToArtist artists={track.artists} />
      {sourceOf(track.id) === "local" && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={reporting(x, () => libraryReveal(track.id))}>
            <IconFolderSearch />
            Show in files
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}

/** Like and dislike, each undone by picking it again, as on the player bar. */
function RatingItems({ videoId }: { videoId: VideoId }) {
  const x = useInteractions();
  const rating = x.ratingOf(videoId);
  if (rating === null) return null;
  const liked = rating === "like";
  const disliked = rating === "dislike";
  return (
    <>
      <DropdownMenuItem onClick={() => x.rate(videoId, toggled(rating, "like"))}>
        {liked ? <IconThumbUpFilled /> : <IconThumbUp />}
        {liked ? "Remove from liked songs" : "Add to liked songs"}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => x.rate(videoId, toggled(rating, "dislike"))}>
        {disliked ? <IconThumbDownFilled /> : <IconThumbDown />}
        {disliked ? "Remove dislike" : "Dislike"}
      </DropdownMenuItem>
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
    run(async (loaded) => {
      const { tracks } = await tracksOf(loaded);
      x.enqueue(tracks, at);
      x.notify(at === "next" ? "Playing next" : "Added to queue");
    });

  return (
    <>
      <DropdownMenuItem
        onClick={run(async (loaded) => {
          const { tracks, from } = await tracksOf(loaded);
          x.play(tracks, null, from);
        })}
      >
        <IconArrowsShuffle />
        Shuffle play
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={run(async (loaded) => {
          const mix = mixOf(loaded);
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
          videoIds={async () => videoIdsOf((await tracksOf(await settledPage(route))).tracks)}
        />
      )}
      {x.signedIn && page?.kind === "playlist" && page.page.editable && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => x.editPlaylist(page.page)}>
            <IconPencil />
            Edit playlist
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => x.deletePlaylist(page.page)}>
            <IconTrash />
            Delete playlist
          </DropdownMenuItem>
        </>
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
        <NewPlaylistItem videoIds={videoIds} />
        <DropdownMenuSeparator />
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

function NewPlaylistItem({ videoIds }: { videoIds: () => Promise<VideoId[]> }) {
  const x = useInteractions();
  return (
    <DropdownMenuItem onClick={() => x.createPlaylist(videoIds)}>
      <IconPlus />
      New playlist
    </DropdownMenuItem>
  );
}

/** Who can see a playlist, as the header and the playlist dialogs name it. */
export const PRIVACY_LABELS: Record<PlaylistPrivacy, string> = {
  PRIVATE: "Private",
  UNLISTED: "Unlisted",
  PUBLIC: "Public",
};

const PRIVACY = (Object.keys(PRIVACY_LABELS) as PlaylistPrivacy[]).map((value) => ({
  value,
  label: PRIVACY_LABELS[value],
}));

/** YouTube Music's "New playlist" dialog: a title, a description and who can see it. */
function NewPlaylistDialog({
  songs,
  onClose,
}: {
  songs: (() => Promise<VideoId[]>) | null;
  onClose: () => void;
}) {
  const x = useInteractions();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState<PlaylistPrivacy>("PRIVATE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setDescription("");
    setPrivacy("PRIVATE");
    setError(null);
  };
  const create = async () => {
    if (!songs || title.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const name = title.trim();
      const ids = await songs();
      const id = await engine.createPlaylist({ title: name, description: description.trim(), privacy }, ids);
      x.playlistCreated({ kind: "playlist", id, title: name, subtitle: null, thumbnails: [] });
      x.notify(ids.length > 0 ? `Saved to ${name}` : `Created ${name}`);
      onClose();
      reset();
      // A new playlist opens, so you land on it. Adding songs to one later does not.
      x.open(newPlaylistRoute(id, ids.length));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={songs !== null}
      onOpenChange={(open) => {
        if (!open && !busy) {
          onClose();
          reset();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New playlist</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <PlaylistFields
            title={title}
            onTitle={setTitle}
            description={description}
            onDescription={setDescription}
            privacy={privacy}
            onPrivacy={setPrivacy}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" disabled={busy} />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={busy || title.trim().length === 0}>
              {busy && <IconLoader2 className="animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A playlist's title, description and who can see it, as both playlist dialogs ask. */
function PlaylistFields(props: {
  title: string;
  onTitle: (title: string) => void;
  description: string;
  onDescription: (description: string) => void;
  privacy: PlaylistPrivacy;
  onPrivacy: (privacy: PlaylistPrivacy) => void;
}) {
  return (
    <>
      <Input
        autoFocus
        aria-label="Title"
        placeholder="Title"
        value={props.title}
        maxLength={150}
        onChange={(event) => props.onTitle(event.target.value)}
      />
      <textarea
        aria-label="Description"
        placeholder="Description"
        value={props.description}
        maxLength={5000}
        rows={3}
        onChange={(event) => props.onDescription(event.target.value)}
        className="w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      />
      <div role="radiogroup" aria-label="Privacy" className="flex gap-2">
        {PRIVACY.map((option) => (
          <Button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={props.privacy === option.value}
            variant={props.privacy === option.value ? "secondary" : "ghost"}
            size="sm"
            className="rounded-full"
            onClick={() => props.onPrivacy(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </>
  );
}

/**
 * YouTube Music's "Edit playlist" dialog, the "New playlist" one filled in.
 * Only what changed is sent.
 */
function EditPlaylistDialog({ page, onClose }: { page: PlaylistPage | null; onClose: () => void }) {
  return (
    <Dialog
      open={page !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* Wider while cropping, for a larger view of the image. */}
      <DialogContent className="has-data-[slot=cover-cropper]:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit playlist</DialogTitle>
        </DialogHeader>
        {/* Keyed, so each opening starts from the playlist as it is. */}
        {page && <EditPlaylistForm key={page.id} page={page} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

/** A cropped image, with what it was cropped from so it can be cropped again. */
type Cropped = Cover & { source: { file: File; crop: Crop } };
/**
 * What the form will make the cover: a new image, the one YouTube makes from
 * the songs, or (null) the cover as it is.
 */
type CoverChange = Cropped | "default" | null;

/**
 * The cover, with YouTube Music's edit button over it: a menu to pick a new
 * image or, when the cover is one someone uploaded, to go back to YouTube's.
 */
function CoverPicker(props: {
  page: PlaylistPage;
  cover: CoverChange;
  disabled: boolean;
  onPick: (file: File) => void;
  onRecrop: () => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { cover } = props;
  const custom = cover === null ? isCustomCover(props.page.thumbnails) : cover !== "default";
  return (
    <div className="relative size-32 self-center">
      {cover !== null && cover !== "default" ? (
        <img src={cover.url} alt="" className="size-32 rounded-lg object-cover" />
      ) : (
        // YouTube's own cover is only known once it is back, so until then the
        // placeholder stands in for it.
        <Art
          thumbnails={cover === "default" ? [] : props.page.thumbnails}
          width={128}
          lazy={false}
          className="size-32 rounded-lg"
          fallback={<IconPlaylist size={48} stroke={1.25} />}
        />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={props.disabled}
          render={
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              aria-label="Edit cover"
              title="Edit cover"
              className="absolute right-1.5 bottom-1.5 rounded-full shadow"
            />
          }
        >
          <IconPhotoEdit />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-max">
          <DropdownMenuItem onClick={() => input.current?.click()}>
            <IconPhoto />
            Choose from library
          </DropdownMenuItem>
          {cover !== null && cover !== "default" && (
            <DropdownMenuItem onClick={props.onRecrop}>
              <IconCrop />
              Adjust crop
            </DropdownMenuItem>
          )}
          {custom && (
            <DropdownMenuItem onClick={props.onRemove}>
              <IconTrash />
              Remove custom image
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/bmp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared, so picking the same file again still reports a change.
          event.target.value = "";
          if (file) props.onPick(file);
        }}
      />
    </div>
  );
}

/** Left and right move focus along a row of buttons. */
function arrowBetweenButtons(event: KeyboardEvent<HTMLElement>) {
  const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
  if (!step) return;
  const buttons = [...event.currentTarget.querySelectorAll("button")];
  const at = buttons.indexOf(event.target as HTMLButtonElement);
  if (at < 0) return;
  event.preventDefault();
  buttons[(at + step + buttons.length) % buttons.length]?.focus();
}

function EditPlaylistForm({ page, onClose }: { page: PlaylistPage; onClose: () => void }) {
  const x = useInteractions();
  const [title, setTitle] = useState(page.title);
  const [description, setDescription] = useState(page.description ?? "");
  // YouTube names the privacy on your playlists, but should it not, the form
  // starts at Private and sends it only if you pick another.
  const startPrivacy = page.privacy ?? "PRIVATE";
  const [privacy, setPrivacy] = useState<PlaylistPrivacy>(startPrivacy);
  const [cover, setCover] = useState<CoverChange>(null);
  // A picked image while its crop is placed, before it becomes `cover`.
  // `initial` is where a cover cropped again was left.
  const [cropping, setCropping] = useState<{ picked: Picked; crop: Crop; initial?: Crop } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cover && cover !== "default") return () => URL.revokeObjectURL(cover.url);
  }, [cover]);
  const picked = cropping?.picked;
  useEffect(() => {
    if (picked) return () => closePicked(picked);
  }, [picked]);

  const pick = async (file: File) => {
    setError(null);
    try {
      const image = await openImage(file);
      setCropping({ picked: image, crop: centredCrop(image.width, image.height) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const recrop = async () => {
    if (cover === null || cover === "default") return;
    setError(null);
    try {
      const image = await openImage(cover.source.file);
      setCropping({ picked: image, crop: cover.source.crop, initial: cover.source.crop });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // Set while a crop is drawn, so Done pressed again in the meantime does nothing.
  const drawing = useRef(false);
  const crop = async () => {
    if (!cropping || drawing.current) return;
    drawing.current = true;
    const { picked: from, crop: area } = cropping;
    try {
      setCover({ ...(await cropCover(from, area)), source: { file: from.file, crop: area } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    drawing.current = false;
    setCropping(null);
  };

  const save = async () => {
    const name = title.trim();
    if (name.length === 0) return;
    const text = description.trim();
    const details = {
      ...(name !== page.title && { title: name }),
      ...(text !== (page.description ?? "") && { description: text }),
      ...(privacy !== startPrivacy && { privacy }),
    };
    if (Object.keys(details).length === 0 && !cover) return onClose();
    setBusy(true);
    setError(null);
    const route: Route = { kind: "playlist", id: page.id };
    let stale = false;
    try {
      // Sent apart from the rest, as YouTube Music does, and first: once it is
      // set, a failure below leaves it out of a second try.
      if (cover) {
        const thumbnails =
          cover === "default"
            ? await engine.removePlaylistCover(page.id)
            : await engine.setPlaylistCover(page.id, cover.image);
        setCover(null);
        // Without the new art in the reply, the page is fetched once the rest is sent.
        stale = thumbnails.length === 0;
        if (!stale)
          patchPage(route, (p) =>
            p.kind === "playlist" ? { ...p, page: { ...p.page, thumbnails } } : p,
          );
        x.libraryChanged();
      }
      await engine.editPlaylist(page.id, details);
      patchPage(route, (p) =>
        p.kind === "playlist"
          ? {
              ...p,
              page: {
                ...p.page,
                title: name,
                description: text || null,
                privacy: details.privacy ?? p.page.privacy,
              },
            }
          : p,
      );
      if (details.title !== undefined) x.libraryChanged();
      x.notify("Playlist saved");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (stale) refreshPage(route);
    }
  };

  if (cropping) {
    return (
      <div className="flex flex-col gap-3">
        <CoverCropper
          picked={cropping.picked}
          initial={cropping.initial}
          onDone={() => void crop()}
          onCrop={(next) => setCropping((now) => now && { ...now, crop: next })}
        />
        <DialogFooter onKeyDown={arrowBetweenButtons}>
          <Button type="button" variant="ghost" onClick={() => setCropping(null)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void crop()}>
            Done
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <CoverPicker
        page={page}
        cover={cover}
        disabled={busy}
        onPick={(file) => void pick(file)}
        onRecrop={() => void recrop()}
        // A new image not yet saved is only dropped; a saved one is removed on save.
        onRemove={() => setCover(isCustomCover(page.thumbnails) ? "default" : null)}
      />
      <PlaylistFields
        title={title}
        onTitle={setTitle}
        description={description}
        onDescription={setDescription}
        privacy={privacy}
        onPrivacy={setPrivacy}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="ghost" disabled={busy} />}>
          Cancel
        </DialogClose>
        <Button type="submit" disabled={busy || title.trim().length === 0}>
          {busy && <IconLoader2 className="animate-spin" />}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Asks first, as YouTube Music does: a deleted playlist cannot be brought back. */
function DeletePlaylistDialog({
  page,
  onClose,
}: {
  page: PlaylistPage | null;
  onClose: () => void;
}) {
  const x = useInteractions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    if (!page) return;
    setBusy(true);
    setError(null);
    try {
      await engine.deletePlaylist(page.id);
      onClose();
      x.playlistDeleted(page.id, page.title);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={page !== null}
      onOpenChange={(open) => {
        if (!open && !busy) {
          onClose();
          setError(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete playlist?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {page?.title} will be deleted from your library. This cannot be undone.
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" disabled={busy} />}>
            Cancel
          </DialogClose>
          <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
            {busy && <IconLoader2 className="animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
      return { tracks: page.page.tracks, from: { kind: "list", title: page.page.title } };
    case "playlist": {
      const { id, title } = page.page;
      return { tracks: page.page.tracks, from: { kind: "playlist", id, title } };
    }
    case "artist": {
      const id = page.page.topSongsPlaylistId;
      const title = page.page.name;
      if (id === null) return { tracks: page.page.topSongs, from: { kind: "list", title } };
      const all = await settledPage({ kind: "playlist", id });
      return {
        tracks: all.kind === "playlist" ? all.page.tracks : page.page.topSongs,
        from: { kind: "playlist", id, title },
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

function videoIdsOf(tracks: readonly Track[]): VideoId[] {
  return tracks.flatMap((t) => {
    const id = videoIdFromTrackId(t.id);
    return id ? [id] : [];
  });
}
