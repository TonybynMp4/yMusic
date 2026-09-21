import { useEffect, useState, type ReactNode } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import type { QueueState, Track, TrackId } from "@ytbm/core";

import { Art } from "@/components/Art";
import { IconButton } from "@/components/IconButton";
import { cn } from "@/lib/utils";
import { Queue } from "./Queue.tsx";

/**
 * A tab in the expanded player's strip.
 *
 * This is the `player.panel` extension point: lyrics, trivia and tour dates
 * are all "a tab beside the queue, given the current track", which is the
 * same shape YouTube Music's own Up next / Lyrics / Related strip has.
 */
export interface PlayerPanelTab {
  id: string;
  label: string;
  render: (track: Track | null) => ReactNode;
}

interface Props {
  track: Track | null;
  queue: QueueState;
  onJump: (id: TrackId) => void;
  onRemove: (id: TrackId) => void;
  onClear: () => void;
  onCollapse: () => void;
  /** Contributed tabs. Empty until plugins exist; the strip is built for them. */
  tabs?: readonly PlayerPanelTab[];
}

/**
 * The full-page player: big artwork, and the queue as one tab among several.
 *
 * Deliberately not a persistent right-hand sidebar — that is Spotify's shape.
 * YouTube Music keeps the queue inside the expanded player, which is also
 * what gives plugin panels somewhere to live.
 */
export function FullPlayer({ track, onCollapse, tabs = [], ...queueProps }: Props) {
  const [active, setActive] = useState("queue");

  // Escape collapses, because a view that covers everything needs a way out
  // that is not hunting for the one small chevron.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCollapse();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCollapse]);

  const contributed = tabs.find((tab) => tab.id === active);

  return (
    <section className="absolute inset-0 z-10 flex flex-col bg-background">
      <div className="px-3 py-2">
        <IconButton label="Collapse player" onClick={onCollapse}>
          <IconChevronDown size={18} stroke={1.75} />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 gap-8 px-8 pb-8">
        <div className="flex min-w-0 flex-[3] flex-col items-center justify-center gap-5">
          <CoverArt track={track} />
          {track && (
            <div className="min-w-0 max-w-full text-center">
              <h1 className="truncate text-xl font-medium">{track.title}</h1>
              <p className="truncate text-sm text-muted-foreground">
                {track.artists.map((artist) => artist.name).join(", ")}
              </p>
            </div>
          )}
        </div>

        <div className="flex min-h-0 w-96 shrink-0 flex-col">
          <div className="flex gap-1 border-b">
            <Tab active={active === "queue"} onClick={() => setActive("queue")}>
              Up next
            </Tab>
            {tabs.map((tab) => (
              <Tab key={tab.id} active={active === tab.id} onClick={() => setActive(tab.id)}>
                {tab.label}
              </Tab>
            ))}
          </div>

          <div className="min-h-0 flex-1 pt-2">
            {contributed ? contributed.render(track) : <Queue {...queueProps} />}
          </div>
        </div>
      </div>
    </section>
  );
}

function Tab(props: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.active}
      // Underlined rather than filled: the strip sits on the page, not in a
      // tinted well, which is how YouTube Music draws it.
      className={cn(
        "-mb-px border-b-2 px-3 py-2 text-sm transition-colors outline-none",
        props.active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {props.children}
    </button>
  );
}

function CoverArt({ track }: { track: Track | null }) {
  if (!track) {
    return (
      <div className="flex aspect-square w-full max-w-md items-center justify-center rounded-xl bg-secondary text-sm text-muted-foreground">
        Nothing playing
      </div>
    );
  }
  return (
    <Art
      thumbnails={track.thumbnails}
      width={448}
      lazy={false}
      className="aspect-square w-full max-w-md rounded-xl text-sm shadow-2xl"
      fallback={track.title.slice(0, 1).toUpperCase()}
    />
  );
}
