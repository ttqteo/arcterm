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

// The scripts use bash builtins only, never `sort`, `head` or any other program: the shell inherits wavesrv's Windows
// PATH, which can list System32 before Git's usr\bin, so `sort -u` there is Windows' sort.exe, which fails on -u and
// leaves the pipe empty. Go dedups, sorts and caps the answer instead. The file loop stops after 1000 names so a huge
// folder's `[ -d ]` checks stay well inside the timeout.
var scripts = map[Kind]string{
	KindCommand:  `compgen -c -- "$1" 2>/dev/null`,
	KindVariable: `compgen -v -- "$1" 2>/dev/null`,
	KindFile:     `n=0; compgen -f -- "$1" 2>/dev/null | while IFS= read -r f; do [ -d "$f" ] && echo "$f/" || echo "$f"; n=$((n+1)); if [ "$n" -ge 1000 ]; then break; fi; done`,
}

// Complete is the shell's completions of `word` in `cwd`, sorted, at most MaxItems (the cap applies to the whole
// answer, after Go's dedup and sort). The word is bash's $1, never part of the script.
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
