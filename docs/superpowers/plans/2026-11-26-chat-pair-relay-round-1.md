# Chat pair relay, fix round 1: the judge side's answer chips, which no scenario step reaches

**Spec:** `docs/superpowers/specs/2026-11-26-chat-pair-relay-design.md` (the judge's Chat: "Its A items keep their
chips ... a chip answers through the pair wherever it is pressed (`useChipAnswer`), as board G draws")
**Verify:** `node scripts/verify.mjs ./pkg/orchestrate ./pkg/agentpair`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs chat-pair-relay`

No attribution trailer in commits. Commit with a pathspec. Never run prettier on `scripts/*.mjs` (hand-formatted 4-space
files). No CDP in a worker: the round's Final runs the scenario.

### Task 1: chat-pair-relay's judge side shows the relayed list's answer chips and a press answers through the pair
**Depends on:** none
**Model:** sonnet
**Files:** `scripts/cdp/scenarios-chat-pair-relay.mjs`
The run's Final passed, but its verifier noted that step 5 ("judge: the working agent's reply") shows the newest Pair
list read-only: no answer chips. The cause is the scenario's seed, not the view. `pairOf` (l.~71) seeds
`decided.open` as `O2 Lock the 0.8 threshold`, while the working agent's relayed fence
(`claude/arc-view-mod/testdata/pair-relay-worker.txt`) reads `D1 Pilot on 40 transcripts`, `O2 Lock the threshold from
the labelled set — before the pilot runs`, `A3 Keep the 0.8 threshold? [Yes | No, change it]`. `pairCardOf`
(`frontend/app/view/agents/pairblocks.ts`, ~l.288) takes the server's sections and `current: true` only when
`isAnchorList(items, decided)` holds; otherwise the card draws the fence as written, and `PairListCard`
(`chatpairblock.tsx`) passes `null` to `useChipAnswer`, so no chips.
- Read `isAnchorList` and make the seeded `decided` the anchor of the relayed list: its open item's text is the fence's
  O2 text exactly (keep the asks item A3 with chips `["Yes", "No, change it"]` and agreed D1). Change only the seed's
  data, never the app.
- Steps 1–4 and 6 read the worker side, where the Judge marks card's rows come from `judgeRowsOf(marks,
  decided)`. Check by reading `judgeRowsOf` that every assertion of steps 1–4 and 6 still holds with the new seed; if
  one would change, adjust the seed (not the assertion) unless the spec says the new reading is right, and say which in
  the report.
- Step 5: also assert that the newest relayed list on the judge side is the current card with A3's two chips (`Yes`,
  `No, change it`), reading the chips through the Pair list card's existing `data-*` hooks (`chatpairblock.tsx`; add
  the read to the `seen` snapshot's per-message data). Then a new step 5b: install `stubPairRpc(h)` (from
  `./pair-fixtures.mjs`, as other pair scenarios do; restore it in teardown with `restorePairRpc`), press `Yes` on the
  judge side, and assert the stub recorded one answer call for this pair's id with item 3 and `Yes` (read
  `stubPairRpc`'s recorder and the command's data shape in `pair-fixtures.mjs` and `useChipAnswer` in
  `raildecidedpane.tsx` for the exact field names). Shot `cdp-shots/chat-pair-relay-5b-judge-chip.png`. Keep the
  existing step names and shot names as they are.
Acceptance: `node --check scripts/cdp/scenarios-chat-pair-relay.mjs`, and importing it still returns one scenario named
`chat-pair-relay`; Final's step 5 and 5b are the live check.
This task changes no rendered view; its scenario step is the change.
