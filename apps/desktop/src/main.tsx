import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

// The webview's own context menu is a browser affordance and reads as a bug in
// a desktop app. Our own menus replace it where one is actually wanted.
window.addEventListener("contextmenu", (event) => {
  if (!import.meta.env.DEV) event.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
