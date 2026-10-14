# Setup → Project tab — design

One place in the app that lists every file that shapes a Claude Code agent in a project, and reads any of them in a
rail, so the person no longer opens them from a terminal.

## Problem

- Setup already shows what every harness shares: Instructions edits the vault's `steering/AGENTS.md`, Skills lists
  every harness's skills. The details rail links the project's `CLAUDE.md`/`AGENTS.md` (`instructionsfile.ts`).
- Nothing in the app shows the project-level files: Claude's project memory (`~/.claude/projects/<slug>/memory/`),
  `.claude/settings*.json` and its hooks, `.mcp.json`, project skills, agents and commands, `.arc/setup`. Reading them
  means a terminal and knowing where each lives; the memory folder's name is a slug of the path.

## Scope

- In: Claude Code's files for one registered project, plus the two global files that also apply to it.
- Out: other harnesses (pi, codex, opencode, agy); editing or deleting files; watching files for changes.

## Decisions

### 1. A fourth Setup tab, list on the left, rail on the right

`SetupTab` gains `"project"` (label "Project"), after Tools. The tab follows the Skills tab's layout: a list, and a
440px read-only rail (`SkillRail`'s shape) for the selected file. Choosing a file never switches to Code.

The projects sit in a narrow column left of the list, as the Instructions tab's file column does (the app has no
dropdown to reuse). Its rows are the registry (`projectListAtom`, `projectsstore.ts`); it starts on the app bar's
project filter (`projectFilterAtom`) and on the first project when the filter is "all".

### 2. Six groups, empty ones still shown

| Group | Files |
|---|---|
| Instructions | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`; the one Claude reads (first that exists in `instructionCandidates` order) is marked, and so is `CLAUDE.local.md` when it exists, since Claude loads it beside that one |
| Memory | `~/.claude/projects/<slug>/memory/*.md`: `MEMORY.md` first, then the rest grouped by frontmatter `type` (user, feedback, project, reference, then untyped) |
| Settings | `.claude/settings.json`, `.claude/settings.local.json`, `.mcp.json`; settings rows note their hook count, `.mcp.json` its MCP server count ("2 MCP servers") |
| Skills & agents | `.claude/skills/*/SKILL.md`, `.claude/agents/*.md`, `.claude/commands/*.md` |
| Setup | `.arc/setup` |
| Global (folded) | `~/.claude/CLAUDE.md`, `~/.claude/settings.json` |

A group with nothing in it shows one muted "—" row, so a missing file reads as missing rather than forgotten. Each
row shows its label, its note (hook count, MCP server count, "invalid JSON", "Claude reads this") and its age.
Memory rows show no note: their type is the head of the section they sit under (user, feedback, project, reference,
other).

### 3. One Go RPC builds the list

New package `pkg/claudecontext`, pure `Scan(projectPath, home string) ([]File, error)`; it errors when the project's
folder does not exist. The handler copies each `File` into the wire type, which lives in wshrpc only:

```go
type ClaudeContextFile struct {
    Group       string `json:"group"` // instructions | memory | settings | skills | setup | global
    Path        string `json:"path"`  // absolute
    Label       string `json:"label"` // as shown: relative to the project, or ~/…
    Exists      bool   `json:"exists"`
    Size        int64  `json:"size,omitempty"`
    ModTs       int64  `json:"modts,omitempty"` // epoch ms
    Note        string `json:"note,omitempty"`
    Description string `json:"description,omitempty"`
}
```

- Memory folder: `agentobserve.SlugifyCwd(projectPath)`. A slug whose drive letter differs only in case (`d--…`,
  `D--…`) names the same folder on Windows and macOS, whose file systems ignore case, so one folder is read.
- Memory rows read `type` (top-level or under `metadata:`) and `description` from frontmatter.
- Settings rows count the entries under `hooks`; a file that does not parse gets the note "invalid JSON".
- `ClaudeContextCommand(ctx, CommandClaudeContextData{Path}) (*CommandClaudeContextRtnData, error)` sits in
  `wshrpctypes_agentsync.go` beside `AgentSyncSkillsCommand`, with its handler in `wshserver_agentsync.go`; then
  `task generate`. A path that does not exist is an error.

Go owns this because the slug rule already lives there; the frontend would otherwise copy it.

### 4. Frontend pieces

- `claudecontextmodel.ts` (pure, `claudecontextmodel.test.ts`): order groups and rows, add the "—" rows, split memory
  by type, pick the default project.
- `setupstore.ts`: the project, the scan result and the selected path as atoms, so they survive a surface switch;
  `loadClaudeContext(project, path)` (a response a newer load overtook is dropped), `reloadClaudeContext()` for ↻,
  `selectContextProject(name)` (clears the selected file) and `selectContextFile(path)`. With no registered project
  the tab shows "No projects yet".
- `projectcontexttab.tsx`: the list and the rail (`setupsurface.tsx` is past 800 lines). The rail reads the file with
  `useFileText`: markdown through `Markdown` with `FrontmatterCard`, JSON and `.arc/setup` as a code block. Its head
  shows the full path and a copy button.
- Loads on opening the tab, on changing project, and on a ↻ button. No watcher.

### 5. Errors

- The project's path is gone: a banner, no list.
- A file that cannot be read: the rail says so.
- Invalid JSON: the rail shows the raw text, the row carries the "invalid JSON" note.

## Testing

- `go test ./pkg/claudecontext`: temp project and home dirs; missing files; the memory folder under the project's
  slug; frontmatter type and description, both shapes; hook count; invalid JSON.
- `npx vitest run frontend/app/view/agents/claudecontextmodel.test.ts`.
- CDP scenario `setup-project` in `scripts/cdp/scenarios.mjs`: open Setup → Project, select a memory file, shoot the
  rail; assert the six group headings.
- `CHANGELOG.md`: one `Added` line.

## Related

- `2026-10-14-learned-additions-design.md` marks memory the user taught; once it ships, this tab's memory rows can
  carry that mark.
