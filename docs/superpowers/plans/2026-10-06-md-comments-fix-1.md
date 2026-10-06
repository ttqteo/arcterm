# Markdown comments — final-stage fix round 1

**Spec:** `docs/superpowers/specs/2026-10-06-md-comments-design.md`

The final stage failed in Verify, not in this run's code. Two tests in `scripts/cdp/final-verify.test.mjs`
time out on macOS: "final-verify.mjs build lock > runs two final stages one after the other" (30 s) and "is free once
the stage holding it is killed" (5 s). Every other test in the suite passed: 5375 passed, 2 failed. The run never
touched `scripts/cdp/final-verify.mjs` or its test, and both tests fail the same way when run alone on the run's base.

The cause is in the base. The test puts the build-lock socket at
`<tmpdir>/final-lock-XXXXXX/localappdata/arc-final/build-<id>.sock`, which is 109 bytes on macOS. Node does not reject
a unix socket path longer than `sun_path` (104 bytes); it cuts it. So the socket file is created as `build-<id>`, while
`dropStaleSocket` probes and removes `build-<id>.sock`. A killed holder's socket is never dropped, and the lock stays
held until the test times out.

`main` already fixes this in `305a125d` ("fix(final-verify): take the build lock on macOS"), which landed after this
run branched. It changes only `scripts/cdp/final-verify.mjs` and `scripts/cdp/final-verify.test.mjs`, applies cleanly
to the run branch, and with it all 21 tests in that file pass on macOS. Bringing the same commit in also keeps the land
clean: both sides then make the identical change to those two files.

### Task 1: Bring main's macOS build-lock fix (305a125d) into the run branch

**Depends on:** none

**Files:**
- Modify: `scripts/cdp/final-verify.mjs`
- Modify: `scripts/cdp/final-verify.test.mjs`

Take the fix exactly as `main` has it. Do not write your own fix and do not change any other file. In particular, do not
change product code or `scripts/cdp/scenarios.mjs`. Never run prettier on `scripts/**/*.mjs`.

- [ ] **Step 1: Confirm the two tests fail before the change**

Run: `npx vitest run scripts/cdp/final-verify.test.mjs`
Expected: 2 failed, both under "final-verify.mjs build lock", each "Test timed out". This takes about 40 s.

- [ ] **Step 2: Apply main's commit**

Run: `git cherry-pick -x --no-commit 305a125d`
Expected: it applies with no conflict, and `git status --short` lists only the two files above.

- [ ] **Step 3: Run the tests again**

Run: `npx vitest run scripts/cdp/final-verify.test.mjs`
Expected: 21 passed, including the new "keeps the posix lock path within a socket path, and the windows lock a named
pipe".

- [ ] **Step 4: Confirm both files now match main**

Run: `git diff 305a125d -- scripts/cdp/final-verify.mjs scripts/cdp/final-verify.test.mjs`
Expected: no output.

- [ ] **Step 5: Commit**

Commit the two files. Use the subject `fix(final-verify): take the build lock on macOS`, then main's commit body
(`git show -s --format=%b 305a125d`), then the line `(cherry picked from commit 305a125d87d55487e03c6af5b8b0a3fca71e837a)`,
then whatever trailer your instructions require.
