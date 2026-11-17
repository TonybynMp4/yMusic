import { useMutation, useQuery } from "@tanstack/react-query";
import type { Track } from "@ymusic/core";

import { Chip } from "@/components/Chip";
import { Spinner } from "@/components/ui/spinner";
import { engine } from "./engine.ts";
import { errorMessage } from "./errors.ts";
import { useNotify } from "./Interactions.tsx";

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
  onTune: (radio: string, playlistId: string, tracks: Track[]) => void;
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
      else onTune(radio, playlistId, tracks);
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
