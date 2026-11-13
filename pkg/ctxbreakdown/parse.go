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
