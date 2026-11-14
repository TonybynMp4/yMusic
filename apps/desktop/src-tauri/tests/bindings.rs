//! Fails when `packages/ipc/src/bindings.ts` no longer matches the commands
//! and types in Rust. `pnpm bindings` runs the ignored `write_bindings` to
//! write it afresh.

use std::path::Path;

use ymusic_lib::{export_bindings, BINDINGS_PATH};

#[test]
fn bindings_are_current() {
    // Cargo's scratch directory for integration tests, fixed when the test is
    // built rather than read from the environment at run time. The process id
    // keeps two runs sharing a target directory off each other's file.
    let fresh =
        Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("bindings-{}.ts", std::process::id()));
    export_bindings(&fresh).expect("export bindings");
    let fresh_text = std::fs::read_to_string(&fresh).expect("read fresh bindings");
    let _ = std::fs::remove_file(&fresh);
    let committed_text = std::fs::read_to_string(BINDINGS_PATH).unwrap_or_default();
    // A Windows checkout with `core.autocrlf` has CRLF in the committed copy.
    assert!(
        fresh_text.replace("\r\n", "\n") == committed_text.replace("\r\n", "\n"),
        "packages/ipc/src/bindings.ts is stale: run `pnpm bindings` and commit the result"
    );
}

/// Writes the committed bindings. Ignored so that `cargo test` only ever
/// checks them; `pnpm bindings` asks for it by name.
#[test]
#[ignore = "writes packages/ipc/src/bindings.ts; run through `pnpm bindings`"]
fn write_bindings() {
    export_bindings(Path::new(BINDINGS_PATH)).expect("export bindings");
}
