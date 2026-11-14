# Council bugs and UX: batch 1 (UI and tests)

**Effort:** effort:67d1c761-ccae-4498-8c85-50d0ab9a65dd
**Verify:** `node scripts/verify.mjs ./pkg/council`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs council-discussion council-summary council-tree`

The fixes from the initiative "Council: bugs and UX" that are still open on `main` at e999f3db4. 9339c31a4 and
df5889499 already landed the Needs you council row, the learned-rule palette target, the spaced chat rows, the Memory
dot on a folded rail, the Retry hold in the Discussion (`retryHold`, `councilretry.ts`), the kept jump link
(`keptOpenAtom`) and the council store's 3.5 MB cap; none of those is redone here. There is no spec: each task quotes
the chunk it closes, and the chunk's label is the requirement. A worker ticks nothing on the initiative; the lead does
that after the run.

Principles for every worker: the smallest change that fixes the chunk, one source of truth (reuse `retryHold` and
`RETRY_NOTHING_SENT` from `councilretry.ts`, `MAX_UPLOAD_BYTES` / `MAX_UPLOAD_LABEL` from `uploadfile.ts`; never a
second copy of either), no abstraction for one use. Colors from `@theme` tokens only; UI follows `DESIGN.md`. Pure
logic lives in a `.ts` beside its `.test.ts`; no render tests.

## Review Focus

- Retry on a failed summary when no idea was sent must not fire `CouncilRetryCommand` at all (wavesrv refuses it with
  "has no sent idea to summarize"), on the Report's two "Retry the summary" buttons as in the Discussion.
- An image exactly at 3.5 MB is accepted by the composer; one byte over is refused before any RPC.

---

### Task 1: The Report's summary Retry needs a sent idea, and the composer's image cap is 3.5 MB
**Depends on:** none
**Files:** `frontend/app/view/agents/councilsummary.tsx`, `frontend/app/view/agents/composerattachments.ts`, `frontend/app/view/agents/composerattachments.test.ts`, `scripts/cdp/council/discussion.mjs`, `scripts/cdp/council/summary.mjs`, `CHANGELOG.md`

Closes three chunks:
- "Gate or reword a failed coordinator's Retry when no idea was sent (…): it now hits the Go refusal 'has no sent
  idea to summarize'" (the Discussion's Retry is gated already; the Report's two buttons are not)
- "discussion.mjs: assert no 'round' text in the failed state too (running, empty, paused have it; failedWhile has
  only a unit test)"
- "Two image limits disagree: the composer refuses over 10 MB, but createTempFileFromBlob refuses over 3.5 MB
  (MAX_UPLOAD_BYTES, uploadfile.ts); pick one" (the council store moved to 3.5 MB in df5889499; the composer is left)

Decision on the cap: 3.5 MB everywhere. Every image travels base64 in one websocket message, which `ws.ts` drops above
5 MiB (`uploadfile.ts:12-16`), so 10 MB never worked.

- [ ] **Step 1: Gate the Report's two "Retry the summary" buttons**
  `councilsummary.tsx` (~:886 in the no-summary panel, ~:1199 in the failed banner): compute
  `const hold = retryHold(c, coordinator.id)` (import from `./councilretry`, as `councildiscussion.tsx:336` does); the
  button and its `RetryWithButton` are `disabled` when `hold != null`, the button's `title` is `hold`, and no
  `retryExpert` call can fire then.

- [ ] **Step 2: One image cap in the composer**
  `composerattachments.ts`: `MAX_ATTACHMENT_BYTES = MAX_UPLOAD_BYTES` imported from `./uploadfile`, its comment
  pointing there (one websocket message); the oversize message (~:196) is `` `${file.name} is over ${MAX_UPLOAD_LABEL}` ``.
  `composerattachments.test.ts` (~:91): `isOversize(3.5 * 1024 * 1024)` is false, one byte more is true, and the
  message test (if any) matches `/3\.5 MB/`. Run `npx vitest run frontend/app/view/agents/composerattachments.test.ts`.

- [ ] **Step 3: Scenario steps**
  - `discussion.mjs` `failed` (~:961): add `!/round/i.test(skeptic)` to the Skeptic step's assertion and
    `!/round/i.test(panel)` to the panel step's, and say so in their labels.
  - `summary.mjs`, beside the coordinator-failed banner step (~:1015-1040): a step on a report whose coordinator
    failed and whose every proposal is unsent (seed it through the fixture's `edit`): the banner's
    `[data-council-action="retry"]` is disabled, its `title` is `RETRY_NOTHING_SENT`'s text, and a click with
    `CouncilRetryCommand` stubbed records no call. Do the same for the no-summary panel (`[data-council-nosummary]`)
    if the fixture can reach it with one more `edit`. Shoot `cdp-shots/council-summary-retry-held.png`.

- [ ] **Step 4: Changelog**
  `CHANGELOG.md`'s top section is `## 1.1.3 — 2026-11-14`, a dated release: open `## Unreleased` above it with a
  `### Fixed` list holding:
  - `Retry the summary on a council's Report is off when no idea was sent, and says why.`
  - `An image over 3.5 MB is refused when you add it to a message, not lost on send.`

- [ ] **Step 5: Run and commit**
  `npx vitest run frontend/app/view/agents/composerattachments.test.ts` passes. Commit:
  `fix(council): the Report's summary Retry needs a sent idea, and the composer's image cap is 3.5 MB`.

### Task 2: A FinalPick test, teardown retries, j/k in the live tree
**Depends on:** none
**Files:** `pkg/council/runner_test.go`, `scripts/cdp/council/fixtures.mjs`, `scripts/cdp/council/tree.mjs`

Closes three chunks:
- "Add a test that a re-summarize keeps Council.FinalPick (checked by reading only, run d81c57a6 t-1)"
- "Final store teardown: EPERM deleting fx-council-routing-auto.json on a second council-routing run (exit stayed 0)"
- "j/k skipping council rows not checked in the live app (unit-tested through treeNavIds only)"

No user-facing change, so no changelog line.

- [ ] **Step 1: FinalPick survives a re-summarize**
  `runner_test.go`: `TestSummarizeKeepsTheFinalPick`, built like `TestSummarizeRerunsTheSynthesis`: set a FinalPick
  with `SetFinalPick`, run Summarize, assert the reloaded council's `FinalPick` is unchanged. Run
  `go test ./pkg/council -run '^TestSummarizeKeepsTheFinalPick$'` (on Windows with the cgo prefix from AGENTS.md). If
  it fails, the Summarize path clears it: fix that in `runner.go` instead, and add `pkg/council/runner.go` to this
  commit.

- [ ] **Step 2: Teardown retries a locked file**
  `fixtures.mjs` (~:258): the per-file `rmSync(join(dir, f), { force: true, recursive: true })` gets
  `maxRetries: 5, retryDelay: 200`, as the base dir's removal at ~:327 has.

- [ ] **Step 3: j/k in the live tree**
  `tree.mjs`, in the steps that have both agent rows and council rows (12 on): focus the Agent tree on an agent row
  whose next row in tree order is a council row, press `j` and assert the focused row is the next non-council row
  (the council skipped), then `k` and assert focus is back on the first agent. Define a local key helper beside
  `pressEscape` (~:184), sending `keyDown`/`keyUp` with `key: "j", code: "KeyJ", windowsVirtualKeyCode: 74, text: "j"`
  (and the same for `k`); `scenarios.mjs`'s `uiPress` is module-local and cannot be imported. The fixture's agents
  sit in two projects (`ROOM_AGENTS`), so the next non-council row may be in another folder: derive the expected id
  from the rows the page draws (`[data-agent-row]`, `[data-council-row]` in document order), not a hard-coded id.

- [ ] **Step 4: Run and commit**
  `go test ./pkg/council -run '^TestSummarize'` passes. Commit:
  `test(council): a FinalPick test, teardown retries and a j/k tree check`.
