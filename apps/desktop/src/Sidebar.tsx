import { IconFolderPlus, IconLoader2, IconRefresh, IconX } from "@tabler/icons-react";
import type { ScanReport } from "@ytbm/ipc";

import { IconButton } from "@/components/IconButton";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  folders: string[];
  report: ScanReport | null;
  loading: boolean;
  onAddFolder: () => void;
  onRemoveFolder: (path: string) => void;
  onRescan: () => void;
}

export function Sidebar(props: Props) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Folders
        </h2>
        <IconButton
          label="Rescan all folders"
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

      <ScrollArea className="min-h-0 flex-1">
        <ul className="px-2 pb-2">
          {props.folders.map((folder) => (
            <li
              key={folder}
              className="group flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60"
            >
              <span className="min-w-0 flex-1 truncate text-xs" title={folder}>
                {folder.split("/").filter(Boolean).pop() ?? folder}
              </span>
              <IconButton
                label="Remove from library (the files are not deleted)"
                onClick={() => props.onRemoveFolder(folder)}
                size="icon-xs"
                className="opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
              >
                <IconX size={14} stroke={2} />
              </IconButton>
            </li>
          ))}
        </ul>
      </ScrollArea>

      {props.report && <ScanSummary report={props.report} />}

      <Button variant="outline" onClick={props.onAddFolder} className="m-3 h-9">
        <IconFolderPlus size={16} stroke={1.75} />
        Add music folder
      </Button>
    </aside>
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
                {failure.path.split("/").pop()}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
