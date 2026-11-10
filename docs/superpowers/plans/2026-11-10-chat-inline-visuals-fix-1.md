# Chat inline visuals: fix round 1

**Verify:** `node scripts/verify.mjs ./pkg/htmlserve/... ./skills/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs agent-chat`

Round 1's final stage failed in Verify: it was cut off after 20 minutes, and 26 vitest cases in four files this run
did not touch (`frontend/app/view/jarvis/petstore.test.ts`, `frontend/app/view/agents/gridstore.persist.test.ts`,
`frontend/app/view/agents/reviewmarks.test.ts`, `scripts/cdp/council/fixtures.test.mjs`) failed with "Test timed out
in 5000ms". All 128 cases in those files pass when run alone (23 s). Each one that timed out imports a module afresh
inside the test, and on a loaded machine that took longer than vitest's 5 s default (`collect 131s` in that run). Final
never ran, so `agent-chat` steps 40-44 have still never executed, and Task 5 of the run found from the code that step 43
would fail: the bridge can never report a height smaller than the frame it is in.

### Task 1: The bridge reports the page's own height, so a frame can shrink

**Depends on:** none

**Files:** `pkg/htmlserve/htmlserve.go`, `pkg/htmlserve/htmlserve_test.go`

`bridgeScript`'s `report()` (`htmlserve.go:223-226`) measures `Math.max(document.documentElement.scrollHeight,
body.scrollHeight)`. In standards mode `documentElement.scrollHeight` is never below the viewport, which inside an
iframe is the frame's own height: a 120 px page drawn in Chat's 160 px loading frame reports 160, and a frame that grew
never shrinks. `agent-chat` step 43 expects `auto.html` (120 px) at 110-130 px.

**Step 1: Write the failing test** in `htmlserve_test.go`, beside `TestHandlerAddsTheBridgeToPagesOnly`:
`TestBridgeMeasuresTheContentNotTheViewport` asserts `bridgeScript` does not contain `documentElement.scrollHeight`
and does contain the measure Step 3 uses. Run `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test
./pkg/htmlserve -run 'Bridge'` → FAIL.

**Step 2: Implement.** Measure the content, not the viewport: the root element's laid-out height
(`Math.ceil(document.documentElement.getBoundingClientRect().height)`, which with the default `html { height: auto }`
is the content's height including the body's margins), falling back to `body.scrollHeight` only when that reads 0.
Keep the rest (load, ResizeObserver on root and body, rAF-throttled, only on change, no report of 0). Update the
`bridgeScript` comment to say why it does not use `scrollHeight`. Do not change `pkg/canvasserve`: its boards are
outside this run.

**Step 3: Check it in a browser engine.** As Task 1 of the run did, run the script in Node's `vm` with stubbed
`window`, `document`, `ResizeObserver` and `requestAnimationFrame`: a root whose bounding height is 120 inside a 160
viewport (`scrollHeight` 160) reports 120; a root that shrinks from 300 to 120 reports 120 after reporting 300. The
harness is a scratch file, not committed; say in the report what it showed.

**Step 4:** the Step 1 command, then `go test ./pkg/htmlserve ./pkg/canvasserve` (same env) → PASS; `gofmt -l
pkg/htmlserve` → nothing.

**Step 5:** Commit: `git commit -m "fix(htmlserve): the bridge reports the page's own height, so a visual's frame can
shrink" -- pkg/htmlserve/htmlserve.go pkg/htmlserve/htmlserve_test.go`

### Task 2: Vitest gives a test 20 s, so a loaded machine does not fail module-loading tests

**Depends on:** none

**Files:** `vitest.config.ts`

**Step 1:** In `vitest.config.ts`'s `test` block, add `testTimeout: 20_000` with a comment in the file's style: several
suites import a module afresh inside each test (`petstore.test.ts`, `gridstore.persist.test.ts`, `reviewmarks.test.ts`,
`scripts/cdp/council/fixtures.test.mjs`), each well under a second alone, but on a loaded machine one import passed the
5 s default and failed run b539a1af's final stage with 26 timeouts. Leave `hookTimeout` as it is unless a hook in
those four files also timed out (read the files' `beforeEach` / `beforeAll`).

**Step 2:** `npx vitest run frontend/app/view/jarvis/petstore.test.ts frontend/app/view/agents/gridstore.persist.test.ts
frontend/app/view/agents/reviewmarks.test.ts scripts/cdp/council/fixtures.test.mjs` → 128 passed. `npx prettier
--check vitest.config.ts` and `npx eslint vitest.config.ts` → clean.

**Step 3:** Commit: `git commit -m "test: vitest gives a test 20 s, so a loaded machine does not time out tests that
import a module" -- vitest.config.ts`
