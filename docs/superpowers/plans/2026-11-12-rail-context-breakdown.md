# Rail context breakdown Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The Agent details rail's session breakdown shows what fills a Claude agent's context (by source, with links
that open each memory file and skill) above today's spend table, plus a cache line and an expiring-cache warning.

**Architecture:** wavesrv runs `claude -p --no-session-persistence /context` in the agent's folder on demand, parses
the markdown into a `ContextBreakdown` (new `pkg/ctxbreakdown`), caches it per folder and serves it over one wshrpc
command. A pure frontend model (`ctxbreakdown.ts`) turns it plus the live context size into rows; `sessionsection.tsx`
draws them inside the existing breakdown fold.

**Tech Stack:** Go (wshrpc, os/exec), React 19 + jotai + Tailwind 4, vitest, CDP scenarios.

**Spec:** `docs/superpowers/specs/2026-11-12-rail-context-breakdown-design.md` — read it first; it holds the states,
copy and figures this plan implements.

**Verify:** `node scripts/verify.mjs ./pkg/ctxbreakdown/... ./pkg/wshrpc/...`
**Check:** `task check:ts`
**Final:** `node scripts/cdp/final-verify.mjs rail-context-breakdown agent-tree-rail`
**Prototype:** D:/work/arcterm/.superpowers/design/rail-context-breakdown/project

---

### Task 1: The wire contract (types, command, handler, generated TS)

**Depends on:** none
**Files:** `pkg/wshrpc/wshrpctypes_agents.go`, `pkg/wshrpc/wshserver/wshserver_agents.go`, `pkg/ctxbreakdown/read.go`, `pkg/wshrpc/wshclient/wshclient.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`

Contract first, so the rail (Task 4) can start on the generated types while Task 2 builds the reading behind them.

Files in detail:
- Modify: `pkg/wshrpc/wshrpctypes_agents.go` (the four wire types, the command's data type beside
  `CommandGetTranscriptUsageData` ~line 394, the command beside `GetTranscriptUsageCommand` in the interface),
  `pkg/wshrpc/wshserver/wshserver_agents.go` (the handler, beside `GetTranscriptUsageCommand` ~line 267)
- Create: `pkg/ctxbreakdown/read.go` holding only the package comment and a `Read` that returns an error (Task 2
  replaces its body)
- Generated (never hand-edit): run `task generate`

**Step 1: Add the wire types** to `wshrpctypes_agents.go`:

```go
// ContextBreakdown is what Claude Code's /context reports for a fresh session in a folder: what loads every turn
// there (pkg/ctxbreakdown). It is not the agent's own session: its Messages row is the /context call itself.
type ContextBreakdown struct {
	Model        string            `json:"model"`
	WindowTokens int               `json:"windowtokens"`
	Categories   []ContextCategory `json:"categories"`  // in /context's order
	MemoryFiles  []ContextItem     `json:"memoryfiles"` // Source is the Type column (User, AutoMem, Project, …)
	Skills       []ContextItem     `json:"skills"`
	Agents       []ContextItem     `json:"agents"`
	McpServers   []ContextMcp      `json:"mcpservers"` // the MCP Tools table summed per server, deferred tools included
	ReadAt       int64             `json:"readat"`     // unix ms
}

type ContextCategory struct {
	Name     string `json:"name"`
	Tokens   int    `json:"tokens"`
	Deferred bool   `json:"deferred,omitempty"` // "(deferred)" in its name: not in the context until a tool search
}

type ContextItem struct {
	Name   string `json:"name"`
	Source string `json:"source"`
	Path   string `json:"path,omitempty"` // the file to open; "" when there is none (built in, claude.ai sync, unresolved)
	Tokens int    `json:"tokens"`
}

type ContextMcp struct {
	Server string `json:"server"`
	Tools  int    `json:"tools"`
	Tokens int    `json:"tokens"`
}
```

**Step 2: Add the command.** In the interface, next to `GetTranscriptUsageCommand`:

```go
	GetContextBreakdownCommand(ctx context.Context, data CommandGetContextBreakdownData) (*ContextBreakdown, error)
```

and the data type beside `CommandGetTranscriptUsageData`:

```go
type CommandGetContextBreakdownData struct {
	Cwd     string `json:"cwd"`
	Refresh bool   `json:"refresh,omitempty"` // read again even when a cached breakdown is fresh
}
```

**Step 3: The placeholder `Read`** in `pkg/ctxbreakdown/read.go`:

```go
// Package ctxbreakdown reads what Claude Code's /context reports for a folder: run headless, it measures a fresh
// session there, which is what loads every turn (tools, memory files, skills, agents, MCP, the system prompt).
package ctxbreakdown

import (
	"context"
	"errors"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// Read returns the breakdown for cwd. Task 2 of the rail-context-breakdown plan replaces this body.
func Read(ctx context.Context, cwd string, refresh bool) (*wshrpc.ContextBreakdown, error) {
	return nil, errors.New("reading /context is not built yet")
}
```

**Step 4: The handler** in `wshserver_agents.go`:

```go
func (ws *WshServer) GetContextBreakdownCommand(ctx context.Context, data wshrpc.CommandGetContextBreakdownData) (*wshrpc.ContextBreakdown, error) {
	if strings.TrimSpace(data.Cwd) == "" {
		return nil, fmt.Errorf("no folder to read /context in")
	}
	return ctxbreakdown.Read(ctx, data.Cwd, data.Refresh)
}
```

**Step 5:** `task generate`, then confirm `frontend/app/store/wshclientapi.ts` has `GetContextBreakdownCommand` and
`frontend/types/gotypes.d.ts` has `ContextBreakdown`. `go build ./pkg/... ./cmd/...` succeeds; `gofmt -l pkg/ctxbreakdown
pkg/wshrpc/wshrpctypes_agents.go pkg/wshrpc/wshserver/wshserver_agents.go` prints nothing.

**Step 6: Commit** the Go files and every generated file `task generate` changed:

```bash
git add pkg/ctxbreakdown pkg/wshrpc frontend/app/store/wshclientapi.ts frontend/types/gotypes.d.ts
git commit -m "feat(ctxbreakdown): GetContextBreakdownCommand contract and generated types"
```

### Task 2: Parse, resolve and read `/context` (`pkg/ctxbreakdown`)

**Depends on:** Task 1
**Files:** `pkg/ctxbreakdown/parse.go`, `pkg/ctxbreakdown/paths.go`, `pkg/ctxbreakdown/read.go`, `pkg/ctxbreakdown/hide_windows.go`, `pkg/ctxbreakdown/hide_other.go`, `pkg/ctxbreakdown/parse_test.go`, `pkg/ctxbreakdown/paths_test.go`, `pkg/ctxbreakdown/read_test.go`

Files in detail:
- Create: `pkg/ctxbreakdown/parse.go`, `pkg/ctxbreakdown/paths.go`, `pkg/ctxbreakdown/hide_windows.go`,
  `pkg/ctxbreakdown/hide_other.go`
- Modify: `pkg/ctxbreakdown/read.go` (replace Task 1's placeholder `Read`)
- Test: `pkg/ctxbreakdown/parse_test.go`, `pkg/ctxbreakdown/paths_test.go`, `pkg/ctxbreakdown/read_test.go`
- Test data (already in the tree): `pkg/ctxbreakdown/testdata/context-opus-1m.md` — a real `/context` report,
  local paths scrubbed

**Step 1: Write the failing parse tests** (`parse_test.go`):

```go
package ctxbreakdown

import (
	"os"
	"testing"
)

func TestParseTokens(t *testing.T) {
	cases := map[string]int{"676": 676, "2.5k": 2500, "958.1k": 958100, "1m": 1000000, "~80": 80, " 14.8k ": 14800, "1,024": 1024}
	for in, want := range cases {
		got, ok := ParseTokens(in)
		if !ok || got != want {
			t.Errorf("ParseTokens(%q) = %d, %v; want %d", in, got, ok, want)
		}
	}
	if _, ok := ParseTokens("—"); ok {
		t.Error("a dash is not a token count")
	}
}

func TestParseRealReport(t *testing.T) {
	raw, err := os.ReadFile("testdata/context-opus-1m.md")
	if err != nil {
		t.Fatal(err)
	}
	b, err := Parse(string(raw))
	if err != nil {
		t.Fatal(err)
	}
	if b.Model != "claude-opus-5-5" || b.WindowTokens != 1000000 {
		t.Fatalf("model/window = %q/%d", b.Model, b.WindowTokens)
	}
	if len(b.Categories) != 12 || b.Categories[0].Name != "System prompt" || b.Categories[0].Tokens != 2500 {
		t.Fatalf("categories = %+v", b.Categories)
	}
	var deferred int
	for _, c := range b.Categories {
		if c.Deferred {
			deferred++
		}
	}
	if deferred != 2 {
		t.Errorf("deferred categories = %d, want 2 (MCP tools, System tools)", deferred)
	}
	if len(b.MemoryFiles) != 3 || b.MemoryFiles[2].Name != "AGENTS.md" || b.MemoryFiles[2].Source != "Project" ||
		b.MemoryFiles[2].Path != `D:\work\arcterm\AGENTS.md` || b.MemoryFiles[2].Tokens != 14800 {
		t.Errorf("memory files = %+v", b.MemoryFiles)
	}
	if len(b.Skills) == 0 || b.Skills[0].Name != "graphify" || b.Skills[0].Source != "User" || b.Skills[0].Tokens != 80 {
		t.Errorf("first skill = %+v", b.Skills[0])
	}
	if len(b.Agents) != 2 || b.Agents[1].Name != "superpowers:code-reviewer" || b.Agents[1].Source != "Plugin" {
		t.Errorf("agents = %+v", b.Agents)
	}
	var stitch *struct{ tools, tokens int }
	for _, m := range b.McpServers {
		if m.Server == "stitch" {
			stitch = &struct{ tools, tokens int }{m.Tools, m.Tokens}
		}
	}
	if stitch == nil || stitch.tools != 18 {
		t.Errorf("stitch = %+v, want 18 tools", stitch)
	}
}

func TestParseKeepsUnknownCategoryAndFailsWithoutTable(t *testing.T) {
	md := "**Tokens:** 10k / 200k (5%)\n\n### Estimated usage by category\n\n| Category | Tokens | Percentage |\n|---|---|---|\n| Brand new thing | 1.2k | 0.6% |\n| Messages | 300 | 0.1% |\n"
	b, err := Parse(md)
	if err != nil || len(b.Categories) != 2 || b.Categories[0].Name != "Brand new thing" || b.WindowTokens != 200000 {
		t.Fatalf("b = %+v, err = %v", b, err)
	}
	if b.MemoryFiles == nil || b.Skills == nil || b.Agents == nil || b.McpServers == nil {
		t.Error("missing tables must be empty slices, not nil, so the wire carries []")
	}
	if _, err := Parse("## Context Usage\n\nnothing here\n"); err == nil {
		t.Error("no category table must be an error")
	}
}
```

**Step 2: Run them to see them fail**

Run (Bash): `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/ctxbreakdown -run 'TestParse' -v`
Expected: FAIL — `undefined: ParseTokens`, `undefined: Parse`.

**Step 3: Implement `parse.go`** (the package comment stays in `read.go`)

```go
package ctxbreakdown

import (
	"errors"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var (
	modelRe  = regexp.MustCompile(`\*\*Model:\*\*\s*(\S+)`)
	tokensRe = regexp.MustCompile(`\*\*Tokens:\*\*\s*\S+\s*/\s*(\S+)`)
	sepRe    = regexp.MustCompile(`^:?-+:?$`)
)

// ParseTokens reads a /context token cell: 676, 2.5k, 958.1k, 1m, ~80.
func ParseTokens(s string) (int, bool) {
	s = strings.ReplaceAll(strings.TrimPrefix(strings.TrimSpace(s), "~"), ",", "")
	mult := 1.0
	if n := len(s); n > 0 {
		switch s[n-1] {
		case 'k', 'K':
			mult, s = 1e3, s[:n-1]
		case 'm', 'M':
			mult, s = 1e6, s[:n-1]
		}
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || f < 0 {
		return 0, false
	}
	return int(math.Round(f * mult)), true
}

// tables maps each "### Heading" (lowercased) to its table's body rows, header and separator dropped
func tables(md string) map[string][][]string {
	out := map[string][][]string{}
	cur, sawHeader := "", false
	for _, line := range strings.Split(strings.ReplaceAll(md, "\r\n", "\n"), "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "### ") {
			cur, sawHeader = strings.ToLower(strings.TrimSpace(t[4:])), false
			continue
		}
		if cur == "" || !strings.HasPrefix(t, "|") {
			continue
		}
		cells := strings.Split(strings.Trim(t, "|"), "|")
		for i := range cells {
			cells[i] = strings.TrimSpace(cells[i])
		}
		if sepRe.MatchString(cells[0]) {
			continue
		}
		if !sawHeader {
			sawHeader = true
			continue
		}
		out[cur] = append(out[cur], cells)
	}
	return out
}

func baseName(p string) string {
	if i := strings.LastIndexAny(p, `/\`); i >= 0 {
		return p[i+1:]
	}
	return p
}

func items(rows [][]string, nameCol, sourceCol int) []wshrpc.ContextItem {
	out := []wshrpc.ContextItem{}
	for _, r := range rows {
		if len(r) < 3 {
			continue
		}
		tok, ok := ParseTokens(r[2])
		if !ok {
			continue
		}
		out = append(out, wshrpc.ContextItem{Name: r[nameCol], Source: r[sourceCol], Tokens: tok})
	}
	return out
}

// Parse reads /context's markdown. A missing table is empty; no category table is an error.
func Parse(md string) (*wshrpc.ContextBreakdown, error) {
	t := tables(md)
	cats := t["estimated usage by category"]
	if len(cats) == 0 {
		return nil, errors.New("no category table in the /context output")
	}
	b := &wshrpc.ContextBreakdown{Categories: []wshrpc.ContextCategory{}, McpServers: []wshrpc.ContextMcp{}}
	if m := modelRe.FindStringSubmatch(md); m != nil {
		b.Model = m[1]
	}
	if m := tokensRe.FindStringSubmatch(md); m != nil {
		b.WindowTokens, _ = ParseTokens(m[1])
	}
	for _, r := range cats {
		if len(r) < 2 {
			continue
		}
		if tok, ok := ParseTokens(r[1]); ok {
			b.Categories = append(b.Categories, wshrpc.ContextCategory{
				Name: r[0], Tokens: tok, Deferred: strings.Contains(strings.ToLower(r[0]), "(deferred)"),
			})
		}
	}
	// Memory Files is Type | Path | Tokens: the name is the path's last part, the source its type
	b.MemoryFiles = []wshrpc.ContextItem{}
	for _, r := range t["memory files"] {
		if len(r) < 3 {
			continue
		}
		if tok, ok := ParseTokens(r[2]); ok {
			b.MemoryFiles = append(b.MemoryFiles, wshrpc.ContextItem{Name: baseName(r[1]), Source: r[0], Path: r[1], Tokens: tok})
		}
	}
	b.Skills = items(t["skills"], 0, 1)
	b.Agents = items(t["custom agents"], 0, 1)
	idx := map[string]int{}
	for _, r := range t["mcp tools"] {
		if len(r) < 3 {
			continue
		}
		tok, ok := ParseTokens(r[2])
		if !ok {
			continue
		}
		i, seen := idx[r[1]]
		if !seen {
			i = len(b.McpServers)
			idx[r[1]] = i
			b.McpServers = append(b.McpServers, wshrpc.ContextMcp{Server: r[1]})
		}
		b.McpServers[i].Tools++
		b.McpServers[i].Tokens += tok
	}
	return b, nil
}
```

**Step 4: Run the parse tests** — same command. Expected: PASS.

**Step 5: Write the failing path tests** (`paths_test.go`): build a temp `home` and `cwd` with
`~/.claude/skills/paper/SKILL.md`, `<cwd>/.claude/skills/local/SKILL.md`, `~/.arc/claude-mod/skills/design/SKILL.md`,
`~/.claude/plugins/cache/superpowers-marketplace/superpowers/4.0.3/skills/brainstorming/SKILL.md`,
`~/.claude/plugins/cache/superpowers-marketplace/superpowers/4.0.3/agents/code-reviewer.md`, `~/.claude/agents/mine.md`.
Then:

```go
b := &wshrpc.ContextBreakdown{
	Skills: []wshrpc.ContextItem{
		{Name: "paper", Source: "User"}, {Name: "local", Source: "Project"}, {Name: "arc:design", Source: "Plugin (arc)"},
		{Name: "superpowers:brainstorming", Source: "Plugin (superpowers)"}, {Name: "gone", Source: "User"},
		{Name: "dataviz", Source: "Built-in"}, {Name: "docx", Source: "claude.ai sync"},
	},
	Agents: []wshrpc.ContextItem{{Name: "superpowers:code-reviewer", Source: "Plugin"}, {Name: "mine", Source: "User"}},
}
ResolvePaths(b, cwd, home)
```

and assert each `Path` is the file made above, and `gone`, `dataviz`, `docx` stay `""`.

**Step 6: Run to see them fail**, then **implement `paths.go`**:

```go
package ctxbreakdown

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func exists(p string) bool { st, err := os.Stat(p); return err == nil && !st.IsDir() }

// pluginOf is the plugin a "Plugin (x)" source or an "x:name" item belongs to, and the item's own name
func pluginOf(name, source string) (plugin, short string) {
	short = name
	if i := strings.Index(name, ":"); i >= 0 {
		plugin, short = name[:i], name[i+1:]
	}
	if open, close := strings.Index(source, "("), strings.LastIndex(source, ")"); open >= 0 && close > open {
		plugin = strings.TrimSpace(source[open+1 : close])
	}
	return plugin, short
}

func firstGlob(pattern string) string {
	m, _ := filepath.Glob(pattern)
	for _, p := range m {
		if exists(p) {
			return p
		}
	}
	return ""
}

// ResolvePaths fills the file a skill or agent row opens; one it cannot find (built in, claude.ai sync, removed) keeps "".
func ResolvePaths(b *wshrpc.ContextBreakdown, cwd, home string) {
	resolve := func(it *wshrpc.ContextItem, user, project func(short string) string, plugin func(p, short string) string) {
		src := strings.ToLower(it.Source)
		var p string
		switch {
		case src == "user":
			p = user(it.Name)
		case src == "project" && cwd != "":
			p = project(it.Name)
		case strings.HasPrefix(src, "plugin"):
			pl, short := pluginOf(it.Name, it.Source)
			if pl != "" {
				p = plugin(pl, short)
			}
		}
		if p != "" && exists(p) {
			it.Path = p
		}
	}
	for i := range b.Skills {
		resolve(&b.Skills[i],
			func(n string) string { return filepath.Join(home, ".claude", "skills", n, "SKILL.md") },
			func(n string) string { return filepath.Join(cwd, ".claude", "skills", n, "SKILL.md") },
			func(pl, n string) string {
				if pl == "arc" {
					return filepath.Join(home, ".arc", "claude-mod", "skills", n, "SKILL.md")
				}
				return firstGlob(filepath.Join(home, ".claude", "plugins", "cache", "*", pl, "*", "skills", n, "SKILL.md"))
			})
	}
	for i := range b.Agents {
		resolve(&b.Agents[i],
			func(n string) string { return filepath.Join(home, ".claude", "agents", n+".md") },
			func(n string) string { return filepath.Join(cwd, ".claude", "agents", n+".md") },
			func(pl, n string) string {
				return firstGlob(filepath.Join(home, ".claude", "plugins", "cache", "*", pl, "*", "agents", n+".md"))
			})
	}
}
```

**Step 7: Run all of the package's tests** — `... go test ./pkg/ctxbreakdown -v`. Expected: PASS.

**Step 8: Write the failing read tests** (`read_test.go`). `read.go` exposes a seam the way `pkg/council/bench`'s
`runClaude` does: `var runContext = func(ctx context.Context, cwd string, env []string) (string, error)`. Tests swap it:

- `TestReadCachesPerFolder`: a fake that counts calls and returns the testdata report; `Read(ctx, dirA, false)` twice
  → 1 call; `Read(ctx, dirA, true)` → 2 calls; `Read(ctx, dirB, false)` → 3 calls. The result's `ReadAt` is set and
  equal on the two cached reads.
- `TestReadSingleFlight`: a fake that blocks on a channel; start 3 `Read(ctx, dir, false)` goroutines, release, all 3
  get the same pointer-equal result and the fake ran once.
- `TestReadErrorCachedBriefly`: a fake that fails → `Read` returns the error; a second `Read` within `errTTL` returns
  it without a call; after setting the package's `now` seam past `errTTL`, it calls again.
- `TestChildEnvDropsBlock`: `childEnv([]string{"PATH=x", "WAVETERM_BLOCKID=b", "WAVETERM_JWT=j", "HOME=h"})` →
  `[PATH=x HOME=h]`.

**Step 9: Run** `... go test ./pkg/ctxbreakdown -run 'TestRead|TestChildEnv' -v` → FAIL (undefined).

**Step 10: Implement `read.go`**, replacing Task 1's placeholder `Read` (keep the package comment)

```go
package ctxbreakdown

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	readTimeout = 90 * time.Second // a headless /context boots a whole session: ~30 s measured 2026-11-12
	okTTL       = 30 * time.Minute
	errTTL      = time.Minute
)

var now = time.Now

// runContext runs /context headless in cwd. --no-session-persistence: without it each run leaves a transcript in
// ~/.claude/projects that Conversation History would list.
var runContext = func(ctx context.Context, cwd string, env []string) (string, error) {
	bin, err := exec.LookPath("claude")
	if err != nil {
		return "", errors.New("claude is not on PATH")
	}
	cmd := exec.CommandContext(ctx, bin, "-p", "--no-session-persistence", "/context")
	cmd.Dir, cmd.Env = cwd, env
	hideWindow(cmd) // wavesrv has no console: a console child would flash a window on Windows
	out, err := cmd.Output()
	if ctx.Err() != nil {
		return "", errors.New("/context took longer than 90 s")
	}
	if err != nil {
		return "", fmt.Errorf("claude -p /context: %w", err)
	}
	return string(out), nil
}

// childEnv is wavesrv's environment without the block identity, so the session's hooks report into no agent
func childEnv(env []string) []string {
	out := make([]string, 0, len(env))
	for _, kv := range env {
		if strings.HasPrefix(kv, "WAVETERM_BLOCKID=") || strings.HasPrefix(kv, "WAVETERM_JWT=") {
			continue
		}
		out = append(out, kv)
	}
	return out
}

type entry struct {
	done chan struct{}
	at   time.Time
	b    *wshrpc.ContextBreakdown
	err  error
}

var (
	mu    sync.Mutex
	cache = map[string]*entry{}
)

func fresh(e *entry) bool {
	select {
	case <-e.done:
	default:
		return true // in flight: wait for it
	}
	ttl := okTTL
	if e.err != nil {
		ttl = errTTL
	}
	return now().Sub(e.at) < ttl
}

// Read returns the breakdown for cwd: one run in flight per folder, kept okTTL (an error errTTL); refresh skips the cache.
func Read(ctx context.Context, cwd string, refresh bool) (*wshrpc.ContextBreakdown, error) {
	key := filepath.Clean(cwd)
	mu.Lock()
	e := cache[key]
	if e == nil || (refresh && !inFlight(e)) || !fresh(e) {
		e = &entry{done: make(chan struct{})}
		cache[key] = e
		go fill(e, key)
	}
	mu.Unlock()
	select {
	case <-e.done:
		return e.b, e.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func inFlight(e *entry) bool {
	select {
	case <-e.done:
		return false
	default:
		return true
	}
}

func fill(e *entry, cwd string) {
	defer close(e.done)
	ctx, cancel := context.WithTimeout(context.Background(), readTimeout)
	defer cancel()
	md, err := runContext(ctx, cwd, childEnv(os.Environ()))
	e.at = now()
	if err != nil {
		e.err = err
		return
	}
	b, err := Parse(md)
	if err != nil {
		e.err = err
		return
	}
	home, _ := os.UserHomeDir()
	ResolvePaths(b, cwd, home)
	b.ReadAt = e.at.UnixMilli()
	e.b = b
}
```

(The run uses a background context so a caller that gives up — the rail closing — does not kill a read another caller
waits on.)

**Step 11: Hide the child's console on Windows**, unconditionally (wavesrv is windowless, so a console child opens
a window of its own), the way `pkg/shellcomplete/bash_windows.go` / `bash_other.go` split by build tag:

```go
//go:build windows

package ctxbreakdown

import (
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NO_WINDOW}
}
```

and `hide_other.go` (`//go:build !windows`): `func hideWindow(cmd *exec.Cmd) {}`.

**Step 12: Run** all of the package's tests → PASS; `go build ./pkg/... ./cmd/...` succeeds (also
`GOOS=darwin go vet ./pkg/ctxbreakdown` for the other build tag); `gofmt -l pkg/ctxbreakdown` prints nothing.

**Step 13: Commit**

```bash
git add pkg/ctxbreakdown
git commit -m "feat(ctxbreakdown): wavesrv parses and caches Claude Code's /context per folder, on demand"
```

### Task 3: The pure model (`ctxbreakdown.ts`)

**Depends on:** none
**Files:** `frontend/app/view/agents/ctxbreakdown.ts`, `frontend/app/view/agents/ctxbreakdown.test.ts`

The model declares its own input shape (identical to the Go JSON above) so it does not wait for Task 1's generated
types; the store passes the generated `ContextBreakdown` to it.

**Step 1: Write the failing tests** (`ctxbreakdown.test.ts`), with a fixture built from the testdata report's numbers:

```ts
import { describe, expect, it } from "vitest";
import { cacheMinutes, contextGroups, fmtTok, readAgo, rewriteNow, type CtxBreakdownData } from "./ctxbreakdown";

const B: CtxBreakdownData = {
    model: "claude-opus-5-5",
    windowtokens: 1_000_000,
    readat: 0,
    categories: [
        { name: "System prompt", tokens: 2500 },
        { name: "System tools", tokens: 10100 },
        { name: "MCP tools", tokens: 676 },
        { name: "MCP server instructions", tokens: 1100 },
        { name: "MCP tools (deferred)", tokens: 32700, deferred: true },
        { name: "System tools (deferred)", tokens: 17100, deferred: true },
        { name: "Custom agents", tokens: 423 },
        { name: "Memory files", tokens: 16000 },
        { name: "Skills", tokens: 6500 },
        { name: "Messages", tokens: 1600 },
        { name: "Compact buffer", tokens: 3000 },
        { name: "Free space", tokens: 958100 },
    ],
    memoryfiles: [
        { name: "CLAUDE.md", source: "User", path: "C:\\Users\\me\\.claude\\CLAUDE.md", tokens: 275 },
        { name: "AGENTS.md", source: "Project", path: "D:\\work\\arcterm\\AGENTS.md", tokens: 14800 },
        { name: "MEMORY.md", source: "AutoMem", path: "C:\\Users\\me\\.claude\\projects\\x\\memory\\MEMORY.md", tokens: 925 },
    ],
    skills: Array.from({ length: 9 }, (_, i) => ({ name: `s${i}`, source: "User", tokens: (i + 1) * 10 })),
    agents: [{ name: "superpowers:code-reviewer", source: "Plugin", path: "/x/code-reviewer.md", tokens: 350 }],
    mcpservers: [{ server: "stitch", tools: 18, tokens: 22900 }],
};

describe("contextGroups", () => {
    const g = contextGroups(B, 70_000);
    it("estimates Messages as the context in use minus what loads every turn", () => {
        // fixed = 2500 + 10100 + 676 + 1100 + 423 + 16000 + 6500 = 37299
        expect(g[0]).toMatchObject({ id: "messages", tokens: 70_000 - 37_299, tag: "Compact shrinks", estimate: true });
    });
    it("orders the every-turn groups and merges the two MCP rows", () => {
        expect(g.map((x) => x.id)).toEqual(["messages", "tools", "memory", "skills", "prompt", "agents", "mcp"]);
        expect(g.find((x) => x.id === "mcp")!.tokens).toBe(1776);
    });
    it("notes the deferred system tools", () => {
        expect(g.find((x) => x.id === "tools")!.note).toBe("Built in. 17.1k more are deferred: a tool search loads them when needed.");
    });
    it("shows the six costliest skills and folds the rest into more", () => {
        const s = g.find((x) => x.id === "skills")!;
        expect(s.rows.map((r) => r.name)).toEqual(["s8", "s7", "s6", "s5", "s4", "s3"]);
        expect(s.more.map((r) => r.name)).toEqual(["s2", "s1", "s0"]);
        expect(s.count).toBe(9);
    });
    it("keeps a memory file's path and names its folder", () => {
        const m = g.find((x) => x.id === "memory")!.rows[1];
        expect(m).toMatchObject({ name: "AGENTS.md", detail: "Project · arcterm", path: "D:\\work\\arcterm\\AGENTS.md" });
    });
    it("words /context's AutoMem type", () => {
        expect(g.find((x) => x.id === "memory")!.rows[2].detail).toBe("Auto memory · memory");
    });
    it("words an MCP server by its tools", () => {
        expect(g.find((x) => x.id === "mcp")!.rows[0]).toMatchObject({ name: "stitch", detail: "18 tools · 22.9k when loaded" });
    });
    it("never lets Messages go negative and takes percents of the larger total", () => {
        const low = contextGroups(B, 10_000);
        expect(low[0].tokens).toBe(0);
        expect(low.reduce((a, x) => a + x.pct, 0)).toBeCloseTo(100, 0);
    });
});

describe("figures", () => {
    it("formats tokens", () => {
        expect([fmtTok(231), fmtTok(9100), fmtTok(14_800), fmtTok(927_000)]).toEqual(["231", "9.1k", "14.8k", "927k"]);
        expect([fmtTok(200_000), fmtTok(1_000_000), fmtTok(1_500_000)]).toEqual(["200k", "1M", "1.5M"]);
    });
    it("reads the cache countdown", () => {
        expect([cacheMinutes("43m left"), cacheMinutes("<1m left"), cacheMinutes("expired"), cacheMinutes("—")]).toEqual([43, 0, null, null]);
    });
    it("estimates what compacting now rewrites", () => {
        expect(rewriteNow(70_000, 23_100)).toBe(48_900);
    });
    it("says how long ago it read", () => {
        expect([readAgo(0, 30_000), readAgo(0, 120_000), readAgo(0, 2 * 3_600_000)]).toEqual(["just now", "2 min ago", "2 h ago"]);
    });
});
```

**Step 2: Run** `npx vitest run frontend/app/view/agents/ctxbreakdown.test.ts` → FAIL (module not found).

**Step 3: Implement `ctxbreakdown.ts`** (pure: no React, no Wave runtime imports; header comment says so, like
`agentrailmodel.ts`):

- Types `CtxCategory`, `CtxItem`, `CtxMcp`, `CtxBreakdownData` mirroring the Go JSON (optional arrays).
- `type CtxGroupId = "messages" | "tools" | "memory" | "skills" | "prompt" | "agents" | "mcp" | "other"`.
- `interface CtxRow { name: string; detail: string; tokens?: number; path?: string }`.
- `interface CtxGroup { id; label; tokens; pct; tag: "Compact shrinks" | "every turn"; fill: string; note?: string;
  rows: CtxRow[]; more: CtxRow[]; count?: number; estimate?: boolean }`.
- `FILL`: messages `bg-conn-1`, tools `bg-cacheread`, memory `bg-mem-feedback`, skills `bg-skill`, prompt
  `bg-ink-faint`, agents `bg-graphlane-5`, mcp `bg-graphlane-2`, other `bg-edge-strong` (existing tokens only).
- Categories matched by lowercased name: `system prompt`, `system tools`, `mcp tools`, `mcp server instructions`,
  `custom agents`, `memory files`, `skills`; skipped: `messages`, `free space`, `compact buffer`, any `deferred`.
  Anything else non-deferred sums into an `other` group ("Other", every turn), shown only when > 0.
- `fixed` = the sum of the non-skipped categories; `messages = max(0, live − fixed)`; `pct` of `max(live, fixed)`.
- Rows: memory files → `{name, detail: \`${type} · ${parentDirName(path)}\`, tokens, path}`, `type` being the source
  with `AutoMem` worded `Auto memory` (the canvas's word) and any other type as `/context` gives it; skills and agents
  sorted by tokens descending, `detail` = source, first 6 in `rows`, the rest in `more`; MCP servers →
  `{name: server, detail: \`${tools} tools · ${fmtTok(tokens)} when loaded\`}` (no tokens: the table mixes deferred
  tools in).
- Notes: tools → `Built in.` plus ` ${fmtTok(deferred system tools)} more are deferred: a tool search loads them when
  needed.` when there are any; skills → `Only each skill's description is in context; its file loads when it runs.`
- Groups with 0 tokens and no rows are dropped, Messages never.
- `fmtTok(n)`: `< 1000` → `${n}`; `< 100_000` → one decimal with a trailing `.0` dropped + `k`; `< 1_000_000` →
  rounded + `k`; else millions to one decimal with a trailing `.0` dropped + `M` (`1M`, `1.5M`).
- `cacheMinutes(countdown)`: `/^(\d+)m left$/` → the number, `<1m left` → 0, else null. `cacheWarn = m != null && m < 5`.
- `rewriteNow(live, messages) = live − messages + 2000` (an assumed summary).
- `freeTokens(window, live) = max(0, window − live)`, `compactBuffer(b)` = its category's tokens.
- `readAgo(readAt, now)`: under 60 s `just now`, under an hour `N min ago`, else `N h ago`.

**Step 4: Run** the test → PASS. Prettier-check the two files (`npx prettier --check <paths>`).

**Step 5: Commit**

```bash
git add frontend/app/view/agents/ctxbreakdown.ts frontend/app/view/agents/ctxbreakdown.test.ts
git commit -m "feat(rail): pure model for the context breakdown rows"
```

### Task 4: The rail's Context part, store, scenario

**Depends on:** Task 1, Task 3

It uses Task 1's wshrpc command and generated types and Task 3's model. Task 2 builds the real read in parallel: until it merges, the command answers "reading /context is not built yet", which is the Failed state, and the
scenario seeds every state instead of reading.
**Files:** `frontend/app/view/agents/ctxbreakdownstore.ts`, `frontend/app/view/agents/sessionsection.tsx`, `frontend/app/view/agents/agentdetailsrail.tsx`, `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`

Files in detail:
- Create: `frontend/app/view/agents/ctxbreakdownstore.ts`
- Modify: `frontend/app/view/agents/sessionsection.tsx`, `frontend/app/view/agents/agentdetailsrail.tsx`
  (the `status` section ~line 1092 and the state row), `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`,
  `docs/hand-checks.md`

**Step 1: The store** `ctxbreakdownstore.ts`:

```ts
// The context breakdown per folder (GetContextBreakdownCommand): read only when asked (Read the breakdown, Refresh),
// since one read boots a headless Claude Code session for ~30 s. wavesrv keeps it 30 min per folder; this keeps the
// last answer per folder for the session, and a stale-load guard so a late reply for one press cannot overwrite the next.
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom } from "jotai";
import { atomFamily } from "jotai/utils";

export type CtxState =
    | { state: "idle" }
    | { state: "reading"; prev?: ContextBreakdown }
    | { state: "ready"; data: ContextBreakdown }
    | { state: "failed"; error: string };

export const ctxBreakdownAtom = atomFamily((_cwd: string) => atom<CtxState>({ state: "idle" }));
const seq = new Map<string, number>();

export async function readCtxBreakdown(cwd: string, refresh: boolean): Promise<void> {
    const a = ctxBreakdownAtom(cwd);
    const n = (seq.get(cwd) ?? 0) + 1;
    seq.set(cwd, n);
    const cur = globalStore.get(a);
    globalStore.set(a, { state: "reading", prev: cur.state === "ready" ? cur.data : undefined });
    try {
        const data = await RpcApi.GetContextBreakdownCommand(TabRpcClient, { cwd, refresh }, { timeout: 120_000 });
        if (seq.get(cwd) === n) globalStore.set(a, { state: "ready", data });
    } catch (e) {
        if (seq.get(cwd) === n) globalStore.set(a, { state: "failed", error: String((e as Error)?.message ?? e) });
    }
}

// scenarios seed any state (idle, reading, ready, failed) without spawning claude; seeding bumps seq so a reply
// still in flight cannot overwrite it
declare global {
    interface Window {
        __arcCtxBreakdown?: { seed: (cwd: string, s: CtxState) => void };
    }
}
if (import.meta.env.DEV && typeof window !== "undefined") {
    window.__arcCtxBreakdown = {
        seed: (cwd, s) => {
            seq.set(cwd, (seq.get(cwd) ?? 0) + 1);
            globalStore.set(ctxBreakdownAtom(cwd), s);
        },
    };
}
```

**Step 2: `sessionsection.tsx`.** Add an optional prop:

```ts
context?: {
    cwd: string;
    liveTokens: number;   // contextpct × contextmax
    windowTokens: number; // contextmax
    cache: string;        // formatCacheCountdown's text ("43m left", "—")
    onOpenFile: (path: string) => void;
};
```

Inside the breakdown fold, above `UsageBreakdown`, render `ContextPart` when `context` is set, and put a `Spend`
heading (same style as Context's) over `UsageBreakdown`, its right side `${fmt(totalTokens)} processed`. Match the
canvas `Main.dc.html` exactly; classes from today's file:

- Section heading: `SubLabel` + `h-px flex-1 bg-edge-faint` rule + `text-[10.5px] tabular-nums text-muted` figure
  (`70k of 1M` via `fmtTok`, `1M` for 1,000,000 and `200k` for 200,000), `data-rail-context` on the part's root.
- Bar: `StackedMeter height={8} radius={4}` over the groups' `fill`.
- Group row (`data-ctx-group={id}`): a `<button aria-expanded>` when it has rows or a note, else a `<div>`; the
  9px swatch, `text-[12px] text-secondary` label, the count in `text-[10.5px] text-muted`, the tag in
  `text-[10.5px] text-muted`, tokens `w-[48px] text-right text-[11.5px] tabular-nums text-secondary`, pct
  `w-[40px] … text-muted`, `ChevronDown`/`ChevronUp` 12 `text-accent-soft`; rows divided by `border-edge-faint`.
  Messages' tooltip: "context in use minus what loads every turn; includes what hooks added". Every group starts
  folded; the open set is local `useState` (it may reset when the rail unmounts).
- Item row: name `text-[11.5px] font-medium text-primary`, detail `text-[10.5px] text-muted truncate`, tokens, and
  when `path` is set the row is a `<button data-ctx-open-file title={"Open " + path}>` ending in lucide `ArrowUpRight`
  11 `text-accent-soft` that calls `onOpenFile(path)`. `+N more` (`text-[10.5px] font-semibold text-accent-soft`)
  swaps `rows` for `rows.concat(more)`.
- Cache line (`data-ctx-cache-line`, `title` = `cacheRewriteTitle`'s text): lucide `Clock` 11 `text-muted`, then
  `Cache warm <b>43m</b> · after that the next turn rewrites these 70k`; left out when the countdown is `—` or
  `expired`.
- Footer: `Free 927k · autocompact keeps 3k`, `read 2 min ago` (`readAgo`), **Refresh** (`RESET_BTN`-style text
  button, `data-ctx-refresh`) → `readCtxBreakdown(cwd, true)`.
- States per the spec: idle → empty 8px `bg-border` bar, the explanatory line and a secondary **Read the breakdown**
  button (`data-ctx-read`, DESIGN.md's secondary button classes) → `readCtxBreakdown(cwd, false)`; reading →
  `SkeletonLine` bar and the button disabled reading `Reading… about 30 s` (with `prev` data, keep drawing it and dim
  the Refresh to `Reading…`); failed → `Couldn't read /context: <error>.` and **Try again**. The cache line shows in
  every state.

**Step 3: `agentdetailsrail.tsx`.** Pass `context` to `SessionSection` only when `!sub && isClaude && ctxPct != null
&& usage?.contextmax` and the agent has a folder (`agentCwd ?? agent.cwd`: `agentCwd` is the rail's per-agent
`railCwdsAtom` value, ~line 693; never `railState?.cwd`, which is another agent's for a moment after a switch, so the
breakdown would key on the wrong folder): `liveTokens =
Math.round(ctxPct / 100 * contextmax)`, `cache = cacheCountdown`, `onOpenFile = (p) => openFileInPanel(model,
agent.id, { abs: p, root: dirname(p) })` (`dirname`: the path up to its last `/` or `\`). Check in the dev app that
the File tab opens a file outside the agent's folder (`~/.claude/CLAUDE.md`); if it refuses, pass `root: null`.
In the state row, when `cacheWarn(cacheMinutes(cacheCountdown))`, compose the line in JSX (`railStatusLine` returns
one string and stays as it is): `railStatusLine({ …, cache: "—" })` (the line without its cache part), then ` · ` and
a `<span data-rail-cache-warn className="text-warning font-semibold">cache Nm left</span>`. And add
`now rewrites ~X, later Y` (`data-rail-rewrite-note`, `text-[10.5px] text-muted`, right-aligned) at the end of the
Compact/Clear row (`ResetActions`' row: it shows only when `offerReset`, i.e. idle with the context at 150k or more or
nearly full), X = `rewriteNow(liveTokens, messages)` with the Messages group's estimate, Y = `liveTokens`, both via
`fmtTok`. The note needs a ready breakdown (or `reading` with `prev`); without one, leave it out.

**Step 4: Scenario** `rail-context-breakdown` in `scripts/cdp/scenarios.mjs`. Not `arrangeTreeRail` (its lead is
working, has no usage, a one-line user transcript, and its `dagsubmit` dispatches a real worker): use
`arrangeFixtureRun` directly, as `docs/reference/cdp-run-fixtures.md` describes, with no `dagsubmit`.

Arrange (a temp dir `ctx.cwd` from `mkdtempSync`, as `agent-tree-rail` makes one):
- Write `join(ctx.cwd, "AGENTS.md")` (a few lines), so the ↗ has a real file to open.
- Write the lead's transcript `join(ctx.cwd, "lead.jsonl")`: a user turn, then two assistant records in Claude Code's
  shape (what `extractClaude`, `pkg/usagestats/usagestats.go:76`, reads: `type: "assistant"`, an ISO `timestamp`,
  `cwd: ctx.cwd`, `requestId`, `message: { id, model: "claude-opus-5-5", role: "assistant", content, usage: {
  input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, cache_creation: {
  ephemeral_1h_input_tokens } } }`), the last one with a 1-hour cache write timestamped 17 minutes ago. That record
  gives the rail its cwd (`agentcwd.ts` reads `cwd`), the session spend (so `[data-rail-breakdown-toggle]` shows) and
  the cache countdown (`GetCacheStatusCommand` reads the last cache write: `43m left`). A helper
  `writeCtxTranscript(path, cwd, cacheWriteAgoMs)` writes it, so step 7 can rewrite it.
- `arrangeFixtureRun(h, ctx, "ctx-rail", CTX_RAIL_LEAD, { state: "idle", idleSince: Date.now() - 60_000,
  transcriptPath, usage: { contextpct: 18, contextmax: 1_000_000 } })`: 180k in context, so `offersContextReset` holds
  (idle, 150k or more, a block id) and Compact/Clear show; the context row shows `18%`.
- The localStorage set/restore, reload and focus of the lead row as `arrangeTreeRail` does them: extract that part into
  a helper `focusFixtureLead(h, ctx, leadName)` both scenarios call, so `agent-tree-rail` keeps its behaviour.
- The fixture breakdown: Task 3's test fixture with the memory files' paths swapped for `join(ctx.cwd, "AGENTS.md")`
  (and the other two pointing at files that need not exist), seeded with
  `window.__arcCtxBreakdown.seed(ctx.cwd, { state: "ready", data })`.

Steps (each a `rec` with its own assertion; a shot where marked):
1. Click `[data-rail-breakdown-toggle]` → `[data-rail-context]` and the Spend heading both show, the heading reads
   `180k of 1M`; shot.
2. Seven `[data-ctx-group]` in order messages … mcp; Messages' figure is `143k` (180,000 − 37,299, via `fmtTok`).
3. Click `[data-ctx-group="memory"]` → three `[data-ctx-open-file]` rows; click the AGENTS.md one → the rail's File tab
   shows that path; shot.
4. `[data-ctx-cache-line]` reads `Cache warm`, and `[data-rail-cache-warn]` is absent (43m left).
5. Seed `{ state: "idle" }` → `[data-ctx-read]` shows, enabled, and the cache line still does; shot.
6. Seed `{ state: "reading" }` → `[data-ctx-read]` is disabled and reads `Reading… about 30 s`; then seed
   `{ state: "failed", error: "claude is not on PATH" }` → the part reads `Couldn't read /context: claude is not on
   PATH.` and a **Try again** button shows; shot.
7. Seed the ready breakdown again, rewrite the transcript with its cache write 56 minutes ago, and wait up to 20 s
   (the rail re-reads the cache status every 15 s, `USAGE_REFRESH_MS`) → `[data-rail-cache-warn]` reads `cache 3m left`
   or `cache 4m left`, and `[data-rail-rewrite-note]` reads `now rewrites ~39.3k, later 180k`; shot.
8. Not a Claude agent: swap the fixture roster's lead to `agent: "pi"` (rewrite `active.json`, reload, refocus with
   `focusFixtureLead`) → the rail shows no `[data-rail-context]`, with the breakdown opened when its toggle shows (a pi
   lead may have no Spend, and then no toggle: the assertion is only that the Context part is absent).
Teardown: `teardownFixtureRun` with the localStorage keys restored, as `agent-tree-rail`'s teardown passes them.

Also update `agent-tree-rail` step 11 only if its assertion breaks (the breakdown still starts folded; it should not).

**Step 5:** `npx vitest run frontend/app/view/agents/ctxbreakdown.test.ts`, `task check:ts` (~2 min: give it a 5 min
timeout), `npx prettier --check` and `npx eslint` on the changed `.ts`/`.tsx` paths. Then the live check in the dev
app: `task verify:ui -- rail-context-breakdown agent-tree-rail`. A real read is not possible in this task's tree
(Task 2's `Read` lands in parallel); it goes on the hand-check line (Step 7).

**Step 6: CHANGELOG.md** — under `Unreleased` → `Added`:

```
- The Agent rail's breakdown shows what fills the context: the conversation apart from what loads every turn (tools,
  memory files, skills, MCP), each memory file and skill a click from opening, and how long the cache stays warm
```

**Step 7: hand-checks.md** — one `- [ ] (arcterm) …` line for what the scenario cannot cover: press **Read the
breakdown** on a real Claude agent (expect ~30 s, then the groups; no new `.jsonl` in `~/.claude/projects/<project>`;
no console window flashes on Windows), the same on a Mac, and the amber cache note on a real idle agent.

**Step 8: Commit**

```bash
git add frontend/app/view/agents/ctxbreakdownstore.ts frontend/app/view/agents/sessionsection.tsx \
  frontend/app/view/agents/agentdetailsrail.tsx scripts/cdp/scenarios.mjs CHANGELOG.md docs/hand-checks.md
git commit -m "feat(rail): the breakdown shows what fills the context, with links to memory files and skills"
```
