# Pair an agent with a judge: fix round 1

**Spec:** `docs/superpowers/specs/2026-11-25-agent-pair-judge-design.md`
**Verify:** `node scripts/verify.mjs ./pkg/agentpair/... ./pkg/agentmsg/... ./pkg/agentsessions/... ./pkg/wps/... ./pkg/tsgen/... ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs surface-smoke pair-conversation pair-decided pair-header pair-tree`

The final stage's Verify failed on one vitest case, `pkg/remotemode/web/projectors.test.js` "the committed bundle is
current". The failure is already on the base: commit `f1f73a657` (fix(chat): a dropped prompt reads Not sent) changed
`frontend/app/view/agents/transcriptprojection.ts` (`droppedReason`) without regenerating the phone page's bundle.
A dry run of the sync also shows `tokens.css` behind `frontend/tailwindsetup.css`. Both are generated outputs, so the fix
is to regenerate them, never to edit them.

Rules: never hand-edit `pkg/remotemode/web/static/*` (the script writes it); never run prettier on `scripts/*.mjs`.

### Task 1: Regenerate the phone page's static assets
**Depends on:** none
**Model:** haiku
**Files:** `pkg/remotemode/web/static/projectors.js`, `pkg/remotemode/web/static/tokens.css`

Run `node scripts/sync-remote-web.mjs` from the repo root. Expect only `projectors.js` (the `droppedReason` projection)
and `tokens.css` to change; if any other file changes, or the projectors diff holds anything besides what the current
`frontend/app/view/agents/*.ts` sources produce, stop and report it rather than commit it. Commit the two files.

Acceptance: `npx vitest run pkg/remotemode/web` passes (all four `projectors.test.js` cases, including "the committed
bundle is current"), and `git status --short` is clean after the commit.
