# Harness update, fix round 1: final-verify's lock-path test on Windows

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** the run's Verify passes on the merged result. Its one failure is
`scripts/cdp/final-verify.test.mjs` › "final-verify.mjs build lock" › "keeps the posix lock path within a socket path,
and the windows lock a named pipe", which fails on Windows before this run (it came in with 49261eef).

**Architecture:** the test builds its short base with `node:path`'s `join("/home/u", ".cache", "arc-final")`, which on
Windows yields `\home\u\.cache\arc-final`, then matches the result against a forward-slash regex. `buildLockPath`
itself is right: it joins with the running platform's separator, as the real lock path must. The fix is in the test.

**Spec:** `docs/superpowers/specs/2026-10-07-harness-update-design.md` (unchanged; this round only clears Verify)

---

### Task 1: Make the short-base lock-path assertion separator-independent

**Depends on:** none

**Files:**
- Modify: `scripts/cdp/final-verify.test.mjs` (the `short` assertion, ~line 222)

Do not change `scripts/cdp/final-verify.mjs`. Do not run prettier on either file (AGENTS.md: `.mjs` scripts are
hand-formatted).

**Step 1: Replace the one regex assertion on `short`**

Replace

```js
        expect(buildLockPath(short, "linux")).toMatch(/^\/home\/u\/\.cache\/arc-final\/build-[0-9a-f]{8}\.sock$/);
```

with

```js
        const inBase = buildLockPath(short, "linux");
        expect(dirname(inBase)).toBe(short);
        expect(basename(inBase)).toMatch(/^build-[0-9a-f]{8}\.sock$/);
```

`dirname` and `basename` are already imported from `node:path` at the top of the file. The claim is the same: a short
base keeps the lock inside the base as `build-<id>.sock`, while the long base falls back to the tmpdir and Windows uses
a named pipe (the other assertions, unchanged).

**Step 2: Run it**

Run: `npx vitest run scripts/cdp/final-verify.test.mjs`
Expected: all tests pass, including "keeps the posix lock path within a socket path, and the windows lock a named pipe".

**Step 3: Commit**

```bash
git add scripts/cdp/final-verify.test.mjs
git commit -m "test(final-verify): check the short-base lock path without assuming a separator"
```

**Acceptance:** the test passes on Windows and still fails if a short base's lock left the base or lost its
`build-<8 hex>.sock` name.
