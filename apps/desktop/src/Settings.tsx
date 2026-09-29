import type { ReactNode } from "react";
import type { AudioQuality } from "@ymusic/core";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { SettingsState } from "./useSettings.ts";

interface Props {
  settings: SettingsState;
}

/** Every setting on one page, in sections, as YouTube Music lays its own out. */
export function SettingsView({ settings: { settings, update } }: Props) {
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
      </Section>
    </div>
  );
}

const QUALITIES: { value: AudioQuality; label: string }[] = [
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

/** A setting with a few named values. */
function Choice<T extends string>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <Select
      items={props.options}
      value={props.value}
      onValueChange={(value) => value !== null && props.onChange(value)}
    >
      <SelectTrigger className="w-40">
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
