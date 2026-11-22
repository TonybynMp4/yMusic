#!/usr/bin/env bash
# Decides which CI jobs a change needs. Reads the changed paths, one per line,
# on stdin and prints `web=true|false` and `rust=true|false`. With --full, or
# with no paths at all, every job runs. A path not listed below runs both
# jobs, so a new kind of file is checked until someone decides otherwise.
#
# Try it on a branch with:
#   git diff --name-only --no-renames origin/main... | .github/scripts/ci-changes.sh
set -euo pipefail

web=false
rust=false

# Files the web job (oxlint, oxfmt, knip, typecheck, Vitest, the Vite build)
# never reads: oxlint and oxfmt ignore src-tauri, and the TypeScript projects
# and the Vite build don't reach into it. A Rust change that moves the IPC
# types also has to change packages/ipc/src/bindings.ts, which runs web.
web_inert() {
  [[ $1 == apps/desktop/src-tauri/* ]]
}

# Files the rust job (cargo fmt, machete, clippy, the tests) can't be broken
# by. Docs and Markdown are never compiled. Frontend source only reaches the
# crate as the built assets in apps/desktop/dist, which generate_context!
# embeds but no Rust test reads, and a change that breaks the Vite build
# fails the web job. Not listed, so they run rust:
# - packages/ipc: the bindings test compares packages/ipc/src/bindings.ts
#   with what the Rust commands export.
# - packages/youtube/botguard: botguard.rs embeds it with include_str!.
# - index.html, vite.config.ts, package.json files, pnpm-lock.yaml and
#   tsconfigs: they decide whether the dist build the job runs succeeds.
# - .github/**: the workflow, its setup action and this script.
rust_inert() {
  case $1 in
    docs/* | *.md) return 0 ;;
    apps/desktop/src/*.ts | apps/desktop/src/*.tsx | apps/desktop/src/*.css) return 0 ;;
    packages/core/src/* | packages/youtube/src/*) return 0 ;;
  esac
  return 1
}

if [[ ${1-} == --full ]]; then
  web=true
  rust=true
else
  count=0
  while IFS= read -r path; do
    [[ -z $path ]] && continue
    count=$((count + 1))
    web_inert "$path" || web=true
    rust_inert "$path" || rust=true
  done
  if ((count == 0)); then
    echo "No changed paths, so running every job." >&2
    web=true
    rust=true
  fi
fi

echo "web=$web"
echo "rust=$rust"
