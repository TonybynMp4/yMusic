import { useEffect, useState } from "react";
import { isTauri, platformSummary } from "@ytbm/ipc";
import { PlaybackSmokeTest } from "./PlaybackSmokeTest.tsx";
import { TitleBar } from "./TitleBar.tsx";

export function App() {
  const [status, setStatus] = useState("connecting to the Rust core…");

  useEffect(() => {
    if (!isTauri) {
      setStatus("running in a plain browser — the Rust core is not available here");
      return;
    }
    platformSummary()
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
      <main className="flex flex-1 flex-col items-center justify-center gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">YTBM</h1>
          <p className="mt-2 text-sm text-neutral-400">{status}</p>
        </div>
        {isTauri && <PlaybackSmokeTest />}
      </main>
    </div>
  );
}
