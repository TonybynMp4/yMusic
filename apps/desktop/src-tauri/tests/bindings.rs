//! Fails when `packages/ipc/src/bindings.ts` no longer matches the commands
//! and types in Rust. `pnpm bindings` (this test with `YMUSIC_WRITE_BINDINGS`
//! set) writes it afresh.

use std::path::Path;

use ymusic_lib::{export_bindings, BINDINGS_PATH};

#[test]
fn bindings_are_current() {
    let committed = Path::new(BINDINGS_PATH);
    if std::env::var_os("YMUSIC_WRITE_BINDINGS").is_some() {
        export_bindings(committed).expect("export bindings");
        return;
    }
    // Cargo's scratch directory for integration tests, fixed when the test is
    // built rather than read from the environment at run time.
    let fresh = Path::new(env!("CARGO_TARGET_TMPDIR")).join("bindings.ts");
    export_bindings(&fresh).expect("export bindings");
    let fresh_text = std::fs::read_to_string(&fresh).expect("read fresh bindings");
    let _ = std::fs::remove_file(&fresh);
    let committed_text = std::fs::read_to_string(committed).unwrap_or_default();
    // A Windows checkout with `core.autocrlf` has CRLF in the committed copy.
    assert!(
        fresh_text.replace("\r\n", "\n") == committed_text.replace("\r\n", "\n"),
        "packages/ipc/src/bindings.ts is stale: run `pnpm bindings` and commit the result"
    );
}
