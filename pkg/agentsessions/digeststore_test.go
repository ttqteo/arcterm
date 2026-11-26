// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
)

// digestEnv points the digest store at a temp dir and the search at the given providers, and puts the budgets back
// when the test ends. Call recordReads before it: the cleanups run last-in first-out, and the warm-up this waits for
// must be over before readLines is put back.
func digestEnv(t *testing.T, providers ...provider) {
	t.Helper()
	dir := t.TempDir()
	origDir, origProviders, origFiles, origBytes := digestDir, digestProviders, digestBudgetFiles, digestBudgetBytes
	digestDir = func() string { return dir }
	digestProviders = func() []provider { return providers }
	t.Cleanup(func() {
		waitDigestWarmup(t)
		digestDir, digestProviders, digestBudgetFiles, digestBudgetBytes = origDir, origProviders, origFiles, origBytes
	})
}

func waitDigestWarmup(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for digestWarming.Load() {
		if time.Now().After(deadline) {
			t.Fatal("the digest warm-up did not finish")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// writeDigestSession writes a claude transcript of one prompt and one reply, in a folder named for cwd as Claude Code
// names it, its mtime set to mtime.
func writeDigestSession(t *testing.T, root, id, cwd, prompt, reply string, mtime time.Time) string {
	t.Helper()
	dir := mkProjectDir(t, root, agentobserve.SlugifyCwd(cwd))
	cwdJSON, _ := json.Marshal(cwd)
	promptJSON, _ := json.Marshal(prompt)
	replyJSON, _ := json.Marshal(reply)
	ts := mtime.UTC().Format(time.RFC3339Nano)
	path := writeJSONL(t, dir, id+".jsonl",
		`{"type":"user","timestamp":"`+ts+`","cwd":`+string(cwdJSON)+`,"message":{"role":"user","content":`+string(promptJSON)+`}}`,
		`{"type":"assistant","timestamp":"`+ts+`","message":{"content":[{"type":"text","text":`+string(replyJSON)+`}]}}`,
	)
	if err := os.Chtimes(path, mtime, mtime); err != nil {
		t.Fatal(err)
	}
	return path
}

// writeDigestPiSession writes a pi session of one prompt and one reply under an encoded-cwd folder of root.
func writeDigestPiSession(t *testing.T, root, id, cwd, prompt, reply string, mtime time.Time) string {
	t.Helper()
	dir := mkProjectDir(t, root, "enc-"+id)
	cwdJSON, _ := json.Marshal(cwd)
	promptJSON, _ := json.Marshal(prompt)
	replyJSON, _ := json.Marshal(reply)
	ts := mtime.UTC().Format(time.RFC3339)
	path := writeJSONL(t, dir, id+".jsonl",
		`{"type":"session","version":3,"id":"`+id+`","timestamp":"`+ts+`","cwd":`+string(cwdJSON)+`}`,
		`{"type":"message","id":"u1","parentId":null,"timestamp":"`+ts+`","message":{"role":"user","content":`+string(promptJSON)+`}}`,
		`{"type":"message","id":"a1","parentId":"u1","timestamp":"`+ts+`","message":{"role":"assistant","content":[{"type":"text","text":`+string(replyJSON)+`}]}}`,
	)
	if err := os.Chtimes(path, mtime, mtime); err != nil {
		t.Fatal(err)
	}
	return path
}

func searchDigest(t *testing.T, query string, opts DigestSearch) ([]DigestResult, bool) {
	t.Helper()
	opts.Query = ParseQuery(query)
	if opts.MaxHits == 0 {
		opts.MaxHits = 20
	}
	return SearchDigests(opts)
}

func digestIDs(results []DigestResult) []string {
	ids := make([]string, len(results))
	for i, r := range results {
		ids[i] = r.Session.ID
	}
	return ids
}

// digestFiles lists the file names in the digest directory.
func digestFiles(t *testing.T) []string {
	t.Helper()
	entries, err := os.ReadDir(digestDir())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

func TestDigestIsWrittenOnceAndReused(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	a := writeDigestSession(t, root, "a", "/p/a", "why did the deploy fail", "the deploy timed out", now.Add(-2*time.Hour))
	b := writeDigestSession(t, root, "b", "/p/a", "rename the module", "renamed", now.Add(-time.Hour))
	reads := recordReads(t)
	digestEnv(t, claudeProvider(root))

	got, incomplete := searchDigest(t, "deploy", DigestSearch{})
	if incomplete {
		t.Fatal("two transcripts fit in the budget")
	}
	if ids := digestIDs(got); !slices.Equal(ids, []string{"a"}) {
		t.Fatalf("want only the deploy session, got %v", ids)
	}
	if n := len(reads()); n != 2 {
		t.Fatalf("the first search reads both transcripts once, read %d", n)
	}
	for _, p := range []string{a, b} {
		if _, err := os.Stat(digestPath(p)); err != nil {
			t.Fatalf("a digest file for %s: %v", p, err)
		}
	}

	again, _ := searchDigest(t, "deploy", DigestSearch{})
	if n := len(reads()); n != 2 {
		t.Fatalf("the second search reads no transcript, %d reads in all", n)
	}
	if !slices.Equal(digestIDs(again), digestIDs(got)) || !slices.Equal(again[0].Hits[0].Marks[0][:], got[0].Hits[0].Marks[0][:]) {
		t.Fatalf("the digest gives the same answer as the transcript did: %+v vs %+v", again, got)
	}
	// a search for another word is answered from the same digests
	searchDigest(t, "rename", DigestSearch{})
	if n := len(reads()); n != 2 {
		t.Fatalf("a different query reads no transcript, %d reads in all", n)
	}
}

// the file name and fields are the format a later build reads back
func TestDigestFileFormat(t *testing.T) {
	root := t.TempDir()
	path := writeDigestSession(t, root, "a", "/p/a", "why did the deploy fail", "the deploy timed out", time.Now().Add(-time.Hour))
	noSession := writeJSONL(t, mkProjectDir(t, root, agentobserve.SlugifyCwd("/p/a")), "tool-only.jsonl",
		`{"type":"assistant","message":{"content":[{"type":"text","text":"only an answer"}]}}`)
	digestEnv(t, claudeProvider(root))
	searchDigest(t, "deploy", DigestSearch{})

	sum := sha1.Sum([]byte(path))
	if want := filepath.Join(digestDir(), hex.EncodeToString(sum[:])+".json"); digestPath(path) != want {
		t.Fatalf("digestPath = %q, want %q", digestPath(path), want)
	}
	read := func(p string) map[string]json.RawMessage {
		data, err := os.ReadFile(digestPath(p))
		if err != nil {
			t.Fatal(err)
		}
		var m map[string]json.RawMessage
		if err := json.Unmarshal(data, &m); err != nil {
			t.Fatal(err)
		}
		return m
	}
	m := read(path)
	for _, key := range []string{"v", "path", "mtime", "size", "runtime", "session", "turns"} {
		if _, ok := m[key]; !ok {
			t.Errorf("the digest has no %q field: %v", key, m)
		}
	}
	if string(m["runtime"]) != `"claude"` || string(m["session"]) == "null" {
		t.Errorf("runtime %s, session %s", m["runtime"], m["session"])
	}
	if got := string(read(noSession)["session"]); got != "null" {
		t.Errorf("a transcript with no session holds session null, got %s", got)
	}
}

func TestDigestIsRebuiltWhenTheTranscriptGrows(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	path := writeDigestSession(t, root, "a", "/p/a", "first question", "first answer", now.Add(-time.Hour))
	reads := recordReads(t)
	digestEnv(t, claudeProvider(root))

	if got, _ := searchDigest(t, "rollback", DigestSearch{}); len(got) != 0 {
		t.Fatalf("nothing says rollback yet, got %v", digestIDs(got))
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	line := `
{"type":"user","timestamp":"` + now.UTC().Format(time.RFC3339Nano) + `","message":{"role":"user","content":"and a rollback plan"}}`
	if _, err := f.WriteString(line); err != nil {
		t.Fatal(err)
	}
	f.Close()
	if err := os.Chtimes(path, now, now); err != nil {
		t.Fatal(err)
	}

	got, _ := searchDigest(t, "rollback", DigestSearch{})
	if !slices.Equal(digestIDs(got), []string{"a"}) {
		t.Fatalf("the appended prompt is searchable, got %v", digestIDs(got))
	}
	if n := len(reads()); n != 2 {
		t.Fatalf("the grown transcript is read again once, %d reads in all", n)
	}
}

// the transcripts with no session (a subagent's, a tool-only one) are most of the walk: they get a digest too, so
// they are never read again
func TestDigestForATranscriptWithNoSessionIsKept(t *testing.T) {
	root := t.TempDir()
	dir := mkProjectDir(t, root, agentobserve.SlugifyCwd("/p/a"))
	path := writeJSONL(t, dir, "tool-only.jsonl", `{"type":"assistant","message":{"content":[{"type":"text","text":"deploy notes"}]}}`)
	reads := recordReads(t)
	digestEnv(t, claudeProvider(root))

	for range 2 {
		if got, incomplete := searchDigest(t, "deploy", DigestSearch{}); len(got) != 0 || incomplete {
			t.Fatalf("a file with no session is no result, got %v (incomplete %v)", digestIDs(got), incomplete)
		}
	}
	if _, err := os.Stat(digestPath(path)); err != nil {
		t.Fatalf("a digest for the file with no session: %v", err)
	}
	if n := len(reads()); n != 1 {
		t.Fatalf("it is read once, %d reads in all", n)
	}
}

func TestDigestCorruptOrOldVersionIsRebuilt(t *testing.T) {
	root := t.TempDir()
	path := writeDigestSession(t, root, "a", "/p/a", "why did the deploy fail", "timed out", time.Now().Add(-time.Hour))
	reads := recordReads(t)
	digestEnv(t, claudeProvider(root))
	searchDigest(t, "deploy", DigestSearch{})

	if err := os.WriteFile(digestPath(path), []byte(`{"v":1,"path":`), 0o644); err != nil {
		t.Fatal(err)
	}
	if got, _ := searchDigest(t, "deploy", DigestSearch{}); !slices.Equal(digestIDs(got), []string{"a"}) {
		t.Fatalf("a corrupt digest is rebuilt from the transcript, got %v", digestIDs(got))
	}
	if n := len(reads()); n != 2 {
		t.Fatalf("one rebuild, %d reads in all", n)
	}

	data, err := os.ReadFile(digestPath(path))
	if err != nil {
		t.Fatal(err)
	}
	old := strings.Replace(string(data), fmt.Sprintf(`"v":%d`, digestVersion), `"v":0`, 1)
	if old == string(data) {
		t.Fatalf("no version field to age in %s", data)
	}
	if err := os.WriteFile(digestPath(path), []byte(old), 0o644); err != nil {
		t.Fatal(err)
	}
	searchDigest(t, "deploy", DigestSearch{})
	if n := len(reads()); n != 3 {
		t.Fatalf("a digest of another version is rebuilt, %d reads in all", n)
	}
	searchDigest(t, "deploy", DigestSearch{})
	if n := len(reads()); n != 3 {
		t.Fatalf("and then kept, %d reads in all", n)
	}
}

func TestDigestBudgetMakesACallIncompleteAndTheWarmupCompletesIt(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	for i := range 5 {
		writeDigestSession(t, root, fmt.Sprintf("s%d", i), "/p/a", "deploy number "+fmt.Sprint(i), "ok", now.Add(-time.Duration(i+1)*time.Hour))
	}
	reads := recordReads(t)
	digestEnv(t, claudeProvider(root))
	digestBudgetFiles = 2

	got, incomplete := searchDigest(t, "deploy", DigestSearch{})
	if !incomplete {
		t.Fatal("two files of budget cannot build five digests")
	}
	if ids := digestIDs(got); !slices.Equal(ids, []string{"s0", "s1"}) {
		t.Fatalf("the budget goes to the newest transcripts, got %v", ids)
	}
	waitDigestWarmup(t)
	if n := len(digestFiles(t)); n != 5 {
		t.Fatalf("the warm-up builds the rest: %d digest files", n)
	}

	got, incomplete = searchDigest(t, "deploy", DigestSearch{})
	if incomplete || len(got) != 5 {
		t.Fatalf("complete with five results once the warm-up is done, got %d (incomplete %v)", len(got), incomplete)
	}
	if n := len(reads()); n != 5 {
		t.Fatalf("every transcript is read once in all, %d reads", n)
	}
}

func TestDigestByteBudget(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	for i := range 3 {
		writeDigestSession(t, root, fmt.Sprintf("s%d", i), "/p/a", "deploy", "ok", now.Add(-time.Duration(i+1)*time.Hour))
	}
	recordReads(t)
	digestEnv(t, claudeProvider(root))
	digestBudgetBytes = 1

	got, incomplete := searchDigest(t, "deploy", DigestSearch{})
	if !incomplete || !slices.Equal(digestIDs(got), []string{"s0"}) {
		t.Fatalf("the first transcript spends the byte budget, got %v (incomplete %v)", digestIDs(got), incomplete)
	}
}

func TestDigestWarmupPrunesWhatIsNoLongerInTheWindow(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	keep := writeDigestSession(t, root, "keep", "/p/a", "deploy", "ok", now.Add(-time.Hour))
	gone := writeDigestSession(t, root, "gone", "/p/a", "deploy", "ok", now.Add(-2*time.Hour))
	aged := writeDigestSession(t, root, "aged", "/p/a", "deploy", "ok", now.Add(-3*time.Hour))
	recordReads(t)
	digestEnv(t, claudeProvider(root))
	if got, _ := searchDigest(t, "deploy", DigestSearch{}); len(got) != 3 {
		t.Fatalf("three sessions to start with, got %v", digestIDs(got))
	}

	if err := os.Remove(gone); err != nil {
		t.Fatal(err)
	}
	old := now.AddDate(0, 0, -(DigestWindowDays + 5))
	if err := os.Chtimes(aged, old, old); err != nil {
		t.Fatal(err)
	}
	stray := filepath.Join(digestDir(), "stray.json")
	if err := os.WriteFile(stray, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	StartDigestWarmup()
	waitDigestWarmup(t)

	names := digestFiles(t)
	if want := []string{filepath.Base(digestPath(keep))}; !slices.Equal(names, want) {
		t.Fatalf("only the digest of the transcript still in the window stays: %v, want %v", names, want)
	}
}

// search reaches 90 days back: a session of two months ago is found, one of a hundred days is not
func TestDigestWindowReachesNinetyDays(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	writeDigestSession(t, root, "two-months", "/p/a", "deploy", "ok", now.AddDate(0, 0, -60))
	writeDigestSession(t, root, "edge", "/p/a", "deploy", "ok", now.AddDate(0, 0, -89))
	writeDigestSession(t, root, "too-old", "/p/a", "deploy", "ok", now.AddDate(0, 0, -100))
	recordReads(t)
	digestEnv(t, claudeProvider(root))

	got, _ := searchDigest(t, "deploy", DigestSearch{})
	if want := []string{"two-months", "edge"}; !slices.Equal(digestIDs(got), want) {
		t.Fatalf("the window holds 60 and 89 days and not 100: got %v, want %v", digestIDs(got), want)
	}
}

func TestDigestWarmupIsOneAtATime(t *testing.T) {
	root := t.TempDir()
	writeDigestSession(t, root, "a", "/p/a", "deploy", "ok", time.Now().Add(-time.Hour))
	recordReads(t)
	digestEnv(t, claudeProvider(root))

	digestWarming.Store(true)
	StartDigestWarmup() // one is running: this starts nothing
	time.Sleep(50 * time.Millisecond)
	digestWarming.Store(false)
	if n := len(digestFiles(t)); n != 0 {
		t.Fatalf("a second warm-up must not start while one runs, %d digests written", n)
	}
	StartDigestWarmup()
	waitDigestWarmup(t)
	if n := len(digestFiles(t)); n != 1 {
		t.Fatalf("the warm-up builds the digest, %d files", n)
	}
}

func TestDigestScopesByRuntimeAndProject(t *testing.T) {
	root, piRoot := t.TempDir(), t.TempDir()
	now := time.Now()
	writeDigestSession(t, root, "claude-a", "/p/a", "deploy a", "ok", now.Add(-time.Hour))
	writeDigestSession(t, root, "claude-b", "/p/b", "deploy b", "ok", now.Add(-2*time.Hour))
	writeDigestPiSession(t, piRoot, "pi-c", "/p/c", "deploy c", "ok", now.Add(-3*time.Hour))
	recordReads(t)
	digestEnv(t, claudeProvider(root), piProvider(piRoot))

	for _, tc := range []struct {
		name string
		opts DigestSearch
		want []string
	}{
		{"every runtime and project", DigestSearch{}, []string{"claude-a", "claude-b", "pi-c"}},
		{"claude", DigestSearch{Runtime: "claude"}, []string{"claude-a", "claude-b"}},
		{"pi", DigestSearch{Runtime: "pi"}, []string{"pi-c"}},
		{"a claude project", DigestSearch{Runtime: "claude", ProjectPath: "/p/b"}, []string{"claude-b"}},
		{"a project of every runtime", DigestSearch{ProjectPath: "/p/c"}, []string{"pi-c"}},
		{"a runtime with no search", DigestSearch{Runtime: "codex"}, nil},
	} {
		got, incomplete := searchDigest(t, "deploy", tc.opts)
		if incomplete || !slices.Equal(digestIDs(got), tc.want) {
			t.Errorf("%s: got %v (incomplete %v), want %v", tc.name, digestIDs(got), incomplete, tc.want)
		}
	}
	// a pi session is found through its digest as the scan finds it
	pi, _ := searchDigest(t, "deploy", DigestSearch{Runtime: "pi"})
	if s := pi[0].Session; s.Runtime != "pi" || s.ProjectPath != "/p/c" || len(s.ResumeArgs) != 2 || s.ResumeCommand == "" {
		t.Errorf("pi session = %+v", s)
	}
}

func TestDigestDropsSessionsUnderTheTempDir(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	writeDigestSession(t, root, "scratch", filepath.Join(os.TempDir(), "scratchpad"), "deploy", "ok", now.Add(-time.Hour))
	writeDigestSession(t, root, "real", "/p/a", "deploy", "ok", now.Add(-2*time.Hour))
	recordReads(t)
	digestEnv(t, claudeProvider(root))

	got, _ := searchDigest(t, "deploy", DigestSearch{})
	if !slices.Equal(digestIDs(got), []string{"real"}) {
		t.Fatalf("a throwaway session is never history, got %v", digestIDs(got))
	}
}

func TestDigestResultsAreNewestFirstWithResumeFields(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	writeDigestSession(t, root, "mid", "/p/a", "deploy mid", "ok", now.Add(-2*time.Hour))
	writeDigestSession(t, root, "new", "/p/a", "deploy new", "the deploy is done", now.Add(-time.Hour))
	writeDigestSession(t, root, "old", "/p/a", "deploy old", "ok", now.Add(-3*time.Hour))
	recordReads(t)
	digestEnv(t, claudeProvider(root))

	got, _ := searchDigest(t, "deploy", DigestSearch{MaxHits: 1})
	if ids := digestIDs(got); !slices.Equal(ids, []string{"new", "mid", "old"}) {
		t.Fatalf("newest first, got %v", ids)
	}
	r := got[0]
	if r.Session.Runtime != "claude" || r.Session.ResumeCommand != "claude --resume new" || r.Session.TranscriptPath == "" {
		t.Errorf("session = %+v", r.Session)
	}
	if r.Session.LastActiveTs != now.Add(-time.Hour).UnixMilli() {
		t.Errorf("LastActiveTs = %d, want the transcript's mtime", r.Session.LastActiveTs)
	}
	if r.TurnHits != 2 || len(r.Hits) != 1 || r.Hits[0].Kind != "turn" || r.Hits[0].Speaker != "user" {
		t.Errorf("two turn hits counted, one kept (MaxHits 1): %+v", r)
	}
}

// the one-line "finished" event of a transcript written a moment ago is left off, as the scan leaves it
func TestDigestWithoutRecentFinish(t *testing.T) {
	root := t.TempDir()
	writeDigestSession(t, root, "live", "/p/a", "deploy", "ok", time.Now().Add(-time.Second))
	writeDigestSession(t, root, "idle", "/p/a", "deploy", "ok", time.Now().Add(-time.Hour))
	recordReads(t)
	digestEnv(t, claudeProvider(root))

	got, _ := searchDigest(t, "deploy", DigestSearch{})
	if len(got) != 2 {
		t.Fatalf("got %v", digestIDs(got))
	}
	finished := func(r DigestResult) bool {
		for _, e := range r.Session.Events {
			if e.Type == "finished" {
				return true
			}
		}
		return false
	}
	if finished(got[0]) || got[0].Session.ID != "live" {
		t.Fatalf("a transcript still being written has no finished event: %+v", got[0].Session.Events)
	}
	if !finished(got[1]) {
		t.Fatalf("one idle for an hour does, or the check above proves nothing: %+v", got[1].Session.Events)
	}
}

// a read that failed is not the file's answer: no digest is written, so the next search reads it again
func TestDigestUnreadableTranscriptWritesNoDigest(t *testing.T) {
	root := t.TempDir()
	path := writeDigestSession(t, root, "a", "/p/a", "deploy", "ok", time.Now().Add(-time.Hour))
	digestEnv(t, claudeProvider(root))
	orig := readLines
	var failing atomic.Bool
	failing.Store(true)
	readLines = func(p string) ([]string, error) {
		if failing.Load() {
			return nil, errors.New("sharing violation")
		}
		return orig(p)
	}
	t.Cleanup(func() { readLines = orig })

	if got, _ := searchDigest(t, "deploy", DigestSearch{}); len(got) != 0 {
		t.Fatalf("an unreadable transcript is no result, got %v", digestIDs(got))
	}
	if _, err := os.Stat(digestPath(path)); err == nil {
		t.Fatal("no digest for a transcript that could not be read")
	}
	failing.Store(false)
	if got, _ := searchDigest(t, "deploy", DigestSearch{}); !slices.Equal(digestIDs(got), []string{"a"}) {
		t.Fatalf("read again once it can be, got %v", digestIDs(got))
	}
}

// ARC_DIGEST_MEASURE=1 go test ./pkg/agentsessions -run TestDigestMeasure -v -count=1
//
// Builds digests for the newest transcripts of the owner's ~/.claude/projects into a temp dir (never the data dir) and
// logs what that cost: bytes read, digest bytes written, build time, a whole search and the peak heap, for the RAM
// watch row in docs/open-issues.md. ARC_DIGEST_MEASURE_N sets how many transcripts (300 by default).
func TestDigestMeasure(t *testing.T) {
	if os.Getenv("ARC_DIGEST_MEASURE") != "1" {
		t.Skip("set ARC_DIGEST_MEASURE=1 to measure on the real ~/.claude/projects")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	all := walkCandidates(claudeProvider(filepath.Join(home, ".claude", "projects")), DigestWindowDays)
	var allBytes, largest int64
	for _, c := range all {
		allBytes += c.size
		largest = max(largest, c.size)
	}
	n := 300
	if v := os.Getenv("ARC_DIGEST_MEASURE_N"); v != "" {
		fmt.Sscan(v, &n)
	}
	cands := all[:min(n, len(all))]
	digestEnv(t)

	var peak atomic.Uint64
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		var ms runtime.MemStats
		for {
			runtime.ReadMemStats(&ms)
			if ms.HeapAlloc > peak.Load() {
				peak.Store(ms.HeapAlloc)
			}
			select {
			case <-stop:
				return
			case <-time.After(10 * time.Millisecond):
			}
		}
	}()

	var read int64
	built := time.Now()
	sessions := 0
	for _, c := range cands {
		read += c.size
		d, err := buildDigest(c)
		if err != nil {
			t.Fatalf("%s: %v", c.path, err)
		}
		if d.Session != nil {
			sessions++
		}
	}
	buildTime := time.Since(built)
	buildPeak := peak.Swap(0)

	var written int64
	for _, name := range digestFiles(t) {
		info, err := os.Stat(filepath.Join(digestDir(), name))
		if err != nil {
			t.Fatal(err)
		}
		written += info.Size()
	}
	// each query twice: the first search to open files just written can cost more than the ones after it
	queries := []string{"the", "deploy", "zzqxnotaword"}
	searchTimes := map[string][2]time.Duration{}
	hits := map[string]int{}
	for _, q := range queries {
		var times [2]time.Duration
		for round := range times {
			started := time.Now()
			got, skipped := searchCandidates(cands, DigestSearch{Query: ParseQuery(q), MaxHits: 20})
			times[round], hits[q] = time.Since(started), len(got)
			if skipped {
				t.Fatalf("search %q skipped digests that were just built", q)
			}
		}
		searchTimes[q] = times
	}
	close(stop)
	<-done

	mb := func(b int64) float64 { return float64(b) / (1 << 20) }
	t.Logf("window: %d transcripts, %.1f MB, the largest %.1f MB; measured the newest %d (%d with a session)", len(all), mb(allBytes), mb(largest), len(cands), sessions)
	t.Logf("read %.1f MB, wrote %.1f MB of digests in %d files, build %v", mb(read), mb(written), len(digestFiles(t)), buildTime.Round(time.Millisecond))
	for _, q := range queries {
		t.Logf("search %q over those digests: %v then %v, %d sessions", q,
			searchTimes[q][0].Round(time.Millisecond), searchTimes[q][1].Round(time.Millisecond), hits[q])
	}
	t.Logf("peak heap (HeapAlloc, garbage included, sampled every 10 ms): %.1f MB while building one transcript at a time, %.1f MB while searching",
		float64(buildPeak)/(1<<20), float64(peak.Load())/(1<<20))
}
