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
