# agy harness: final-stage fix round 1

**Goal:** The final stage's vitest pass is steady: `final-verify.test.mjs` stops failing under full-suite load.

**Spec:** ~/code/arcterm/.waveterm/worktrees/85548d0b-b33a-47e8-9a49-a047cee274ae/docs/superpowers/specs/2026-10-08-agy-harness-design.md

The failure is not in the agy work. The test file passes alone, three runs out of three. It also passed in the full
suite at the base commit `052e6df7`. In round 1 it failed only inside the full suite (389 files) on a Mac.

### Task 1: final-verify's stop test waits for the killed process to go
**Depends on:** none
**Files:** `scripts/cdp/final-verify.test.mjs`

**The failure** (final stage, round 1, macOS):
```
FAIL scripts/cdp/final-verify.test.mjs > final-verify.mjs > is unverified when the dev app never answers CDP, and stops the process it started
AssertionError: expected true to be false
 ❯ scripts/cdp/final-verify.test.mjs:129:62
     expect(alive(Number(readFileSync(pidFile, "utf8")))).toBe(false);
```

**Why it fails:**
- On POSIX, `killTree` in `final-verify.mjs` sends `SIGKILL` to the dev process group and the script exits at once.
- The fake dev process (`node fake-dev.cjs`, a child of the `sh -c` that `spawn(..., {shell: true})` starts) is then
  reparented and reaped asynchronously.
- Until it is reaped, `process.kill(pid, 0)` still succeeds on it, so `alive()` returns true. On a loaded machine that
  window is long enough for the assertion to see it.
- The script's contract, that it stops the process it started, holds. Only the test reads it too early.

**Decisions:**
- Change only the test. `final-verify.mjs` cannot wait for a grandchild it does not reap, and it already sends
  `SIGKILL` to the whole group.
- Replace the one-shot assertion with a bounded poll:
  - Add a small `gone(pid, ms)` helper beside `alive` in the test file. It resolves true as soon as `alive(pid)` is
    false, checks every 50 ms, and resolves false after `ms`.
  - The test asserts `expect(await gone(pid, 5000)).toBe(true)`.
  - 5 s fits easily inside the test's 30 s timeout.
- Leave every other assertion in that test, and every other test in the file, unchanged.
- Run nothing with prettier on `scripts/*.mjs` (AGENTS.md: `.editorconfig` omits `.mjs`). Keep the file's 4-space
  indent by hand.

**Acceptance:**
- `node node_modules/vitest/vitest.mjs run scripts/cdp/final-verify.test.mjs`: 21 tests pass.
- A process that never dies still fails the test, 5 s later instead of at once: `gone` resolves false at its deadline,
  and the test asserts true.
