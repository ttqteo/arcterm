# Council report: tables of the project's facts, not prose about the council

Date: 2026-11-23 · Brainstorm: `.superpowers/brainstorm/council-report-tables/brainstorm.json`

## Why

The person runs about one council a day in mit-thesis (17 councils, 22 reports under `docs/council/`, 28–130 KB
each). They read Vietnamese and say they "can't understand anything, too much text". What they want from a report is
useful information about their work: what to do next, and the numbers the advice stands on. Today's report spends
most of its length judging the council itself.

Today's Review report (`pkg/council/markdown.go`, `Document` → `documentWith`), e.g.
`mit-thesis/docs/council/2026-11-23-them-tap-ca-npm-...md` (28 KB):

| Section | What it is | Kind |
|---|---|---|
| Memory | Agreed / Ruled out / Open | content |
| Answer + summary text | one sentence + ≤60 words, in the question's language | content |
| At a glance | quadrant chart, evidence × agreement (`charts.go`) | about the council |
| Directions | ~120-word English paragraph each + First step | content, as prose |
| Ask next | questions to ask the panel | about the council |
| Matrix | proposal × seat stances | about the council |
| Cite check | list of refs that hold / are wrong | about the council |
| The discussion | every message (17 of the 28 KB) | raw |
| Run facts | seats, models, tokens, charts | about the council |

Three faults found in the review of the mit-thesis councils feed this design:

1. Evidence cites files outside the project that are gone. The 22/11 and 23/11 councils cite
   `/private/tmp/claude-501/.../scratchpad/council_xjs_llmvd_facts.md` ~20 times; `wsh council cites` on the 22/11
   report now finds 14 wrong refs, all "file not found", plus 6 bare `facts.md:N` refs it cannot check.
2. The quadrant's x axis is the share of cites that hold, clamped at 0.9 (`charts.go:125`); in paper councils ~95%
   hold, so every direction sits at 0.80–0.90 and the chart tells nothing.
3. `summaryRule` (`prompts.go:322`) keeps every field but answer/text/asks in English, so the reasoning and the
   First step, the part the person acts on, are English under a Vietnamese question; direction titles flip between
   the two languages.

## Decisions

### 1. The main report holds only content about the project (part `meta`, `content`, `tables`, `prose`)

Order of the main `.md` (Review mode):

1. Title, the question (as today).
2. **Answer**: the one-sentence answer and the short summary text (as today).
3. **Việc cần làm** (to-do table), ranked, one row per direction:

   | # | Việc (≤15 words) | Vì sao (1 sentence) | File đụng tới | Loại (việc mới / sửa chữ) |
   |---|---|---|---|---|

   The coordinator writes three new fields per direction in the round-3 synthesis (`CouncilDirection`,
   `types.go:342`; `ParseSynthesis`, `parse.go:526`; then `task generate`): `task` (≤15 words, the Việc column),
   `kind` (one of `new` / `edit` / `decision`, shown as "việc mới" / "sửa chữ" / "quyết định" in a Vietnamese council
   and "new work" / "text edit" / "decision" in an English one) and `files` (project paths the task changes). Vì sao
   is the direction's reasoning cut to one sentence by the coordinator (a `why` field). Rewritten old reports have no
   such fields: Việc falls back to the direction title, Vì sao to the first sentence of the reasoning, and File /
   Loại show "—". No extra model call. The direction's agreed/split state is not a column.
4. **Số liệu** (figures table): one row per figure the panel relied on, *only figures Go verified* (decision 3):

   | Giá trị | Đo gì | Nguồn (`path:line`) |
   |---|---|---|

5. **Memory**: Agreed / Ruled out / Open, as today (it is content: what is settled).
6. One line linking the side file.

Each direction is otherwise reduced to its table row plus one sentence of reason; the long reasoning paragraph is not
in the main file.

Everything that judges the council moves to the side file: At a glance (quadrant), Matrix, Cite check, stances
("2 experts on 2 models", "Stances: … challenge"), Ask next, Run facts with its charts, and figures that failed the
check.

Agent's call: the quadrant's 0.9 clamp (fault 2) is not fixed in this work; the chart only moves to the side file.
`charts.go`, its frontend mirror and `testdata/glance-golden.json` stay as they are.

### 2. The discussion moves to a side file (part `prose`)

`docs/council/<same name>.discussion.md` holds: the full direction reasoning, the discussion, and the council-about-
the-council sections listed above. The main file links it at the end. The cite check (`AuditReportCites`,
`reportcites.go`) and anything else that today reads the discussion from the one document reads both files.

### 3. Figures are declared by the experts in round 1 and checked by Go (part `figsource`, the judge's pick)

- Round 1 (and any later round where a seat sends a proposal): each proposal may carry `figures`, a list of
  `{ value, measures, ref, quote }`, beside `evidence` (`CouncilProposal`, `types.go:233`; seat prompt around
  `prompts.go:50`; `ParseRound1`). `measures` is written in the question's language.
- Go checks each figure: `quote` is on or near the line (`CheckEvidence`, `cites.go:92`, the existing cite check),
  and `value` appears in `quote`. A figure passing both is verified.
- Figures are deduplicated by `ref` + `value`; when two seats describe the same figure differently, one `measures`
  is kept.
- Only verified figures go into the main table; failed ones go to the side file with the reason.
- The coordinator does not write figures (it has no tools, `prompts.go:1680`), and no extra model call is added.
- A figure that appears only in prose and no seat declared is not in the table (accepted loss).
- Agent's call: figures are Review-mode only; a Brainstorm asks for no evidence. Brainstorm reports still get
  decisions 1, 2 and 4 (the to-do table is built from its ideas' first steps).

### 4. Language follows the question (part `lang`)

Every prose field the report shows is written in the question's language (`Council.Lang`, `LangOf` in `lang.go`):
direction titles, reasoning, first steps, the to-do table, the figures' `measures`. Technical terms (McNemar, tier-2,
PoV) stay as they are. This replaces "every other field stays in English" in `summaryRule` and
`summaryRuleNoQuestion` (`prompts.go:322`, `:326`). Ids and JSON keys stay English.

The main file's own words follow the language too: its headings ("Việc cần làm", "Số liệu", "Đã chốt" / "Đã loại" /
"Còn mở"), column names and the side-file link. This narrows the standing rule at `labelWord` (`markdown.go`: "The
document's own words are English") to the side file, which keeps its English headings. A council with an empty
`lang` (the older Brainstorms) takes `LangOf(question)`, else `LangOf(feature)`.

### 5. Both the `.md` and the cockpit's Report change (part `where`)

The cockpit's council Report (`frontend/app/view/agents/council*`, e.g. `councilfiguresmodel.ts`,
`councilglancefigures.tsx`, `councildetails.tsx`) shows the same to-do table and figures table first, from the same
data, and puts the about-the-council views (quadrant, matrix, cite check, run charts) behind the details it already
has. New Go fields reach the frontend through `task generate`. A CDP scenario shows the new Report.

### 6. Files outside the project are copied into the repo at Start (part `briefs`)

When a council starts, every file in `files` that lies outside the project folder is copied to
`docs/council/briefs/<date>-<council id>-<file name>`, and the council reads and cites that copy by its path relative
to the project. `files` is stored relative to the project wherever possible, so a report synced between the Mac and
Windows checkouts resolves on both (today the 18/11 council's 7 files are all missing on Windows).

Agent's calls:
- The copy sits beside the original in `files`; it does not replace it. The experts read and cite the copy, and the
  outside refresh (`changedFiles`, `outside.go`) still watches the original, so a brief the person keeps editing
  still reaches a follow-up.
- A folder outside the project is copied whole up to 1 MB in all; past that, or for a file that cannot be read at
  Start, the council goes on without the copy, and Start prints a warning naming the file. The same warning is in the
  side file.

### 7. Old mit-thesis councils (part `old`)

- Every mit-thesis report whose council record is in the store of the machine running the rewrite
  (`%LOCALAPPDATA%\dev.arc.app\data\councils\<id>.json` on Windows) is rewritten in the new layout by Go, at no
  token cost; they have no figures table. Agent's call: a report with no record there (6 of the 22 on Windows; their
  records are likely in the Mac store) is left untouched and listed by the command; no report is ever deleted. The
  command can be run again on the Mac for the rest.
- Agent's call: the Vietnamese re-summary goes to the Vietnamese-question councils since 18/11: `5e31814143638517`,
  `27f5e22576cf98bf`, `0c4145c0d29de45b`, `51d083251b2dc133` and `5a8ffa6d661752a0`. `0f74c5be72277053` (20/11)
  is left out: its question is English, so under decision 4 a re-summary would come back English. One coordinator
  call each (~0.5M tokens in all, through the Token burn gate), e.g. with `wsh council summarize`.
- Their old evidence pointing at the lost scratchpad file stays as it is (the file cannot be recovered).

## Left to the builder

The prompt wording for round 1 and the synthesis; the `figures` field in `CouncilProposal` and its parsing, then
`task generate`; the rule that picks one `measures` when two seats differ; the side file's exact name and link; the
command that rewrites old reports and re-summarises the five; the Report's table views in the cockpit and the CDP
scenario that shows them; how the cite check reads both files.

## Testing

- Go unit tests: figure parsing, the value-in-quote check, dedup, the main/side split of `Document`, the language
  rule in the synthesis prompt, the outside-file copy and ref rewrite.
- Golden markdown for a Review council (main and side file).
- Frontend: pure model tests for the to-do and figures tables; a CDP scenario screenshot of the Report.
- Regenerate one mit-thesis report and read it by hand.

## Decisions made while planning (2026-11-23, autonomous run)

Every task of the plan builds on these. Where one changes a decision above, it says so.

1. **The council's figures are derived once, by Go, and stored.** Each proposal keeps the figures its seat declared,
   each with Go's check (`Cite`, `CiteNote`, as on evidence). After every check pass (`ApplyChecks`) Go writes the
   deduplicated list to `Council.Figures`, each with `From` (the proposal ids that declared it). The `.md` and the
   cockpit both read `Council.Figures`, so the dedup rule lives in one place. A Brainstorm's `Figures` stays nil.
2. **Dedup and the `measures` pick.** Two figures are one when their ref (path folded to slashes, lower case) and their
   value (spaces collapsed) match. The merged figure is verified when any copy is; its quote and ref come from the first
   verified copy (else the first copy); its `measures` is the first non-empty one in proposal order among verified
   copies, else among all copies.
3. **Value in quote** is a case-insensitive substring test after collapsing spaces in both; a figure with no quote, no
   ref line or no value fails with a reason.
4. **Direction fields.** `task`, `why`, `kind` (`new` / `edit` / `decision`; any other word reads as none) and `files`
   are asked for in both the Review and the Brainstorm synthesis. Fallbacks when a field is empty: Việc = `task`, else
   (Brainstorm) the first step, else the title; Vì sao = `why`, else the first sentence of the reasoning; File and Loại
   show "—". Go (`markdown.go`) and the cockpit (`councilreporttables.ts`) each implement this short rule; both
   comments name the other.
5. **The main file and the side file.** `WriteDocument` writes `<stem>.md` (main) and `<stem>.discussion.md` (side) and
   returns the main path; `DiscussionSuffix` and `SidePath` name the side file in one place. Main: title, question,
   Memory's chosen direction, answer and text, Việc cần làm, Số liệu, Memory's Agreed / Ruled out / Open, the person's
   pinned Final proposal (the person's own pick, so content), then the link line. Side (English headings): a link back,
   At a glance, the full Directions (reasoning, first step, stances), Also raised / Wild ideas kept aside, Ask next,
   Matrix, Figures that did not check out (with why), Files not copied (decision 6's warnings), Cite check, The
   discussion, Run facts and charts. `Document(c)` keeps its signature and returns main then side, for `wsh read`.
   `Markdown(c)`, what `wsh council wait` / `show` print for an agent, is the main file's content without the link,
   followed by the full Directions, the kept ones, Ask next and the Matrix: an agent keeps the detail it acts on.
6. **Changes decision 6: the copy replaces the original in `files`.** `Council.Briefs` records each outside file as
   `{source, copy}` (or `{source, skipped}` with why). `files` holds the copy's project-relative path, which every
   prompt, the cite roots and Setup read with no change, so no reader has to skip an original that has a copy; the
   outside refresh (`changedFiles`) watches each brief's `source`, so a brief the person keeps editing still reaches a
   follow-up. A file or folder that is not copied stays in `files` as it was. The 1 MB cap applies to a single file as
   well as a folder (a large PDF brief would otherwise land in the repo). Copies are taken in `beginFresh`, so Start,
   StartSaved and the queue all take them; a re-run keeps the copy a brief already has. A queued council takes its
   copies when it starts, so `wsh council start` prints the warnings only for a council that starts at once; the side
   file carries them always.
7. **The rewrite command is `wsh council redoc [--project <dir>] [--dry-run]`.** It lists the project's councils
   (`CouncilListCommand`), re-saves each one whose `docpath` names a report under the project's `docs/council/`
   (`CouncilSaveDocCommand` with that path), and lists the reports no record names as left untouched. It adds no RPC.
   It renders through the running wavesrv, so it writes the new layout only once this build is installed; running it
   on mit-thesis and the five Vietnamese re-summaries (`wsh council summarize <id>`, ~0.5M tokens through the Token
   burn gate) wait for the person after install (`docs/hand-checks.md`).
8. **Cockpit Report.** Under the cover: Việc cần làm, Số liệu, What it settled (Memory), the direction cards (they keep
   Brainstorm this / Ask again), kept ideas, Final proposal, Ask next (its buttons fill the composer, so it stays), then
   a folded "About the council" holding At a glance and the figures that did not check out, then What it spent as
   today. Jump links: To do, Figures (when any), Directions, …; At a glance leaves the jump links. The table headings
   follow the council's language, as in the `.md`.
9. **HarnessVersion** becomes `2026-11-23.1`: the seat and synthesis prompts change.
10. **CHANGELOG** gets `Changed` lines (the report layout, the cockpit Report) and `Added` lines (brief copies,
    `wsh council redoc`), none marked big: the Report is an existing view redrawn, and a big line needs its picture in
    the tree before the line lands.
