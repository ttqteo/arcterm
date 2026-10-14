package learn

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const projCwd = `D:\w\proj`

func memFile(home, slug, name string) string {
	return filepath.Join(home, ".claude", "projects", slug, "memory", name)
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestUpsertMemoryWritesFileAndIndexLine(t *testing.T) {
	home := t.TempDir()
	m := Memory{Cwd: projCwd, Key: "no-push", Text: "Commit, never push", Learned: "2026-10-14", Count: 2}
	if err := UpsertMemory(home, m, []string{"đừng push", "commit thôi"}); err != nil {
		t.Fatal(err)
	}
	got := readFile(t, memFile(home, "D--w-proj", "learned_no-push.md"))
	for _, want := range []string{
		"---\nname: no-push\n",
		"description: Commit, never push\n",
		"metadata:\n",
		"  type: feedback\n",
		"  source: learned\n",
		"  learned: 2026-10-14\n",
		"  count: 2\n",
		"  cwd: 'D:\\w\\proj'\n",
		"\n---\n",
		"Commit, never push\n",
		"**Why:**",
		`"đừng push"`,
		`"commit thôi"`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("file lacks %q:\n%s", want, got)
		}
	}
	if idx := readFile(t, memFile(home, "D--w-proj", "MEMORY.md")); idx != "- [Commit, never push](learned_no-push.md) — learned 2026-10-14\n" {
		t.Fatalf("index = %q", idx)
	}
	// the file reads back as written
	list, err := ListMemories(home)
	if err != nil || len(list) != 1 {
		t.Fatalf("list = %v %v", list, err)
	}
	want := Memory{Cwd: projCwd, Dir: filepath.Dir(memFile(home, "D--w-proj", "x")), Key: "no-push", Text: "Commit, never push", Learned: "2026-10-14", Count: 2}
	if list[0] != want {
		t.Fatalf("list[0] = %+v, want %+v", list[0], want)
	}
}

func TestUpsertMemoryReplacesAndKeepsOtherIndexLines(t *testing.T) {
	home := t.TempDir()
	dir := MemoryDir(home, projCwd)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	other := "- [Other](feedback_other.md) — something else\n"
	if err := os.WriteFile(filepath.Join(dir, "MEMORY.md"), []byte(other), 0o644); err != nil {
		t.Fatal(err)
	}
	m := Memory{Cwd: projCwd, Key: "no-push", Text: "Commit, never push", Learned: "2026-10-14", Count: 2}
	if err := UpsertMemory(home, m, []string{"a"}); err != nil {
		t.Fatal(err)
	}
	m.Text, m.Learned, m.Count = "Never push without asking", "2026-10-20", 1
	if err := UpsertMemory(home, m, []string{"b"}); err != nil {
		t.Fatal(err)
	}
	idx := readFile(t, filepath.Join(dir, "MEMORY.md"))
	if want := other + "- [Never push without asking](learned_no-push.md) — learned 2026-10-20\n"; idx != want {
		t.Fatalf("index = %q, want %q", idx, want)
	}
	list, _ := ListMemories(home)
	if len(list) != 1 || list[0].Count != 3 || list[0].Text != "Never push without asking" || list[0].Learned != "2026-10-20" {
		t.Fatalf("list = %+v", list)
	}
	if body := readFile(t, filepath.Join(dir, "learned_no-push.md")); strings.Contains(body, `"a"`) || !strings.Contains(body, `"b"`) {
		t.Fatalf("the second upsert's quotes replace the first's:\n%s", body)
	}
}

func TestUpsertMemoryEditKeepsCountAndQuotes(t *testing.T) {
	home := t.TempDir()
	m := Memory{Cwd: projCwd, Key: "no-push", Text: "Commit, never push", Learned: "2026-10-14", Count: 2}
	if err := UpsertMemory(home, m, []string{"đừng push"}); err != nil {
		t.Fatal(err)
	}
	m.Text, m.Count = "Never push", 0
	if err := UpsertMemory(home, m, nil); err != nil {
		t.Fatal(err)
	}
	list, _ := ListMemories(home)
	if len(list) != 1 || list[0].Count != 2 || list[0].Text != "Never push" {
		t.Fatalf("list = %+v", list)
	}
	body := readFile(t, memFile(home, "D--w-proj", "learned_no-push.md"))
	if !strings.Contains(body, `"đừng push"`) || strings.Count(body, "**Why:**") != 1 {
		t.Fatalf("an edit with no quotes keeps the old ones:\n%s", body)
	}
}

func TestUpsertMemoryAwkwardTextReadsBack(t *testing.T) {
	home := t.TempDir()
	text := strings.Repeat("Use: a #tag, [brackets] and 'quotes' — ", 5)[:190]
	m := Memory{Cwd: `C:\Users\a b\p.q_r`, Key: "awkward", Text: text, Learned: "2026-10-14", Count: 1}
	if err := UpsertMemory(home, m, []string{"line one\nline two"}); err != nil {
		t.Fatal(err)
	}
	list, err := ListMemories(home)
	if err != nil || len(list) != 1 {
		t.Fatalf("list = %v %v", list, err)
	}
	if list[0].Text != text || list[0].Cwd != m.Cwd {
		t.Fatalf("read back %+v", list[0])
	}
	// the description stays on one line, so a reader that is not a YAML parser sees it whole
	file := readFile(t, filepath.Join(list[0].Dir, "learned_awkward.md"))
	if !strings.Contains(file, "\nmetadata:\n") || strings.Contains(strings.SplitN(file, "\nmetadata:", 2)[0], "\n ") {
		t.Fatalf("description wrapped:\n%s", file)
	}
}

func TestUpsertMemoryRejectsBadInput(t *testing.T) {
	home := t.TempDir()
	for _, m := range []Memory{
		{Cwd: projCwd, Key: "../escape", Text: "x", Learned: "2026-10-14"},
		{Cwd: projCwd, Key: "Bad Key", Text: "x", Learned: "2026-10-14"},
		{Cwd: "", Key: "ok", Text: "x", Learned: "2026-10-14"},
		{Cwd: projCwd, Key: "ok", Text: "", Learned: "2026-10-14"},
	} {
		if err := UpsertMemory(home, m, nil); err == nil {
			t.Errorf("UpsertMemory(%+v) = nil, want an error", m)
		}
	}
	if list, _ := ListMemories(home); len(list) != 0 {
		t.Fatalf("nothing should be written, got %v", list)
	}
}

func TestRemoveMemory(t *testing.T) {
	home := t.TempDir()
	dir := MemoryDir(home, projCwd)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	other := "- [Other](feedback_other.md) — something else\n"
	if err := os.WriteFile(filepath.Join(dir, "MEMORY.md"), []byte(other), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"no-push", "keep-me"} {
		m := Memory{Cwd: projCwd, Key: key, Text: "Text " + key, Learned: "2026-10-14", Count: 2}
		if err := UpsertMemory(home, m, nil); err != nil {
			t.Fatal(err)
		}
	}
	if err := RemoveMemory(dir, "no-push"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "learned_no-push.md")); !os.IsNotExist(err) {
		t.Fatalf("file should be gone, stat err = %v", err)
	}
	idx := readFile(t, filepath.Join(dir, "MEMORY.md"))
	if want := other + "- [Text keep-me](learned_keep-me.md) — learned 2026-10-14\n"; idx != want {
		t.Fatalf("index = %q, want %q", idx, want)
	}
	// a missing one, and a dir with no MEMORY.md, are not errors
	if err := RemoveMemory(dir, "no-push"); err != nil {
		t.Fatalf("removing a missing memory: %v", err)
	}
	if err := RemoveMemory(filepath.Join(home, "nowhere"), "x"); err != nil {
		t.Fatalf("removing from a missing dir: %v", err)
	}
	if err := RemoveMemory(dir, "../MEMORY"); err == nil {
		t.Fatal("a path-like key must be refused")
	}
}

func TestListMemories(t *testing.T) {
	home := t.TempDir()
	put := func(cwd, key, text, learned string) {
		t.Helper()
		if err := UpsertMemory(home, Memory{Cwd: cwd, Key: key, Text: text, Learned: learned, Count: 2}, nil); err != nil {
			t.Fatal(err)
		}
	}
	put(`D:\w\old`, "b-key", "Old rule", "2026-09-01")
	put(`D:\w\new`, "z-key", "New rule", "2026-10-14")
	put(`D:\w\new`, "a-key", "Same day rule", "2026-10-14")
	// an ordinary memory file, and a learned_ name without the source marker, are not listed
	ordinary := "---\nname: other\ndescription: Other\nmetadata:\n  type: feedback\n---\nbody\n"
	for _, name := range []string{"feedback_other.md", "learned_unmarked.md"} {
		if err := os.WriteFile(memFile(home, "D--w-new", name), []byte(ordinary), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// a broken learned file is skipped, not fatal
	if err := os.WriteFile(memFile(home, "D--w-new", "learned_broken.md"), []byte("---\n: [\n---\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := ListMemories(home)
	if err != nil {
		t.Fatal(err)
	}
	var keys []string
	for _, m := range got {
		keys = append(keys, m.Key)
	}
	if strings.Join(keys, ",") != "a-key,z-key,b-key" {
		t.Fatalf("order = %v", keys)
	}
	if got[0].Cwd != `D:\w\new` || got[0].Dir != filepath.Dir(memFile(home, "D--w-new", "x")) || got[0].Text != "Same day rule" ||
		got[0].Learned != "2026-10-14" || got[0].Count != 2 {
		t.Fatalf("got[0] = %+v", got[0])
	}
}

func TestListMemoriesWithNoClaudeDir(t *testing.T) {
	got, err := ListMemories(t.TempDir())
	if err != nil || len(got) != 0 {
		t.Fatalf("got %v %v", got, err)
	}
}
