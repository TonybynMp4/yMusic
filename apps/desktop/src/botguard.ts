import { convertFileSrc } from "@tauri-apps/api/core";
import type { BotGuardVm } from "@ymusic/youtube/host";

/**
 * BotGuard for the engine worker, run in a hidden frame.
 *
 * The frame is `packages/youtube/botguard/`, served by Rust on its own
 * `botguard:` origin with a CSP that allows eval and nothing else (see
 * `src-tauri/src/botguard.rs`). This page's CSP stays as strict as it was; all
 * that crosses between the two is a MessagePort carrying the challenge in and
 * tokens out. Created on first use: most sessions never need a PO token.
 * Removed again after a while unused, since BotGuard's VM and the challenge
 * it ran stay in memory for as long as the frame does. The minter goes with
 * it, and `PoTokenMinter` builds a new one on the next call.
 */

/** Generous: the frame bounds each BotGuard stage itself, at five seconds. */
const CALL_TIMEOUT_MS = 20_000;

/** A fallback session mints a few tokens at its start, then none for hours. */
const IDLE_CLOSE_MS = 5 * 60 * 1000;

type Method = "load" | "createMinter" | "mint";

interface Reply {
  id: number;
  result?: unknown;
  error?: string;
}

interface Frame {
  iframe: HTMLIFrameElement;
  port: MessagePort;
}

let frame: Promise<Frame> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let nextId = 0;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

function openFrame(): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.style.cssText =
      "position:fixed;left:0;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
    iframe.title = "BotGuard";
    const timer = setTimeout(
      () => fail(new Error("the BotGuard frame never loaded")),
      CALL_TIMEOUT_MS,
    );

    const fail = (error: Error) => {
      clearTimeout(timer);
      window.removeEventListener("message", onReady);
      iframe.remove();
      reject(error);
    };

    function onReady(event: MessageEvent) {
      if (event.source !== iframe.contentWindow || event.data?.type !== "botguard-ready") return;
      clearTimeout(timer);
      window.removeEventListener("message", onReady);
      if (event.data.ipcVisible) {
        // The frame's whole reason to exist is to keep Google's code away from
        // the IPC bridge. Say so loudly if it ever stops doing that.
        console.error("Tauri IPC is visible inside the BotGuard frame; its isolation is broken");
      }
      const channel = new MessageChannel();
      channel.port1.onmessage = ({ data }: MessageEvent<Reply>) => {
        const waiting = pending.get(data.id);
        if (!waiting) return;
        pending.delete(data.id);
        if (data.error !== undefined) waiting.reject(new Error(data.error));
        else waiting.resolve(data.result);
      };
      iframe.contentWindow!.postMessage(null, event.origin, [channel.port2]);
      resolve({ iframe, port: channel.port1 });
    }

    window.addEventListener("message", onReady);
    iframe.src = convertFileSrc("index.html", "botguard");
    document.body.append(iframe);
  });
}

function closeFrame(): void {
  const closing = frame;
  frame = null;
  void closing?.then(({ iframe, port }) => {
    port.close();
    iframe.remove();
  });
}

/** Restarts the countdown to closing the frame, once nothing is waiting on it. */
function closeWhenIdle(): void {
  clearTimeout(idleTimer);
  if (pending.size === 0) idleTimer = setTimeout(closeFrame, IDLE_CLOSE_MS);
}

async function call<T>(method: Method, args: object): Promise<T> {
  clearTimeout(idleTimer);
  frame ??= openFrame().catch((error: unknown) => {
    frame = null;
    throw error;
  });
  const { port } = await frame;
  const id = nextId++;
  const result = new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`BotGuard ${method} timed out`));
    }, CALL_TIMEOUT_MS);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value as T);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    port.postMessage({ id, method, args });
  });
  return result.finally(closeWhenIdle);
}

export const botguard: BotGuardVm = {
  load: (challenge) => call("load", challenge),
  createMinter: (integrityToken) => call("createMinter", { integrityToken }),
  mint: (binding) => call("mint", { binding }),
};
