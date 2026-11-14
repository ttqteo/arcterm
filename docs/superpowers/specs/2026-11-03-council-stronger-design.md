# Council, stronger: checked claims, a Map tab, plain role names

Date: 2026-11-03. Brainstorm: `.superpowers/brainstorm/council-stronger/brainstorm.json`.
Prototype: `.superpowers/design/council-stronger/project/Map-tab.dc.html`.

## Why

The person wants the council to show more and look sharper, with one rule over both: **useful first, so a glance at
it tells you what is going on**. Three things are asked:

1. See what each expert actually did and how far to trust each claim, instead of one "latest activity" line and
   `path:line` chips nobody checked.
2. See at a glance who backs which idea, who doubts it, and how the council ended.
3. Role names a person reads without knowing jargon: Skeptic, Contrarian and Area chair are opaque.

This is not Claude Code agent teams. Go keeps driving the rounds; experts stay one-shot `claude -p` calls with
read-only tools. The 2026-10 benchmark (`docs/council-phase0.md`) found an agent team, council v1 and one agent tied on
recall, and all three scored 0/5 on the real-bug case (services-bugs): what the council lacks is checking, not more
seats.

## What the code does today

- Each expert turn is a fresh `claude -p --output-format stream-json` process with no session resume
  (`pkg/consult/consult.go:89`), tools `Read, Grep, Glob` or none (`pkg/council/caller.go`, `readOnlyTools`), and
  `--tools … --strict-mcp-config` (`consult.ClaudeArgs`). It runs with `Cwd: snap.Project`, the real checkout
  (`pkg/council/runner.go:883`).
- 1 to 3 seat rounds (`types.go`, `MaxRounds = 3`). Round 2 has stances accept / challenge / oppose and revisions that
  answer a challenge (`runner.go`: `hasStance`, `challengeTo`, `applyRevision`). `Council.Outcomes` records each
  proposal's end ("Direction 1", "Merged into direction 3", "Withdrawn in round 2", `types.go:214`).
- Evidence is `CouncilEvidence{Ref, Weak, Note}` (`types.go:124`); `Weak` comes from the coordinator's judgement
  (`parse.go`, `WeakNote`), never from a check.
- Activity is one line per expert (`CouncilActivity.Text`, `types.go:227`), replaced on every tool call; stats are
  `CouncilExpertStat{Ms, Tokens, Calls}`.
- The UI has two tabs, Report and Discussion (`counciltabs.tsx`), a Seats popover (`councilseats.tsx`), evidence chips
  (`councilsourcespanel.tsx`), and in the Report a folded table "Every expert on every idea" (`councilsummary.tsx:478`,
  `matrixRows`).
- 13 roles with English names in `roles.go` (UX, RAM, New user, Skeptic, Coordinator, Reviewer A/B, Reader, Area
  chair, Designer, Builder, Contrarian, Facilitator) and 5 named groups; Setup asks a model to suggest extra roles with
  names (`runner.go:2642`). Council content is already written in the language of the person's question
  (`prompts.go:238`). Any prompt, role or model change bumps `HarnessVersion` (`prompts.go:13`).
- `orchestrate.CreateRunWorktree` (`pkg/orchestrate/worktree.go:115`) and `linkdeps.go` make a throwaway tree with
  junctioned `node_modules`; `pkg/memgate` classes a single test file or `-run` filter as light (never queues).

## Design

### 1. Checked claims (backend)

Every claim gets one of three labels, set by Go, never by a model:

| Label | Meaning | How it is set |
|---|---|---|
| **Ran** ("Đã chạy") | Go ran a command for it and has the result | the claim's `verify` command ran (pass or fail) |
| **Read code** ("Đã đọc code") | it cites code and the citation holds | every `path:line` resolves and the quoted text matches |
| **Guess** ("Chỉ đoán") | it cites nothing, or nothing checkable | no evidence, or none that resolves |

A citation that does not resolve (missing file, line past the end, quote not found) is marked **Wrong cite**
("Trích sai") on that chip, and does not count toward Read code.

- **What a claim is** (Agent's call): a proposal, or a reply that takes a stance (agrees, has doubts, against). The
  label lives on that proposal or reply; plain replies (an answer to the person) carry none and are not counted.
  `verify` requests sit only on proposals.
- **Disproved** (Agent's call): a Ran claim whose result contradicts what the expert expected gets its own label,
  **Disproved** ("Bị bác"), red with an x icon and its own segment on the evidence bar. **Ran** means the result
  matched what the expert expected.
- **Mixed cites** (Agent's call): a claim is Read code when at least one of its cites resolves; each wrong cite still
  shows as a Wrong cite chip, and the expert card counts them.
- **Attached files** (Agent's call): cites into attached files and folders (`AddDirs`, the council's `Files`) are
  checked against those paths. `screenshot:` cites are not labelled and not counted.
- **Live agent seats** (Agent's call): their cites are checked against the seat's own working directory when known,
  else the project. They get no `verify` requests. Their timeline is built from the AgentLink's tool text, with the
  kind read best-effort.
- **Brainstorm councils** (Agent's call): no check badges, no evidence bar and no verify step, since a Brainstorm asks
  for no evidence (`prompts.go:341`). The matrix adds a **Builds on** pill; the cards keep tokens, time and calls.

**Citation check.** After round 1 and after each reply pass, Go checks every `path:line` against the council's tree:
the file exists under the project, the line is in range, and when the expert quoted text, that text is found at or
near the line. How near is the builder's call (see Left to the builder).

**Verify requests.** The round 1 JSON gains an optional `verify` list per proposal: a command and what the expert
expects (pass / fail, and why). Between round 1 and round 2, Go:

1. Makes one throwaway tree for the whole council, detached at the snapshot commit Start took (see Which tree), with
   no branch and the main checkout's `node_modules` linked in, so commands run on the code the experts read, and
   removes it when the council ends, fails or is stopped. The person's checkout is never
   written to.
2. Runs each requested command there, if it is on the allowlist, within limits:
   - Allowlist: `go test <one package> -run <pattern>`, `npx vitest run <one file>`, `cargo test <one test name>`
     (with the repo's own `--manifest-path` where needed). These are what memgate already classes as light; they still
     take a slot through `jobqueue` like any council call.
   - At most 2 commands per expert per council; each stops after 3 minutes.
   - A command off the list does not run. Its timeline row says "not run: not on the list", and the claim keeps Read
     code or Guess.
3. Records on the claim: the command, pass or fail, exit code, the last 40 lines of output, and whether it matched
   what the expert expected. Only a result that tested the claim counts: a command that timed out, matched no test
   (`go test` "no tests to run", vitest "No test files found", cargo "running 0 tests"), or did not build (a Go
   `[build failed]` or `[setup failed]`, a cargo compile error, a vitest transform error) is `not-run` with that
   reason, never pass or fail, so it never makes a claim Ran or Disproved and the claim keeps Read code or Guess.
4. Puts every result into **every** expert's round 2 prompt, not only the asker's, so round 2 argues over results.

When it runs (Agent's call): right after round 1 and before the round 1 pause, so the results are in front of the
person when choosing what to cut; a cut idea's result does not go into round 2. A 1-round council still runs it, and
the results go to the summarizer. The worktree is made only when at least one allowed command was requested; a project
that is not a git repo runs none, and the timeline says why.

**Which tree** (builder question 1): citations are checked against the checkout the experts read; commands run in
the worktree, which is HEAD plus the checkout's uncommitted changes and untracked files at council start. At Start, Go
takes that snapshot as a commit without touching the person's index or files: a private `GIT_INDEX_FILE` seeded from
HEAD, `git add -A` into it, `git write-tree`, `git commit-tree` with HEAD as parent; the commit id is stored on the
council (`snapshot`) and the tree is checked out detached at it. A project that is not a git repo stores none.

Experts still have only `Read, Grep, Glob`. No model gets Bash.

### 2. Per-expert timeline (backend + UI)

The runner keeps every activity of every expert, not only the last, capped at 200 rows per expert. One row: time,
kind (Read, Search, Ran command, Proposed, Replied), target (file, pattern, command) and result when there is one
(pass, fail, matches found). Commands render in mono, per DESIGN.md.

The timeline opens in the Seats popover when a seat is clicked, and from an expert card on the Map tab or among the
Discussion's round-1 cards.

### 3. The Map tab (UI)

A third tab, **Map** ("Bản đồ"), beside Report and Discussion. It is available while the council runs and after it
ends. Board: `Map-tab.dc.html`.

**Expert cards** (the scoreboard), one per seat in a row: avatar in its existing tone, role name, what it is doing now
(a running command shows in mono with the working dot), an evidence bar in four segments (Ran green, Disproved
red, Read code neutral, Guess amber) with the counts in words, then tokens, time and calls. There is **no self-reported confidence**:
the evidence bar replaces it, because it is counted by Go. A card is a button that opens that expert's timeline.

**Stance matrix**: one row per idea, sorted by agreement, highest first; one column per seat. Each cell is a pill:
Proposed, Agrees, Has doubts, Against, or "not said". A cell notes "revised in round N" where the author revised the
idea after a challenge. Under each idea title is its check badge: Ran (with the command and its result), Read code
(with the `path:line` chip), or Guess. The last two columns are an agreement bar (green / amber / red with the counts in
words, e.g. "2 agree · 1 doubt") and the outcome from `Council.Outcomes`; a withdrawn idea is dimmed. A legend above
the table says what each badge means.

A click on an idea's row (or Enter on it) opens it: under each seat's column, that seat's reason, as the Report's table
gives it today (the author's first sentence of the argument, else the seat's last reply of that stance; `matrixRows`'
`reason`). One row is open at a time; a second click closes it. Before a summary exists the reason comes from the same
replies, so the Map works while the council runs.

Status is never colour alone: every badge and pill carries an icon or a word.

The badges also appear on the evidence chips in the Discussion and the Report.

**The Report's "Every expert on every idea" table** (`councilsummary.tsx:478`) is removed (builder question 2): the
Report gets one line in its place, "See who agrees with which idea in Map", which opens the Map tab. The Map's matrix
reuses `matrixRows` (extended, not copied).

### 4. Plain role names (backend + UI)

Each role has a plain English name and a Vietnamese name; the council shows the set that matches the language of the
person's question. The council's language is read at Setup and stored on the council. Setup's suggested extra roles are
named in that language too. Role ids do not change, so saved councils still open.

| id | English | Tiếng Việt |
|---|---|---|
| ux | Ease of use | Người lo trải nghiệm |
| ram | Memory watcher | Người canh RAM |
| newuser | New user | Người dùng mới |
| skeptic | Bug hunter | Người soi lỗi |
| coordinator | Summarizer | Người tổng hợp |
| reviewer-a / reviewer-b | Reviewer A / B | Người chấm A / B |
| reader | Reader | Người đọc |
| areachair | Final judge | Người chốt điểm |
| designer | Designer | Người thiết kế |
| builder | Builder | Người làm |
| contrarian | Other side | Người cãi ngược |
| facilitator | Host | Người dẫn dắt |

Groups: Review a UI feature → "Soi một tính năng giao diện", Paper review → "Chấm bài báo", Product ideas → "Ý tưởng
sản phẩm", Chats with a Skeptic → "Trò chuyện cùng Người soi lỗi", Chats with a Contrarian → "Trò chuyện cùng Người cãi
ngược"; the English group names follow the new English role names.

### Not in this change

- **Session resume across rounds** is deferred: the verify step changes the timing between rounds, and the council's
  prompt cache is 5 minutes (`consult.go:80`), so it is measured once that settles. Add it to `docs/open-issues.md`.
- No agent teams, no Bash for any model, no graph library for the map.

## Testing

- Go: citation check (exists, out of range, quote mismatch, near-miss), allowlist parsing (accepts the three forms,
  rejects pipes, `&&`, redirects, other binaries), the per-expert cap and timeout, worktree cleanup on end / fail /
  stop, label assignment, results reaching every round 2 prompt, timeline cap, language pick and role names.
- Frontend: pure models beside each view (matrix rows and sort, agreement counts, evidence bar counts, timeline rows,
  name by language) with vitest; no render tests.
- CDP: a scenario that opens the Map tab on a fixture council with all three badges, a revised cell, a withdrawn idea,
  and a running command, plus the Seats timeline.

## Calls made while planning

These settle what the brainstorm left to the builder, plus two things the code forced.

- **Round 1 shape.** Each evidence item may carry the text it quotes: `{"ref": "pkg/x/y.go:42", "quote": "exact text"}`.
  Each proposal may carry `"verify": [{"command": "go test ./pkg/x -run TestY", "expect": "fail", "why": "one line"}]`,
  `expect` being `pass` or `fail`. The prompt names the three allowed forms and the cap of 2.
- **Storage** (wire types, then `task generate`):
  - `CouncilEvidence` gains `quote` and `cite`: `""` (not checked: a screenshot, a Brainstorm), `"ok"` or `"wrong"`,
    plus `citenote` saying why it is wrong ("line 900 is past the end (412 lines)", "quote not found near line 42").
  - `CouncilProposal` gains `runs []CouncilRun`. A `CouncilRun` is `{command, expect, why, state, exit, tail, matched,
    reason}`. `state` is `pass`, `fail` or `not-run`; `reason` says why one did not run ("not on the list", "over the
    2-command cap", "timed out after 3 min", "not a git repo"); `tail` is the last 40 lines.
  - `CouncilProposal` and `CouncilReply` gain `label`: `ran`, `disproved`, `read`, `guess`, or `""` when nothing is
    labelled (a plain reply, a Brainstorm).
  - `Council` gains `timeline map[string][]CouncilStep` (expert id → rows, oldest first, capped at 200) and `lang`
    (`en` or `vi`). A `CouncilStep` is `{ts, kind, target, result}`, `kind` being `read`, `search`, `run`, `propose` or
    `reply`. `Council` also gains `snapshot`, the commit Start takes (see Which tree).
- **Near a quoted line**: the quote, whitespace collapsed, is found in the cited line or range or within 3 lines either
  side. Case counts.
- **The council's language**: Go's `LangOf(text)` reads `vi` when the question (else the feature) holds a letter only
  Vietnamese writes (đ, ă, â, ê, ô, ơ, ư, or a vowel with a Vietnamese tone mark), else `en`. It is stored on the council
  at Start. Setup's preview of the seat names uses a TypeScript copy of the same rule, and both are tested on one table
  of cases. At Start, a stock role's seat whose name is still a stock name (English, old English or Vietnamese) takes
  the name for the council's language; a name the person changed, and user roles from `council.json`, stay as they are.
- **More than 6 seats**: the matrix scrolls sideways inside its own box, with the idea column sticky on the left.
- **The worktree** (the code forced this): `pkg/orchestrate` already depends on `pkg/council`, so council cannot import
  it. `council.Runner` gains a `Trees` field, an interface that makes and removes a detached tree for a project;
  `pkg/orchestrate` implements it (`git worktree add --detach` at the council's `snapshot` commit, see Which tree, then
  `linkDependencies`), and
  `wshserver_council.go` wires it. No branch is created. A nil `Trees` runs no command, and the timeline says so.
- **Commands run without a shell**: Go splits the command into words and checks them against the allowlist; anything
  with a shell operator (`|`, `&&`, `;`, `>`, `<`, `` ` ``, `$(`) is off the list. Each one takes a `jobqueue` slot sized
  by `memgate.Classify` (which classes `cargo test` as heavy, so it may wait), then runs with a 3-minute limit.
- **The timeline in the Seats popover**: a click on a seat row still shows that seat's messages alone, as today. Each
  row gains a Timeline button that swaps the popover's body to that seat's timeline, with Back to the list. An expert
  card on the Map opens the same popover on that seat's timeline. One per-council atom holds which seat's timeline is
  open.
- **Agent seats** (the code forced this): `AgentLink` knows only a seat's state and context, so `AgentSeatState`
  gains `Cwd` (the agent's working directory, empty when unknown) and `Activity` (its current tool line from the
  roster). While the AgentCaller waits on a seat's turn it reports each new `Activity` through `OnTool`, which is what
  the timeline records; the cite check uses `Cwd`.
- **A verify command's slot**: `memgate.Classify` returns nothing for a light command, so a light one claims the same
  512 MB a council call with tools claims (`toolSlotBytes`).
- **Role kind for the timeline**: read from the tool text's first word (`Read` → read, `Grep` and `Glob` → search), the
  same way for role seats and agent seats; a verify command is `run`, a posted idea `propose`, a reply `reply`.
- **Housekeeping**: bump `HarnessVersion`; CHANGELOG lines for the Map tab, checked claims and the plain role names; add
  session resume across rounds to `docs/open-issues.md`; the CDP scenario is `council-map`.
