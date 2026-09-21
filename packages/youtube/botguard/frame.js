/*
 * The BotGuard side of PO-token minting, run inside an isolated frame.
 *
 * BotGuard is Google's obfuscated VM. Minting a PO token means running it, and
 * it will not run without a real DOM — so not in the engine worker — while
 * running it in the app's own document would mean `unsafe-eval` and
 * Google-served code next to Tauri IPC. It runs here instead: a frame on its
 * own custom-scheme origin, served by Rust with a CSP that allows eval and
 * nothing else — no network, no IPC, no reach into the parent but a
 * MessagePort. The worker does all networking; this file only touches the VM.
 *
 * Deliberately hand-written, dependency-free, and small enough to audit. It
 * ports the VM-facing half of bgutils-js (BotGuardClient.load/snapshot and
 * WebPoMinter); if YouTube changes the VM's calling convention, this and that
 * library change together.
 */
"use strict";

const botguard = (() => {
  const TIMEOUT_MS = 5000;
  let snapshot = null;
  let signalOutput = [];
  let mintCallback = null;

  function withTimeout(promise, what) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`BotGuard timed out: ${what}`)), TIMEOUT_MS),
      ),
    ]);
  }

  function fromBase64(value) {
    const standard = value.replace(/[-_.]/g, (c) => ({ "-": "+", _: "/", ".": "=" })[c]);
    return Uint8Array.from(atob(standard), (c) => c.charCodeAt(0));
  }

  function toWebsafeBase64(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
  }

  const noop = () => {};

  return {
    /** Boots the VM and returns its attestation, for the worker to trade for an integrity token. */
    async load({ interpreterJavascript, program, globalName }) {
      new Function(interpreterJavascript)();
      const vm = globalThis[globalName];
      if (!vm || typeof vm.a !== "function") throw new Error("BotGuard did not load");

      const functions = new Promise((resolve) => {
        const setup = (asyncSnapshot) => resolve(asyncSnapshot);
        // Arguments as the YouTube player passes them; the telemetry hooks are
        // accepted and dropped.
        vm.a(program, setup, true, undefined, noop, [[], []], undefined, false, [
          noop,
          noop,
          noop,
          noop,
          noop,
        ]);
      });
      snapshot = await withTimeout(functions, "setup");
      signalOutput = [];
      mintCallback = null;
      return withTimeout(
        new Promise((resolve) =>
          snapshot((response) => resolve(response), [undefined, undefined, signalOutput, undefined]),
        ),
        "snapshot",
      );
    },

    async createMinter({ integrityToken }) {
      const getMinter = signalOutput[0];
      if (typeof getMinter !== "function") throw new Error("BotGuard produced no minter");
      const callback = await getMinter(fromBase64(integrityToken));
      if (typeof callback !== "function") throw new Error("BotGuard rejected the integrity token");
      mintCallback = callback;
    },

    async mint({ binding }) {
      if (mintCallback === null) throw new Error("mint before createMinter");
      const token = await mintCallback(new TextEncoder().encode(binding));
      if (!(token instanceof Uint8Array)) throw new Error("BotGuard minted nothing");
      return toWebsafeBase64(token);
    },
  };
})();

// Transport. The parent sends one message carrying a MessagePort; every call
// after that goes over the port, so nothing else posting to this window is
// ever answered.
if (window.parent !== window) {
  const onConnect = (event) => {
    if (event.source !== window.parent || event.ports.length !== 1) return;
    window.removeEventListener("message", onConnect);
    const port = event.ports[0];
    port.onmessage = async ({ data }) => {
      const { id, method, args } = data ?? {};
      try {
        if (!Object.hasOwn(botguard, method)) throw new Error(`no method ${method}`);
        port.postMessage({ id, result: await botguard[method](args) });
      } catch (error) {
        port.postMessage({ id, error: String(error?.message ?? error) });
      }
    };
  };
  window.addEventListener("message", onConnect);
  // Whether Tauri's IPC leaked into this frame, reported so the parent can
  // complain loudly: the isolation is the point of this file.
  window.parent.postMessage(
    { type: "botguard-ready", ipcVisible: "__TAURI_INTERNALS__" in window },
    "*",
  );
}
