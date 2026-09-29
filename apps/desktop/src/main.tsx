import React from "react";
import ReactDOM from "react-dom/client";
import { defaultSettings, settingsGet } from "@ymusic/ipc";
import { App } from "./App.tsx";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./styles.css";

// The webview's own context menu is a browser affordance and reads as a bug in
// a desktop app. Our own menus replace it where one is actually wanted.
window.addEventListener("contextmenu", (event) => {
  if (!import.meta.env.DEV) event.preventDefault();
});

// Read before the first render, so every part of the app starts on the saved
// settings. It is a local file read, well under a frame.
const settings = await settingsGet().catch((error: unknown) => {
  console.error("could not read settings", error);
  return defaultSettings;
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* One provider for the whole app, so tooltips share a hover timer: once
        one is open, moving along a row of transport buttons shows the next
        immediately instead of waiting out the delay again. */}
    <TooltipProvider delay={400}>
      <App settings={settings} />
    </TooltipProvider>
  </React.StrictMode>,
);
