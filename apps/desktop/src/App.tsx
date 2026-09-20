import { useEffect, useState } from "react";
import { TitleBar } from "./TitleBar.tsx";
import { invokeCommand, isTauri } from "./tauri.ts";

interface PlatformSummary {
  os: string;
  arch: string;
  appVersion: string;
  installFlavor: string;
  supportsInAppUpdate: boolean;
}

export function App() {
  const [status, setStatus] = useState("connecting to the Rust core…");

  useEffect(() => {
    if (!isTauri) {
      setStatus("running in a plain browser — the Rust core is not available here");
      return;
    }
    invokeCommand<PlatformSummary>("platform_summary")
      .then((summary) =>
        setStatus(
          `${summary.os}/${summary.arch} · v${summary.appVersion} · ${summary.installFlavor} · ` +
            `in-app update ${summary.supportsInAppUpdate ? "available" : "unavailable"}`,
        ),
      )
      .catch((error: unknown) => setStatus(`Rust core unreachable: ${String(error)}`));
  }, []);

  return (
    <div className="flex h-full flex-col bg-neutral-950/80 text-neutral-100">
      <TitleBar />
      <main className="grid flex-1 place-items-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">YTBM</h1>
          <p className="mt-2 text-sm text-neutral-400">{status}</p>
        </div>
      </main>
    </div>
  );
}
