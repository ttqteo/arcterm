# Brainstorm ideas implementation plan

**Spec:** `docs/superpowers/specs/2026-10-14-brainstorm-ideas-design.md` (read it first)

**Verify:** `node scripts/verify.mjs ./pkg/ideastore ./pkg/wshrpc/... ./pkg/wps ./pkg/tsgen ./cmd/wsh/cmd ./skills ./pkg/agentsync`

**Check:** `go vet ./pkg/ideastore/... ./pkg/wshrpc/... && node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit`

**Final:** `node scripts/cdp/final-verify.mjs ideas-rail`

**Prototype:** D:\work\arcterm\.superpowers\design\brainstorm-ideas\project

**Goal:** While the user brainstorms with an agent, the agent records ideas, decisions and open questions with
`wsh idea add`; the user adds, edits, merges and drops them; the details rail shows them as an Ideas count that opens
an Ideas section, with an unread dot, so the user can catch up.

**Architecture:** A new Go package `pkg/ideastore` keeps one JSON file per agent session under the data dir. wshrpc
commands (`ideaadd`, `idealist`, `ideaupdate`, `ideatick`) expose it to `wsh` and the frontend, and every change
publishes an `ideas:changed` event. The frontend keeps a per-session atom, a pure `ideasmodel.ts` groups and counts,
and the details rail gains an `ideas` count and section. The Claude mod nudges the agent when ideas stop coming, and a
shipped skill tells it when to write.

**Tech stack:** Go (wshrpc, wps, cobra), React 19 + jotai + Tailwind 4, vitest, the Claude mod engine
(`claude/arc-mod`), CDP scenarios.

## Worker and reviewer brief

- Read `AGENTS.md` and `DESIGN.md`. Colours are `@theme` tokens only; the canvas boards under **Prototype** are the
  look (copy their structure, take values from `frontend/tailwindsetup.css`).
- Never hand-edit generated files; after changing a wshrpc type or event, run `task generate`.
- Pure logic goes in a `.ts` with a `.test.ts` beside it; `.tsx` stays thin. No jsdom tests.
- Typecheck with `node --stack-size=4000 node_modules/typescript/lib/tsc.js --noEmit` (never `npx tsc`), with a
  timeout over 2 minutes.
- Check formatting only on files you touched (`gofmt -l <files>`, `npx prettier --check <files>`); never `--write`
  the tree; never prettier `scripts/*.mjs`.
- Commit with a pathspec (`git add -- <new files> && git commit -m "…" -- <paths>`); no Co-Authored-By trailer.

### Task 1: `pkg/ideastore`

**Depends on:** none
**Files:** `pkg/ideastore/ideastore.go`, `pkg/ideastore/ideastore_test.go`

**Where:**
- Create: `pkg/ideastore/ideastore.go`, `pkg/ideastore/ideastore_test.go`

The store follows `pkg/notestore/notestore.go`: a package `mu sync.Mutex`, a `rootOverride string` for tests, writes
through `fileutil.AtomicWriteFile` after `os.MkdirAll`. Its root is `filepath.Join(wavebase.GetWaveDataDir(), "ideas")`.

```go
type Idea struct {
    ID      string `json:"id"`      // "i1", "i2"… unique within the session
    Text    string `json:"text"`
    Kind    string `json:"kind"`    // KindDecision | KindIdea | KindQuestion
    By      string `json:"by"`      // ByAgent | ByYou
    Turn    int    `json:"turn,omitempty"` // prompts submitted when it was added; 0 = not known
    Ts      int64  `json:"ts"`      // epoch ms
    Dropped bool   `json:"dropped,omitempty"`
}

type SessionIdeas struct {
    SessionId string  `json:"sessionid"`
    SeenAt    int64   `json:"seenat"`
    Prompts   int     `json:"prompts"`   // UserPromptSubmit count, from Tick
    LastIdeaPrompt int `json:"lastideaprompt"` // Prompts when the last idea was added
    NudgedAt  int     `json:"nudgedat"`  // Prompts when the last nudge went out
    NextId    int     `json:"nextid"`
    Ideas     []Idea  `json:"ideas"`
}
```

Functions (each takes `mu`, reads `<root>/<sessionid>.json`, a missing file reads as empty):

- `Add(sessionId, text, kind, by string) (Idea, error)` — trims text; rejects empty text, an unknown kind or by, and a
  session id that is not a safe file name (`^[A-Za-z0-9_-]{1,128}$`). Sets `Turn = Prompts` (0 when 0),
  `LastIdeaPrompt = Prompts`, `Ts = now()`.
- `List(sessionId string) (SessionIdeas, error)`
- `Update(sessionId string, op Op) error` where `Op{Kind: "edit"|"kind"|"drop"|"restore"|"merge"|"seen", Ids []string,
  Text, NewKind string}`:
  - `edit`: one id, new text (trimmed, non-empty). `kind`: one or more ids, `NewKind`.
  - `drop` / `restore`: set `Dropped`.
  - `merge`: two or more ids; the oldest (by `Ts`, then id) keeps its kind and gets the texts of all, oldest first,
    joined with `"; "`; the others are dropped.
  - `seen`: `SeenAt = now()`.
  - An unknown id is an error naming it.
- `Tick(sessionId string) (nudge string, err error)` — increments `Prompts` in memory; persists only when the session's
  file exists (a session with no ideas leaves no file). Returns
  `fmt.Sprintf("%d turns since the last idea was recorded; record new ideas, decisions or open questions with wsh idea add.", gap)`
  when the file has at least one idea not dropped, `gap := Prompts - LastIdeaPrompt >= 3` and
  `Prompts - NudgedAt >= 3`; then sets `NudgedAt = Prompts`. Otherwise `""`. For a session with no file, keep the
  count in a package map so the first idea's `Turn` is right; it is lost on restart, which is fine (`Turn` 0).

**Steps:**
1. Write `ideastore_test.go` first, with `rootOverride = t.TempDir()` and a fixed `now`: add/list round trip; ids
   increase; empty text, bad kind, bad session id rejected; edit, kind, drop, restore; merge order and kind; unknown id
   error; seen sets `SeenAt`; Tick returns "" with no file, "" under 3 prompts, the nudge at 3, "" again at 4 and 5, the
   nudge again at 6; an add resets the gap; 20 concurrent `Add`s keep 20 ideas with distinct ids.
2. Run `go test ./pkg/ideastore` — fails (no package).
3. Implement `ideastore.go`.
4. Run `go test ./pkg/ideastore` — passes. `gofmt -l pkg/ideastore` prints nothing.
5. Commit `feat(ideas): ideastore keeps a session's ideas in one JSON file`.

### Task 2: RPC, event and `wsh idea`

**Depends on:** Task 1
**Files:** `pkg/wshrpc/wshrpctypes_idea.go`, `pkg/wshrpc/wshserver/wshserver_idea.go`, `pkg/wshrpc/wshserver/wshserver_idea_test.go`, `cmd/wsh/cmd/wshcmd-idea.go`, `cmd/wsh/cmd/wshcmd-idea_test.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wps/wpstypes.go`, `pkg/tsgen/tsgenevent.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `frontend/types/waveevent.d.ts`

**Where:**
- Create: `pkg/wshrpc/wshrpctypes_idea.go`, `pkg/wshrpc/wshserver/wshserver_idea.go`,
  `pkg/wshrpc/wshserver/wshserver_idea_test.go`, `cmd/wsh/cmd/wshcmd-idea.go`, `cmd/wsh/cmd/wshcmd-idea_test.go`
- Modify: `pkg/wshrpc/wshrpctypes.go:52` (embed `IdeaCommands` beside `NoteCommands`), `pkg/wps/wpstypes.go:17-44`
  (constant + `AllEvents`), `pkg/tsgen/tsgenevent.go:23` (`WaveEventDataTypes` entry)
- Generated by `task generate`: `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`,
  `frontend/types/gotypes.d.ts`, `frontend/types/waveevent.d.ts`

Types (`wshrpctypes_idea.go`, shaped like `wshrpctypes_note.go`):

```go
type IdeaCommands interface {
    IdeaAddCommand(ctx context.Context, data CommandIdeaAddData) (*ideastore.Idea, error)
    IdeaListCommand(ctx context.Context, data CommandIdeaTargetData) (*ideastore.SessionIdeas, error)
    IdeaUpdateCommand(ctx context.Context, data CommandIdeaUpdateData) error
    IdeaTickCommand(ctx context.Context, data CommandIdeaTargetData) (*CommandIdeaTickRtnData, error)
}
type CommandIdeaTargetData struct {
    BlockId   string `json:"blockid,omitempty"`
    SessionId string `json:"sessionid,omitempty"`
}
type CommandIdeaAddData struct {
    CommandIdeaTargetData
    Text string `json:"text"`
    Kind string `json:"kind"`
    By   string `json:"by"`
}
type CommandIdeaUpdateData struct {
    CommandIdeaTargetData
    Op      string   `json:"op"`
    Ids     []string `json:"ids,omitempty"`
    Text    string   `json:"text,omitempty"`
    NewKind string   `json:"newkind,omitempty"`
}
type CommandIdeaTickRtnData struct {
    Nudge string `json:"nudge,omitempty"`
}
// the data of the ideas:changed event
type IdeasChangedData struct {
    SessionId string `json:"sessionid"`
}
```

If embedding a struct does not generate cleanly in TS, flatten the two target fields into each struct instead.

Server (`wshserver_idea.go`):
- `resolveIdeaSession(ctx, target)`: `SessionId` wins; else read the block
  (`wstore.DBMustGet[*waveobj.Block](ctx, blockId)`, as `pkg/jarvis/onexit.go:117`) and take the base name of
  `Meta.GetString(waveobj.MetaKey_AgentTranscriptPath, "")` without `.jsonl`. No path:
  `errors.New("no agent session in this terminal yet")`.
- Add, Update publish `wps.Broker.Publish(wps.WaveEvent{Event: wps.Event_IdeasChanged, Data: IdeasChangedData{SessionId}})`
  (pattern: `pkg/blockcontroller/blockcontroller.go:452`, no scopes). Tick publishes only when it returns a nudge.
- Event: `Event_IdeasChanged = "ideas:changed" // type: wshrpc.IdeasChangedData`, added to `AllEvents` and
  `WaveEventDataTypes` (`pkg/tsgen/tsgenevent_test.go` enforces the map).

`wsh idea` (`wshcmd-idea.go`, shaped like `wshcmd-note.go`; the target is `WAVETERM_BLOCKID` unless `--session` is
given):
- `wsh idea add "<text>" [--kind idea|decision|question] [--by agent|you] [--json]` — default kind `idea`, by `agent`;
  prints `idea <id> added`.
- `wsh idea list [--json]` — one line per idea not dropped: `<id>\t<kind>\t<text>`.
- `wsh idea update <id...> --kind <kind> | --text <text> | --drop | --restore | --merge` — exactly one action.
- `wsh idea tick --session <id>` — prints the nudge, or nothing (used by the Claude mod).

**Steps:**
1. Write `wshserver_idea_test.go`: resolution from a session id, from a block whose meta has
   `C:\x\proj\abc-123.jsonl` → `abc-123`, and the no-session error. Write `wshcmd-idea_test.go` for flag validation
   (zero or two actions on update is an error; bad kind is an error) in the style of `wshcmd-note_test.go`.
2. Run them — they fail.
3. Add the types, event, server and command; run `task generate`.
4. Run `go test ./pkg/wshrpc/... ./pkg/tsgen ./cmd/wsh/cmd -run 'Idea|Event'` and `go build ./cmd/...` — pass.
5. Commit `feat(ideas): wsh idea and its RPC, with an ideas:changed event`.

### Task 3: The agent writes ideas: skill, nudge, `/idea`

**Depends on:** Task 2
**Files:** `skills/ideas/SKILL.md`, `skills/skills.go`, `skills/skills_test.go`, `claude/arc-mod/hooks/ideas-core.ts`, `claude/arc-mod/hooks/ideas-core.test.ts`, `claude/arc-mod/hooks/register.ts`, `claude/arc-mod/commands/idea.md`, `cmd/wsh/cmd/claude-mod/**`

**Where:**
- Create: `skills/ideas/SKILL.md`, `claude/arc-mod/hooks/ideas-core.ts`, `claude/arc-mod/hooks/ideas-core.test.ts`,
  `claude/arc-mod/commands/idea.md`
- Modify: `skills/skills.go:10` (add `ideas` to the `//go:embed` list), `skills/skills_test.go` if it lists skills,
  `claude/arc-mod/hooks/register.ts:333-337` (the `classic.UserPromptSubmit` handler)
- Regenerated by `task sync:claudemod`: the tracked copy under `cmd/wsh/cmd/claude-mod/` (commit it with the rest)

`skills/ideas/SKILL.md`:
- Frontmatter `name: ideas`, `description: Use when brainstorming, designing or weighing options with the user —
  record each decision, idea and open question as it comes up, via \`wsh idea add\`.`
- Body: record one line per item, in the conversation's language, as soon as it is said (a decision when the user
  settles something, an idea when a direction is floated, a question when one is left open); run `wsh idea list`
  first and do not repeat one; when the user settles an open question, `wsh idea update <id> --kind decision` (and
  `--text` if the answer changes it); never batch a turn's ideas into one line. The commands with their flags.

Nudge: the 3-prompt rule lives in `ideastore.Tick` (Task 1, Go-tested). `ideas-core.ts` holds the mod's side, with
its effects injected so vitest drives it whole:
- `nudgeRow(nudge: string): string | null` — null for empty or whitespace; otherwise the row text, prefixed `arc: `.
- `promptNudge(io: { run(argv: string[]): Promise<string>; append(text: string): Promise<void>; log(msg: string): void }, wsh: string, sessionId: string): Promise<void>`
  — runs `[wsh, "idea", "tick", "--session", sessionId]`; when `nudgeRow` of the output is non-null, appends it; a
  failed run or append is logged with `log` and never thrown (the prompt must not block on it).

In `register.ts`, the `classic.UserPromptSubmit` handler, only when `active`, calls `promptNudge` with `$.process.run`
(its output text), an `append` that wraps `$.session.append({ message: { type: "user", content: [{ type: "text", text }] } })`
and throws on `kept.deny` the way `lintMemoryDir` does (`register.ts:263-268`), and `$.ui.log(…, { to: "debug" })`;
then `return next(e)`. What the model does with the row, and with `/idea`, is model behaviour this run does not
verify: no hand-check line; the lead lists it as an open issue.

`claude/arc-mod/commands/idea.md`: a Claude Code plugin command. Frontmatter `description: Record the idea just
discussed in arcterm's Ideas list`. Body: sum up the idea, decision or open question just discussed in one line, in
the conversation's language, and record it with `wsh idea add "<line>" --kind <kind> --by you`; with arguments
(`$ARGUMENTS`), record those words instead. Check `claude plugin validate claude/arc-mod` accepts the `commands/`
folder, and that `task sync:claudemod` copies it (it copies the folder minus tests).

**Steps:**
1. Write `ideas-core.test.ts`: `nudgeRow` (empty and whitespace → null; a nudge → `arc: …`); `promptNudge` with fakes —
   the argv it runs, one append with the `arc: ` text when tick prints a nudge, no append when it prints nothing, a
   rejected run and a rejected append each logged once and not thrown. Run
   `npx vitest run claude/arc-mod/hooks/ideas-core.test.ts` — fails.
2. Implement `ideas-core.ts`, wire `register.ts`, write the skill and the command, update the embed line.
3. Run the vitest file, `go test ./skills ./pkg/agentsync`, `claude plugin validate claude/arc-mod` — pass.
4. Run `task sync:claudemod`; check `cmd/wsh/cmd/claude-mod/` now holds `hooks/ideas-core.ts`, the new `register.ts`
   and `commands/idea.md` (and no test file).
5. Commit `feat(ideas): the ideas skill, a nudge when ideas stop, and /idea`, with the `cmd/wsh/cmd/claude-mod/` copy.

### Task 4: The Ideas count and section on the details rail

**Depends on:** Task 2
**Files:** `frontend/app/view/agents/ideasmodel.ts`, `frontend/app/view/agents/ideasmodel.test.ts`, `frontend/app/view/agents/ideasstore.ts`, `frontend/app/view/agents/ideassection.tsx`, `frontend/app/view/agents/agentrailsections.ts`, `frontend/app/view/agents/agentrailsections.test.ts`, `frontend/app/view/agents/agentrailpanel.tsx`, `frontend/app/view/agents/agentdetailsrail.tsx`, `frontend/app/view/agents/railicons.tsx`, `frontend/app/view/agents/sessionsdetail.tsx`, `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

**Where:**
- Create: `frontend/app/view/agents/ideasmodel.ts`, `frontend/app/view/agents/ideasmodel.test.ts`,
  `frontend/app/view/agents/ideasstore.ts`, `frontend/app/view/agents/ideassection.tsx`
- Modify: `frontend/app/view/agents/agentrailsections.ts:16-60` (`ideas` stat), its test,
  `frontend/app/view/agents/agentrailpanel.tsx:137-153` (`STAT_ICON.ideas = Lightbulb`, `STAT_LABEL.ideas = "Ideas"`,
  the unread dot), `frontend/app/view/agents/agentdetailsrail.tsx:672-751` (`railInput`, `LABEL`, `ICON`, `CONTENT`),
  `frontend/app/view/agents/railicons.tsx` (an `ideas` icon), `frontend/app/view/agents/sessionsdetail.tsx`
  (`SoloDetail`, the ended session), `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`

Model (`ideasmodel.ts`, pure):
- `sessionIdFromTranscript(path?: string): string | null` — base name without `.jsonl`, either slash.
- `groupIdeas(s: SessionIdeas): { decided: Idea[]; ideas: Idea[]; open: Idea[]; dropped: Idea[] }` — newest first in
  each; dropped ones only in `dropped`.
- `ideaCounts(s): { live: number; fresh: number }` — `fresh` counts live ideas with `ts > seenat`.
- `isFresh(idea, seenAt)`; `ideaMeta(idea): string` → `turn 4 · agent` / `you` (no turn part when `turn` is 0).

Store (`ideasstore.ts`): an `atomFamily` by session id holding `SessionIdeas | null`; `loadIdeas(sessionId)` calls
`RpcApi.IdeaListCommand`; one `waveEventSubscribeSingle({ eventType: "ideas:changed", … })` (pattern:
`agentaskstore.ts:40`) reloads the session named in the event if its atom was ever read; `updateIdeas(sessionId, op)`
calls `IdeaUpdateCommand`; `addIdea(sessionId, text, by)`.

Rail:
- `AgentRailStatId` gains `"ideas"`, `AgentRailInput` gains `ideas: number` and `ideasFresh: number`; `ideas` is the
  first stat, absent at 0 (the existing filter does that); `AgentRailStat` gains `fresh?: boolean`.
- In `planAgentRail` the `ideas` section goes right after `needs`.
- `RailStats` draws a 6px dot (`bg-primary`, a `border-surface` ring) on the Lightbulb while `fresh`; its title reads
  `Ideas: 9, 4 new`.
- `agentdetailsrail.tsx`: derive the session id from `agent.transcriptPath`; feed `railInput.ideas` / `ideasFresh`
  from the store; `CONTENT.ideas` renders `<IdeasSection sessionId=… />`.
- `ideassection.tsx` draws `Main.dc.html`'s section: header extras `N new` and **Mark read** (op `seen`); groups
  Decided / Ideas / Open with their counts; rows with text, meta and a `New` pill; hover actions Edit, Mark as decided,
  Drop; checkboxes on hover, and with any checked the bar `N selected · Merge · Drop` and Esc to clear
  (`Ideas-EditMerge.dc.html`); inline edit with the Decided / Idea / Open choice, Ctrl+Enter saves, Esc cancels;
  Dropped folded with Restore; the **Add an idea** input (Enter adds as `by: "you"`, kind `idea`).
- Marking read on leave: when the section unmounts or closes while it showed fresh ideas, send `seen`.
- A session whose list is empty shows no count and no section; a load error shows nothing (the rail stays as today)
  and logs.
- Every interactive element carries a `data-ideas-*` attribute (section, group, row with its id, each hover action,
  checkbox, selection bar and its buttons, edit box and kind choice, Dropped fold, Restore, add input, Mark read) so
  the scenario can find it.

Ended session (spec decision 2: "an ended session opened from Conversation History shows it"): `SoloDetail`
(`sessionsdetail.tsx:404`, what the `session` centre mode and History draw) renders `<IdeasSection>` for the session
id taken from the session's transcript path (`sessionIdFromTranscript`; the field is on `LiveSession`,
`sessionsarchivestore.ts`), between the header and `SessionBody`. It is folded by default to one line `Ideas · N`
that expands, and is absent when the session has no ideas. Opening it does not mark the ideas read (only the rail
does).
Scenario `ideas-rail` in `scripts/cdp/scenarios.mjs` (shape: `surfaceSmoke` at `:88`; the real-terminal agent
follows the `rail-workflow` arrange at `:28790-28850`):
- Arrange: `openRailTerminal` a project terminal; set its tab's meta `session:agent: claude` and its block's meta
  `agent:transcriptpath` to `<temp>/ideas-fixture.jsonl`; write a fixture roster (`TREE_RAIL_FIXTURE`, as `rwfRoster`
  does) with one Claude agent whose `blockId` is that terminal's block and whose `transcriptPath` is the same path;
  reload, go to Agent, show the agent and wait for its shell (`uploadsShellUp`). No ideas yet.
- Seeding (in step 2, through `h.rpc` on session `ideas-fixture`, the texts from `Main.dc.html`): `ideatick` twice,
  add decided d1; `ideatick`, add decided d3, ideas i2, i3 (`by: "you"`), open o1, and one more idea then `drop` it;
  `ideaupdate` op `seen`; wait 5 ms; `ideatick`, add d2, i4, o2; `ideatick`, add i1. That is 9 live (3 decided, 4
  ideas, 2 open), 4 after `seenat`, 1 dropped, with turns 2-5 as the board shows.

Steps, each with a screenshot and an assertion read from the DOM (and, where it says so, from `idealist`):
1. "absent at 0" — before seeding the strip has no Lightbulb count (`Tab-Unread.dc.html`, the no-ideas state).
2. "count with unread dot" — seed; the strip shows the Lightbulb count `9` with its dot and the title
   `Ideas: 9, 4 new` (`Tab-Unread.dc.html`).
3. "ideas section open" — click the count: the section shows Decided 3 / Ideas 4 / Open 2, `4 new`, four `New`
   pills, and the row metas `turn N · agent|you` (`Main.dc.html`).
4. "hover actions" — hover a row: Edit, Mark as decided, Drop and its checkbox show.
5. "inline edit" — Edit an idea row, change its text, pick Open, Ctrl+Enter: the row is in Open with the new text
   (and `idealist` agrees). Edit another, press Esc: unchanged.
6. "mark as decided" — Mark as decided on an Open row: it moves to Decided; the group counts follow.
7. "select and merge" — check two rows: the bar reads `2 selected · Merge · Drop`; with one row's edit open, screenshot
   (`Ideas-EditMerge.dc.html`). Merge: one row remains holding both texts oldest first joined by `; `, the other is in
   Dropped, the count is one less. Check a row and press Esc: the selection clears.
8. "drop" — Drop a row from its hover actions: the count is one less and the Dropped fold's count one more.
9. "dropped open" — expand Dropped: each row shows Restore (`Ideas-EditMerge.dc.html`, Dropped open); Restore one: it
   is back in its group and the count one more.
10. "add an idea" — type in Add an idea, Enter: a new row in Ideas with meta `you`; the count one more; the input empty.
11. "mark read clears dot" — Mark read: the dot, `N new` and the pills are gone.
12. "leaving marks read" — `ideaadd` one idea by agent: the dot is back; switch the rail to its other tab: `idealist`'s
    `seenat` is past that idea's `ts` and the dot is gone.
13. "ended session" — write an ended transcript `ideas-ended.jsonl` the way the `usage-insights` arrange does
    (`:3600-3700`) so it is in Conversations, `ideaadd` two ideas for `ideas-ended`, open it from Conversations: the
    session view shows the folded `Ideas · 2`; expand it: both rows show.

Teardown: close the terminal tab, restore the previous roster fixture, delete the `ideas-fixture.json` and
`ideas-ended.json` idea files and the temp transcripts.
- `CHANGELOG.md` under `Added` in the top section (open `## Unreleased` if it has a date): "Ideas on the agent's
  rail: while you brainstorm, the agent lists what was decided, floated and left open, and you can add, edit, merge
  or drop ideas."

**Steps:**
1. Write `ideasmodel.test.ts` (grouping, order, counts, fresh, meta, transcript path parsing, both slashes) and extend
   the `agentrailsections` test (ideas first, absent at 0, section after needs, `fresh` passed through). Run
   `npx vitest run frontend/app/view/agents/ideasmodel.test.ts frontend/app/view/agents/agentrailsections.test.ts` — fail.
2. Implement the model, then the store, the rail wiring and the section.
3. Run the two test files — pass; run the typecheck (see brief).
4. In the dev app run `task verify:ui -- ideas-rail` — PASS, and look at each step's shot against its board.
5. Commit `feat(ideas): the Ideas count and section on the agent's rail`.

### Task 5: Capture a selection as an idea

**Depends on:** Task 4
**Files:** `frontend/app/view/agents/ideacapture.ts`, `frontend/app/view/agents/ideacapture.test.ts`, `frontend/app/view/agents/ideacapturechip.tsx`, `frontend/app/view/term/termwrap.ts`, `frontend/app/view/term/term.tsx`, `frontend/app/view/agents/ideassection.tsx`, `frontend/app/view/agents/ideasstore.ts`, `frontend/app/view/agents/agentdetailsrail.tsx`, `frontend/app/cockpit/notificationstore.ts`, `frontend/app/cockpit/notificationstore.test.ts`, `frontend/app/cockpit/notificationtoasts.tsx`, `frontend/app/store/keybindings/bindings.ts`, `docs/keyboard-shortcuts.md`, `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/superpowers/specs/2026-10-14-brainstorm-ideas-design.md`

**Where:**
- Create: `frontend/app/view/agents/ideacapture.ts`, `frontend/app/view/agents/ideacapture.test.ts`,
  `frontend/app/view/agents/ideacapturechip.tsx`
- Modify: `frontend/app/view/term/termwrap.ts:504-520` (selection hook), `frontend/app/view/term/term.tsx` (mounts the
  chip over the terminal), `frontend/app/view/agents/ideassection.tsx` + `ideasstore.ts` (a request atom: open the
  Ideas section and focus its input), `frontend/app/view/agents/agentdetailsrail.tsx` (opens the `ideas` section on
  that request, the way `railStatClick` does), `frontend/app/cockpit/notificationstore.ts` + its test +
  `notificationtoasts.tsx` (an optional `action?: { label: string; run: () => void }` on `ToastNotification`, drawn as
  a button that runs it and closes the toast), `frontend/app/store/keybindings/bindings.ts` (`buildGlobalBindings`,
  `:227`), `docs/keyboard-shortcuts.md`, `scripts/cdp/scenarios.mjs` (`ideas-rail`), `CHANGELOG.md`, the spec's
  shortcut line only if the key changes

Behaviour (`Capture-Selection.dc.html`):
- Selecting still copies (`term:copyonselect` untouched).
- In a terminal whose block meta has `agent:transcriptpath` (the session is `sessionIdFromTranscript` of it), a
  non-empty selection shows the chip **Add as idea** with
  the shortcut keycap beside the selection's end. It never takes focus; it goes when the selection clears, a key is
  typed, or the terminal scrolls.
- Clicking it or pressing the shortcut adds the trimmed selection (whitespace runs collapsed, at most 500 chars) as
  `kind: idea, by: you`, clears the selection and shows the toast **Added to Ideas · Undo** (`pushToast` with
  `ttlMs: 5000` and the `Undo` action); Undo drops it (op `drop`).
- The shortcut with no selection opens the agent's Ideas section and focuses its input.
- Binding: `{ id: "idea-capture", keys: "Mod:Shift:i", group: "Global", label: "Add the selection as an idea", … }`
  in the style of `open-tool` (`bindings.ts:378-387`). In the dev app, check that WebView2's DevTools does not take
  Ctrl+Shift+I first; if it does, use `Mod:Shift:y` and change the spec's line to match.

Pure part (`ideacapture.ts`): `cleanSelection(text): string | null` (collapse, trim, cap, null when empty);
`chipVisible({ hasSelection, hasSession, typedSinceSelect })`; `captureAction({ selection, sessionId })` →
`"add" | "open-input" | "none"`.

The chip's position comes from xterm's selection (`terminal.getSelectionPosition()` → cell → pixels using the
renderer's cell size); keep that arithmetic in `ideacapture.ts` and test it.

Scenario: extend `ideas-rail` (Task 4's real terminal, whose block meta carries `agent:transcriptpath`) with these
steps after Task 4's, each with a screenshot; N is the count Task 4's steps leave:
14. "selection chip" — print a line in the terminal (`echo` through the block's input, as other scenarios drive a
    shell), select it with a CDP mouse drag over the xterm: the chip shows by the selection's end (`Capture-Selection.dc.html`).
    Type a key: the chip is gone. Select again.
15. "shortcut adds" — press the shortcut: the toast **Added to Ideas · Undo** shows, the selection is cleared, the
    count is N+1, and `idealist` has the text with `by: "you"`.
16. "undo" — click Undo: the count is back to N and that idea is dropped in `idealist`.
17. "chip click adds" — select again, click the chip: the count is N+1.
18. "shortcut with no selection" — with nothing selected press the shortcut: the Ideas section is open and
    `document.activeElement` is its Add an idea input.

`docs/keyboard-shortcuts.md`: add the binding. `CHANGELOG.md` under `Added`: "Select text in an agent's terminal and
press Ctrl+Shift+I, or click Add as idea, to keep it in the agent's Ideas. <!-- try: idea-capture -->"

**Steps:**
1. Write `ideacapture.test.ts`, and extend `notificationstore.test.ts` for the toast action. Run
   `npx vitest run frontend/app/view/agents/ideacapture.test.ts frontend/app/cockpit/notificationstore.test.ts` — fail.
2. Implement the pure part, then the chip, the termwrap hook, the binding, the toast.
3. Run the test — pass; typecheck.
4. `task verify:ui -- ideas-rail` in the dev app — PASS, and look at the chip and toast shots.
5. Commit `feat(ideas): add a terminal selection as an idea`.
