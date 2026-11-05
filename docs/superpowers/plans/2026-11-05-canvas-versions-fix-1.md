# Canvas versions, fix round 1: the Storage canvases card no longer waits on a full scan

**Spec:** `docs/superpowers/specs/2026-11-05-canvas-related-design.md`

Why this round: the merged result passed `canvas-versions` (9/9) and `canvas-gallery-maker` (1/1), but `canvas-gallery`
threw at step 6 with `no storage scan within 600 s`. Step 6 asks `rescanstorage` and waits for a whole scan to end. A
scan measures build output and the package caches, which on this machine takes more than 10 minutes. A rescan asked
while one runs only queues behind it (`Scanner.Rescan`), and the auto-clean loop starts a scan 2 minutes after boot.
`canvases` is also the last provider, so its category lands only at the very end. No wait length fixes that.

The lead's call (recorded in the run report): after `Scanner.Clean` cleans a category, it re-measures **that category
only** at once and publishes it, then starts the full rescan as before. Why: the canvases provider is cheap, and the
gallery's Move to trash goes through `CleanStorageCommand` → `Scanner.Clean`, so the Storage section and its
Design canvases card show the canvas that was just trashed right away instead of after a scan that can take minutes. It
is a small product fix that also makes the check honest: step 6 then reads the count a person would see.

### Task 1: Clean re-measures the cleaned category at once

**Depends on:** none
**Model:** sonnet
**Files:** `pkg/storage/scanner.go`, `pkg/storage/storage_test.go`

- In `Scanner.Clean`, after `p.clean(...)`, call `p.measure(ctx, s.env)` and merge the result into `s.report`: replace
  that category's entry, or add it when the report has none yet, keeping the categories in `s.providers` order (the
  same merge `landed` does; share one helper with `landed`, don't copy it). Leave `ScannedTs` as it is: the report's
  time stays the last full scan's, as `landed` documents. Publish the report, then `s.Rescan(context.Background())` as
  today. Update `Clean`'s comment.
- A running scan that measures the same category later overwrites it with its own fresh result. That is fine, so add
  no locking beyond the existing `s.mu`.
- Tests in `storage_test.go` with fake providers like the existing ones:
  - after `Clean` on category B, `Report()` holds B's new measure before any rescan finishes (make the rescan block,
    e.g. a slow provider A), and the categories keep provider order;
  - when the report had no B yet, `Clean` adds it in its place;
  - `ScannedTs` is unchanged by `Clean`'s re-measure;
  - `TestCleanDispatchesToItsCategoryAndRescans` still passes (adjust its publish count only if the extra publish
    changes it, and say so in the report).
- Run `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/storage -count=1` (Bash) and gofmt the two
  files.

### Task 2: canvas-gallery step 6 waits for the canvases category, not a whole scan

**Depends on:** Task 1 (its live check needs Clean to re-measure the canvases category at once)
**Model:** sonnet
**Files:** `scripts/cdp/scenarios.mjs`

- In the `canvas-gallery` scenario's step 6, remove the `rescanstorage` call and the 600 s whole-scan loop (the
  `scanFrom` / `scanBy` block and its comment). Instead, after `listcanvases`, poll `getstorage` every 500 ms for up
  to 60 s until its `canvases` category exists and its row count equals the listed canvases (`gallery-alpha` alone
  after step 5's Move to trash), and throw `no canvases category matching the gallery within 60 s` with what it last
  saw otherwise. Keep a short comment saying why: Move to trash re-measures the canvases category at once (Task 1),
  and a whole scan can take more than 10 minutes on a machine with large caches.
- Keep every assertion of step 6 and 6b as it is.
- Don't touch `canvas-versions` or `canvas-gallery-maker`, which passed.
- Don't run prettier on `scripts/*.mjs` (AGENTS.md); keep the file's 4-space hand format.
- Live check: `node scripts/cdp/final-verify.mjs canvas-gallery` must show steps 0 to 6b passing. Run it alone on the
  machine; if the machine is short of memory and the run is stopped, say so in the report rather than retrying.
