import type { ReactNode } from "react";
import {
  IconDeviceDesktop,
  IconFolder,
  IconFolderPlus,
  IconHeart,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLoader2,
  IconPlaylist,
  IconRefresh,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import type { BrowseCard } from "@ytbm/core";
import type { ScanReport } from "@ytbm/ipc";

import { Art } from "@/components/Art";
import { IconButton } from "@/components/IconButton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { viewKey, type View } from "./useBrowse.ts";
import { folderName } from "./useLibrary.ts";

interface Props {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** The key of the view showing, or null for search. */
  current: string | null;
  onSearch: () => void;
  onNavigate: (view: View) => void;
  /** YouTube Music playlists, Liked Music first. Empty when signed out. */
  playlists: readonly BrowseCard[];
  folders: readonly string[];
  localCount: number;
  report: ScanReport | null;
  loading: boolean;
  onAddFolder: () => void;
  onRemoveFolder: (path: string) => void;
  onRescan: () => void;
}

const LIKED_MUSIC = "LM";

/**
 * One library, whatever the source: YouTube Music playlists and local folders
 * in a single list, told apart by a subtitle rather than split into tabs.
 * Collapses to a rail of artwork and icons.
 */
export function Sidebar(props: Props) {
  const { collapsed } = props;
  const entries: Entry[] = [
    ...props.playlists
      .filter((p) => p.id === LIKED_MUSIC)
      .map((p) => playlistEntry(p, <IconHeart size={18} stroke={1.75} />)),
    {
      view: { kind: "local", id: "" },
      title: "Local files",
      subtitle: `${props.localCount} song${props.localCount === 1 ? "" : "s"}`,
      icon: <IconDeviceDesktop size={18} stroke={1.75} />,
    },
    ...props.playlists.filter((p) => p.id !== LIKED_MUSIC).map((p) => playlistEntry(p)),
    ...props.folders.map(
      (path): Entry => ({
        view: { kind: "local", id: path },
        title: folderName(path),
        subtitle: "Folder",
        tooltip: path,
        icon: <IconFolder size={18} stroke={1.75} />,
        onRemove: () => props.onRemoveFolder(path),
      }),
    ),
  ];

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r transition-[width] duration-200",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className={cn("flex flex-col gap-1 p-2", collapsed && "items-center")}>
        <IconButton
          label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={props.onToggleCollapsed}
          size="icon"
          className={collapsed ? "" : "self-start"}
        >
          {collapsed ? (
            <IconLayoutSidebarLeftExpand size={18} stroke={1.75} />
          ) : (
            <IconLayoutSidebarLeftCollapse size={18} stroke={1.75} />
          )}
        </IconButton>
        <Item
          collapsed={collapsed}
          active={props.current === null}
          onClick={props.onSearch}
          title="Search"
          art={<IconSearch size={18} stroke={1.75} />}
          plain
        />
      </div>

      {!collapsed && (
        <div className="flex items-center justify-between px-4 pt-2 pb-1">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Library
          </h2>
          <IconButton
            label="Rescan local folders"
            onClick={props.onRescan}
            disabled={props.loading || props.folders.length === 0}
          >
            {props.loading ? (
              <IconLoader2 size={15} className="animate-spin" />
            ) : (
              <IconRefresh size={15} />
            )}
          </IconButton>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <ul className={cn("flex flex-col gap-0.5 px-2 pb-2", collapsed && "items-center")}>
          {entries.map((entry) => (
            <li key={viewKey(entry.view)} className="group relative">
              <Item
                collapsed={collapsed}
                active={props.current === viewKey(entry.view)}
                onClick={() => props.onNavigate(entry.view)}
                title={entry.title}
                subtitle={entry.subtitle}
                tooltip={entry.tooltip}
                art={entry.art ?? entry.icon}
              />
              {entry.onRemove && !collapsed && (
                <IconButton
                  label="Remove from library (the files are not deleted)"
                  onClick={entry.onRemove}
                  size="icon-xs"
                  className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <IconX size={14} stroke={2} />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      </ScrollArea>

      {props.report && !collapsed && <ScanSummary report={props.report} />}

      <div className={cn("p-2", collapsed && "flex justify-center")}>
        <Item
          collapsed={collapsed}
          active={false}
          onClick={props.onAddFolder}
          title="Add music folder"
          art={<IconFolderPlus size={18} stroke={1.75} />}
          plain
        />
      </div>
    </aside>
  );
}

interface Entry {
  view: View;
  title: string;
  subtitle: string;
  tooltip?: string;
  icon?: ReactNode;
  art?: ReactNode;
  onRemove?: () => void;
}

function playlistEntry(card: BrowseCard, icon?: ReactNode): Entry {
  return {
    view: { kind: "playlist", id: card.id },
    title: card.title,
    // YouTube's own subtitle names the owner; the source goes in front.
    subtitle: card.subtitle ? `YouTube Music • ${card.subtitle}` : "YouTube Music",
    art: icon ?? (
      <Art
        thumbnails={card.thumbnails}
        width={40}
        className="size-10 rounded"
        fallback={<IconPlaylist size={18} stroke={1.75} />}
      />
    ),
  };
}

/**
 * A row in the list: artwork or an icon, then the title over its subtitle.
 * Collapsed, only the artwork shows, and the title moves to a tooltip.
 */
function Item(props: {
  collapsed: boolean;
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle?: string | undefined;
  tooltip?: string | undefined;
  art: ReactNode;
  /** A navigation row: icon without a tile behind it, and no subtitle. */
  plain?: boolean;
}) {
  const button = (
    <button
      type="button"
      onClick={props.onClick}
      aria-label={props.collapsed ? props.title : undefined}
      aria-current={props.active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg p-1 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent/60",
        props.active && "bg-accent",
        props.collapsed && "w-auto",
        props.plain && !props.collapsed && "px-2",
      )}
      title={props.collapsed ? undefined : props.tooltip}
    >
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded text-muted-foreground",
          !props.plain && "bg-secondary",
          props.plain && !props.collapsed && "size-6",
        )}
      >
        {props.art}
      </span>
      {!props.collapsed && (
        <span className="min-w-0 flex-1 pr-6">
          <span className="block truncate text-sm">{props.title}</span>
          {props.subtitle && (
            <span className="block truncate text-xs text-muted-foreground">{props.subtitle}</span>
          )}
        </span>
      )}
    </button>
  );
  if (!props.collapsed) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="right">{props.tooltip ?? props.title}</TooltipContent>
    </Tooltip>
  );
}

function ScanSummary({ report }: { report: ScanReport }) {
  const { added, updated, removed, unchanged, failed } = report;
  return (
    <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">
      <p>
        {added} added · {updated} updated · {removed} removed · {unchanged} unchanged
      </p>
      {failed.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-amber-500">
            {failed.length} file{failed.length === 1 ? "" : "s"} could not be read
          </summary>
          <ul className="mt-1 space-y-1">
            {failed.slice(0, 10).map((failure) => (
              <li
                key={failure.path}
                className="truncate"
                title={`${failure.path}: ${failure.reason}`}
              >
                {failure.path.split(/[\\/]/).pop()}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
