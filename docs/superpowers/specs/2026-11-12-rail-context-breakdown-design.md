# Rail session block: what fills the context

Status: design approved 2026-11-12 (canvas `rail-context-breakdown`, boards `Main` and `States`).

## Problem

The Agent details rail's session block shows how full the context is (`7% · 70k in context`) and what the session
has spent (`718K ▬ ≈ $0.49`, opening a per-class table). It never says what the 70k is made of. Cache reads are
95% of a session's tokens because the whole context is re-read every turn, yet nothing shows which part of it is the
conversation (what Compact shrinks) and which part is loaded every turn whatever you do (tools, memory files, skills,
MCP). Claude Code's own `/context` shows that split, and links nothing; we want it in the rail, with a link that opens
each memory file and skill.

## Design

The session tile stays as it is today. Its figures (the context row and the tokens row) remain the one toggle, and the
breakdown still folds open under Compact/Clear — it is longer: a **Context** part above the existing **Spend** part.
`DESIGN.md`'s "the breakdown is the one part that folds" holds unchanged.

Folded (no change except one state):

- Context ring row, tokens row with spend and chevron, facts, tools, `idle 15m · cache 43m left` with Resume/Stop,
  Compact and Clear.
- **Cache expiring** (under 5 minutes left on a Claude agent): `cache 4m left` is drawn in `warning`, and a muted note
  sits at the end of the Compact/Clear row: `now rewrites ~49k, later 70k` (the first figure is the context with
  Messages replaced by an assumed 2k summary; see "Figures").

Open, Context part (`Context` label, rule, `70k of 1M`):

1. A stacked bar, 8px, one segment per group, of the context in use now.
2. One row per group: swatch, name, item count, a muted tag (`Compact shrinks` for Messages, `every turn` for the rest),
   tokens, percent of the context in use. In this order:
   - **Messages** (estimate; see "Figures"), not expandable.
   - **System tools**, expandable to a note: `Built in. 17.1k more are deferred: a tool search loads them when needed.`
   - **Memory files**, expandable to one row per file: name, `Type · folder`, tokens, and ↗ when the file opens.
   - **Skills**, expandable: a note (`Only each skill's description is in context; its file loads when it runs.`), then
     the 6 costliest skills (name, source, tokens, ↗ when resolved) and `+N more`, which lists the rest.
   - **System prompt**, not expandable.
   - **Custom agents**, expandable like Skills.
   - **MCP** (MCP tools + MCP server instructions), expandable to one row per server: `stitch · 18 tools deferred · 22.9k`.
   Every group starts folded.
3. Cache line: clock icon, `Cache warm 43m · after that the next turn rewrites these 70k` (the countdown the state row
   shows, the figure the old tooltip gave). Shown even before the breakdown is read: it needs only the countdown and the
   context in use.
4. `Free 927k · autocompact keeps 3k`, `read 2 min ago`, **Refresh**.

Open, Spend part: today's breakdown unchanged (insight, per-class table, per-model, footnote) under a `Spend` label with
`718K processed`.

States:

- **Not read yet** (no breakdown for this agent's folder in wavesrv's cache): empty bar, the line "What fills the 70k is
  read from Claude Code's /context. It runs between turns and adds nothing to the conversation.", and a secondary
  button **Read the breakdown**. The cache line and Spend still show.
- **Reading**: the button reads `Reading… about 30 s` and is disabled; the bar is a skeleton.
- **Failed** (no `claude` on PATH, a timeout, output that does not parse): `Couldn't read /context: <reason>.` and
  **Try again**.
- **Not a Claude agent**, or the context in use is unknown (asleep, after a restart): the Context part is left out, as
  the context row is today.

A ↗ opens the file in the rail's File tab (`openFileInPanel`). Built-in and `claude.ai sync` skills, built-in agents and
MCP servers have no file and no ↗.

## Data

`/context` runs headless and prints markdown:

```
claude -p --no-session-persistence /context
```

run in the agent's folder. Checked 2026-11-12 on Claude Code with Opus 5.5 (`pkg/ctxbreakdown/testdata/context-opus-1m.md`
is that output with local paths scrubbed):

- It calls no model and spends no tokens. It takes about **30 s** (it boots a full session: hooks, MCP connects).
- `--no-session-persistence` is required: without it every run leaves a 13-line transcript in `~/.claude/projects`,
  which Conversation History would list.
- Sections: `**Model:**`, `**Tokens:** 38.9k / 1m (4%)`, then `### Estimated usage by category` (Category | Tokens |
  Percentage), `### MCP Tools` (Tool | Server | Tokens; deferred tools included), `### Custom Agents` (Agent Type |
  Source | Tokens), `### Memory Files` (Type | Path | Tokens; full paths), `### Skills` (Skill | Source | Tokens;
  `~80` style, sources `User`, `Project`, `Plugin (<name>)`, `Built-in`, `claude.ai sync`).
- Token cells are `676`, `2.5k`, `958.1k`, `1m`, `~80`.
- A server that failed to connect is not listed.

It measures a **fresh** session in that folder, not the agent's: its Messages row is the `/context` call itself. What
is loaded every turn (tools, memory, skills, agents, MCP, system prompt) is the same for the same folder and config,
which is what the breakdown takes from it.

### Figures

- Context in use: `contextpct × contextmax` from the agent's status line (`pkg/baseds`), as today.
- Fixed part: the sum of the headless run's non-deferred categories other than Messages, Free space and Compact buffer.
- **Messages = context in use − fixed part**, floored at 0, labelled an estimate in its tooltip ("context in use minus
  what loads every turn; includes what hooks added").
- Free = window − context in use. Autocompact keeps = the Compact buffer row.
- The "now rewrites" figure = context in use − Messages + 2,000.

### Backend

New package `pkg/ctxbreakdown`:

- `Parse(md string) (*wshrpc.ContextBreakdown, error)`: the sections above; an unknown section or category is kept as a
  plain category, a missing table is empty, no categories table is an error.
- `ResolvePaths(b, cwd, home)`: fills a skill's or agent's `Path` when the file exists — User:
  `~/.claude/skills/<n>/SKILL.md`, `~/.claude/agents/<n>.md`; Project: the same under `<cwd>/.claude/`;
  `Plugin (arc)`: `~/.arc/claude-mod/skills/<n without arc:>/SKILL.md`; other plugins: the first match of
  `~/.claude/plugins/cache/*/<plugin>/*/skills/<n>/SKILL.md` (agents: `.../agents/<n>.md`). Anything else stays `""`.
- `Read(ctx, cwd, refresh)`: one in flight per folder (later callers wait for it), a 90 s timeout, results kept in
  memory 30 min per folder (an error 1 min); `refresh` skips the cache. The child gets wavesrv's environment without
  `WAVETERM_BLOCKID` and `WAVETERM_JWT`, so its hooks report into no block (a `-p` session's hooks are already treated
  as nested, `agentobserve.nestedSession`).

RPC `GetContextBreakdownCommand(CommandGetContextBreakdownData{Cwd, Refresh})` → `ContextBreakdown`
(`wshrpctypes_agents.go`, handler beside `GetTranscriptUsageCommand`), then `task generate`.

```go
type ContextBreakdown struct {
    Model        string            `json:"model"`
    WindowTokens int               `json:"windowtokens"`
    Categories   []ContextCategory `json:"categories"`   // in /context's order
    MemoryFiles  []ContextItem     `json:"memoryfiles"`  // Source = Type (User, AutoMem, Project, …), Path set
    Skills       []ContextItem     `json:"skills"`
    Agents       []ContextItem     `json:"agents"`
    McpServers   []ContextMcp      `json:"mcpservers"`   // per server, tools summed
    ReadAt       int64             `json:"readat"`       // unix ms
}
type ContextCategory struct { Name string `json:"name"`; Tokens int `json:"tokens"`; Deferred bool `json:"deferred,omitempty"` }
type ContextItem struct { Name string `json:"name"`; Source string `json:"source"`; Path string `json:"path,omitempty"`; Tokens int `json:"tokens"` }
type ContextMcp struct { Server string `json:"server"`; Tools int `json:"tools"`; Tokens int `json:"tokens"` }
```

### Frontend

- `view/agents/ctxbreakdown.ts` (pure, with tests): `contextGroups(b, liveTokens, windowTokens)` → the rows above
  (label, tokens, pct, tag, colour token, items, note, more), `messagesEstimate`, `cacheWarn(countdownMs)` (< 5 min),
  `rewriteNow(...)`, and the token label (`231`, `9.1k`, `927k`). A category `/context` adds later that the model
  does not know sums into an `Other` group, shown only when it is above 0.
- `view/agents/ctxbreakdownstore.ts`: an atom per folder `{state: idle|reading|ready|failed, data, error}`, `read(cwd,
  refresh)` with the stale-load guard `transcriptusagestore.ts` uses. Nothing reads on mount: only Read the breakdown
  and Refresh call it.
- `sessionsection.tsx`: the Context part above `UsageBreakdown`, a `Spend` label over the latter; props for the context
  in use, the cache countdown and an `onOpenFile(path)`.
- `agentdetailsrail.tsx`: passes those; the amber `cache Nm left` and the "now rewrites" note.
- Group colours reuse existing tokens, no new ones: Messages `conn-1`, System tools `cacheread`, Memory files
  `mem-feedback`, Skills `skill`, System prompt `ink-faint`, Custom agents `graphlane-5`, MCP `graphlane-2`.

## Cost

Reading spawns one `claude` process (a Node runtime, roughly 200–400 MB) for about 30 s, only on a click, at most once
per folder per 30 min. Nothing long-lived; no RAM watch row.

## Out of scope

- The agent's own exact breakdown (`--resume <id> /context`): it may write into that session's transcript; untested.
- Other runtimes (pi, codex, opencode).
- Telling a failed MCP server apart: `/context` does not list it.

## Verification

- Go: `Parse` on the testdata file and on edge cases (no tables, `~` and `m` suffixes, an unknown category);
  `ResolvePaths` over a temp home; `Read`'s cache, single flight and env (a fake `claude` on PATH).
- vitest: `ctxbreakdown.test.ts`.
- CDP scenario `rail-context-breakdown`: a seeded breakdown (dev-only seam), open the breakdown, see both parts, expand
  Memory files, click a ↗ and see the File tab; the not-read state; the amber cache state.
