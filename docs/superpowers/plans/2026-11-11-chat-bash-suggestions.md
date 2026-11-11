# Chat bash mode: shell well and suggestions — implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Chat's message box in bash mode (text that starts with `!`) draws as the approved board: a dark shell well
under a "Bash" caption, the newest matching `!` command from Claude Code's history as grey ghost text (→ takes it), and
Tab completions (commands, `$` variables, files) in a list over the box, as Claude Code's TUI offers them.

**Architecture:** Go owns the two reads: `pkg/shellcomplete` reads the newest `!` commands for a folder out of Claude
Code's `history.jsonl`, and asks the shell's `compgen` for completions of one word in the agent's folder (Git Bash on
Windows). Two wshrpc commands carry them. The frontend splits the word under the caret, picks the ghost and applies a
pick in a pure `chatbash.ts`; `chatbashstore.ts` caches each folder's history; `bashcomplete.tsx` is the Tab list (a
`PickerList`, as the `/` menu); `chatcomposer.tsx` draws the well and wires the keys; `chateditor.tsx` draws the ghost.

**Tech Stack:** Go (wavesrv, wshrpc), React 19 + Lexical + Tailwind 4 + jotai, vitest, CDP scenarios.

**Prototype:** D:\work\arcterm\.superpowers\design\chat-bash-mode\project

**Verify:** `node scripts/verify.mjs ./pkg/shellcomplete/... ./pkg/wshrpc/...`

**Check:** `task check:ts`

**Final:** `node scripts/cdp/final-verify.mjs agent-chat`

---

## What Claude Code does (2.1.322, read from its bundle; match it)

- **History ghost:** with the box in bash mode and at least 2 characters after the `!`, it takes the first of the
  newest 50 distinct `!` commands from its prompt history (`~/.claude/history.jsonl`, `display` field, the `!` and edge
  whitespace stripped, entries that hold an `[Image` paste skipped) that starts with what you typed and is not equal to
  it, and shows the rest of it as ghost text. A command you run moves to the front of that list.
- **Tab completion:** for the word under the caret it runs `compgen -c` (the first word: commands), `compgen -v` (a
  word that starts with `$`: variables) or `compgen -f` (any other word: files, a folder suffixed `/`).

`history.jsonl` lines look like
`{"display":"!git status","pastedContents":{},"timestamp":1767061845701,"project":"D:\\work\\arcterm","sessionId":"…"}`;
the file is ~20 MB here, so it is read from its end. `CLAUDE_CONFIG_DIR`, when set, replaces `~/.claude`.

---

### Task 1: `pkg/shellcomplete`: the `!` history and `compgen` completions

**Depends on:** none
**Files:** `pkg/shellcomplete/history.go`, `pkg/shellcomplete/history_test.go`, `pkg/shellcomplete/complete.go`, `pkg/shellcomplete/complete_test.go`, `pkg/shellcomplete/bash_windows.go`, `pkg/shellcomplete/bash_other.go`

All six are new.

**Step 1: Write the failing history tests** (`history_test.go`)

```go
package shellcomplete

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeHistory(t *testing.T, lines ...string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "history.jsonl")
	if err := os.WriteFile(p, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestBashHistoryNewestFirstDistinctForTheFolder(t *testing.T) {
	p := writeHistory(t,
		`{"display":"!git status","project":"D:\\work\\app"}`,
		`{"display":"hello","project":"D:\\work\\app"}`,
		`{"display":"! ls -la ","project":"D:\\work\\app"}`,
		`{"display":"!npm test","project":"D:\\other"}`,
		`{"display":"!git status","project":"d:\\work\\app\\"}`,
		`{"display":"![Image #1] look","project":"D:\\work\\app"}`,
		`not json`,
	)
	got, err := BashHistory(p, `D:\work\app`, 50)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"git status", "ls -la"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestBashHistoryCapsAndMissingFile(t *testing.T) {
	var lines []string
	for i := 0; i < 80; i++ {
		lines = append(lines, `{"display":"!echo `+strings.Repeat("x", i+1)+`","project":"/p"}`)
	}
	got, _ := BashHistory(writeHistory(t, lines...), "/p", 50)
	if len(got) != 50 || got[0] != "echo "+strings.Repeat("x", 80) {
		t.Fatalf("got %d, first %q", len(got), got[0])
	}
	got, err := BashHistory(filepath.Join(t.TempDir(), "none.jsonl"), "/p", 50)
	if err != nil || len(got) != 0 {
		t.Fatalf("missing file: %v %v", got, err)
	}
}
```

The project match ignores case on Windows only and a trailing separator everywhere; write the case-folding test
behind `runtime.GOOS == "windows"` if the test above must also pass on a Mac (split the `d:\\work\\app\\` line into
its own Windows-only test).

**Step 2: Run them, expect FAIL** (`BashHistory` undefined):
`CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/shellcomplete -run BashHistory`

**Step 3: Implement `history.go`**

```go
// Package shellcomplete answers Chat's bash mode: the `!` commands Claude Code's history holds for a folder, and the
// shell's completions of one word.
package shellcomplete

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// HistoryPath is Claude Code's prompt history: CLAUDE_CONFIG_DIR's history.jsonl, else ~/.claude's.
func HistoryPath() (string, error) {
	if dir := os.Getenv("CLAUDE_CONFIG_DIR"); dir != "" {
		return filepath.Join(dir, "history.jsonl"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".claude", "history.jsonl"), nil
}

func sameFolder(a, b string) bool {
	a, b = strings.TrimRight(filepath.Clean(a), `\/`), strings.TrimRight(filepath.Clean(b), `\/`)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// BashHistory is the newest `max` distinct `!` commands run in `project`, newest first, without the `!`. The file is
// read backwards in chunks, so a long history costs only its tail. A missing file is an empty history.
func BashHistory(path, project string, max int) ([]string, error) {
	f, err := os.Open(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	var out []string
	seen := map[string]bool{}
	take := func(line []byte) {
		var rec struct {
			Display string `json:"display"`
			Project string `json:"project"`
		}
		if json.Unmarshal(line, &rec) != nil || !strings.HasPrefix(rec.Display, "!") || !sameFolder(rec.Project, project) {
			return
		}
		if strings.Contains(rec.Display, "[Image") {
			return
		}
		cmd := strings.TrimSpace(rec.Display[1:])
		if cmd != "" && !seen[cmd] {
			seen[cmd] = true
			out = append(out, cmd)
		}
	}
	const chunk = 64 << 10
	var rest []byte // the start of a line whose beginning is in an earlier chunk
	for end := st.Size(); end > 0 && len(out) < max; {
		start := max64(0, end-chunk)
		buf := make([]byte, end-start)
		if _, err := f.ReadAt(buf, start); err != nil && !errors.Is(err, io.EOF) {
			return out, err
		}
		buf = append(buf, rest...)
		lines := bytes.Split(buf, []byte("\n"))
		if start > 0 {
			rest, lines = lines[0], lines[1:]
		} else {
			rest = nil
		}
		for i := len(lines) - 1; i >= 0 && len(out) < max; i-- {
			take(bytes.TrimSpace(lines[i]))
		}
		end = start
	}
	return out, nil
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
```

(`rest` must be copied before the next `append` reuses its array: use `rest = append([]byte(nil), lines[0]...)`.)

**Step 4: Run the history tests, expect PASS.**

**Step 5: Write the failing completion tests** (`complete_test.go`), skipped when no bash is found:

```go
func TestCompleteFilesMarksFolders(t *testing.T) {
	bash := bashPath()
	if bash == "" {
		t.Skip("no bash")
	}
	dir := t.TempDir()
	os.Mkdir(filepath.Join(dir, "chatpanes"), 0o755)
	os.WriteFile(filepath.Join(dir, "chatpane.tsx"), nil, 0o644)
	os.WriteFile(filepath.Join(dir, "other.ts"), nil, 0o644)
	got, err := Complete(context.Background(), dir, KindFile, "chatp")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, "|") != "chatpane.tsx|chatpanes/" {
		t.Fatalf("got %q", got)
	}
}

func TestCompleteVariablesAndCommands(t *testing.T) {
	if bashPath() == "" {
		t.Skip("no bash")
	}
	got, _ := Complete(context.Background(), t.TempDir(), KindVariable, "PAT")
	if !slices.Contains(got, "PATH") {
		t.Fatalf("variables: %q", got)
	}
	got, _ = Complete(context.Background(), t.TempDir(), KindCommand, "ech")
	if !slices.Contains(got, "echo") {
		t.Fatalf("commands: %q", got)
	}
}

func TestCompleteTakesTheWordAsAnArgumentNotAsScript(t *testing.T) {
	if bashPath() == "" {
		t.Skip("no bash")
	}
	dir := t.TempDir()
	got, err := Complete(context.Background(), dir, KindFile, `"; touch pwned; echo "`)
	if err != nil {
		t.Fatal(err)
	}
	if _, statErr := os.Stat(filepath.Join(dir, "pwned")); statErr == nil || len(got) != 0 {
		t.Fatalf("the word ran as script: %q", got)
	}
}
```

**Step 6: Run them, expect FAIL.**

**Step 7: Implement `complete.go` and the bash locators**

```go
package shellcomplete

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"os/exec"
	"sort"
	"strings"
	"time"
)

// Kind is what the word under the caret completes to (Claude Code's three: compgen -c, -v, -f).
type Kind string

const (
	KindCommand  Kind = "command"
	KindVariable Kind = "variable" // the word without its `$`
	KindFile     Kind = "file"
)

// MaxItems caps one answer: the list over the box shows a screenful, and a bare Tab on Windows' PATH lists thousands.
const MaxItems = 50

var scripts = map[Kind]string{
	KindCommand:  `compgen -c -- "$1" 2>/dev/null | sort -u | head -n 200`,
	KindVariable: `compgen -v -- "$1" 2>/dev/null | head -n 200`,
	KindFile:     `compgen -f -- "$1" 2>/dev/null | head -n 200 | while IFS= read -r f; do [ -d "$f" ] && echo "$f/" || echo "$f"; done`,
}

// Complete is the shell's completions of `word` in `cwd`, sorted, at most MaxItems. The word is bash's $1, never part
// of the script.
func Complete(ctx context.Context, cwd string, kind Kind, word string) ([]string, error) {
	script, ok := scripts[kind]
	if !ok {
		return nil, errors.New("unknown completion kind " + string(kind))
	}
	bash := bashPath()
	if bash == "" {
		return nil, errors.New("no bash to complete with: install Git for Windows or set term:gitbashpath")
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	c := exec.CommandContext(ctx, bash, "--noprofile", "--norc", "-c", script, "complete", word)
	c.Dir = cwd
	hideWindow(c)
	out, err := c.Output()
	if err != nil && ctx.Err() != nil {
		return nil, ctx.Err()
	}
	var items []string
	seen := map[string]bool{}
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		s := strings.TrimRight(sc.Text(), "\r")
		if s != "" && !seen[s] {
			seen[s] = true
			items = append(items, s)
		}
	}
	sort.Strings(items)
	if len(items) > MaxItems {
		items = items[:MaxItems]
	}
	return items, nil
}
```

`bash_windows.go`: `bashPath()` returns `shellutil.FindGitBash(&fullConfig, false)` with
`fullConfig := wconfig.GetWatcher().GetFullConfig()` (as `pkg/orchestrate/plancmd_windows.go:25-31`), falling back to
`exec.LookPath("bash")` when the watcher is not running (tests); `hideWindow` sets
`c.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NO_WINDOW}` so no console flashes.
`bash_other.go` (`//go:build !windows`): `bashPath()` is `exec.LookPath("bash")` (or `""`), `hideWindow` does nothing.

**Step 8: Run the package's tests, expect PASS** (same command as Step 2 without `-run`), then `gofmt -l pkg/shellcomplete`
prints nothing.

**Step 9: Commit**

```bash
git commit -m "feat(shellcomplete): the ! history and compgen completions for Chat's bash mode" -- pkg/shellcomplete
```

(add the new files first with `git add pkg/shellcomplete` in the same command line: `git add pkg/shellcomplete && git commit … -- pkg/shellcomplete`.)

---

### Task 2: wshrpc commands `BashHistoryCommand` and `ShellCompleteCommand`

**Depends on:** Task 1 (calls `shellcomplete.HistoryPath`, `BashHistory` and `Complete`)
**Files:** `pkg/wshrpc/wshrpctypes_shellcomplete.go`, `pkg/wshrpc/wshrpctypes.go`, `pkg/wshrpc/wshserver/wshserver_shellcomplete.go`, `pkg/wshrpc/wshserver/wshserver_shellcomplete_test.go`, `frontend/app/store/wshclientapi.ts`, `frontend/types/gotypes.d.ts`, `pkg/wshrpc/wshclient/wshclient.go`

New: the types file and the server file with its test. `wshrpctypes.go` embeds the interface beside
`ClaudeCmdsCommands` (line 63). The last three are written by `task generate`, never by hand.

**Step 1: The wire** (`wshrpctypes_shellcomplete.go`), modelled on `wshrpctypes_claudecmds.go`:

```go
// ShellCompleteCommands is the wire of Chat's bash mode (pkg/shellcomplete).
type ShellCompleteCommands interface {
	// BashHistoryCommand is the newest 50 distinct `!` commands Claude Code's history holds for the folder, newest
	// first, without the `!`. A missing history is an empty list.
	BashHistoryCommand(ctx context.Context, data CommandBashHistoryData) ([]string, error)
	// ShellCompleteCommand is the shell's completions of one word in the folder: kind "command", "variable" (the word
	// without its `$`) or "file" (a folder ends in `/`). At most 50, sorted.
	ShellCompleteCommand(ctx context.Context, data CommandShellCompleteData) ([]string, error)
}

type CommandBashHistoryData struct {
	Cwd string `json:"cwd"`
}

type CommandShellCompleteData struct {
	Cwd  string `json:"cwd"`
	Kind string `json:"kind"`
	Word string `json:"word"`
}
```

**Step 2: The server side** (`wshserver_shellcomplete.go`): `BashHistoryCommand` calls `shellcomplete.HistoryPath()` then
`shellcomplete.BashHistory(path, data.Cwd, 50)`; it refuses an empty `Cwd`. `ShellCompleteCommand` refuses an empty
`Cwd` or a `Cwd` that is not an existing folder, then calls `shellcomplete.Complete(ctx, data.Cwd, shellcomplete.Kind(data.Kind), data.Word)`.
A test covers the two refusals and one history read (point `CLAUDE_CONFIG_DIR` at a temp dir with `t.Setenv`).

**Step 3:** `task generate`, then check that `RpcApi.BashHistoryCommand` and `RpcApi.ShellCompleteCommand` appear in
`frontend/app/store/wshclientapi.ts`.

**Step 4:** `CGO_ENABLED=1 CC="zig cc -target x86_64-windows-gnu" go test ./pkg/wshrpc/wshserver -run 'Shell|BashHistory'`
passes; `go build ./cmd/server` succeeds.

**Step 5: Commit** the Go files and the generated ones with one pathspec commit:
`feat(wshrpc): BashHistoryCommand and ShellCompleteCommand for Chat's bash mode`.

---

### Task 3: `chatbash.ts`, the pure rules

**Depends on:** none
**Files:** `frontend/app/view/agents/chatbash.ts`, `frontend/app/view/agents/chatbash.test.ts`

**Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { applyCompletion, bashGhost, bashWordAt, ranFirst } from "./chatbash";

describe("bashGhost", () => {
    const history = ["git log --oneline -5", "git status -sb", "ls releases"];
    it("is the rest of the newest command that starts with what was typed", () => {
        expect(bashGhost(history, "!git l", 6)).toBe("og --oneline -5");
        expect(bashGhost(history, "!git s", 6)).toBe("tatus -sb");
    });
    it("is nothing under 2 characters, for an exact match, off the end of the text, or out of bash mode", () => {
        expect(bashGhost(history, "!g", 2)).toBe("");
        expect(bashGhost(history, "!ls releases", 12)).toBe("");
        expect(bashGhost(history, "!git l", 3)).toBe("");
        expect(bashGhost(history, "git l", 5)).toBe("");
        expect(bashGhost(history, "!zz", 3)).toBe("");
    });
});

describe("bashWordAt", () => {
    it("reads the first word as a command", () => {
        expect(bashWordAt("!gi", 3)).toEqual({ start: 1, end: 3, kind: "command", word: "gi" });
    });
    it("reads a later word as a file, and a path-like first word too", () => {
        expect(bashWordAt("!npx vitest run src/ch", 22)).toEqual({ start: 17, end: 22, kind: "file", word: "src/ch" });
        expect(bashWordAt("!./scr", 6)).toEqual({ start: 1, end: 6, kind: "file", word: "./scr" });
    });
    it("reads a $word as a variable, without its $", () => {
        expect(bashWordAt("!echo $PA", 9)).toEqual({ start: 7, end: 9, kind: "variable", word: "PA" });
    });
    it("is null out of bash mode", () => {
        expect(bashWordAt("git", 3)).toBeNull();
    });
});

describe("applyCompletion", () => {
    it("puts the pick in place of the word, a space after a file but not after a folder", () => {
        expect(applyCompletion("!cat src/ch", { start: 5, end: 11, kind: "file", word: "src/ch" }, "src/chat.ts")).toEqual({
            text: "!cat src/chat.ts ",
            caret: 17,
        });
        expect(applyCompletion("!cd fr", { start: 4, end: 6, kind: "file", word: "fr" }, "frontend/")).toEqual({
            text: "!cd frontend/",
            caret: 13,
        });
    });
    it("keeps the $ of a variable and the text after the caret", () => {
        expect(applyCompletion("!echo $PA x", { start: 7, end: 9, kind: "variable", word: "PA" }, "PATH")).toEqual({
            text: "!echo $PATH  x",
            caret: 12,
        });
    });
});

describe("ranFirst", () => {
    it("moves a command just run to the front, once", () => {
        expect(ranFirst(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
        expect(ranFirst(["a"], "z")).toEqual(["z", "a"]);
    });
});
```

**Step 2:** `npx vitest run frontend/app/view/agents/chatbash.test.ts` fails (module missing).

**Step 3: Implement** — the file header is the repo's pure-model comment ("Pure … No React, no Wave runtime imports").

```ts
/** What the word under the caret completes to; the three of Claude Code's bash mode (compgen -c, -v, -f). */
export type BashWordKind = "command" | "variable" | "file";

export interface BashWord {
    start: number; // in the box's text; for a variable, after its `$`
    end: number;
    kind: BashWordKind;
    word: string;
}

/** Pure: the rest of the newest history command that starts with what was typed after the `!`, as Claude Code's
 *  ghost text: only with the caret at the end, 2 characters typed or more, and never for an exact match. */
export function bashGhost(history: string[], text: string, caret: number): string {
    if (!text.startsWith("!") || caret !== text.length) {
        return "";
    }
    const typed = text.slice(1);
    if (typed.length < 2 || typed.trim() === "") {
        return "";
    }
    const hit = history.find((h) => h.startsWith(typed) && h !== typed);
    return hit == null ? "" : hit.slice(typed.length);
}

/** Pure: the word that ends at the caret, and what it completes to: the command's first word is a command (unless it
 *  holds a `/` or starts with `.` or `~`), a `$word` a variable, any other a file. Null out of bash mode. */
export function bashWordAt(text: string, caret: number): BashWord | null {
    if (!text.startsWith("!") || caret < 1) {
        return null;
    }
    let start = caret;
    while (start > 1 && !/\s/.test(text[start - 1])) {
        start--;
    }
    const word = text.slice(start, caret);
    if (word.startsWith("$")) {
        return { start: start + 1, end: caret, kind: "variable", word: word.slice(1) };
    }
    const first = text.slice(1, start).trim() === "";
    const pathLike = word.includes("/") || word.startsWith(".") || word.startsWith("~");
    return { start, end: caret, kind: first && !pathLike ? "command" : "file", word };
}

/** Pure: the text with `pick` in place of the word, and the caret after it; a space follows unless the pick is a
 *  folder (it ends in `/`), so the next Tab goes on into it. */
export function applyCompletion(text: string, w: BashWord, pick: string): { text: string; caret: number } {
    const insert = pick.endsWith("/") ? pick : `${pick} `;
    return { text: text.slice(0, w.start) + insert + text.slice(w.end), caret: w.start + insert.length };
}

/** Pure: the history with a command just run in front, as Claude Code moves it. */
export function ranFirst(history: string[], cmd: string): string[] {
    return [cmd, ...history.filter((h) => h !== cmd)];
}
```

**Step 4:** the tests pass. **Step 5: Commit** `feat(chat): the pure rules of bash mode's ghost text and Tab completion`
(pathspec: the two files).

---

### Task 4: The shell well, its caption, and the history ghost

**Depends on:** Task 2 (calls `RpcApi.BashHistoryCommand`), Task 3 (uses `bashGhost` and `ranFirst`)
**Files:** `frontend/app/view/agents/chatbashstore.ts`, `frontend/app/view/agents/chatcomposer.tsx`, `frontend/app/view/agents/chateditor.tsx`, `scripts/cdp/scenarios.mjs`

`chatbashstore.ts` is new. In `chatcomposer.tsx`: the box's classes (~411-414), the `data-chat-bash` chip (~517-532),
the `ChatEditor` (~423) and its `onKeyDown`. In `chateditor.tsx`: a `ghost` prop drawn after the text, like the
placeholder (~619). In `scenarios.mjs`: the `agent-chat` scenario (`name: "agent-chat"`, ~42735).

**Step 1: `chatbashstore.ts`** — per folder, session-only: `useBashHistory(cwd, on)` loads
`RpcApi.BashHistoryCommand(TabRpcClient, { cwd })` once per folder the first time `on` is true (errors → `[]`), keeps
it in a jotai atom keyed by folder (`ReadonlyMap<string, string[]>`, as `chatpendingstore.ts` does), and
`noteBashRun(cwd, cmd)` applies `ranFirst`. No tests (it is wiring); its rules are `chatbash.ts`'s.

**Step 2: the well and caption** in `chatcomposer.tsx`, as board C (`C-shell-well.dc.html`), DESIGN.md tokens only:
- the box keeps `border-edge-mid focus-within:border-edge-strong` in bash mode too (drop `border-accent/60`);
- the `data-chat-bash` footer chip goes; above the editor, while `bash`, a caption row
  `data-chat-bash-caption`: a lucide `SquareTerminal`/`Terminal` icon 13px in `text-accent`, "Bash" in `text-primary
  font-medium`, then `text-muted` "· runs in the agent's shell, output joins the chat", and at the right, only while a
  ghost shows, `text-ink-faint` "→ accept" with the arrow in `font-mono text-muted`; text 12px;
- the editor sits in a well while `bash`: a wrapper `rounded-[8px] bg-surface-code px-2.5 py-2`, the editor's class
  gains `font-mono` (DESIGN.md: shell command lines are mono); the leading `!` stays in the text;
- the `@` file picker stays closed in bash mode (pass the `mention` hook a guard, or skip its `onCaret`/`onKeyDown`
  while `bash`).

**Step 3: the ghost** — `ChatEditor` takes `ghost?: string`; when non-empty it draws an `aria-hidden`
`pointer-events-none absolute inset-0 whitespace-pre-wrap [overflow-wrap:anywhere] leading-[1.9]` mirror holding the
text in an `invisible` span and the ghost in a `text-ink-faint` span, with the same font classes as the editor, so the
ghost lands right after the last character. The composer passes `bashGhost(history, text, caret)` where `caret` is the
editor's `selectionStart` read in `onChange` (keep it in state).

**Step 4: the key** — in the composer's `onKeyDown`, after the slash and mention lists: `ArrowRight` with a ghost
showing (caret at the end) does `preventDefault` and `setTextAt(text + ghost, (text + ghost).length)`. On a bash send
(`submit` while `bash`), call `noteBashRun(cwd, text.slice(1).trim())`.

**Step 5: the scenario** — in `agent-chat`, add a step that mocks `BashHistoryCommand` (the scenario already mocks RPCs
through `AC_MOCK_KEY`; follow how it mocks `ListClaudeCommandsCommand` for the `/` menu) to return
`["git log --oneline -5", "git status -sb"]`, types `!git l` into the main agent's box (`acBox`), and asserts: the
composer has `data-chat-bash-mode`, `[data-chat-bash-caption]` reads "Bash", the editor's computed font family is the
mono one, the ghost reads `og --oneline -5`; then presses ArrowRight and asserts the box text is
`!git log --oneline -5`; screenshot. A second shot with just `!` typed (no ghost). Clear the box in teardown.

**Step 6:** `npx vitest run frontend/app/view/agents/chatbash.test.ts`, `task check:ts`, and in the dev app
`task verify:ui -- agent-chat` (see AGENTS.md "Visual verification"); compare the shots with board C's scenes 1 and 2.

**Step 7: Commit** `feat(chat): bash mode draws a shell well, and the newest matching ! command as ghost text`.

---

### Task 5: Tab completions over the box

**Depends on:** Task 4
**Files:** `frontend/app/view/agents/bashcomplete.tsx`, `frontend/app/view/agents/chatcomposer.tsx`, `scripts/cdp/scenarios.mjs`, `CHANGELOG.md`, `docs/hand-checks.md`

`bashcomplete.tsx` is new. `chatcomposer.tsx` renders its list beside `slash.list` and routes the keys; `scenarios.mjs`
extends `agent-chat`; `CHANGELOG.md` gets an Unreleased → Added line.

**Step 1: `useBashComplete({ text, setText, cwd, inputRef, on })`**, shaped like `useSlashMenu` in `slashmenu.tsx`
(read it first; reuse `PickerList` from `pickerlist.tsx` with `anchor={inputRef}`):
- Tab while `on` (bash mode, the `/` and `@` lists closed): `bashWordAt(text, caret)`; null → let Tab through. Else
  `RpcApi.ShellCompleteCommand(TabRpcClient, { cwd, kind, word })`. No items → nothing. One item → apply it at once
  (`applyCompletion`, `setText(next.text, next.caret)`), as a shell does. Several → open the list.
- The list: group label "Commands", "Variables" or "Files" with its count; rows `font-mono text-[13px] text-ink-hi`,
  a file row's folder part (up to its last `/`) in `text-muted`; footer as the `/` menu's: `↑↓ move`, `Tab complete`,
  `Esc close`, and at the right `in <cwd>`. List attrs `data-chat-bash-list`, item attr `data-chat-bash-item`.
- ↑/↓ move, Tab or Enter applies the highlighted row and closes, Esc closes, any other key closes it (the next Tab
  asks again with the new word).
- A Tab with no `cwd` (agent with no folder) does nothing.

**Step 2: wire it** — the composer calls the hook with `on: bash`, runs its `onKeyDown` first in bash mode (before
the slash and mention ones), and renders `{bashList.list}` next to `{slash.list}`. In bash mode Tab never leaves the box.

**Step 3: the scenario** — in `agent-chat`, mock `ShellCompleteCommand` to return
`["frontend/app/view/agents/chatpane.tsx", "frontend/app/view/agents/chatpanes/", "frontend/app/view/agents/chatpending.ts"]`,
type `!npx vitest run frontend/app/view/agents/chatp`, press Tab, assert `[data-chat-bash-list]` shows 3
`[data-chat-bash-item]` rows under "Files", screenshot (board C scene 3); press Enter and assert the text ends in
`chatpane.tsx ` and the list is gone. Then a one-item answer applies without a list.

**Step 4:** CHANGELOG, under Unreleased → Added:
`- Chat's bash mode (a message that starts with !) shows the command in a shell well, suggests the last matching ! command you ran (→ takes it), and completes commands, $variables and files with Tab.`
`docs/hand-checks.md`: `- [ ] (arcterm) Chat bash mode on Windows: Tab completes a path and a command through Git Bash with no console window flashing; the ghost follows Claude Code's own ! history.`

**Step 5:** `task check:ts`, `task verify:ui -- agent-chat`.

**Step 6: Commit** `feat(chat): Tab completes commands, variables and files in bash mode`.
