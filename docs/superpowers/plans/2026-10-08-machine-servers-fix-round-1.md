# Servers on this machine — fix round 1: a vitest test that times out under load is flaky, not a failure

**Goal:** The final stage failed in Verify on two vitest tests that this run never touched:
`scripts/cdp-shot.test.mjs` ("exits nonzero with an actionable message when the port is closed") and
`frontend/app/view/agents/gridstore.persist.test.ts` ("starts empty for a profile that never stored a grid"). Each
hit vitest's 5 s timeout while the whole suite ran on a machine short of RAM (collect 456 s); run alone, both pass in
about 0.3 s. `scripts/verify.mjs` already reruns a failed Go test alone and reports it through `ARC_VERIFY_FLAKY`
when it passes, but a failed vitest run fails Verify outright. Give vitest the same rerun, so the final stage gets
past Verify and runs the CDP scenarios, which never ran.

**Spec:** `docs/superpowers/specs/2026-10-08-machine-servers-design.md` — not changed by this round; read only for context.

**Verify:** `node scripts/verify.mjs ./pkg/devservers ./pkg/memusage ./pkg/wshrpc/...`

**Final:** `if [ "$(uname -s)" = Darwin ]; then echo "unverified: machine-servers needs CDP, which WKWebView on macOS does not answer"; exit 3; fi; node scripts/cdp/final-verify.mjs machine-servers rail-servers consumers-popover`

Conventions: commit only the files the task names; no `Co-Authored-By` trailer; never run prettier on
`scripts/*.mjs` (they are hand-formatted with 4 spaces); don't start a dev app or a build.

---

### Task 1: rerun failed vitest test files alone; a pass there is flaky, not a failure

**Files:** `scripts/verify.mjs`, `scripts/verify.test.mjs`

In `scripts/verify.mjs`, every vitest invocation (`run("node", VITEST)` in both branches of `main`, and the
`vitest related --run` call) goes through one new function that does what `rerunAlone` does for Go:

1. Run vitest as today, output streamed. Exit 0: done.
2. Otherwise read the failed test files from the JUnit report vitest already writes (`vitest.config.ts`:
   `reporters: ["verbose", "junit"]`, `outputFile.junit: "test-results.xml"`, at the repo root): a `<testcase>`
   with a `<failure>` or `<error>` child names its file in `classname` (check this against a real report and use what
   it actually holds). Keep the parsing a pure exported function, e.g. `failedVitestFiles(xml)`, returning the file
   list, or `null` when the report is missing, unreadable, or names no failed test case (a crash, a collection error,
   or a failure outside any test). `null` means the failure is real: exit 1 as today.
3. Rerun just those files once, in one process: `node node_modules/vitest/vitest.mjs run <files...>`. Pass: push
   each failed test (`<file> > <test name>`) onto the same `flaky` list Go uses, print
   `verify: flaky, failed and then passed when rerun alone: …`, and call `reportFlaky` so the engine lists them among
   what it could not verify. Fail again: exit 1.

Read the report before the rerun overwrites it. Don't change what a clean run does, the Go path, or the
`ARC_VERIFY_CHANGED` planning.

Tests in `scripts/verify.test.mjs`, beside the existing `rerunnableTests` and `reportFlaky` tests:
`failedVitestFiles` on a report with two failed cases in two files (both files, once each), on a report with
failures only in one file's two cases (one file), on an all-pass report (`null`), and on text that is not XML
(`null`). If the rerun decision is factored as a function taking an injected `rerun` (as `rerunAlone` takes one), test
that a passing rerun records the tests as flaky and a failing rerun returns false.

Prove it with `npx vitest run scripts/verify.test.mjs`. Don't run the whole suite or `verify.mjs` itself: Verify and
the final stage run them.
