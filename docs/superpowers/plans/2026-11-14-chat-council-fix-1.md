# Council and Doc review cards in Chat: final fix, round 1

**Effort:** effort:7655bf18-619e-40cf-8805-5f4a6e5ac85e
**Spec:** `docs/superpowers/specs/2026-11-14-chat-council-design.md` (read its "Builder decisions" section)
**Verify:** `node scripts/verify.mjs`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs chat-council chat-verdict-handoff`
**Prototype:** D:/work/arcterm/.superpowers/design/chat-council/project

Final round 1 failed on two things, and both hold the land:

1. **The council's ended row draws the wrong part dimmed.** Spec section 3 and the board (`Council.dc.html` states 4
   and 5) draw "Council" semibold, the rest of the head plain in the primary ink, and the feature (done) or the reason
   (stopped, failed, not run) muted and cut short. `ChatCouncilRow` passes the feature or reason as `DoneRow`'s
   `text`, and `DoneRow` (`chatbrainstormparts.tsx`, the span pair at ~L569-580) draws a head that has a text in
   `text-muted` and the text in `font-medium text-primary`: the emphasis is inverted.
2. **No scenario ran.** The final dev app's page stayed at boot phase `html` for 600 s
   (`final-shots/<dag>/1-steps/final.txt`). The Tauri Vite config keeps Vite's default cache dir,
   `node_modules/.vite`. In a worktree `node_modules` is a junction to the main checkout's, so every worktree's dev
   app, every Final and the main checkout's dev app share one `node_modules/.vite/deps`. Their configs hash
   differently: the aliases are absolute paths, so each tree's `configHash` differs. So each start logs "Re-optimizing
   dependencies because vite config has changed" and rewrites the shared deps under every other running server. The
   shared `_metadata.json` was rewritten at 03:28, inside this Final's 03:21 to 03:31 boot window. The page then asks for
   deps that were just replaced (Vite answers 504 Outdated Optimize Dep), and the entry module never runs. Run
   ab534f5b's Final did not start either (`docs/hand-checks.md`). `vite.browser.config.ts` already gives itself its own
   `cacheDir` for the same reason.

Principles for every worker: simple and direct, one source of truth, no abstraction for one use, errors handled at the
boundary and never swallowed silently. Colors from `@theme` tokens only; UI follows `DESIGN.md`.

### Task 1: The council row draws its head strong and its feature or reason muted
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/app/view/agents/chatbrainstormparts.tsx`, `frontend/app/view/agents/chatcouncilcard.tsx`, `frontend/app/view/agents/chatcouncil.ts`, `frontend/app/view/agents/chatcouncil.test.ts`, `scripts/cdp/scenarios-chat-council.mjs`

Decisions:
- `DoneRow` gets one opt-in prop, `dimText?: boolean`. Without it every row draws exactly as today; the run, verdict,
  handoff, builder, design and Doc review rows keep their look. With it, the head span is `flex-none text-primary` and
  the text span is `min-w-0 truncate text-muted`, keeping its `title={text}` and no `font-medium`.
- `DoneRow`'s `head` widens from `string` to `ReactNode`, so a caller can set one word in a stronger weight. Every
  caller passes a string today, which still fits: `chatbrainstormrun.tsx`, `chatbrainstormcard.tsx`,
  `chathandoffcard.tsx`, `chatruncard.tsx`, `chatverdictcard.tsx`, `chatdocreviewcard.tsx` and `chatcouncilcard.tsx`.
  None of them change.
- `DoneRow` marks its two spans `data-chat-bscard-head` and `data-chat-bscard-text`, so the scenario can read them.
  These are attributes only and change no look.
- `chatcouncil.ts` exports `COUNCIL_WORD = "Council"`. `councilCardView` and `councilRowView` build every head from it,
  so the word has one source. The heads' text does not change, and every existing test still holds.
- `ChatCouncilRow` passes `dimText`, and a head of `<span className="font-semibold">{COUNCIL_WORD}</span>` followed by
  `view.head.slice(COUNCIL_WORD.length)`. A head that does not start with the word is drawn as given. The head's text
  (its `textContent`) stays `view.head`, so the scenario's `text.includes("Council · …")` reads still hold.
- Only `ChatCouncilRow` passes `dimText`.

Scenario (`scripts/cdp/scenarios-chat-council.mjs`):
- `readRow` also returns `style`, read with `getComputedStyle`:
  - the color and font weight of the row's `[data-chat-bscard-head]`;
  - the weight of the head's first `span`, the Council word;
  - the color and weight of `[data-chat-bscard-text]`;
  - the color of the row's muted reference: the ✓ `svg`, or `[data-chat-bscard-mark]` when there is no ✓. Both are
    `text-muted`. For a mark with a colour of its own, such as the ! in `text-error`, read the mark box itself, not its
    inner span.
- Step 4 (done) and step 5 (stopped, failed, not run) each add these checks to their `rec`:
  - the text's color equals the muted reference's color;
  - the head's color differs from it;
  - the Council word's weight is at least 600;
  - the text's weight is below 500.
- Each check is named in the step's `rec` description. Example for step 4: "…, the head in the primary ink with
  'Council' semibold and the feature muted".

Acceptance:
- `npx vitest run frontend/app/view/agents/chatcouncil.test.ts` passes, and `task check:ts` is clean.
- `chat-council` step 4 (`4-done-row` shot) and step 5 (`5-ended-rows` shot) show "Council" semibold, the rest of the
  head in the primary ink, and the feature or reason muted and cut short. Their new style assertions pass.
- `chat-verdict-handoff`'s run, verdict and handoff ✓ rows draw as before; that scenario stays green.
- Run `node scripts/cdp/final-verify.mjs chat-council` in your tree and report its PASS table. Task 2 fixes the dev
  app's boot. If that boot still hangs because Task 2 has not merged, say so in Not verified and do not retry it in a
  loop.

### Task 2: Each checkout's Tauri dev app keeps its own Vite deps cache
**Depends on:** none
**Model:** sonnet
**Files:** `frontend/tauri/vite.config.ts`, `.gitignore`

Decisions:
- `frontend/tauri/vite.config.ts` sets `cacheDir: resolve(fe, "../.vite")`, which is `<checkout>/.vite`. That is a real
  directory inside each checkout or worktree, never behind the `node_modules` junction. A comment says why: a
  worktree's `node_modules` is a junction to the main checkout's, every tree's config hashes differently because the
  aliases are absolute, and a shared `node_modules/.vite` is re-optimized under every other running dev app, so a page
  loads replaced deps (504) and never boots.
- `vite.browser.config.ts` keeps its own `cacheDir`. `mergeConfig` lets it override this one. Do not touch it.
- `.gitignore` adds `/.vite/`.
- The first start in a tree optimizes cold, which takes seconds against Final's 600 s wait. Nothing else changes:
  vitest has its own config, and `scripts/cdp/final-verify.mjs` needs no change.

Acceptance:
- `task check:ts` is clean.
- Start `npx vite --config frontend/tauri/vite.config.ts --port 5297 --strictPort` in this task's tree, in the
  background with `run_in_background`, and fetch `http://localhost:5297/` once. Then check:
  - `.vite/deps/_metadata.json` appears in the tree;
  - the shared `node_modules/.vite/deps/_metadata.json` keeps its modification time.
  Stop the server with TaskStop. Report both times.
- `git status --short` shows no `.vite` entry.
- Final runs both named scenarios (`chat-council` and `chat-verdict-handoff`) instead of stopping at boot phase `html`.
