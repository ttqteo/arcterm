# Agent Notifications Fix Round 1

**Goal:** Make the final stage's vitest pass on Windows. The one failure is a test that already fails on `main` and is
unrelated to notifications.

**Spec:** `docs/superpowers/specs/2026-10-07-agent-notifications-design.md`

Conventions for every task: commit on the branch you are given; commit only the files the task names; no
`Co-Authored-By` trailer; never push. Never prettier `scripts/*.mjs`.

### Task 1: final-verify's posix lock-path test passes on Windows

**Depends on:** none

**Files:** `scripts/cdp/final-verify.test.mjs` only. Do not change `scripts/cdp/final-verify.mjs`.

The final stage's vitest fails one test, `scripts/cdp/final-verify.test.mjs` > "final-verify.mjs build lock" > "keeps
the posix lock path within a socket path, and the windows lock a named pipe", at line 222:

```
expected '\home\u\.cache\arc-final\build-b027f594.sock' to match /^\/home\/u\/\.cache\/arc-final\/build-[0-9a-f]{8}\.sock$/
```

`buildLockPath(base, "linux")` builds its path with `node:path`'s `join`, which is the host's: on Windows it joins with
backslashes. The `platform` argument only picks named pipe versus socket file. The test then expects forward slashes,
so it can only pass on a posix host. It came in with 49261eef ("fix(final-verify): take the build lock on macOS") and
fails on `main` too.

Step 1: Change only the `short` assertion so it holds on any host. It should still check that a short base keeps the
lock inside the base as `build-<8 hex>.sock`. For example, compare against the host's `join(short, ...)` with a
separator-agnostic pattern (`[\\/]` between segments), or assert `dirname(result) === short` and
`basename(result)` matches `/^build-[0-9a-f]{8}\.sock$/`. Keep the other assertions in the test unchanged.

Step 2: Run `npx vitest run scripts/cdp/final-verify.test.mjs`. Every test in the file passes.

Step 3: Commit, with a body saying the test assumed a posix host.
