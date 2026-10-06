# Worker RAM Capacity — Final Fix Round 1

**Goal:** The final stage's Verify passes on macOS. The only failure was two `build lock` tests in `scripts/cdp/final-verify.test.mjs`, and they fail there before this run too. This run never touched `final-verify.mjs` or its test. Every Go package Verify names passes, and so do the other 5,319 vitest tests.

**Spec:** `docs/superpowers/specs/2026-10-06-worker-ram-capacity-design.md` (unchanged; this round is test tooling only)

## Global Constraints

- Change only `scripts/cdp/final-verify.mjs` and `scripts/cdp/final-verify.test.mjs`. Keep the win32 behaviour as it is: the lock stays a named pipe there, and the OS drops it when its process dies.
- Never start a dev app (`task dev`, `cargo tauri dev`) in the task worktree, and never run `final-verify.mjs` without `ARC_FINAL_DEV_CMD` pointing at a fake, as the tests do. Its `dist/bin` and `src-tauri/target` link into the main checkout.
- Never run prettier on `scripts/**/*.mjs`. Those files are hand-formatted with 4-space indents, and `.editorconfig` leaves `.mjs` out.

---

### Task 1: final-verify's build lock works with a POSIX socket on macOS

**Depends on:** none

**Files:**
- Modify: `scripts/cdp/final-verify.mjs` (`buildLockPath`, `listenOn`, `dropStaleSocket`, `acquireBuildLock`)
- Modify (only if a test's setup is what is wrong on POSIX): `scripts/cdp/final-verify.test.mjs`

**What fails** (`npx vitest run scripts/cdp/final-verify.test.mjs` on darwin arm64: 18 pass, 2 fail):
- `final-verify.mjs build lock > runs two final stages one after the other`: one stage's last line is `final-verify: listen EEXIST: file already exists` instead of `dev app exited with code 0 before answering on :<port>`. The test then hits its 30 s timeout.
- `final-verify.mjs build lock > is free once the stage holding it is killed`: after the holder is SIGKILLed, `acquireBuildLock(lockPath, 5000)` never gets the lock, and the test hits its 5 s timeout.

**A lead to check first, not a diagnosis:**
- On POSIX the lock is the file `join(base, "build-<id>.sock")`. In these tests `base` is `<os.tmpdir()>/final-lock-XXXXXX/localappdata/arc-final`. On this Mac that path is 109 bytes, and macOS caps a unix socket path (`sun_path`) at 104.
- A real stage uses `~/.cache/arc-final/build-<id>.sock`, about 50 bytes.
- Find out what node and libuv do on darwin with a path over the limit (truncate, or an error), and what `listen` returns there on an existing socket file whose owner is alive or dead. `listenOn` treats only `EADDRINUSE` as held, and `dropStaleSocket` probes the full path.
- Fix it where it is wrong. If a real stage could hit the limit, `buildLockPath` should keep the socket path short on POSIX, for example under `os.tmpdir()` keyed by the base's hash, or by a cwd-relative path. If only the tests can hit it, shorten their base and say so.
- Either way, a held lock must read as held, a dead holder's socket must be dropped and taken, and no error may escape `acquireBuildLock` as a thrown `listen` error.

- [ ] **Step 1:** Reproduce: `npx vitest run scripts/cdp/final-verify.test.mjs` shows the two failures above.
- [ ] **Step 2:** Find the cause, with a minimal node script if that helps. Write the fix.
- [ ] **Step 3:** If the fix changes `buildLockPath`, add a test that it returns a path of at most 104 bytes on POSIX for a long base, and keeps the named pipe on win32 (call it with `process.platform` stubbed, or test the exported helper it uses).
- [ ] **Step 4:** Run `npx vitest run scripts/cdp/final-verify.test.mjs`: all of it passes, three times in a row (the lock tests involve timing).
- [ ] **Step 5:** Commit `fix(final-verify): take the build lock on macOS` with the cause in the body.

**Acceptance:** On darwin, `npx vitest run scripts/cdp/final-verify.test.mjs` passes all its tests, including both `build lock` tests named above. The win32 lock is still `\\.\pipe\arc-final-build-<id>`. Neither file changed outside the lock and its tests.
