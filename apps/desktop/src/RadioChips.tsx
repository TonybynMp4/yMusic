import { useState } from "react";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { parseRadioId, type RadioCover, type Track } from "@ymusic/core";

import { Chip } from "@/components/Chip";
import { IconButton } from "@/components/IconButton";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { engine } from "./engine.ts";
import { errorMessage } from "./errors.ts";
import { useNotify, useSignedIn } from "./Interactions.tsx";
import { EditRadioDialog } from "./RadioBuilder.tsx";

/**
 * The tuning chips above the queue of a mix or radio, as YouTube Music shows
 * them: "All", "Popular", "Chill", "2010s" and so on. Picking one plays that
 * radio after the current song, in place of what was to come.
 *
 * The chips are always those of the mix the queue started from (`radio`),
 * so picking one keeps the others in reach. `tuned` is the one picked.
 */
export function RadioChips({
  radio,
  tuned,
  onTune,
}: {
  radio: string;
  tuned: string | null;
  onTune: (playlistId: string, tracks: Track[]) => void;
}) {
  const notify = useNotify();
  const chips = useQuery({
    queryKey: ["radio-chips", radio],
    queryFn: () => engine.radioChips(radio),
    staleTime: Infinity,
  });
  const tuning = useMutation({
    mutationFn: (playlistId: string) => engine.mix(playlistId),
    onSuccess: (tracks, playlistId) => {
      if (tracks.length === 0) notify("YouTube Music has nothing for this one");
      else onTune(playlistId, tracks);
    },
    onError: (error) => notify(errorMessage(error)),
  });

  const list = chips.data ?? [];
  if (list.length === 0) return null;
  const picked = tuned ?? radio;
  return (
    <div
      role="group"
      aria-label="Tune the radio"
      className="no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto px-4 pt-3"
    >
      {list.map((chip) => {
        const pending = tuning.isPending && tuning.variables === chip.playlistId;
        return (
          <Chip
            key={chip.playlistId}
            selected={chip.playlistId === picked}
            onClick={() => {
              if (!tuning.isPending && chip.playlistId !== picked) tuning.mutate(chip.playlistId);
            }}
          >
            {chip.title}
            {pending && <Spinner size={12} label="Tuning the radio" />}
          </Chip>
        );
      })}
    </div>
  );
}

/**
 * Opens the radio builder on a tuned radio, as YouTube Music's Android app
 * does for a mix it made or a tuned one of YouTube's. Shown only for a tuned
 * radio (`RDAT…`) whose id the builder can read back; a song radio or an
 * artist's mix names no tuning to edit. `onPlay` gets the edited radio.
 */
export function EditRadio({
  radio,
  variant,
  onPlay,
}: {
  radio: string;
  /** An icon, above the queue, or a labelled button, in a playlist's header. */
  variant: "icon" | "button";
  onPlay: (tracks: Track[], cover: RadioCover | null, radio: string) => void;
}) {
  const signedIn = useSignedIn();
  const [editing, setEditing] = useState<string | null>(null);
  if (parseRadioId(radio) === null) return null;
  return (
    <>
      {variant === "icon" ? (
        <IconButton label="Edit radio" onClick={() => setEditing(radio)}>
          <IconAdjustmentsHorizontal />
        </IconButton>
      ) : (
        <Button variant="outline" className="rounded-full" onClick={() => setEditing(radio)}>
          <IconAdjustmentsHorizontal size={16} stroke={1.75} />
          Edit radio
        </Button>
      )}
      <EditRadioDialog
        radio={editing}
        signedIn={signedIn}
        onClose={() => setEditing(null)}
        onPlay={onPlay}
      />
    </>
  );
}
