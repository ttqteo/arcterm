# Council memory: fix round 1

The final stage's Verify failed on the merged result in one vitest test that already fails on `main` on a Mac: the
bench-cases script resolves a Windows data dir against the current folder. This round fixes it so the final stage
can run the `council-memory` scenario.

### Task 1: The bench cases keep a Windows data dir as it is on a Mac

**Depends on:** none
**Files:** `scripts/council-bench-cases.mjs`, `pkg/wshrpc/wshserver/wshserver_council_test.go`

`scripts/council-bench-cases.test.mjs` > "the approved cases" > "build review entries for group ui-feature with this
pass's tag, in forward-slash paths" fails on a Mac:

```
Expected: "C:/data dir/x/council-bench-projects/spec-live-agents"
Received: "/Users/…/arc-wt/75522ac7/C:/data dir/x/council-bench-projects/spec-live-agents"
```

`caseEntry` (`scripts/council-bench-cases.mjs:78-79`) runs `resolve(dataDir)`. On a Mac `node:path`'s `resolve` does not
read `C:\data dir\x` as absolute and prefixes the current folder.

- [ ] In `caseEntry`, keep a data dir that is already absolute on Windows (a drive letter then `\` or `/`, or a `\\`
  share; `path.win32.isAbsolute` reads all of these) as given, and `resolve` any other. Then turn `\` into `/` as today.
  The other `resolve` calls in the file (the script's own root, the CLI's data dir) stay as they are.
- [ ] Do not change the test: its expected strings are right on every OS.
- [ ] Fix the stale comment at `pkg/wshrpc/wshserver/wshserver_council_test.go:207`: it says "a 15k round check", and the
  round check is now 18k (`roundCheckTokens`). Change only the comment.
- [ ] Run `node node_modules/vitest/vitest.mjs run scripts/council-bench-cases.test.mjs`: all 8 tests pass.
- [ ] Commit.

The file is a hand-formatted 4-space `.mjs`: edit it with the edit tool and never run prettier on it.

**Acceptance:** the bench-cases test file passes on a Mac. No test assertion changes.
