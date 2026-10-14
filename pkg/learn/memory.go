package learn

import (
	"cmp"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
)

const (
	memoryFilePrefix = "learned_"
	memoryIndexFile  = "MEMORY.md"
	sourceLearned    = "learned"
	dateLayout       = "2006-01-02"
	indexTextRunes   = 80
	whyMarker        = "**Why:**"
)

// memMu serializes our read-modify-write of a MEMORY.md; Claude itself writes the same file, which this cannot guard.
var memMu sync.Mutex

// Memory is one learned Claude memory: the file learned_<Key>.md in the memory dir of the project at Cwd. Learned
// is a local date (YYYY-MM-DD); Dir is the memory dir holding the file.
type Memory struct {
	Cwd, Dir, Key, Text, Learned string
	Count                        int
}

type memoryFront struct {
	Description string `yaml:"description"`
	Metadata    struct {
		Source  string `yaml:"source"`
		Learned string `yaml:"learned"`
		Count   int    `yaml:"count"`
		Cwd     string `yaml:"cwd"`
	} `yaml:"metadata"`
}

// MemoryDir is the memory dir Claude Code uses for the project at cwd. It names the project dir by
// agentobserve.SlugifyCwd: memroots.ProjectHash misses dots and underscores.
func MemoryDir(home, cwd string) string {
	return filepath.Join(home, ".claude", "projects", agentobserve.SlugifyCwd(cwd), "memory")
}

func memoryFileName(key string) string {
	return memoryFilePrefix + key + ".md"
}

// UpsertMemory writes the feedback memory file for m and its line in MEMORY.md, leaving every other line alone. If the
// file already exists its count is added to m.Count (an edit passes Count 0), and when why is empty its quotes stay.
func UpsertMemory(home string, m Memory, why []string) error {
	// the same key and text rules as a note; the session is unused
	n := Note{Key: m.Key, Target: "memory:" + m.Cwd, Text: m.Text, Session: "-"}
	if err := n.normalize(); err != nil {
		return err
	}
	if _, err := time.Parse(dateLayout, m.Learned); err != nil {
		return fmt.Errorf("learned date %q must be YYYY-MM-DD", m.Learned)
	}
	description, err := yamlString(n.Text, 0)
	if err != nil {
		return err
	}
	cwd, err := yamlString(m.Cwd, yaml.SingleQuotedStyle)
	if err != nil {
		return err
	}

	memMu.Lock()
	defer memMu.Unlock()
	dir := MemoryDir(home, m.Cwd)
	path := filepath.Join(dir, memoryFileName(m.Key))
	count, whyText := m.Count, whySection(why)
	switch old, body, err := readMemoryFile(path); {
	case err == nil:
		count += old.Metadata.Count
		if whyText == "" {
			whyText = oldWhySection(body)
		}
	case !errors.Is(err, fs.ErrNotExist):
		log.Printf("learn: replacing unreadable memory %s: %v", path, err)
	}

	var b strings.Builder
	fmt.Fprintf(&b, "---\nname: %s\ndescription: %s\nmetadata:\n  type: feedback\n  source: %s\n  learned: %s\n  count: %d\n  cwd: %s\n---\n\n%s\n",
		m.Key, description, sourceLearned, m.Learned, count, cwd, n.Text)
	if whyText != "" {
		b.WriteString("\n" + whyText)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	if err := fileutil.AtomicWriteFile(path, []byte(b.String()), 0o644); err != nil {
		return err
	}
	line := fmt.Sprintf("- [%s](%s) — learned %s", truncateRunes(n.Text, indexTextRunes), memoryFileName(m.Key), m.Learned)
	return setIndexLine(dir, m.Key, line)
}

// RemoveMemory deletes the learned memory file for key in dir and its MEMORY.md line. A memory that is already
// gone is not an error.
func RemoveMemory(dir, key string) error {
	if len(key) > maxKeyBytes || !keyRe.MatchString(key) {
		return fmt.Errorf("key %q must be a kebab-case slug", key)
	}
	memMu.Lock()
	defer memMu.Unlock()
	if err := os.Remove(filepath.Join(dir, memoryFileName(key))); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return setIndexLine(dir, key, "")
}

// ListMemories returns every learned memory under home's Claude projects, newest first. A file that cannot be read
// is logged and skipped; a learned_ file without `source: learned` is not ours and is left out.
func ListMemories(home string) ([]Memory, error) {
	projects := filepath.Join(home, ".claude", "projects")
	entries, err := os.ReadDir(projects)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return []Memory{}, nil
		}
		return nil, err
	}
	out := []Memory{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		dir := filepath.Join(projects, e.Name(), "memory")
		files, err := os.ReadDir(dir)
		if err != nil {
			if !errors.Is(err, fs.ErrNotExist) {
				log.Printf("learn: reading %s: %v", dir, err)
			}
			continue
		}
		for _, f := range files {
			name := f.Name()
			if f.IsDir() || !strings.HasPrefix(name, memoryFilePrefix) || !strings.HasSuffix(name, ".md") {
				continue
			}
			front, _, err := readMemoryFile(filepath.Join(dir, name))
			if err != nil {
				log.Printf("learn: skipping memory %s: %v", filepath.Join(dir, name), err)
				continue
			}
			md := front.Metadata
			if md.Source != sourceLearned {
				continue
			}
			if md.Cwd == "" {
				log.Printf("learn: skipping memory %s: no cwd", filepath.Join(dir, name))
				continue
			}
			out = append(out, Memory{
				Cwd:     md.Cwd,
				Dir:     dir,
				Key:     strings.TrimSuffix(strings.TrimPrefix(name, memoryFilePrefix), ".md"),
				Text:    front.Description,
				Learned: md.Learned,
				Count:   md.Count,
			})
		}
	}
	slices.SortFunc(out, func(a, b Memory) int {
		return cmp.Or(cmp.Compare(b.Learned, a.Learned), cmp.Compare(a.Key, b.Key), cmp.Compare(a.Cwd, b.Cwd))
	})
	return out, nil
}

// readMemoryFile parses a memory file into its frontmatter and body.
func readMemoryFile(path string) (memoryFront, string, error) {
	var front memoryFront
	data, err := os.ReadFile(path)
	if err != nil {
		return front, "", err
	}
	rest, ok := strings.CutPrefix(strings.ReplaceAll(string(data), "\r\n", "\n"), "---\n")
	if !ok {
		return front, "", errors.New("no frontmatter")
	}
	head, body, ok := strings.Cut(rest, "\n---\n")
	if !ok {
		if head, ok = strings.CutSuffix(rest, "\n---"); !ok {
			return front, "", errors.New("unterminated frontmatter")
		}
	}
	if err := yaml.Unmarshal([]byte(head), &front); err != nil {
		return front, "", fmt.Errorf("frontmatter: %w", err)
	}
	return front, body, nil
}

// whySection renders the user's words as the memory's Why block; "" when there are none.
func whySection(quotes []string) string {
	var b strings.Builder
	for _, q := range quotes {
		if q = strings.Join(strings.Fields(q), " "); q != "" {
			b.WriteString("- \"" + q + "\"\n")
		}
	}
	if b.Len() == 0 {
		return ""
	}
	return whyMarker + " the user corrected this in their own words:\n" + b.String()
}

// oldWhySection is the Why block of an existing memory body: it starts at the first blank line before the marker,
// which a quote (always a "- " line) or the one-line text cannot produce.
func oldWhySection(body string) string {
	if i := strings.Index(body, "\n\n"+whyMarker); i >= 0 {
		return strings.TrimLeft(body[i:], "\n")
	}
	return ""
}

// setIndexLine replaces the MEMORY.md line linking learned_<key>.md with line, or appends it; an empty line removes
// it. Every other line stays as it was, and a file with nothing to change is not rewritten.
func setIndexLine(dir, key, line string) error {
	path := filepath.Join(dir, memoryIndexFile)
	data, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	old := string(data)
	var lines []string
	if old != "" {
		lines = strings.Split(strings.TrimSuffix(old, "\n"), "\n")
	}
	link := "(" + memoryFileName(key) + ")"
	out := make([]string, 0, len(lines)+1)
	placed := line == ""
	for _, l := range lines {
		if !strings.Contains(l, link) {
			out = append(out, l)
		} else if !placed {
			out = append(out, line)
			placed = true
		}
	}
	if !placed {
		out = append(out, line)
	}
	next := ""
	if len(out) > 0 {
		next = strings.Join(out, "\n") + "\n"
	}
	if next == old {
		return nil
	}
	return fileutil.AtomicWriteFile(path, []byte(next), 0o644)
}

// yamlString renders s as a YAML scalar: style 0 quotes only when needed, yaml.SingleQuotedStyle always quotes.
func yamlString(s string, style yaml.Style) (string, error) {
	out, err := yaml.Marshal(&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: s, Style: style})
	if err != nil {
		return "", err
	}
	return strings.TrimSuffix(string(out), "\n"), nil
}
