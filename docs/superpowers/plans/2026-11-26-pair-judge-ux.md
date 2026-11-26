# Pair judge UX: one answer per question, a pause card, Resume, Chat's judge renamed — plan

**Spec:** `docs/superpowers/specs/2026-11-26-pair-judge-ux-design.md` (its "Builder decisions" section settles every open point: each task works from it)
**Verify:** `node scripts/verify.mjs ./pkg/agentpair/... ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs chat-judge pair-conversation library-pairs pair-tree`

Plan-wide rules: never hand-edit generated files (`task generate` writes them; only Task 1 runs it). Words, VI/EN rule
and card order are the spec's "Builder decisions". Pure logic sits in a `.ts` with a vitest beside it; a `.tsx` stays
thin. No CDP in a worker: each UI task writes its scenario steps, Final runs them. Colors from `@theme` tokens only.
Lint/format only the paths you touched. No attribution trailer in commits.

### Task 1: Wire types, the PairResume declaration and task generate
**Depends on:** none
**Model:** sonnet
**Files:** `pkg/wshrpc/wshrpctypes_pair.go`, `pkg/agentpair/pair.go`, `pkg/agentpair/view.go`, `pkg/agentpair/view_test.go`, `pkg/agentpair/resume.go`, `pkg/wshrpc/wshserver/wshserver_pair.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`
Interfaces the other tasks rely on (exact names):
- `wshrpc.PairPause{Reason string "reason"; Summary string "summary"; Decided PairDecided "decided"}`.
- `wshrpc.PairMessage.Pause *PairPause` (json `pause,omitempty`); `agentpair.Message.Pause *wshrpc.PairPause` (json `pause,omitempty`); `View` copies it through.
- `wshrpc.PairView.CanResume bool` (json `canresume,omitempty`, so the generated TS field is optional and the hand-built `PairView` literals in frontend tests and `scripts/cdp` fixtures keep typechecking), set by `View` from `canResume(p)`.
- `PairResumeCommand(ctx, CommandPairGetData) error` in `PairCommands`; the handler calls `getPairManager().Resume(ctx, data.PairId)`.
- `resume.go` declares `func (m *Manager) Resume(ctx context.Context, pairId string) error` and `func canResume(p *Pair) bool` with placeholder bodies (Resume returns an error saying it is not built yet; canResume false); Task 2 fills them.
- Run `task generate`.
Acceptance: `go build ./...` and `go test ./pkg/agentpair -run 'TestView'` pass (a Pause set on a message reaches the view); `task check:ts` passes with the regenerated types.

### Task 2: Resume and canresume
**Depends on:** Task 1
**Model:** sonnet
**Files:** `pkg/agentpair/resume.go`, `pkg/agentpair/resume_test.go`, `pkg/agentpair/history.go`, `pkg/agentpair/view_test.go`, `pkg/wshrpc/wshserver/wshserver_pair_test.go`
- `canResume(p)`: stopped, StopReason not `judges-gone`, and `callsForAnswer` true for the worker or a live judge (its signature does not change in Task 3).
- `Manager.Resume` refuses not-stopped, judges-gone and nothing-to-deliver with errors that say what to do instead (send a message; Add judge); else `resume(p, now)` inside `change`, then `deliverAll(ctx, id, true)`. No timeline line.
- `history.go`'s `Read` sets `CanResume` false on a synced view.
Acceptance: `go test ./pkg/agentpair -run 'TestResume|TestCanResume|TestView'` (resume after a token cap delivers the kept queues, resets the counts and sends no message; each refusal; canresume false after a no-new-points stop with empty queues and on a synced read); `go test ./pkg/wshrpc/wshserver -run 'TestPairHandlers'` covers PairResume.

### Task 3: The waiting rule, the summary mark and the pause snapshot
**Depends on:** Task 1 (uses `Message.Pause` and `wshrpc.PairPause`)
**Model:** sonnet
**Files:** `pkg/agentpair/manager.go`, `pkg/agentpair/manager_test.go`, `pkg/agentpair/blocks.go`, `pkg/agentpair/blocks_test.go`, `pkg/agentpair/brief.go`, `pkg/agentpair/brief_test.go`, `frontend/app/view/agents/pairblocks.ts`, `frontend/app/view/agents/pairblocks.test.ts`
- `callsFor`: the spec's waiting rule (Builder decisions) on a judge's side for a person's `To` both message; `@judge` / a judge tab still calls at once.
- `buildPrompt`: for a judge, a person's to-both message that does not call yet stays in the queue (not in the prompt, not in the ids removed), as the spec says. Check `answeredBy` still names the worker's answer as what the judge's reply answers.
- `Marks.Summary` from a `summary: <text>` line in the arc-judge fence (last wins); same pattern mirrored as `summaryLine` / `marks.summary` in `pairblocks.ts` (`parseJudgeMarks`; every `JudgeMarks` literal is in `pairblocks.ts` and its test).
- `stop()` appends one system message whose `Raw` is today's "Paused: …" text and whose `Pause` holds the reason, `Decided(p)` at that moment and the summary of the newest judge message after the worker's newest one ("" when none).
- `JudgeBrief`: when writing `no new points`, first write `summary:` in the arc-judge block (a few sentences for the person, in the person's language); a person's message that arrives with the agent's answer is judged through that answer, not answered.
Acceptance: `go test ./pkg/agentpair -run 'TestPersonToBothWaitsForWorker|TestPersonToBothNotSentWithACallingMessage|TestPersonToJudgeCallsAtOnce|TestPauseSnapshot|TestJudgeMarksSummary|TestJudgeBrief|TestManagerResumeByThePerson'`: the df763872 shape (m8 to both reaches the judge only with the worker's answer, in one prompt); a judge queue of [worker msg, person to-both msg] sends only the worker msg and keeps the person's; the pause message holds the Decided snapshot and summary for no-new-points and an empty summary for token-cap. `TestManagerResumeByThePerson` (manager_test.go:608-634) asserts today that the judge is sent a to-both message at once: update it to the waiting rule. `npx vitest run frontend/app/view/agents/pairblocks.test.ts` covers the summary line.

### Task 4: Chat's judge button renamed, magnifier icon
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatjudgeline.tsx`, `frontend/app/view/agents/chatjudge.ts`, `frontend/app/view/agents/chatjudge.test.ts`, `frontend/app/view/agents/chatcomposer.tsx`, `frontend/app/view/agents/chatconversation.tsx`, `frontend/app/view/agents/chatpane.tsx`, `frontend/app/view/agents/chatsuggeststore.ts`, `frontend/app/store/keybindings/bindings.ts`, `frontend/app/store/keybindings/bindings.test.ts`, `docs/keyboard-shortcuts.md`, `docs/hand-checks.md`, `scripts/cdp/scenarios-chat-judge.mjs`, `CHANGELOG.md`
- Action "Đọc code rồi chọn" / "Read the code and pick"; done head "Đã đọc code: chọn" / "Read the code: picks"; lucide `Search` in place of `Scale` on the judge line (`data-chat-judge-icon` value `search`) and on the judged chip (`chatcomposer.tsx` `judge:`). Internals keep their names. Comments naming the old label (chatsuggeststore.ts:212, chatpane.tsx:1222, chatconversation.tsx:969, bindings.ts:2218, bindings.test.ts:239/3313) are reworded; `docs/hand-checks.md:208-216` lines quote the new names.
- `docs/keyboard-shortcuts.md` Alt+J row names the new label. CHANGELOG `Changed` line (not big): the button's new name.
Acceptance: `npx vitest run frontend/app/view/agents/chatjudge.test.ts frontend/app/store/keybindings/bindings.test.ts`; in `scenarios-chat-judge.mjs` every read of the old icon (`svg.lucide-scale`, icon `scale` at about l.81, 121, 621, 815) reads the magnifier (`svg.lucide-search` / `search`), and the label asserts (`Judge kỹ` about l.624, 696; `Judge chọn` about l.805) read the new words.

### Task 5: Pause model, Resume and Judge-again actions, pair fixtures
**Depends on:** Task 1 (uses the generated `PairResumeCommand`, `PairPause` and `canresume` types)
**Model:** sonnet
**Files:** `frontend/app/view/agents/pairpause.ts`, `frontend/app/view/agents/pairpause.test.ts`, `frontend/app/view/agents/pairstore.ts`, `frontend/app/view/agents/pairstore.test.ts`, `frontend/app/view/agents/pairopen.ts`, `scripts/cdp/pair-fixtures.mjs`
Interfaces Tasks 6 and 7 use:
- `pairpause.ts` (pure): `pairVietnamese(view)`; `pauseCardOf(view, msg)` → `{ head, note, summary, sections: [{ kind: "asks"|"open"|"agreed", label, items }] }` (`note` is the judges-gone "Add judge…" line), asks carrying the live answer by item number; `pauseActions(view, { local })` → `{ resume: string | null, judgeAgain: string | null, hint: string | null }` ("Resume · 3.0M more" / "Chạy tiếp · thêm 3.0M" after a token cap, "Resume" / "Chạy tiếp" otherwise; Judge again "Judge again" / "Judge tiếp" on no-new-points or settled; hint "Message to go on" / "Nhắn để bàn tiếp" when nothing would be delivered; all null on ended, synced, relaying, and judges-gone gets none); `newestPauseId(view)`; `composerPlaceholder(view)`.
- `pairstore.ts`: `pairDraftAtom(pairId)` (string | null, taken once by the composer); `resumePair(pairId): Promise<void>` (calls `PairResumeCommand`, logs and rethrows on failure).
- `pairopen.ts`: `judgeAgainOf(model, agentId, pairId)` = `openPairOf` + set the draft to `@judge `.
- `pair-fixtures.mjs`: `PAIR_COMMANDS` gains `PairResumeCommand`, and `stubPairRpc`'s hard-coded recording list (about l.271) stubs and records it too; header comments' "seven" counts updated. The resume stub rejects with an error when the page flag `window.__pairFx.failResume` is set (a `setPairResumeFails(h, on)` helper), and otherwise flips the seeded view to relaying (state, stopreason, canresume) so the next read draws no Resume. `pausedPairView(now, { reason, canresume, summary, olderPause })` builds a stopped view whose last message carries a `pause` with the R1 Decided list (asks with chips, open, agreed); `olderPause: true` adds an earlier pause message too.
Acceptance: `npx vitest run frontend/app/view/agents/pairpause.test.ts frontend/app/view/agents/pairstore.test.ts`: every reason × canresume × synced/ended, the VI/EN pick, section order and empty sections, the live answer overlay, "Resume · 3.0M more"; `resumePair` calls the command and rethrows its error; `pairDraftAtom` holds the draft per pair; `judgeAgainOf` sets the draft and the pair on screen.

### Task 6: The pause card in the conversation, Judge again and the new placeholder
**Depends on:** Task 5 (uses `pairpause.ts`, `pairDraftAtom`, `resumePair` and the fixtures)
**Model:** sonnet
**Files:** `frontend/app/view/agents/pairpausecard.tsx`, `frontend/app/view/agents/pairpane.tsx`, `frontend/app/view/agents/pairmodel.ts`, `frontend/app/view/agents/pairmodel.test.ts`, `scripts/cdp/scenarios-pair-conversation.mjs`
- `PairRow` gains `pause: PairPause | null`; a system row with a pause draws `PairPauseCard` (`data-pair-pause={msgId}`, `data-pair-pause-reason`), a system row without one draws as today.
- The card: head, summary on top when present, sections, the note; chips answer through `useChipAnswer` and buttons `data-pair-resume` / `data-pair-judge-again` show only on the newest pause card of a stopped pair and not `readOnly`; older cards and `readOnly` (Library) draw chips as text and no buttons. A failed Resume goes to the conversation's error line (`data-pair-error`). Same arrival motion as other messages.
- The composer takes `pairDraftAtom` once (text set, focus, caret at end); Judge again on the card sets it. Placeholder from `composerPlaceholder(view)`; update the scenario's `PLACEHOLDER` constant.
Acceptance: `npx vitest run frontend/app/view/agents/pairmodel.test.ts` (rows carry the pause). `scenarios-pair-conversation.mjs` steps, each with a shot: (a) a no-new-points paused view shows the card with summary on top, then Waits on you with chips, Still open, Agreed, the hint and Judge again, no Resume; (b) Judge again leaves `@judge ` in the focused composer; (c) a chip on the newest card records one `PairSayCommand` with its item; (d) with `olderPause`, the older card has no chips as buttons and no Resume/Judge again; (e) a token-cap view with canresume shows "Resume · 3.0M more", a press records one `PairResumeCommand` and the button is gone after the flipped view draws; (f) with the resume stub failing, a press shows the error line and the button stays; (g) a judges-gone card has the Add judge note and no button; (h) the placeholder reads the new text.

### Task 7: Resume and Judge again on the Library page and the tree's pair row
**Depends on:** Task 6 (the read view draws Task 6's `PairPauseCard` through `PairConversation readOnly`), Task 5 (uses `pauseActions`, `resumePair`, `judgeAgainOf`, `pairDraftAtom` and the fixtures)
**Model:** sonnet
**Files:** `frontend/app/view/agents/pairreadpane.tsx`, `frontend/app/view/agents/agenttree.tsx`, `scripts/cdp/scenarios-library-pairs.mjs`, `scripts/cdp/scenarios-pair-tree.mjs`
- Library header (`pairreadpane.tsx`): `data-pair-read-resume` and `data-pair-read-judge-again` from `pauseActions(view, { local: !view.synced })`; Judge again opens the pair through `openref.ts`'s router (pair target) and sets the draft; a failed Resume shows a line under the header (`data-pair-read-resume-error`).
- Tree pair row (`agenttree.tsx`): hover/focus buttons `data-pair-row-resume` / `data-pair-row-judge-again` on the first line, clicks stop propagation; Judge again uses `judgeAgainOf`; a failure shows in the button's tooltip and an `aria-live` text (`data-pair-row-resume-error`).
Acceptance, each step with a shot: `scenarios-library-pairs.mjs`: a stopped local pair after a token cap shows Resume, a press records one `PairResumeCommand` and Resume is gone once the flipped view draws; with the stub failing the error line shows; Judge again on a no-new-points pair opens the conversation on the Agent surface with `@judge ` in the composer; the synced and the ended views show neither button; the pause card shows in the read view with chips as plain text. `scenarios-pair-tree.mjs`: the stopped pair's row shows Resume on hover, a press records the call and the button leaves; with the stub failing the row's error text shows; a no-new-points row shows Judge again and a press opens the conversation with `@judge ` in the composer; a relaying row shows neither.

### Task 8: Guide, changelog and the motion hand-check
**Depends on:** Task 4
**Model:** sonnet
**Files:** `docs/guide/agent-pair.md`, `CHANGELOG.md`, `docs/hand-checks.md`
- `agent-pair.md`: the sending rule (to both: the worker first, then the judge judges it; `@judge` at once), the `summary:` mark, the pause card and what it holds, Resume (where, when it shows, "3.0M more"), Judge again.
- CHANGELOG (top section; not big, as the spec decides): Changed: a message to both is answered by the worker first; Added: the pause card; Added: Resume.
- `docs/hand-checks.md`: one `- [ ] (arcterm) …` line for the pause card's arrival motion in a live pair. (Whether a real judge writes `summary:` is the re-measure chunk the spec names, not a hand-check.)
Acceptance: `npx vitest run frontend/app/cockpit/whatsnew.test.ts` passes with the new lines.
