import { type ReactNode, useEffect, useState } from "react";
import type { AudioQuality } from "@ymusic/core";
import {
  accountBrowsers,
  type AudioDevice,
  type Browser,
  isTauri,
  openLogsFolder,
  platformSummary,
  type PlatformSummary,
  playerAudioDevices,
  type StableVolume,
} from "@ymusic/ipc";
import {
  IconBrandGoogle,
  IconExternalLink,
  IconFolderOpen,
  IconFolderPlus,
  IconLogout,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { openUrl } from "@tauri-apps/plugin-opener";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Art } from "@/components/Art";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ScanSummary } from "./Sidebar.tsx";
import type { AccountState } from "./useAccount.ts";
import type { Library } from "./useLibrary.ts";
import type { UpdatesState } from "./useUpdates.ts";
import type { SettingsState } from "./useSettings.ts";

interface Props {
  settings: SettingsState;
  library: Library;
  updates: UpdatesState;
  account: AccountState;
}

/** Every setting on one page, in sections, as YouTube Music lays its own out. */
export function SettingsView({
  settings: { settings, update },
  library,
  updates,
  account,
}: Props) {
  const devices = useAudioDevices();
  const available = updates.update;
  const platform = usePlatform();
  const version = platform?.appVersion ?? null;
  // Assumed there until the summary says otherwise.
  const hasTray = platform?.hasTray ?? true;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-3 pt-2 pb-8">
      <h1 className="text-3xl font-bold tracking-tight">Settings</h1>

      {isTauri && <AccountSection state={account} />}

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
          description="Evens out songs mastered louder or quieter than others. Local files use their ReplayGain tags."
          control={
            <Choice
              value={settings.stableVolume}
              options={STABLE_VOLUME}
              onChange={(stableVolume) => update({ stableVolume })}
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

      <Section title="App">
        <Row
          label="Keep playing in the tray"
          description={
            hasTray
              ? "Closing the window leaves the music playing. Quit from the tray icon."
              : "Needs a system tray. On Linux, install libayatana-appindicator3-1."
          }
          control={
            <Switch
              checked={settings.closeToTray && hasTray}
              disabled={!hasTray}
              onCheckedChange={(closeToTray) => update({ closeToTray })}
            />
          }
        />
        <Row
          label="Check for updates"
          description="Looks for a new release each time yMusic starts."
          control={
            <Switch
              checked={settings.checkForUpdates}
              onCheckedChange={(checkForUpdates) => update({ checkForUpdates })}
            />
          }
        />
        <Row
          label="Include prereleases"
          description="Test versions that come out before a release. They can have bugs."
          control={
            <Switch
              checked={settings.includePrereleases}
              onCheckedChange={(includePrereleases) => update({ includePrereleases })}
            />
          }
        />
        <div className="flex items-center gap-6 px-4 py-3">
          <span className="flex-1 text-sm text-muted-foreground">
            {updates.status ?? "Find out whether a newer version is out."}
          </span>
          {available ? (
            <Button onClick={() => void openUrl(available.url)}>Get {available.version}</Button>
          ) : (
            <Button
              variant="outline"
              disabled={updates.checking}
              onClick={() => void updates.check()}
            >
              Check now
            </Button>
          )}
        </div>
      </Section>

      <Section title="About">
        <Row label="Version" control={<span className="text-sm">{version ?? "Unknown"}</span>} />
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <Button
            variant="outline"
            onClick={() =>
              void openLogsFolder().catch((error: unknown) =>
                console.warn("could not open the logs folder", error),
              )
            }
          >
            <IconFolderOpen />
            Open logs folder
          </Button>
          <Button variant="outline" onClick={() => void openUrl(REPOSITORY)}>
            <IconExternalLink />
            Source code
          </Button>
          <Button variant="outline" onClick={() => void openUrl(`${REPOSITORY}/issues/new`)}>
            <IconExternalLink />
            Report a problem
          </Button>
        </div>
      </Section>
    </div>
  );
}

const QUALITIES: { value: AudioQuality; label: string }[] = [
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

const STABLE_VOLUME: { value: StableVolume; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
  { value: "loudOnly", label: "Only loud songs" },
];

function AccountSection({ state }: { state: AccountState }) {
  const { account } = state;
  const [browser, setBrowser] = useState<string | null>(null);
  const browsers = useBrowsers(account === null);
  if (account !== null) {
    return (
      <Section title="Account">
        <div className="flex items-center gap-3 px-4 py-3">
          <Art
            thumbnails={account.photoUrl ? [{ url: account.photoUrl, width: 88, height: 88 }] : []}
            width={40}
            lazy={false}
            className="size-10 shrink-0 overflow-hidden rounded-full bg-secondary"
            fallback={account.name.slice(0, 1).toUpperCase()}
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm">{account.name}</span>
            {account.handle && (
              <span className="truncate text-xs text-muted-foreground">{account.handle}</span>
            )}
          </span>
          <Button variant="outline" disabled={state.busy} onClick={state.signOut}>
            <IconLogout />
            Sign out
          </Button>
        </div>
      </Section>
    );
  }
  const chosen = browser ?? browsers[0]?.id ?? null;
  return (
    <Section title="Account">
      <Row
        label="Sign in"
        action
        description={
          state.error ?? "Your library, playlists and history come from your YouTube account."
        }
        control={
          <Button disabled={state.busy} onClick={state.signIn}>
            <IconBrandGoogle />
            Sign in with Google
          </Button>
        }
      />
      <Row
        label="Import from a browser"
        action
        description="Uses the session of a browser that is already signed in to YouTube."
        control={
          browsers.length === 0 ? (
            <span className="text-sm text-muted-foreground">No supported browser found</span>
          ) : (
            <span className="flex items-center gap-2">
              <Choice
                className="w-48"
                value={chosen ?? ""}
                options={browsers.map((b) => ({ value: b.id, label: b.name }))}
                onChange={setBrowser}
              />
              <Button
                variant="outline"
                disabled={state.busy || chosen === null}
                onClick={() => chosen !== null && state.importFrom(chosen)}
              >
                Import
              </Button>
            </span>
          )
        }
      />
    </Section>
  );
}

function useBrowsers(enabled: boolean): Browser[] {
  const [browsers, setBrowsers] = useState<Browser[]>([]);
  useEffect(() => {
    if (!enabled) return;
    accountBrowsers()
      .then(setBrowsers)
      .catch((error: unknown) => console.warn("could not list browsers", error));
  }, [enabled]);
  return browsers;
}

const REPOSITORY = "https://github.com/TonybynMp4/yMusic";

function usePlatform(): PlatformSummary | null {
  const [summary, setSummary] = useState<PlatformSummary | null>(null);
  useEffect(() => {
    if (!isTauri) return;
    platformSummary()
      .then(setSummary)
      .catch((error: unknown) => console.warn("could not read the platform summary", error));
  }, []);
  return summary;
}

/** Null until mpv lists them, and for good if it can't. */
function useAudioDevices(): AudioDevice[] | null {
  const [devices, setDevices] = useState<AudioDevice[] | null>(null);
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
 * Without a list it can't be told apart from one that is.
 */
function deviceOptions(devices: AudioDevice[] | null, saved: string) {
  const options = [
    { value: "auto", label: "System default" },
    ...(devices ?? []).map((device) => ({ value: device.name, label: device.description })),
  ];
  if (!options.some((option) => option.value === saved)) {
    options.push({ value: saved, label: devices === null ? "Saved device" : "Disconnected device" });
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

/**
 * A setting: what it is on the left, its control on the right. A label, so
 * clicking the text flips a switch, unless `action` says the control is a
 * button, which a stray click on the text must not press.
 */
export function Row(props: {
  label: string;
  description?: ReactNode;
  control: ReactNode;
  action?: boolean;
}) {
  const Element = props.action ? "div" : "label";
  return (
    <Element className="flex items-center gap-6 px-4 py-3">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm">{props.label}</span>
        {props.description && (
          <span className="text-xs text-muted-foreground">{props.description}</span>
        )}
      </span>
      {props.control}
    </Element>
  );
}
