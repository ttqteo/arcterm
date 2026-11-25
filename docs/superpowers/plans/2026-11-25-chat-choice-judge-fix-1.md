# Judge for choice questions in Chat: final-stage fix, round 1

**Spec:** `docs/superpowers/specs/2026-11-25-chat-choice-judge-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/chatsuggest/... ./pkg/chatjudge/... ./pkg/wshrpc/... ./claude/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs chat-judge agent-chat chat-code-box`
**Prototype:** .superpowers/design/chat-choice-judge/project/C-under-reply.dc.html

The merged result failed Verify on two frontend tests. Verify runs the vitest suite for the changed paths, so the
final stage never reached the CDP scenarios.

1. `frontend/app/store/keybindings/store.test.ts` "PREDICATE_ATOMS completeness" fails: the new `agent:chat-judge`
   binding (`Alt+J`, `bindings.ts` ~2230) reads `liveJudgeAtom` in its `when()`, and `whenstate.ts` does not watch it,
   so the hints footer would not update when the live line's action changes. This is ours.
2. `pkg/remotemode/web/projectors.test.js` "the committed bundle is current" fails: commit `f1f73a657` (on the base,
   before this run) added `droppedReason` to `frontend/app/view/agents/transcriptprojection.ts` without regenerating
   `pkg/remotemode/web/static/projectors.js`. It is not ours, but it holds the land, so this round fixes it.



### Task 1: Watch liveJudgeAtom for the key hints, and regenerate the phone page's bundle
**Files:** `frontend/app/store/keybindings/whenstate.ts`, `pkg/remotemode/web/static/projectors.js`, `pkg/remotemode/web/static/markdown.js`, `pkg/remotemode/web/static/tokens.css`, `pkg/remotemode/web/static/icon.png`, `pkg/remotemode/web/static/fonts`
**Depends on:** none

- `whenstate.ts`: import `liveJudgeAtom` from `@/app/view/agents/chatsuggeststore` and add it to `PREDICATE_ATOMS`
  with a comment in the list's style (`// buildAgentBindings: agent:chat-judge`). Do not change the test. If the import
  creates a cycle that breaks module load (a test or `task check:ts` shows it), say so in the report rather than moving
  the atom: `bindings.ts` already imports the same module, so none is expected.
- Run `node scripts/sync-remote-web.mjs` from the worktree root. It rewrites the generated files under
  `pkg/remotemode/web/static/` from their sources. Commit whatever the script changes under that directory, and
  nothing by hand (they are generated). Expect only `projectors.js` to change, picking up `droppedReason`. If
  `markdown.js`, `tokens.css`, the fonts or `icon.png` also change, commit them too and name them in the report: they
  drifted from their sources as well. If any file outside `pkg/remotemode/web/static/` changes, do not commit it, and
  say so.
- Do not touch the CHANGELOG: neither change is visible to the person.

Acceptance: `npx vitest run frontend/app/store/keybindings/store.test.ts pkg/remotemode/web/projectors.test.js
frontend/app/store/keybindings/bindings.test.ts` all pass (the third because Task 7 of the first round changed its
imports and ran only its own new tests); `task check:ts` passes (run it once, with a 4-minute timeout; Task 7 could not
run it on its final code, so this is that run). If a run is stopped for memory, do not restart it: say so under Not
verified, since the engine's Check runs it again.
