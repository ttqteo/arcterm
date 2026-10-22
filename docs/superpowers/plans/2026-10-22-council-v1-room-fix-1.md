# Council v1 room, fix round 1

The final stage failed in two `council-summary` steps on the merged result. Task 3 now makes
`CouncilSaveDocCommand` set `Council.DocPath` and publish `council:changed`, as the lead asked. Task 5's report shows
the `[data-council-docpath]` line ("Saved to docs/council/… with the whole discussion") and the ⋯ item
`Open the document` once `docpath` is set. The older local `[data-council-doc-saved]` line shows only when it is not.
The scenario still expects the old behaviour:

- **"Save as doc (in the ⋯ menu) writes the doc into the project and shows its path".** It waits for
  `[data-council-doc-saved]`, which no longer appears after a save. Result: `{"saved":null,"exists":false}`.
- **"a Brainstorm that kept nothing aside … and a Review report shows none of the Brainstorm parts".** It reopens the
  Review fixture `fx-council-done`, which the earlier Save as doc step has since given a `docpath`. It then asserts
  `review.docpath == null` and a `Save as doc` item. It got the saved line and `Open the document`.

The product behaviour is right; the scenario is stale.

### Task 1: The summary scenario follows the saved document's path

**Depends on:** none

**Files:** `scripts/cdp/council/summary.mjs`

1. In the step "Save as doc (in the ⋯ menu) writes the doc into the project and shows its path":
   - Wait for `[data-council-docpath]`.
   - Read the file's path from its `data-path` and the shown text from its text.
   - If `data-path` is relative to the project, resolve it against `ctx.repo` before `existsSync`.
   - Keep the existing checks:
     - the file is a `.md` under `<repo>/docs/council/`;
     - the shown text names `docs/council/….md`;
     - the body holds the council's heading.
   - Match the heading and section names to what `council.Document` writes today (`pkg/council`). It is the report
     plus the discussion plus the run facts, so drop or rename a check only where the document no longer has that
     heading.
   - Also assert that after the save the ⋯ menu offers `Open the document` and no `Save as doc`.
2. In the step "a Brainstorm that kept nothing aside shows no kept section and offers Save as doc until it has saved
   itself, and a Review report shows none of the Brainstorm parts":
   - The Review half must not depend on the earlier save.
   - Seed a fresh Review council with no `docpath`, open its Summary, and keep the original assertions: no Brainstorm
     parts, `docpath == null`, `Save as doc` offered. The `seedCouncil` helper with a new id such as
     `fx-council-review-unsaved` is enough; the teardown already removes the seeded councils.
   - Leave the Brainstorm half as it is.
3. Change no product code. A failure that still remains after these edits means the product is wrong. Report it in
   Found not fixed, and do not weaken the assertion.
4. Run `CDP_PORT=<port> task verify:ui -- council-summary` on a dev app of this worktree, as `AGENTS.md` describes
   (`scripts/cdp/final-verify.mjs council-summary` starts one). Every step must pass.
