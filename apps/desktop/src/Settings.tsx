import { type ReactNode, useEffect, useState } from "react";
import type { AudioQuality } from "@ymusic/core";
import { type AudioDevice, playerAudioDevices } from "@ymusic/ipc";
import { IconFolderPlus, IconRefresh, IconX } from "@tabler/icons-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ScanSummary } from "./Sidebar.tsx";
import type { Library } from "./useLibrary.ts";
import type { SettingsState } from "./useSettings.ts";

interface Props {
  settings: SettingsState;
  library: Library;
}

/** Every setting on one page, in sections, as YouTube Music lays its own out. */
export function SettingsView({ settings: { settings, update }, library }: Props) {
  const devices = useAudioDevices();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-3 pt-2 pb-8">
      <h1 className="text-3xl font-bold tracking-tight">Settings</h1>

      <Section title="Playback">
        <Row
          label="Autoplay"
          description="When the queue runs out, keep playing similar songs."
          control={
            <Switch
              checked={settings.autoplay}
              onCheckedChange={(autoplay) => update({ autoplay })}
            />
          }
        />
        <Row
          label="Audio quality"
          description="Applies from the next song."
          control={
            <Choice
              value={settings.audioQuality}
              options={QUALITIES}
              onChange={(audioQuality) => update({ audioQuality })}
            />
          }
        />
        <Row
          label="Stable volume"
          description="Turns loud songs down so every song plays at a similar level. Local files use their ReplayGain tags."
          control={
            <Switch
              checked={settings.stableVolume}
              onCheckedChange={(stableVolume) => update({ stableVolume })}
            />
          }
        />
        <Row
          label="Output device"
          control={
            <Choice
              className="w-64"
              value={settings.audioDevice}
              options={deviceOptions(devices, settings.audioDevice)}
              onChange={(audioDevice) => update({ audioDevice })}
            />
          }
        />
      </Section>

      <Section title="Library">
        {library.folders.map((path) => (
          <div key={path} className="flex items-center gap-4 py-2 pr-2 pl-4">
            <span className="min-w-0 flex-1 truncate text-sm" title={path}>
              {path}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${path}`}
              disabled={library.loading}
              onClick={() => void library.removeFolder(path)}
            >
              <IconX />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2 px-4 py-3">
          <span className="flex-1 text-xs text-muted-foreground">
            {library.folders.length === 0
              ? "Add a folder to play the music files in it."
              : "Removing a folder takes its songs out of yMusic, not off the disk."}
          </span>
          <Button
            variant="outline"
            disabled={library.loading || library.folders.length === 0}
            onClick={() => void library.rescan()}
          >
            <IconRefresh />
            Rescan
          </Button>
          <Button
            variant="outline"
            disabled={library.loading}
            onClick={() => void library.addFolder()}
          >
            <IconFolderPlus />
            Add folder
          </Button>
        </div>
        {library.report && <ScanSummary report={library.report} />}
      </Section>

      <Section title="Privacy">
        <Row
          label="Pause watch history"
          description="Songs you play stop going into your YouTube history."
          control={
            <Switch
              checked={settings.pauseWatchHistory}
              onCheckedChange={(pauseWatchHistory) => update({ pauseWatchHistory })}
            />
          }
        />
        <Row
          label="Pause search history"
          description="Searches are sent without your account, so they stay out of your YouTube search history. Results are not personalised while this is on."
          control={
            <Switch
              checked={settings.pauseSearchHistory}
              onCheckedChange={(pauseSearchHistory) => update({ pauseSearchHistory })}
            />
          }
        />
      </Section>
    </div>
  );
}

const QUALITIES: { value: AudioQuality; label: string }[] = [
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

function useAudioDevices(): AudioDevice[] {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  useEffect(() => {
    playerAudioDevices()
      .then(setDevices)
      .catch((error: unknown) => console.warn("could not list audio devices", error));
  }, []);
  return devices;
}

/**
 * The system default first, then each device. A saved device that is not
 * plugged in stays listed, so the choice still reads as what was picked.
 */
function deviceOptions(devices: AudioDevice[], saved: string) {
  const options = [
    { value: "auto", label: "System default" },
    ...devices.map((device) => ({ value: device.name, label: device.description })),
  ];
  if (!options.some((option) => option.value === saved)) {
    options.push({ value: saved, label: "Disconnected device" });
  }
  return options;
}

/** A setting with a few named values. */
function Choice<T extends string>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <Select
      items={props.options}
      value={props.value}
      onValueChange={(value) => value !== null && props.onChange(value)}
    >
      <SelectTrigger className={props.className ?? "w-40"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {props.options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="mb-1 text-lg font-semibold">{title}</h2>
      <div className="flex flex-col divide-y rounded-lg border bg-card">{children}</div>
    </section>
  );
}

/** A setting: what it is on the left, its control on the right. */
export function Row(props: { label: string; description?: ReactNode; control: ReactNode }) {
  return (
    <label className="flex items-center gap-6 px-4 py-3">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm">{props.label}</span>
        {props.description && (
          <span className="text-xs text-muted-foreground">{props.description}</span>
        )}
      </span>
      {props.control}
    </label>
  );
}
