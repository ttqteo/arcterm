package agentsessions

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
)

// writeClaudeSession writes one claude transcript with the given cwd and first prompt, its mtime set to mtime.
func writeClaudeSession(t *testing.T, dir, id, cwd, task string, mtime time.Time) {
	t.Helper()
	cwdJSON, _ := json.Marshal(cwd)
	taskJSON, _ := json.Marshal(task)
	path := writeJSONL(t, dir, id+".jsonl", `{"type":"user","cwd":`+string(cwdJSON)+`,"message":{"content":`+string(taskJSON)+`}}`)
	if err := os.Chtimes(path, mtime, mtime); err != nil {
		t.Fatal(err)
	}
}

// readAllPages follows Next until it is empty, returning each page's session ids.
func readAllPages(t *testing.T, providers []provider, opts PageOpts) [][]string {
	t.Helper()
	var pages [][]string
	for range 100 {
		page, err := scanPageFrom(providers, opts, "")
		if err != nil {
			t.Fatal(err)
		}
		ids := []string{}
		for _, s := range page.Sessions {
			ids = append(ids, s.ID)
		}
		pages = append(pages, ids)
		if page.Next == "" {
			return pages
		}
		opts.Cursor = page.Next
	}
	t.Fatal("pages never ended")
	return nil
}

func TestScanPage_pagesNewestFirstWithoutGapsOrRepeats(t *testing.T) {
	dir := t.TempDir()
	base := time.Now().Add(-time.Hour)
	var want []string
	for i := range 7 {
		id := fmt.Sprintf("s%d", i)
		writeClaudeSession(t, dir, id, "/p/a", "task "+id, base.Add(-time.Duration(i)*time.Minute))
		want = append(want, id)
	}
	pages := readAllPages(t, []provider{claudeProvider(dir)}, PageOpts{Limit: 3})
	if len(pages) != 3 || len(pages[0]) != 3 || len(pages[1]) != 3 || len(pages[2]) != 1 {
		t.Fatalf("want pages of 3, 3, 1, got %v", pages)
	}
	var got []string
	for _, p := range pages {
		got = append(got, p...)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("want %v newest first, got %v", want, got)
	}
}

// 16 files share one mtime: sort.Slice insertion-sorts 12 or fewer elements, which keeps input order, so a smaller set
// would pass without the path tiebreak.
func TestScanPage_sameMtimeAcrossABoundary(t *testing.T) {
	dirA, dirB := t.TempDir(), t.TempDir()
	mtime := time.Now().Add(-time.Hour)
	for i := range 16 {
		dir := dirA
		if i%2 == 1 {
			dir = dirB
		}
		writeClaudeSession(t, dir, fmt.Sprintf("eq%02d", i), "/p/a", "task", mtime)
	}
	pages := readAllPages(t, []provider{claudeProvider(dirA), claudeProvider(dirB)}, PageOpts{Limit: 5})
	seen := map[string]int{}
	for _, p := range pages {
		for _, id := range p {
			seen[id]++
		}
	}
	if len(seen) != 16 {
		t.Errorf("want 16 distinct sessions, got %d: %v", len(seen), pages)
	}
	for id, n := range seen {
		if n != 1 {
			t.Errorf("%s listed %d times: %v", id, n, pages)
		}
	}
}

func TestScanPage_filtersBeforeTheLimitCounts(t *testing.T) {
	dir := t.TempDir()
	base := time.Now().Add(-time.Hour)
	for i, cwd := range []string{"/p/b", "/p/b", "/p/b", "/p/b", "/p/a", "/p/a"} {
		writeClaudeSession(t, dir, fmt.Sprintf("s%d", i), cwd, "task", base.Add(-time.Duration(i)*time.Minute))
	}
	page, err := scanPageFrom([]provider{claudeProvider(dir)}, PageOpts{ProjectPath: "/p/a/", Limit: 2}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Sessions) != 2 || page.Sessions[0].ID != "s4" || page.Sessions[1].ID != "s5" {
		t.Errorf("want both /p/a sessions, got %+v", page.Sessions)
	}
	if page.Next != "" {
		t.Errorf("no candidate is left, Next = %q", page.Next)
	}
}

func TestScanPage_queryMatchesTheTitleCaseInsensitively(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	writeClaudeSession(t, dir, "hit", "/p/a", "Fix the Resume list", now.Add(-time.Hour))
	writeClaudeSession(t, dir, "miss", "/p/a", "other", now.Add(-2*time.Hour))
	page, err := scanPageFrom([]provider{claudeProvider(dir)}, PageOpts{Query: " resume "}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Sessions) != 1 || page.Sessions[0].ID != "hit" {
		t.Errorf("want only the matching session, got %+v", page.Sessions)
	}
}

func TestScanPage_runtimeFilter(t *testing.T) {
	claudeDir, codexDir := t.TempDir(), t.TempDir()
	now := time.Now()
	writeClaudeSession(t, claudeDir, "cl", "/x", "claude one", now.Add(-time.Hour))
	cx := writeJSONL(t, codexDir, "rollout-cx.jsonl",
		`{"type":"session_meta","payload":{"session_id":"cx","cwd":"/x"}}`,
		`{"type":"event_msg","payload":{"type":"user_message","message":"codex one"}}`)
	if err := os.Chtimes(cx, now.Add(-2*time.Hour), now.Add(-2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	page, err := scanPageFrom([]provider{claudeProvider(claudeDir), codexProvider(codexDir)}, PageOpts{Runtime: "codex"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Sessions) != 1 || page.Sessions[0].Runtime != "codex" {
		t.Errorf("want only the codex session, got %+v", page.Sessions)
	}
}

func TestScanPage_badCursor(t *testing.T) {
	for _, cur := range []string{"nope", "x|/a/b"} {
		if _, err := scanPageFrom([]provider{claudeProvider(t.TempDir())}, PageOpts{Cursor: cur}, ""); err == nil {
			t.Errorf("cursor %q: want an error", cur)
		}
	}
}

// mkProjectDir makes the folder name under root and returns its path.
func mkProjectDir(t *testing.T, root, name string) string {
	t.Helper()
	dir := filepath.Join(root, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	return dir
}

// a session filed in another folder with the project's cwd stands in for every other transcript on disk: the walk
// never reads it, which is what keeps a project with few sessions from parsing the whole store
func TestScanPage_projectWalksOnlyItsClaudeFolder(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	writeClaudeSession(t, mkProjectDir(t, root, agentobserve.SlugifyCwd("/p/a")), "own", "/p/a", "task", now.Add(-time.Hour))
	writeClaudeSession(t, mkProjectDir(t, root, "elsewhere"), "stray", "/p/a", "task", now.Add(-2*time.Hour))
	page, err := scanPageFrom([]provider{claudeProvider(root)}, PageOpts{Runtime: "claude", ProjectPath: "/p/a", Limit: 30}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Sessions) != 1 || page.Sessions[0].ID != "own" {
		t.Errorf("want only the session in the project's own folder, got %+v", page.Sessions)
	}
}

func TestScanPage_projectWithNoFolderWalksTheRoot(t *testing.T) {
	root := t.TempDir()
	writeClaudeSession(t, mkProjectDir(t, root, "shortened-slug"), "short", "/p/z", "task", time.Now().Add(-time.Hour))
	page, err := scanPageFrom([]provider{claudeProvider(root)}, PageOpts{Runtime: "claude", ProjectPath: "/p/z", Limit: 30}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Sessions) != 1 || page.Sessions[0].ID != "short" {
		t.Errorf("a project with no folder of its own walks every folder, got %+v", page.Sessions)
	}
}

func TestScanPage_windowZeroReadsEveryFile(t *testing.T) {
	dir := t.TempDir()
	writeClaudeSession(t, dir, "ancient", "/p/a", "old work", time.Now().AddDate(0, 0, -400))
	page, err := scanPageFrom([]provider{claudeProvider(dir)}, PageOpts{WindowDays: 0}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Sessions) != 1 || page.Sessions[0].ID != "ancient" {
		t.Errorf("want the 400-day-old session, got %+v", page.Sessions)
	}
}
