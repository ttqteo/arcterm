// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	judgeTestLineA = "- [Alpha rule](alpha.md) — when to read alpha"
	judgeTestLineB = "- [Beta rule](beta.md) — when to read beta"
)

// judgeTestInventory writes a memory folder (an index linking alpha and beta, plus an unlinked
// harvested gamma) and returns its inventory, as ReadInventory would give it.
func judgeTestInventory(t *testing.T) *Inventory {
	t.Helper()
	folder := t.TempDir()
	index := judgeTestLineA + "\n" + judgeTestLineB + "\n"
	writeFile(t, filepath.Join(folder, judgeIndexName), index)
	inv := &Inventory{
		Folder:     folder,
		IndexPath:  filepath.Join(folder, judgeIndexName),
		IndexLines: []string{judgeTestLineA, judgeTestLineB},
		Index:      wshrpc.MemIndexStats{Exists: true, Lines: 2, Bytes: len(index)},
		Sessions:   10,
	}
	for _, m := range []struct{ name, body, line string }{
		{"alpha.md", "Alpha says one thing. Verified 2026-07-24.\n", judgeTestLineA},
		{"beta.md", "Beta says the same thing.\n", judgeTestLineB},
		{"gamma.md", "---\nsource: codex\nsource_hash: abc\nharvested_at: 2026-01-01\n---\nGamma rule.\n", ""},
	} {
		path := filepath.Join(folder, m.name)
		writeFile(t, path, m.body)
		hash, err := HashFile(path)
		if err != nil {
			t.Fatal(err)
		}
		mem := Memory{Name: m.name, Path: path, Sha256: hash, Size: len(m.body), Body: m.body, IndexLine: m.line}
		if m.name == "gamma.md" {
			mem.Body = "Gamma rule.\n"
			mem.Frontmatter = map[string]string{"source": "codex", "source_hash": "abc", "harvested_at": "2026-01-01"}
		}
		inv.Memories = append(inv.Memories, mem)
	}
	return inv
}

func TestBatchesCapAt60KB(t *testing.T) {
	kb := func(n int) string { return strings.Repeat("x", n<<10) }
	mems := []Memory{
		{Name: "a", Body: kb(30)},
		{Name: "b", Body: kb(30)}, // exactly at the cap with a
		{Name: "c", Body: kb(1)},
		{Name: "d", Body: kb(70)}, // over the cap alone
		{Name: "e", Body: kb(10)},
		{Name: "f", Body: kb(10)},
	}
	var got [][]string
	for _, batch := range Batches(mems) {
		var names []string
		size := 0
		for _, m := range batch {
			names = append(names, m.Name)
			size += len(m.Body)
		}
		if size > judgeBatchBytes && len(batch) > 1 {
			t.Errorf("batch %v holds %d bytes, over the cap", names, size)
		}
		got = append(got, names)
	}
	want := [][]string{{"a", "b"}, {"c"}, {"d"}, {"e", "f"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Batches = %v, want %v", got, want)
	}
}

func TestParseJudgeFencedAndProse(t *testing.T) {
	inv := judgeTestInventory(t)
	obj := `{"changes": [{"kind": "delete", "title": "Stale alpha", "files": ["alpha.md"]}]}`
	for name, reply := range map[string]string{
		"bare":   obj,
		"fenced": "Here is my review {as asked}.\n```json\n" + obj + "\n```\nThat's all.",
		"prose":  "I looked at {both} memories. " + obj + " Let me know.",
	} {
		changes, err := ParseJudge(reply, inv, filepath.Join(t.TempDir(), judgeDocAgents))
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if len(changes) != 1 || changes[0].Kind != judgeKindDelete || changes[0].Title != "Stale alpha" {
			t.Fatalf("%s: got %+v", name, changes)
		}
	}
}

func TestParseJudgeTruncatedIsError(t *testing.T) {
	inv := judgeTestInventory(t)
	for name, reply := range map[string]string{
		"truncated": "```json\n{\"changes\": [{\"kind\": \"delete\", \"title\": \"Stale alpha\", \"files\": [\"alpha.md\"]}",
		"no json":   "I found nothing worth changing.",
		"bad value": `{"changes": {"kind": "delete"}}`,
		"bad kind":  `{"changes": [{"kind": "rename", "files": ["alpha.md"]}]}`,
	} {
		if changes, err := ParseJudge(reply, inv, judgeDocAgents); err == nil {
			t.Fatalf("%s: want an error, got %+v", name, changes)
		}
	}
}

func TestParseJudgeBuildsOpAndHashes(t *testing.T) {
	inv := judgeTestInventory(t)
	project := t.TempDir()
	doc := filepath.Join(project, judgeDocAgents)
	writeFile(t, doc, "# Repo\n\n## Gotchas\n\n- one\n")
	reply := `{"changes": [
		{"kind": "delete", "title": "Stale alpha", "files": ["alpha.md"], "evidence": [{"tone": "warn", "text": "Names a file that is gone: ", "code": "x.go"}, {"tone": "loud", "text": "odd tone"}]},
		{"kind": "trim", "title": "Drop a date", "files": ["alpha.md"], "old": " Verified 2026-07-24.", "new": ""},
		{"kind": "merge", "title": "Two say one thing", "files": ["alpha.md", "beta.md"], "merge_name": "alpha-beta.md", "merge_body": "One thing.\n", "index_line": "- [One thing](alpha-beta.md) — both"},
		{"kind": "move-to-doc", "title": "The repo should own it", "files": ["beta.md"], "section": "## Gotchas", "passage": "- beta rule"},
		{"kind": "add-to-index", "title": "Worth loading", "files": ["gamma.md"], "index_line": "- [Gamma](gamma.md) — gamma"}
	]}`
	changes, err := ParseJudge(reply, inv, doc)
	if err != nil {
		t.Fatal(err)
	}
	if len(changes) != 5 {
		t.Fatalf("got %d changes, want 5", len(changes))
	}
	hash := func(path string) string {
		h, err := HashFile(path)
		if err != nil {
			t.Fatal(err)
		}
		return h
	}
	alpha := filepath.Join(inv.Folder, "alpha.md")
	beta := filepath.Join(inv.Folder, "beta.md")
	gamma := filepath.Join(inv.Folder, "gamma.md")
	alphaRef := wshrpc.MemFileRef{Path: alpha, Sha256: hash(alpha)}
	betaRef := wshrpc.MemFileRef{Path: beta, Sha256: hash(beta)}
	for _, c := range changes {
		if c.Id != ChangeID(c.Kind, c.Files) || c.Status != "open" {
			t.Errorf("%s: id %q status %q, want ChangeID and open", c.Kind, c.Id, c.Status)
		}
	}

	del := changes[0]
	if want := []wshrpc.MemFileRef{alphaRef}; !reflect.DeepEqual(del.Files, want) {
		t.Errorf("delete files = %+v, want %+v (the index stays out)", del.Files, want)
	}
	if !reflect.DeepEqual(del.Op.IndexRemove, []string{judgeTestLineA}) || del.Op.Folder != inv.Folder || !reflect.DeepEqual(del.Op.Memories, []string{"alpha.md"}) {
		t.Errorf("delete op = %+v", del.Op)
	}
	lineBytes := len(judgeTestLineA) + 1
	if del.IndexDelta != (wshrpc.MemIndexDelta{Lines: -1, Bytes: -lineBytes}) {
		t.Errorf("delete index delta = %+v", del.IndexDelta)
	}
	if want := "Index −" + judgeBytes(lineBytes); del.Effect != want || del.ApplyLabel != "Delete memory" {
		t.Errorf("delete effect %q label %q, want %q and Delete memory", del.Effect, del.ApplyLabel, want)
	}
	if del.Evidence[0].Code != "x.go" || del.Evidence[1].Tone != "none" {
		t.Errorf("delete evidence = %+v", del.Evidence)
	}
	if len(del.Diffs) != 2 || del.Diffs[0].Path != judgeIndexName || del.Diffs[0].Note != "−1 line" || del.Diffs[1].Note != "deleted · "+judgeBytes(inv.Memories[0].Size) || len(del.Diffs[1].Lines) != 1 {
		t.Errorf("delete diffs = %+v", del.Diffs)
	}

	trim := changes[1]
	if want := []wshrpc.MemFileRef{alphaRef}; !reflect.DeepEqual(trim.Files, want) {
		t.Errorf("trim files = %+v, want only the memory (the index line stays)", trim.Files)
	}
	if trim.Op.Old != " Verified 2026-07-24." || trim.Op.New != "" || len(trim.Op.IndexRemove) != 0 {
		t.Errorf("trim op = %+v", trim.Op)
	}
	if trim.Effect != "Body −21 B" || trim.ApplyLabel != "Apply trim" || trim.Note != "The index line stays as it is." {
		t.Errorf("trim effect %q label %q note %q", trim.Effect, trim.ApplyLabel, trim.Note)
	}

	merge := changes[2]
	newRef := wshrpc.MemFileRef{Path: filepath.Join(inv.Folder, "alpha-beta.md"), Sha256: ""}
	if want := []wshrpc.MemFileRef{alphaRef, betaRef, newRef}; !reflect.DeepEqual(merge.Files, want) {
		t.Errorf("merge files = %+v, want %+v", merge.Files, want)
	}
	if merge.Op.WriteName != "alpha-beta.md" || merge.Op.WriteBody != "One thing.\n" || !reflect.DeepEqual(merge.Op.IndexRemove, []string{judgeTestLineA, judgeTestLineB}) {
		t.Errorf("merge op = %+v", merge.Op)
	}
	if merge.IndexDelta.Lines != -1 || merge.Diffs[0].Note != "2 lines → 1" || merge.ApplyLabel != "Merge entries" {
		t.Errorf("merge delta %+v diffs %+v label %q", merge.IndexDelta, merge.Diffs, merge.ApplyLabel)
	}

	move := changes[3]
	if want := []wshrpc.MemFileRef{betaRef}; !reflect.DeepEqual(move.Files, want) {
		t.Errorf("move files = %+v, want %+v (the doc stays out)", move.Files, want)
	}
	if move.Op.DocPath != doc || move.Op.DocSection != "## Gotchas" || move.Op.DocPassage != "- beta rule" || move.ApplyLabel != "Move to AGENTS.md" {
		t.Errorf("move op = %+v label %q", move.Op, move.ApplyLabel)
	}

	add := changes[4]
	if want := []wshrpc.MemFileRef{{Path: gamma, Sha256: hash(gamma)}}; !reflect.DeepEqual(add.Files, want) {
		t.Errorf("add files = %+v, want %+v", add.Files, want)
	}
	if !add.Op.StripHarvester || add.Op.IndexAdd != "- [Gamma](gamma.md) — gamma" || len(add.Op.IndexRemove) != 0 || add.IndexDelta.Lines != 1 {
		t.Errorf("add op = %+v delta %+v", add.Op, add.IndexDelta)
	}
	if last := add.Diffs[len(add.Diffs)-1]; last.Note != "frontmatter" || len(last.Lines) != 3 {
		t.Errorf("add diffs = %+v", add.Diffs)
	}
}

func TestDocTargetPrefersClaudeMd(t *testing.T) {
	project := t.TempDir()
	agents, claude := filepath.Join(project, judgeDocAgents), filepath.Join(project, judgeDocClaude)
	if got := DocTarget(project); got != agents {
		t.Fatalf("no doc: DocTarget = %q, want %q", got, agents)
	}
	writeFile(t, agents, "# Agents\n")
	if got := DocTarget(project); got != agents {
		t.Fatalf("AGENTS.md only: DocTarget = %q, want %q", got, agents)
	}
	writeFile(t, claude, "# Claude\n")
	if got := DocTarget(project); got != claude {
		t.Fatalf("both: DocTarget = %q, want %q", got, claude)
	}

	inv := judgeTestInventory(t)
	docs := map[string]string{claude: "# Claude\n", agents: "# Agents\n"}
	prompt := JudgePrompt(inv, inv.Memories, docs, claude)
	if !strings.Contains(prompt, "heading in CLAUDE.md") {
		t.Errorf("prompt doesn't name CLAUDE.md as the move target")
	}
	changes, err := ParseJudge(`{"changes": [{"kind": "move-to-doc", "files": ["beta.md"], "section": "Claude", "passage": "x"}]}`, inv, claude)
	if err != nil {
		t.Fatal(err)
	}
	if changes[0].ApplyLabel != "Move to CLAUDE.md" || changes[0].Op.DocPath != claude {
		t.Fatalf("label %q doc %q, want Move to CLAUDE.md at %s", changes[0].ApplyLabel, changes[0].Op.DocPath, claude)
	}
}

func TestJudgePromptCarriesIndexBatchAndDocs(t *testing.T) {
	inv := judgeTestInventory(t)
	doc := filepath.Join(t.TempDir(), judgeDocAgents)
	prompt := JudgePrompt(inv, inv.Memories[:1], map[string]string{doc: "DOC-CONTENT"}, doc)
	for _, want := range []string{judgeTestLineA, judgeTestLineB, "### alpha.md", "Verified 2026-07-24", "DOC-CONTENT", `"changes"`} {
		if !strings.Contains(prompt, want) {
			t.Errorf("prompt lacks %q", want)
		}
	}
	if strings.Contains(prompt, "Beta says") {
		t.Errorf("prompt carries a body outside the batch")
	}
}

// everything after the fixed instructions, exactly: the index, each memory with its index line or the lack of
// one, dead links only when there are some, and the no-doc warning only when the target doc is missing
func TestJudgePromptSectionsExact(t *testing.T) {
	line := "- [A](a.md) — hook a"
	inv := &Inventory{
		IndexLines: []string{line},
		Memories:   []Memory{{Name: "a.md", IndexLine: line, Body: "A body"}, {Name: "b.md", Body: "B body"}},
		Sessions:   3,
	}
	doc := filepath.Join(t.TempDir(), judgeDocAgents)
	memories := "\n## Memories to review\n" +
		"\n### a.md\n\nIndex line: " + line + "\nRead in 0 of 3 sessions\nBody:\nA body\n" +
		"\n### b.md\n\nIndex line: none (the index doesn't link it)\nRead in 0 of 3 sessions\nBody:\nB body\n"

	want := "## The whole index (MEMORY.md)\n\n" + line + "\n" + memories +
		"\n## Instruction docs\n" + "\n### " + doc + "\n\nDOC\n"
	if got := JudgePrompt(inv, inv.Memories, map[string]string{doc: "DOC"}, doc); !strings.HasSuffix(got, want) {
		t.Errorf("prompt does not end with\n%s\n---\ngot\n%s", want, got)
	}

	inv.DeadLinks = []string{"gone.md"}
	want = "## The whole index (MEMORY.md)\n\n" + line + "\n" +
		"\nIndex links to files that don't exist: gone.md\n" + memories +
		"\n## Instruction docs\n" + "\nThe project has no AGENTS.md, so propose no move-to-doc.\n"
	if got := JudgePrompt(inv, inv.Memories, map[string]string{}, doc); !strings.HasSuffix(got, want) {
		t.Errorf("prompt does not end with\n%s\n---\ngot\n%s", want, got)
	}
}

func TestModelRefusesToolsInInit(t *testing.T) {
	base, ok := consult.SpecFor("claude")
	if !ok {
		t.Fatal("no claude spec")
	}
	cancelled := false
	spec, guard, err := modelNoTools(base, func() { cancelled = true })
	if err != nil {
		t.Fatal(err)
	}
	args := strings.Join(spec.BaseArgs, "|")
	if !strings.Contains(args, `|--tools||--strict-mcp-config`) {
		t.Fatalf("args %q lack --tools \"\" --strict-mcp-config", spec.BaseArgs)
	}
	if ev := spec.ParseLine([]byte(`{"type":"system","subtype":"init","tools":[]}`)); ev.Err != nil || cancelled {
		t.Fatalf("an init with no tools failed: %v", ev.Err)
	}
	if ev := spec.ParseLine([]byte(`{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}`)); ev.Text != "hi" {
		t.Fatalf("assistant text didn't pass through: %+v", ev)
	}
	ev := spec.ParseLine([]byte(`{"type":"system","subtype":"init","tools":["Read","Bash"]}`))
	if ev.Err == nil || !strings.Contains(ev.Err.Error(), "Read, Bash") || !cancelled || guard.failure == nil {
		t.Fatalf("an init with tools: err %v cancelled %v", ev.Err, cancelled)
	}

	pi, _ := consult.SpecFor("pi")
	if _, _, err := modelNoTools(pi, func() {}); err == nil || !strings.Contains(err.Error(), "pi") {
		t.Fatalf("pi: want an error naming the runtime, got %v", err)
	}
	api, _ := consult.SpecFor("openrouter")
	if got, g, err := modelNoTools(api, func() {}); err != nil || g != nil || len(got.BaseArgs) != 0 {
		t.Fatalf("openrouter: want the spec unchanged, got %+v %v", got, err)
	}
}

func TestParseSort(t *testing.T) {
	reply := "Sorted:\n```json\n" + `{"sort": {"hub.md": ["cyber_assistant"], "branches.md": ["cyber_assistant", "MP-Frontend", "other"]}}` + "\n```"
	got, err := ParseSort(reply)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string][]string{"hub.md": {"cyber_assistant"}, "branches.md": {"cyber_assistant", "MP-Frontend", "other"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ParseSort = %v, want %v", got, want)
	}
	if _, err := ParseSort(`{"sort": {"hub.md": ["cyber_assistant"]`); err == nil {
		t.Fatal("truncated sort: want an error")
	}

	inv := judgeTestInventory(t)
	inv.Memories[0].Description = "ALPHA-DESC"
	prompt := SortPrompt(inv, []string{"cyber_assistant", "MP-Frontend"})
	for _, want := range []string{"cyber_assistant, MP-Frontend", judgeTestLineA, "ALPHA-DESC", `"other"`} {
		if !strings.Contains(prompt, want) {
			t.Errorf("sort prompt lacks %q", want)
		}
	}
	if strings.Contains(prompt, "Alpha says") {
		t.Errorf("sort prompt carries a body")
	}
}

func TestIndexBudget(t *testing.T) {
	for _, tc := range []struct {
		name  string
		lines []string
		want  int
	}{
		{"header budget", []string{"# Memory index", "Budget: 12,000 bytes, checked with wc -c."}, 12000},
		{"no budget", []string{"# Memory index"}, LimitBytes},
		{"a memory line naming a budget is not the index's", []string{"- [Cap](cap.md) — budget: 500 bytes per file"}, LimitBytes},
		{"above claude code's limit", []string{"Budget: 90000 bytes"}, LimitBytes},
	} {
		if got := IndexBudget(tc.lines); got != tc.want {
			t.Errorf("%s: IndexBudget = %d, want %d", tc.name, got, tc.want)
		}
	}
}

// over budget, each batch is asked for its share of the cut, by its memories' index-line bytes
func TestJudgePromptBudgetShare(t *testing.T) {
	a, b := "- [A](a.md) — "+strings.Repeat("a", 85), "- [B](b.md) — "+strings.Repeat("b", 285)
	inv := &Inventory{
		IndexLines: []string{"Budget: 100 bytes", a, b},
		Index:      wshrpc.MemIndexStats{Exists: true, Lines: 3, Bytes: 500},
		Memories:   []Memory{{Name: "a.md", IndexLine: a}, {Name: "b.md", IndexLine: b}},
	}
	lineA, lineB := len(a)+1, len(b)+1
	share := (400*lineA + lineA + lineB - 1) / (lineA + lineB)
	got := JudgePrompt(inv, inv.Memories[:1], nil, "AGENTS.md")
	want := fmt.Sprintf("The index is 500 bytes, 400 over its 100-byte budget, and every session pays for each of its lines. The index lines of the memories below take %d bytes, so propose changes that cut at least %d bytes from the index.", lineA, share)
	if !strings.Contains(got, want) || strings.Contains(got, "Proposing nothing is a fine answer") {
		t.Fatalf("over-budget prompt lacks %q or still invites no change:\n%s", want, got)
	}

	inv.Index.Bytes = 90
	got = JudgePrompt(inv, inv.Memories, nil, "AGENTS.md")
	if !strings.Contains(got, "The index is 90 bytes of its 100-byte budget. Proposing nothing is a fine answer.") {
		t.Fatalf("under-budget prompt:\n%s", got)
	}
}
