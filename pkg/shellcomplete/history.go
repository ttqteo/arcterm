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

// sameFolder compares two folders ignoring a trailing separator, and case on Windows.
func sameFolder(a, b string) bool {
	a, b = strings.TrimRight(filepath.Clean(a), `\/`), strings.TrimRight(filepath.Clean(b), `\/`)
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// historyChunk is how much of history.jsonl one backwards read takes.
const historyChunk = 64 << 10

// BashHistory is the newest `limit` distinct `!` commands run in `project`, newest first, without the `!`. The file
// is read backwards in chunks, so a long history costs only its tail. A missing file is an empty history.
func BashHistory(path, project string, limit int) ([]string, error) {
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
		if json.Unmarshal(line, &rec) != nil || !strings.HasPrefix(rec.Display, "!") {
			return
		}
		if rec.Project == "" || !sameFolder(rec.Project, project) || strings.Contains(rec.Display, "[Image") {
			return
		}
		cmd := strings.TrimSpace(rec.Display[1:])
		if cmd != "" && !seen[cmd] {
			seen[cmd] = true
			out = append(out, cmd)
		}
	}
	var rest []byte // the start of a line whose beginning is in an earlier chunk
	for end := st.Size(); end > 0 && len(out) < limit; {
		start := max(0, end-historyChunk)
		buf := make([]byte, end-start)
		if _, err := f.ReadAt(buf, start); err != nil && !errors.Is(err, io.EOF) {
			return out, err
		}
		buf = append(buf, rest...)
		lines := bytes.Split(buf, []byte("\n"))
		if start > 0 {
			rest, lines = append([]byte(nil), lines[0]...), lines[1:]
		} else {
			rest = nil
		}
		for i := len(lines) - 1; i >= 0 && len(out) < limit; i-- {
			take(bytes.TrimSpace(lines[i]))
		}
		end = start
	}
	return out, nil
}
