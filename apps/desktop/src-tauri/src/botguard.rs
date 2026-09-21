//! Serves the BotGuard frame (`packages/youtube/botguard/`) on its own scheme.
//!
//! BotGuard needs `eval` and a real DOM, and minting a PO token means running
//! Google's code. Rather than loosen the app's CSP for that, the frontend puts
//! it in a hidden frame on this origin, whose only CSP exception is eval and
//! which can reach nothing (no network, no scripts but its own) and talks
//! to the app only over a MessagePort. The files are compiled in, so the
//! scheme serves exactly two fixed documents and nothing a path could name.
//!
//! One thing the scheme does not buy: Tauri treats every registered custom
//! scheme as a local origin, so this frame's origin carries the app's
//! capabilities, and WebKitGTK exposes the IPC message handler to every frame.
//! What keeps Google's code off the IPC is that Tauri's init scripts, and
//! with them the per-run invoke key every call must carry, are injected
//! into the main frame only. The frame reports whether that still holds on
//! every load; `src/botguard.ts` logs loudly if not.

use tauri::http::{header, Request, Response, StatusCode};

pub const SCHEME: &str = "botguard";

const INDEX_HTML: &str = include_str!("../../../../packages/youtube/botguard/index.html");
const FRAME_JS: &str = include_str!("../../../../packages/youtube/botguard/frame.js");

/// `'self'` is what lets `index.html` load `frame.js`; `'unsafe-eval'` is what
/// BotGuard's interpreter needs. Everything else, fetches included, is denied.
const CSP: &str = "default-src 'none'; script-src 'self' 'unsafe-eval'";

pub fn respond(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let (body, content_type) = match request.uri().path() {
        "/" | "/index.html" => (INDEX_HTML, "text/html; charset=utf-8"),
        "/frame.js" => (FRAME_JS, "text/javascript; charset=utf-8"),
        _ => {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .body(Vec::new())
                .expect("a static response");
        }
    };
    Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_SECURITY_POLICY, CSP)
        .header(header::CACHE_CONTROL, "no-store")
        .body(body.as_bytes().to_vec())
        .expect("a static response")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(uri: &str) -> Response<Vec<u8>> {
        respond(&Request::builder().uri(uri).body(Vec::new()).expect("request"))
    }

    #[test]
    fn serves_the_frame_on_both_platform_url_shapes() {
        // `convertFileSrc` yields the first on Linux, the second on Windows.
        for base in ["botguard://localhost", "http://botguard.localhost"] {
            let page = get(&format!("{base}/index.html"));
            assert_eq!(page.status(), StatusCode::OK);
            assert_eq!(page.headers()[header::CONTENT_SECURITY_POLICY], CSP);
            assert!(String::from_utf8_lossy(page.body()).contains("frame.js"));

            let script = get(&format!("{base}/frame.js"));
            assert_eq!(script.status(), StatusCode::OK);
            assert!(script.headers()[header::CONTENT_TYPE].to_str().unwrap().contains("javascript"));
        }
    }

    #[test]
    fn serves_nothing_else() {
        for path in ["/../Cargo.toml", "/secrets", "/frame.js/x", "/index.html.bak"] {
            assert_eq!(get(&format!("botguard://localhost{path}")).status(), StatusCode::NOT_FOUND);
        }
    }
}
