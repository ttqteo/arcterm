---
name: arc-dev
description: |
  Work inside the arc repo (Wave Terminal fork): build, test, typecheck, and verify
  changes following the repo conventions. Use for any code change in this repository.
---

# arcterm Dev

Workflow for changing code in this repository (Tauri cockpit + Go backend).

1. **Regenerate after type changes.** After editing any wshrpc / waveobj / wconfig Go type, run
   `task generate` at the repo root. Never hand-edit generated files
   (`frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`,
   `pkg/wshrpc/wshclient/wshclient.go`).
2. **Build.** `task build:backend` (sets the CGO flags itself). For a quick server-only build on
   Windows: `task build:backend:quickdev:windows`.
3. **Test.** Frontend: `npx vitest run <file>`. Backend: `go test ./pkg/...`. Rust: `cargo test --manifest-path
src-tauri/Cargo.toml`.
4. **Typecheck.** `npx tsc` stack-overflows here. Use
   `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit` (baseline is clean).
5. **Verify UI.** Run `task dev`, then `task verify:ui -- <scenario>` (CDP scenario harness,
   contact sheet in `cdp-shots/index.html`).
6. **Theme/skill edits.** If changing `pi/themes/arc.json` run `node scripts/validate-pi-theme.mjs`
   and `task sync:piartifacts`; if changing `pi/extensions/` or `pi/themes/`, re-run
   `task sync:piartifacts` so the embedded copies stay in sync.

Conventions: colors from `@theme` tokens only (never raw hex in components); comments explain
"why"; testable logic goes in pure `.ts` with `.test.ts` beside it; never commit without explicit
user approval.
