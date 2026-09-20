import { IconFolderPlus, IconLoader2, IconRefresh, IconX } from "@tabler/icons-react";
import type { ScanReport } from "@ytbm/ipc";

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
    <aside className="flex w-64 shrink-0 flex-col border-r border-white/10 bg-black/20">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Folders</h2>
        <button
          type="button"
          onClick={props.onRescan}
          disabled={props.loading || props.folders.length === 0}
          title="Rescan all folders"
          aria-label="Rescan all folders"
          className="rounded p-1 text-neutral-400 transition hover:bg-white/10 hover:text-neutral-100 disabled:opacity-30"
        >
          {props.loading ? (
            <IconLoader2 size={15} className="animate-spin" />
          ) : (
            <IconRefresh size={15} />
          )}
        </button>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto px-2">
        {props.folders.map((folder) => (
          <li key={folder} className="group flex items-center gap-1 rounded px-2 py-1.5 hover:bg-white/5">
            <span className="min-w-0 flex-1 truncate text-xs text-neutral-300" title={folder}>
              {folder.split("/").filter(Boolean).pop() ?? folder}
            </span>
            <button
              type="button"
              onClick={() => props.onRemoveFolder(folder)}
              title="Remove from library (the files are not deleted)"
              aria-label="Remove from library"
              className="shrink-0 rounded p-0.5 text-neutral-600 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
            >
              <IconX size={14} stroke={2} />
            </button>
          </li>
        ))}
      </ul>

      {props.report && <ScanSummary report={props.report} />}

      <button
        type="button"
        onClick={props.onAddFolder}
        className="m-3 flex items-center justify-center gap-2 rounded border border-white/10 px-3 py-2 text-sm text-neutral-300 transition hover:bg-white/10 hover:text-neutral-100"
      >
        <IconFolderPlus size={16} stroke={1.75} />
        Add music folder
      </button>
    </aside>
  );
}

function ScanSummary({ report }: { report: ScanReport }) {
  const { added, updated, removed, unchanged, failed } = report;
  return (
    <div className="border-t border-white/5 px-4 py-2 text-[11px] text-neutral-500">
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
              <li key={failure.path} className="truncate" title={`${failure.path}: ${failure.reason}`}>
                {failure.path.split("/").pop()}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
