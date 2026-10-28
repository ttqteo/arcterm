# Code surface: who wrote this, and telling the agent

Date: 2026-10-28. Status: approved design, not yet planned.

## Intent

The Code surface began as a plain repo reader (2026-08-03). Since then it has gained edits, search,
symbols and handoff, but its ties to agents are still thin. "Send to agent" hands over one file
reference, and an agent's edit re-checks the open file against disk (`useRecheckOnAgentEdit`,
`codesurface.tsx`). Reading code here you cannot tell which run wrote a line, and you cannot hand back
more than one line of feedback. This design makes Code the place to read what agents wrote and to
answer it. Parity with a plain editor (open-file tabs, an LSP client) is deliberately not the goal.

## Scope

In this design, built in this order:

1. **A. Who wrote this line**: a blame column that leads from a line to its commit, and from the
   commit to the run that landed it.
2. **D. Diff against the branch base**: the diff toggle gains a second target, the merge-base with
   the default branch. It ships with A because both are "what did this branch or run do to this file".
3. **B. Review comments to an agent**: collect several line comments while reading, then send them
   as one message.

Recorded, not built (a later spec each):

- **C. Agent-touched files in the tree.** Badge the files a live agent edited, with the agent named.
  Today the only signal is `agent:lasteditts`, a per-block timestamp with no path
  (`pkg/waveobj/wtypemeta.go:103`), so this needs the hook to record paths too. It also overlaps the
  Diff surface's changed list.
- **E. Search and replace.** It was deferred in the 09-04 search spec until destructive operations
  were proven, which they now are. It is the least agent-specific item, and agents usually do this
  work anyway.

This reopens two items earlier specs put out of scope: blame/per-line authorship and diffing against a
ref other than HEAD (both in `2026-09-04-code-git-aware-mutable-tree-design.md` §6). Everything else
those specs put out of scope stays out.

## A. Who wrote this line

**Gesture.** A Code binding (key left to the builder; add it to `buildCodeBindings` in
`frontend/app/store/keybindings/bindings.ts` and to `docs/keyboard-shortcuts.md`) toggles a blame
column on the open file. Blame shows one entry per hunk of consecutive lines from the same commit:
short sha, relative age, and, when known, the run that landed the commit. Hovering shows the commit
subject and author. Clicking an entry with a run opens that run through `openTarget`
(`frontend/app/view/jarvis/openref.ts`), the one router. Clicking an entry with no run copies the
sha. The toggle state persists in a jotai atom, because the surface unmounts when you switch away.

**Backend.** A new `GitBlameCommand` in `pkg/wshrpc/wshrpctypes_git.go`, next to `GitFileAtRefCommand`
and `GitHistoryCommand`. It runs `git blame --porcelain` on the working-tree file and returns hunks
(start line, line count, sha, author, author time, subject), plus a run id per sha where one maps.
Run `task generate` afterwards.

**Commit to run.** A landed run records its `--no-ff` merge commit in `RunLand.Commit`
(`pkg/waveobj/wtype.go:428`, written in `pkg/orchestrate/land.go`). That run's commits are exactly
`git rev-list M^1..M^2`, where M is that merge commit. For the project's landed runs, the backend
builds a map from commit sha to run id. A landed run never changes, so the map is cached per run.
There are two more cases:

- **A run still in progress.** Blame in a worktree on a `wave/<runId>` branch attributes the
  first-parent, non-merge commits in `<base>..HEAD` to that run (`git rev-list --first-parent
  --no-merges`), so main's commits merged into the branch are not credited to it.
- **No run.** Commits made by interactive sessions or by hand have no run and show sha, age and
  author only.

The map is at run level. Mapping a line to a task inside a run is up to the builder, if lane merges
carry the task's identity; if not, run level is enough. (Lane squash messages carry only task labels,
from `laneMergeMessage` in `pkg/orchestrate/lane.go`, not a run id.)

**Runs with no `--no-ff` merge: exact only.** A run is credited only where the link is certain:

- its `--no-ff` land merge (`M^1..M^2`), credited only when the run's `EndCommit` is in that range,
  so the merge is known to have taken in the run's own tip. That holds for 134 of the 137 landed runs
  in the store on 2026-10-28; the other 3 have no `EndCommit` and get no link.
- a fast-forward land whose `RunLand.Commit` is the run's own tip: the first-parent commits of
  `wave/<runId>` since `BaseCommit`, leaving out "Merge main into wave/…" merges
- a live `wave/<runId>` branch

Quick runs and `--landing checkout` runs show sha, age and author with no run link. A hand merge of
the run's branch is credited when it passes the same `EndCommit` check, since that check is exact. A
wrong run link is worse than a missing one, so `BaseCommit..EndCommit` ranges are never used to credit
commits.

**Not a repository.** In a plain directory there is nothing to blame: the blame toggle is disabled,
as the diff toggle already is there.

**Uncommitted lines** (`git blame` reports them as `0000000`) show as "not committed" and have no
link.

## D. Diff against the branch base

The existing `d` binding ("Toggle the diff against HEAD") keeps its key. Its states become off → HEAD
→ base → off. "Base" is `git merge-base HEAD <default>`, where `<default>` is the `Default` that
`ListBranches` already resolves (origin/HEAD, else local main/master). On a checkout where the base
equals HEAD (you are on the default branch), the base state is skipped. The diff view's header names
the target it is showing. The base file content comes from `GitFileAtRefCommand`, just as the HEAD
diff gets it today (`codestore.ts`).

## B. Review comments to an agent

**Today.** `codehandoff.ts` sends exactly one line (`look at path:L1-L2 — note`), because
`ControllerInputCommand` submits at the first newline. That rule stays.

**Gesture.** With a line or range selected, a Code binding adds a comment. It opens a small inline
input; Enter saves the comment and Escape cancels. Saved comments appear as gutter markers in the
file and as a count in the toolbar. A "Send review" action (and binding) offers the same agent picker
that "Send to agent" uses (`liveAgentsForProject`).

**State.** Comments live in a jotai atom keyed by project and file, so they survive the surface
unmounting, but not an app restart. Each comment holds the path, line range, the text of the first
commented line (an anchor if lines shift), and the note.

**Scope of one review (Agent's call).** A review spans the whole project, like a PR review spans
files. The toolbar count is the project's total, and the open file's gutter markers show its share.
"Send review" sends every comment in the project and clears them all. "Clear" also acts on the whole
project and asks first.

**Payload.** On send, the comments are written to one markdown file, one section per comment, grouped
by file (`path:L12-L18`, the anchored line, the note). The agent gets one handoff line with the file's
absolute path: `review comments in <abs path> — address each one`.

**Where the file goes (Agent's call).** `~/.arc/review/<project>/<timestamp>.md`. That is one
location whichever tree the Code project or the chosen agent is in, so there is no git-dir or
agent-cwd resolution. It is outside every repo, so nothing tracks it. A Claude Code agent in a
worktree reads files outside its cwd under this install's `auto` permission mode, and pi has no read
prompt at all. Files older than 7 days are pruned on each send. The earlier `<git-dir>` idea was
dropped because in a linked worktree `git rev-parse --git-dir` points outside the worktree anyway.

**No live agent (Agent's call).** The clipboard gets the review's full markdown, and no file is
written: a pointer to a file is no use pasted outside an agent. The one-line rule applies only to
`ControllerInputCommand`, not to the clipboard.

## Constraints

- Colors and spacing only from the `@theme` tokens in `frontend/tailwindsetup.css`, with no new
  tokens. Follow DESIGN.md.
- Pure logic in `foo.ts` with a `foo.test.ts` beside it (hunk grouping, commit-to-run mapping, the
  diff-target cycle, comment anchoring, the review file's text). The `.tsx` stays thin.
- Monaco access stays in `codeviewer.tsx`, the only module that touches Monaco today.
- Each new UI state gets a step in a CDP scenario in `scripts/cdp/scenarios-code.mjs` (or the Code
  area's module): the blame column on, the diff base state, comment markers with the toolbar count.

## Left to the builder

- How the blame column looks (a Monaco margin or decorations vs a separate column), within DESIGN.md.
- Whether blame is cached per file and modification time, or rerun on every toggle.
- Mapping to a task inside a run, if lane merges make it cheap.
- Keybindings for blame, add comment and send review.
- The exact wording of the review file and the handoff line, keeping the line to one line.
