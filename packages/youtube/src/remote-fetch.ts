/**
 * `fetch` across a worker boundary.
 *
 * The engine runs in a Web Worker, but Tauri's IPC — and with it the HTTP
 * plugin that gets past YouTube's missing CORS headers — only exists on the
 * main thread. So the worker's `fetch` flattens each request into plain data,
 * the main thread performs it, and the response comes back the same way. Bodies
 * travel as transferred `ArrayBuffer`s, so nothing is copied.
 *
 * No DOM or Tauri imports: both halves are plain functions, testable in Node.
 */

export interface SerializedRequest {
  url: string;
  method: string;
  headers: [string, string][];
  body: ArrayBuffer | null;
}

export interface SerializedResponse {
  url: string;
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ArrayBuffer | null;
}

/**
 * Flattens `fetch`'s arguments the way `fetch` would combine them.
 *
 * Headers are gathered into a standalone `Headers` rather than read off a
 * `new Request(...)`: a Request's headers carry the "request" guard, which
 * silently drops `Origin`, `Referer` and `Cookie` — exactly the headers the
 * YouTube session depends on.
 *
 * Not forwarded: `signal`. An `AbortSignal` cannot be cloned into another
 * thread; an aborted call simply has its response ignored when it arrives.
 */
export async function serializeRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<SerializedRequest> {
  const request = input instanceof Request ? input : null;
  const headers = new Headers();
  if (request) for (const [name, value] of request.headers) headers.set(name, value);
  for (const [name, value] of new Headers(init?.headers)) headers.set(name, value);

  let body: ArrayBuffer | null = null;
  if (init?.body != null) {
    // Response is the one constructor that accepts every `BodyInit` kind and
    // hands back the bytes.
    body = await new Response(init.body).arrayBuffer();
  } else if (request?.body) {
    body = await request.arrayBuffer();
  }

  return {
    url: request ? request.url : input.toString(),
    method: init?.method ?? request?.method ?? "GET",
    headers: [...headers],
    body,
  };
}

/** Statuses whose responses may not carry a body; `new Response` throws otherwise. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

export function deserializeResponse(serialized: SerializedResponse): Response {
  const response = new Response(
    NULL_BODY_STATUSES.has(serialized.status) ? null : serialized.body,
    {
      status: serialized.status,
      statusText: serialized.statusText,
      headers: serialized.headers,
    },
  );
  // A constructed Response has an empty `url`; callers that resolve redirects
  // or relative links against it need the real one.
  Object.defineProperty(response, "url", { value: serialized.url });
  return response;
}

export async function serializeResponse(response: Response): Promise<SerializedResponse> {
  const body = NULL_BODY_STATUSES.has(response.status) ? null : await response.arrayBuffer();
  return {
    url: response.url,
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers],
    body,
  };
}

/** The main thread's half: performs a flattened request with a real fetch. */
export async function performRequest(
  fetch: typeof globalThis.fetch,
  request: SerializedRequest,
): Promise<SerializedResponse> {
  const init: RequestInit = { method: request.method, headers: request.headers };
  if (request.body !== null) init.body = request.body;
  return serializeResponse(await fetch(request.url, init));
}
