# Diff worktree sidebar — fix round 1

**Goal:** Record in the spec the three choices the run made beyond it. The human approved them, and the final
verifier asks for a Deviations section to allow them. No code changes.

---

### Task 1: Record the sidebar deviations in the spec

**Depends on:** none

**Files:** `docs/superpowers/specs/2026-10-08-diff-worktree-sidebar-design.md`

Nothing else changes: no code, no tests, no scenarios, no CHANGELOG or docs. The code that landed is the
behaviour being recorded; read it to get the names and numbers right
(`frontend/app/view/agents/difflayout.ts`, `worktreesidebarstore.ts`, `worktreesidebar.ts`,
`worktreesidebarview.tsx`, `filessurface.tsx`).

**Step 1:** Add a `## Deviations` section to the spec, directly before `## Out of scope`. It has one
numbered entry per deviation below. Each entry names the decision or section it departs from, says what the
code does instead, and says why. Write in the spec's plain style, short sentences.

1. **The sidebar folds itself in a narrow window (departs from decision 4 and section 4).** The human chose
   this during the run, on 2026-10-09.
   - Why: at the shipped 1000x700 window, the open 240px sidebar left the diff pane about 338px wide, and
     `diff-compare` step 5 needs at least 400px.
   - What the code does: `sidebarFoldedAtom` is `boolean | null`, still persisted under
     `cockpit.files.sidebar.folded`.
     - `null` means follow the width. With no explicit choice, the sidebar shows as its rail when the whole
       Diff surface, sidebar included, is narrower than `SIDEBAR_FOLD_PX` (1000px). This uses
       `resolveSidebarFolded` in `difflayout.ts`, the same rule as the History column's `resolveCollapsed`.
     - An explicit choice always wins. A `Shift+B` press, the fold button, or "Choose a source" writes the
       choice. The automatic fold is never persisted.
     - The view and the `files:toggle-sidebar` binding read the derived `sidebarShownFoldedAtom`.
   - Consequence: at the shipped 1000x700 window, the Diff surface opens with the rail until the person
     unfolds it once. In a wider or maximized window it opens as decision 4 says.
2. **The user's collapse wins over the current source (departs from decision 1).** The group holding the
   current source is added to `sidebarExpandedAtom` when the scope changes, so it opens by itself. Its
   header can still collapse it: `expanded` is "an active query, or the user's set". Forcing that group open
   would have made the header click do nothing on the group a person is most likely to collapse. The
   lead decided this during the run.
3. **A filter reads collapsed groups (departs from decision 7).** While the filter is non-empty, every group
   not read yet is loaded with `status: true`. Without that read, branches and paths in collapsed projects
   could never match, as section 3's filter rule requires. These reads are not written to the expanded set,
   so the groups stay collapsed once the filter clears.

**Step 2:** Leave decisions 1, 4 and 7 as written. The Deviations entries carry the change.

**Step 3:** Commit only the spec file, with a pathspec.

**Acceptance:** the spec has a `## Deviations` section placed before `## Out of scope`, with the three entries
above, and the names and the 1000px value match the code. No other file changes.
