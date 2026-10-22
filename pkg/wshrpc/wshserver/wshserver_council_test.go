// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// useCouncilStore points the council store and the config dir (councilroles.json) at temp dirs, so a test never
// reads or writes the person's own.
func useCouncilStore(t *testing.T) {
	t.Helper()
	t.Cleanup(council.UseRootForTest(t.TempDir()))
	prev := wavebase.ConfigHome_VarCache
	wavebase.ConfigHome_VarCache = t.TempDir()
	t.Cleanup(func() { wavebase.ConfigHome_VarCache = prev })
}

func saveCouncil(t *testing.T, c *council.Council) *council.Council {
	t.Helper()
	if err := council.Save(c); err != nil {
		t.Fatalf("save council %s: %v", c.Id, err)
	}
	return c
}

func councilIds(cs []*council.Council) []string {
	ids := make([]string, len(cs))
	for i, c := range cs {
		ids[i] = c.Id
	}
	sort.Strings(ids)
	return ids
}

func writeCouncilFile(t *testing.T, path string, size int) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(strings.Repeat("x", size)), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestCouncilGetAndListByProject(t *testing.T) {
	useCouncilStore(t)
	ws := &WshServer{}
	ctx := context.Background()
	p1, p2 := t.TempDir(), t.TempDir()
	saveCouncil(t, &council.Council{Id: "a", Project: p1, Feature: "Idle sleep", State: council.StateDone})
	saveCouncil(t, &council.Council{Id: "b", Project: p2, Feature: "Dark mode", State: council.StateRunning, Round: 1})
	saveCouncil(t, &council.Council{Id: "c", Project: p1, Feature: "Palette row", State: council.StateNotRun})

	got, err := ws.CouncilGetCommand(ctx, wshrpc.CommandCouncilIdData{Id: "a"})
	if err != nil {
		t.Fatalf("CouncilGetCommand: %v", err)
	}
	if got.Id != "a" || got.Feature != "Idle sleep" || got.Project != p1 || got.State != council.StateDone {
		t.Errorf("get a = %+v", got)
	}
	if _, err := ws.CouncilGetCommand(ctx, wshrpc.CommandCouncilIdData{Id: "missing"}); err == nil {
		t.Error("get of a council that does not exist should fail")
	}
	if _, err := ws.CouncilGetCommand(ctx, wshrpc.CommandCouncilIdData{}); err == nil {
		t.Error("get with no id should fail")
	}

	for _, tc := range []struct {
		project string
		want    []string
	}{
		{p1, []string{"a", "c"}},
		{p2, []string{"b"}},
		{t.TempDir(), []string{}},
		{"", []string{"a", "b", "c"}},
	} {
		list, err := ws.CouncilListCommand(ctx, wshrpc.CommandCouncilListData{Project: tc.project})
		if err != nil {
			t.Fatalf("CouncilListCommand(%q): %v", tc.project, err)
		}
		if list == nil {
			t.Errorf("list(%q) = nil, want an empty list the frontend can map over", tc.project)
		}
		if ids := councilIds(list); !reflect.DeepEqual(ids, tc.want) {
			t.Errorf("list(%q) = %v, want %v", tc.project, ids, tc.want)
		}
	}
}

func TestCouncilListHidesBenchCouncils(t *testing.T) {
	useCouncilStore(t)
	ws := &WshServer{}
	ctx := context.Background()
	p := t.TempDir()
	saveCouncil(t, &council.Council{Id: "real", Project: p, Feature: "Idle sleep", State: council.StateDone})
	saveCouncil(t, &council.Council{Id: "bench-done", Project: p, Feature: "Idle sleep", State: council.StateDone, Bench: true})
	saveCouncil(t, &council.Council{Id: "bench-queued", Project: p, Feature: "Idle sleep", State: council.StateQueued, Bench: true})

	for _, project := range []string{p, ""} {
		list, err := ws.CouncilListCommand(ctx, wshrpc.CommandCouncilListData{Project: project})
		if err != nil {
			t.Fatalf("CouncilListCommand(%q): %v", project, err)
		}
		if ids := councilIds(list); !reflect.DeepEqual(ids, []string{"real"}) {
			t.Errorf("list(%q) = %v, want only the council the person started", project, ids)
		}
	}

	// the filter is the cockpit's list only: a bench council loads by id, and the queue, which reads the store, still sees it
	got, err := ws.CouncilGetCommand(ctx, wshrpc.CommandCouncilIdData{Id: "bench-done"})
	if err != nil || !got.Bench {
		t.Errorf("CouncilGetCommand of a bench council = %+v, %v, want it loaded", got, err)
	}
	all, err := council.List("")
	if err != nil || !reflect.DeepEqual(councilIds(all), []string{"bench-done", "bench-queued", "real"}) {
		t.Errorf("council.List(\"\") = %v, %v, want the store to hold all three", councilIds(all), err)
	}
}

func TestCouncilEstimateWholeCouncil(t *testing.T) {
	useCouncilStore(t)
	ws := &WshServer{}
	ctx := context.Background()
	experts, err := council.ExpertsFor("ui-feature")
	if err != nil {
		t.Fatalf("ExpertsFor: %v", err)
	}

	est, err := ws.CouncilEstimateCommand(ctx, wshrpc.CommandCouncilEstimateData{Experts: experts})
	if err != nil {
		t.Fatalf("CouncilEstimateCommand: %v", err)
	}
	if want := (wshrpc.CouncilEstimateRtnData{Calls: 9, Tokens: 820_000, Minutes: 6}); *est != want {
		t.Errorf("UI group with no files = %+v, want %+v", *est, want)
	}

	// a path is under the project, a folder counts its files but not .git or node_modules, and a path that is not
	// there counts for nothing
	project := t.TempDir()
	writeCouncilFile(t, filepath.Join(project, "a.txt"), 4000)
	writeCouncilFile(t, filepath.Join(project, "src", "b.txt"), 300)
	writeCouncilFile(t, filepath.Join(project, "src", "deep", "c.txt"), 100)
	writeCouncilFile(t, filepath.Join(project, "src", "node_modules", "x.txt"), 10_000)
	writeCouncilFile(t, filepath.Join(project, "src", ".git", "y"), 10_000)
	outside := filepath.Join(t.TempDir(), "abs.txt")
	writeCouncilFile(t, outside, 400)
	est, err = ws.CouncilEstimateCommand(ctx, wshrpc.CommandCouncilEstimateData{
		Project: project, Files: []string{"a.txt", "src", "missing.txt", outside}, Experts: experts,
	})
	if err != nil {
		t.Fatalf("estimate with files: %v", err)
	}
	// 4800 bytes are 1200 tokens read by each of the four experts
	if want := (wshrpc.CouncilEstimateRtnData{Calls: 9, Tokens: 820_000 + 4*1200, Minutes: 6}); *est != want {
		t.Errorf("with files = %+v, want %+v", *est, want)
	}
}

func TestCouncilEstimateOfASavedCouncil(t *testing.T) {
	useCouncilStore(t)
	ws := &WshServer{}
	ctx := context.Background()
	experts, err := council.ExpertsFor("ui-feature")
	if err != nil {
		t.Fatalf("ExpertsFor: %v", err)
	}
	saveCouncil(t, &council.Council{
		Id: "c1", Project: t.TempDir(), Feature: "Idle sleep", Experts: experts, State: council.StateAwaiting, Round: 1,
		Failed: map[string]council.CouncilFailure{"ux": {Round: 1, Error: "timeout"}},
	})

	for _, tc := range []struct {
		name string
		data wshrpc.CommandCouncilEstimateData
		want wshrpc.CouncilEstimateRtnData
	}{
		{"remaining skips the expert whose round 1 failed", wshrpc.CommandCouncilEstimateData{Id: "c1"},
			wshrpc.CouncilEstimateRtnData{Calls: 4, Tokens: 3*45_000 + 80_000, Minutes: 3}},
		{"a follow-up of two experts", wshrpc.CommandCouncilEstimateData{Id: "c1", Followup: 2},
			wshrpc.CouncilEstimateRtnData{Calls: 2, Tokens: 40_000, Minutes: 1}},
		{"a follow-up that reads code", wshrpc.CommandCouncilEstimateData{Id: "c1", Followup: 2, Tools: true},
			wshrpc.CouncilEstimateRtnData{Calls: 2, Tokens: 180_000, Minutes: 2}},
	} {
		got, err := ws.CouncilEstimateCommand(ctx, tc.data)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if *got != tc.want {
			t.Errorf("%s = %+v, want %+v", tc.name, *got, tc.want)
		}
	}
	if _, err := ws.CouncilEstimateCommand(ctx, wshrpc.CommandCouncilEstimateData{Id: "missing"}); err == nil {
		t.Error("the remaining estimate of a council that does not exist should fail")
	}
}

// TestCouncilSaveDocWritesTheDocument: the command writes the whole document (report, discussion, run facts) at the
// default path and keeps that path on the council, so a second save rewrites the same file. The path rules themselves
// are council.DocPath's tests.
func TestCouncilSaveDocWritesTheDocument(t *testing.T) {
	events := useCouncilRig(t, newCouncilFake())
	prevDay := council.DocDay
	t.Cleanup(func() { council.DocDay = prevDay })
	council.DocDay = func() time.Time { return time.Date(2026, 10, 21, 9, 0, 0, 0, time.Local) }
	ws := &WshServer{}
	ctx := context.Background()
	project := t.TempDir()
	c := saveCouncil(t, &council.Council{
		Id: "c1", Project: project, Feature: "Idle sleep for services!", State: council.StateDone,
		Experts:   []council.CouncilExpert{{Id: "ux", Name: "UX", Model: "sonnet"}, {Id: "lead", Name: "Lead", Model: "opus", Coordinator: true}},
		Proposals: []council.CouncilProposal{{Id: "P1", Author: "ux", Title: "Sleep after a minute", Argument: "It saves RAM.", Ts: 1}},
		Summary: &council.CouncilSummary{
			Text:       "Sleep an idle service after a minute.",
			Directions: []council.CouncilDirection{{Rank: 1, Title: "Sleep after a minute", Reasoning: "It saves RAM.", Agreed: true}},
		},
	})

	got, err := ws.CouncilSaveDocCommand(ctx, wshrpc.CommandCouncilSaveDocData{Id: "c1"})
	if err != nil {
		t.Fatalf("CouncilSaveDocCommand: %v", err)
	}
	want := filepath.Join(project, "docs", "council", "2026-10-21-idle-sleep-for-services.md")
	if got.Path != want {
		t.Errorf("default path = %q, want %q", got.Path, want)
	}
	body, err := os.ReadFile(want)
	if err != nil {
		t.Fatalf("the doc was not written: %v", err)
	}
	if string(body) != council.Document(c) {
		t.Errorf("the doc is not council.Document:\n%s", body)
	}
	for _, w := range []string{"# Council: Idle sleep for services!", "## The discussion", "**UX** proposes", "## Run facts"} {
		if !strings.Contains(string(body), w) {
			t.Errorf("the doc lacks %q:\n%s", w, body)
		}
	}

	// the default path is kept on the council and announced, and a second save writes the same file
	saved, err := council.Load("c1")
	if err != nil || saved.DocPath != want {
		t.Fatalf("DocPath after the save = %q, %v, want %q", saved.DocPath, err, want)
	}
	if evs := events.all(); len(evs) != 1 || evs[0].Id != "c1" {
		t.Errorf("events = %+v, want one change for c1", evs)
	}
	if again, err := ws.CouncilSaveDocCommand(ctx, wshrpc.CommandCouncilSaveDocData{Id: "c1"}); err != nil || again.Path != want {
		t.Errorf("second save = %+v, %v, want the same file %q", again, err, want)
	}
	files, _ := os.ReadDir(filepath.Dir(want))
	if len(files) != 1 {
		t.Errorf("docs/council holds %d files after two saves, want 1", len(files))
	}
}

func TestCouncilSaveDocPickedPathAndRefusals(t *testing.T) {
	useCouncilStore(t)
	ws := &WshServer{}
	ctx := context.Background()
	project, elsewhere := t.TempDir(), t.TempDir()
	saveCouncil(t, &council.Council{Id: "c1", Project: project, Feature: "Idle sleep", State: council.StateDone})

	// a relative path is under the project, an absolute one inside it is kept as it is
	got, err := ws.CouncilSaveDocCommand(ctx, wshrpc.CommandCouncilSaveDocData{Id: "c1", Path: "notes/out.md"})
	if err != nil {
		t.Fatalf("relative path: %v", err)
	}
	if want := filepath.Join(project, "notes", "out.md"); got.Path != want {
		t.Errorf("relative path = %q, want %q", got.Path, want)
	}
	inside := filepath.Join(project, "abs.md")
	if got, err = ws.CouncilSaveDocCommand(ctx, wshrpc.CommandCouncilSaveDocData{Id: "c1", Path: inside}); err != nil || got.Path != inside {
		t.Fatalf("absolute path inside the project = %+v, %v", got, err)
	}
	if saved, err := council.Load("c1"); err != nil || saved.DocPath != inside {
		t.Errorf("DocPath after a save by hand = %q, %v, want the path it was saved at", saved.DocPath, err)
	}

	outside := filepath.Join(elsewhere, "x.md")
	for _, path := range []string{outside, filepath.Join("..", filepath.Base(elsewhere), "x.md"), "../x.md", "docs/../../x.md", "..", "."} {
		if got, err := ws.CouncilSaveDocCommand(ctx, wshrpc.CommandCouncilSaveDocData{Id: "c1", Path: path}); err == nil {
			t.Errorf("path %q was written to %q, want a refusal", path, got.Path)
		}
	}
	if _, err := os.Stat(outside); err == nil {
		t.Errorf("%s was written", outside)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(project), "x.md")); err == nil {
		t.Error("a file was written next to the project")
	}

	if _, err := ws.CouncilSaveDocCommand(ctx, wshrpc.CommandCouncilSaveDocData{Id: "missing"}); err == nil {
		t.Error("saving a doc of a council that does not exist should fail")
	}
	saveCouncil(t, &council.Council{Id: "c2", Feature: "No project", State: council.StateDone})
	if _, err := ws.CouncilSaveDocCommand(ctx, wshrpc.CommandCouncilSaveDocData{Id: "c2"}); err == nil {
		t.Error("a council with no project has nowhere to save a doc")
	}
}

func TestCouncilRolesAndSaveGroup(t *testing.T) {
	useCouncilStore(t)
	ws := &WshServer{}
	ctx := context.Background()

	roles, err := ws.CouncilRolesCommand(ctx)
	if err != nil {
		t.Fatalf("CouncilRolesCommand: %v", err)
	}
	hasRole, hasGroup := map[string]bool{}, map[string]bool{}
	for _, r := range roles.Roles {
		hasRole[r.Id] = true
	}
	for _, g := range roles.Groups {
		hasGroup[g.Id] = true
	}
	for _, id := range []string{"ux", "ram", "newuser", "skeptic", "coordinator"} {
		if !hasRole[id] {
			t.Errorf("role %q missing from %v", id, roles.Roles)
		}
	}
	if !hasGroup["ui-feature"] || hasGroup["mine"] {
		t.Errorf("groups = %v, want ui-feature and no mine yet", roles.Groups)
	}

	mine := council.CouncilGroup{Id: "mine", Name: "Mine", Roles: []string{"ux", "skeptic"}, Coordinator: "coordinator"}
	if err := ws.CouncilSaveGroupCommand(ctx, mine); err != nil {
		t.Fatalf("CouncilSaveGroupCommand: %v", err)
	}
	roles, err = ws.CouncilRolesCommand(ctx)
	if err != nil {
		t.Fatalf("CouncilRolesCommand after save: %v", err)
	}
	var found *council.CouncilGroup
	for i := range roles.Groups {
		if roles.Groups[i].Id == "mine" {
			found = &roles.Groups[i]
		}
	}
	if found == nil || !reflect.DeepEqual(*found, mine) {
		t.Errorf("saved group came back as %+v, want %+v", found, mine)
	}
	if err := ws.CouncilSaveGroupCommand(ctx, council.CouncilGroup{Name: "No id"}); err == nil {
		t.Error("a group with no id should be refused")
	}
}

// ---- the runner ----

// councilFake is the council.Caller of these tests. It answers every call with canned JSON for its round and records
// the requests. A call is keyed "<expert id>/<kind>", kind being r1, r2, r3, ans or suggest: a test can make a key
// fail, or hold it until the council is stopped.
type councilFake struct {
	mu      sync.Mutex
	reqs    []council.CallReq
	failure map[string]error
	held    map[string]chan struct{} // closed when the held call starts
}

func newCouncilFake() *councilFake {
	return &councilFake{failure: map[string]error{}, held: map[string]chan struct{}{}}
}

func councilCallKind(prompt string) string {
	switch {
	case strings.Contains(prompt, "This is round 1 of 3"):
		return "r1"
	case strings.Contains(prompt, "This is round 2 of 3"):
		return "r2"
	case strings.Contains(prompt, "This is round 3 of 3"):
		return "r3"
	case strings.Contains(prompt, "The council has already met"):
		return "ans"
	case strings.Contains(prompt, "about to review one feature"):
		return "suggest"
	}
	return "?"
}

var (
	councilProposalHead = regexp.MustCompile(`(?m)^### (P\d+) · `)
	councilAskLine      = regexp.MustCompile(`(?m)^- \[(r\d+)\]`)
	councilReplyHead    = regexp.MustCompile(`(?m)^## Reply (r\d+)$`)
)

// councilSection is the body of a "## heading" section of a prompt, or "" when it has none.
func councilSection(prompt, heading string) string {
	_, rest, ok := strings.Cut(prompt, heading+"\n")
	if !ok {
		return ""
	}
	body, _, _ := strings.Cut(rest, "\n## ")
	return body
}

func councilIdsIn(re *regexp.Regexp, text string) []string {
	var out []string
	for _, m := range re.FindAllStringSubmatch(text, -1) {
		out = append(out, m[1])
	}
	return out
}

func councilFenced(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return "My answer follows.\n\n```json\n" + string(b) + "\n```\n"
}

func councilAnswers(expert string, ids []string) []map[string]any {
	answers := []map[string]any{}
	for _, id := range ids {
		answers = append(answers, map[string]any{"replyid": id, "text": "Answer from " + expert})
	}
	return answers
}

func councilCanned(req council.CallReq, kind string) string {
	switch kind {
	case "r1":
		return councilFenced(map[string]any{
			"overview": "Looks fine.",
			"proposals": []map[string]any{{
				"title": "Title from " + req.Expert.Id, "argument": "Argument from " + req.Expert.Id,
				"evidence": []map[string]string{{"ref": "pkg/" + req.Expert.Id + ".go:1"}},
			}},
		})
	case "r2":
		stances := []map[string]any{}
		for _, pid := range councilIdsIn(councilProposalHead, councilSection(req.Prompt, "## Proposals to review")) {
			stances = append(stances, map[string]any{"proposalid": pid, "stance": "accept", "reason": "Reason from " + req.Expert.Id + " on " + pid})
		}
		asks := councilIdsIn(councilAskLine, councilSection(req.Prompt, "## What the person asks you"))
		return councilFenced(map[string]any{"stances": stances, "revisions": []any{}, "answers": councilAnswers(req.Expert.Id, asks)})
	case "r3":
		return councilFenced(map[string]any{
			"text": "The panel prefers showing the state.",
			"directions": []map[string]any{{
				"rank": 1, "title": "Show the sleep state", "reasoning": "Cheap and clear. It also helps new users.",
				"from": []string{"P1", "P2"}, "stances": map[string]string{"newuser": "accept"}, "agreed": true,
			}},
			"outcomes": map[string]string{"P1": "Direction 1", "P2": "Merged into direction 1"},
			"weak":     []any{},
		})
	case "ans":
		return councilFenced(map[string]any{"answers": councilAnswers(req.Expert.Id, councilIdsIn(councilReplyHead, req.Prompt))})
	case "suggest":
		return councilFenced(map[string]any{"files": []string{"pkg/a.go", "pkg/a.go", " "}, "roles": []any{}, "group": "ui-feature"})
	}
	return "no canned reply for " + kind
}

func (f *councilFake) Call(ctx context.Context, req council.CallReq) (council.CallRes, error) {
	kind := councilCallKind(req.Prompt)
	key := req.Expert.Id + "/" + kind
	f.mu.Lock()
	f.reqs = append(f.reqs, req)
	failure, started := f.failure[key], f.held[key]
	delete(f.held, key)
	f.mu.Unlock()
	if started != nil {
		close(started)
		<-ctx.Done()
		return council.CallRes{}, ctx.Err()
	}
	if failure != nil {
		return council.CallRes{}, failure
	}
	return council.CallRes{Text: councilCanned(req, kind), Tokens: 10}, nil
}

func (f *councilFake) setFailure(key string, err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if err == nil {
		delete(f.failure, key)
		return
	}
	f.failure[key] = err
}

// hold makes the next call under key wait until its council is stopped; the returned channel closes once it did start.
func (f *councilFake) hold(key string) <-chan struct{} {
	f.mu.Lock()
	defer f.mu.Unlock()
	ch := make(chan struct{})
	f.held[key] = ch
	return ch
}

func (f *councilFake) calls(kind string) []council.CallReq {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []council.CallReq
	for _, r := range f.reqs {
		if councilCallKind(r.Prompt) == kind {
			out = append(out, r)
		}
	}
	return out
}

func (f *councilFake) total() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.reqs)
}

// councilEvents is the wps client of a test: it keeps every council:changed event the broker sends.
type councilEvents struct {
	mu  sync.Mutex
	got []wshrpc.CouncilChangedData
}

func (e *councilEvents) SendEvent(_ string, event wps.WaveEvent) {
	data, ok := event.Data.(wshrpc.CouncilChangedData)
	if !ok || event.Event != wps.Event_CouncilChanged {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.got = append(e.got, data)
}

func (e *councilEvents) all() []wshrpc.CouncilChangedData {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]wshrpc.CouncilChangedData(nil), e.got...)
}

// useCouncilRig runs the council commands of a test through fake: the store and the config dir are temp dirs, the
// runner is a fresh one, and its council:changed events reach the returned recorder. At the end every council is
// stopped and waited for, so no run is still writing when the temp dirs go.
func useCouncilRig(t *testing.T, fake *councilFake) *councilEvents {
	t.Helper()
	useCouncilStore(t)
	prevRunner := councilRunner
	councilRunner = newCouncilRunner(fake)
	runner := councilRunner
	t.Cleanup(func() { councilRunner = prevRunner })

	events := &councilEvents{}
	prevClient := wps.Broker.GetClient()
	wps.Broker.SetClient(events)
	wps.Broker.Subscribe("council-test", wps.SubscriptionRequest{Event: wps.Event_CouncilChanged, AllScopes: true})
	t.Cleanup(func() {
		wps.Broker.UnsubscribeAll("council-test")
		wps.Broker.SetClient(prevClient)
	})

	t.Cleanup(func() {
		list, _ := council.List("")
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		for _, c := range list {
			runner.Stop(c.Id)
			runner.Wait(ctx, c.Id)
		}
	})
	return events
}

// waitCouncil returns the council once nothing is running on it.
func waitCouncil(t *testing.T, id string) *council.Council {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	c, err := councilRunner.Wait(ctx, id)
	if err != nil {
		t.Fatalf("waiting for council %s: %v", id, err)
	}
	return c
}

// councilStartData is the start of a council of the UI group's panel, as the app's Setup sends it.
func councilStartData(t *testing.T) wshrpc.CommandCouncilStartData {
	t.Helper()
	experts, err := council.ExpertsFor("ui-feature")
	if err != nil {
		t.Fatalf("ExpertsFor: %v", err)
	}
	return wshrpc.CommandCouncilStartData{Project: t.TempDir(), Feature: "Idle sleep for services", Experts: experts}
}

// startDoneCouncil starts a council and waits for its three rounds.
func startDoneCouncil(t *testing.T, ws *WshServer) *council.Council {
	t.Helper()
	started, err := ws.CouncilStartCommand(context.Background(), councilStartData(t))
	if err != nil {
		t.Fatalf("CouncilStartCommand: %v", err)
	}
	done := waitCouncil(t, started.Id)
	if done.State != council.StateDone {
		t.Fatalf("council ended %s (%s), want done", done.State, done.Error)
	}
	return done
}

func findCouncilReply(c *council.Council, match func(r council.CouncilReply) bool) *council.CouncilReply {
	for i := range c.Replies {
		if match(c.Replies[i]) {
			return &c.Replies[i]
		}
	}
	return nil
}

func TestCouncilStartRunsTheRoundsToDone(t *testing.T) {
	fake := newCouncilFake()
	events := useCouncilRig(t, fake)
	ws := &WshServer{}
	ctx := context.Background()
	data := councilStartData(t)

	started, err := ws.CouncilStartCommand(ctx, data)
	if err != nil {
		t.Fatalf("CouncilStartCommand: %v", err)
	}
	// the RPC answers at once with the council running its first round; the rest happens in the background
	if started.Id == "" || started.State != council.StateRunning || started.Round != 1 {
		t.Errorf("started = id %q, %s at round %d, want an id and running at round 1", started.Id, started.State, started.Round)
	}
	if started.Project != data.Project || started.Feature != data.Feature || started.Created == 0 {
		t.Errorf("started council lost its request: %+v", started)
	}

	done := waitCouncil(t, started.Id)
	if done.State != council.StateDone || done.Summary == nil || len(done.Summary.Directions) != 1 {
		t.Fatalf("the council ended %s (%s) with summary %+v, want done with one direction", done.State, done.Error, done.Summary)
	}
	if len(done.Proposals) != 4 {
		t.Errorf("proposals = %d, want one per expert (4)", len(done.Proposals))
	}
	for kind, want := range map[string]int{"r1": 4, "r2": 4, "r3": 1} {
		if got := len(fake.calls(kind)); got != want {
			t.Errorf("%s calls = %d, want %d", kind, got, want)
		}
	}

	got, err := ws.CouncilGetCommand(ctx, wshrpc.CommandCouncilIdData{Id: started.Id})
	if err != nil || got.State != council.StateDone {
		t.Errorf("get after the run = %+v, %v, want done", got, err)
	}
	list, err := ws.CouncilListCommand(ctx, wshrpc.CommandCouncilListData{Project: data.Project})
	if err != nil || !reflect.DeepEqual(councilIds(list), []string{started.Id}) {
		t.Errorf("list for the project = %v, %v, want just %s", councilIds(list), err, started.Id)
	}

	// every save told the cockpit, with the council's id and project; the last one is in before Wait returns
	evs := events.all()
	if len(evs) < 3 {
		t.Fatalf("events = %d, want one per save (the start, each call's result, the end)", len(evs))
	}
	for i, ev := range evs {
		if ev.Id != started.Id || ev.Project != data.Project {
			t.Errorf("event %d = %+v, want id %s and project %s", i, ev, started.Id, data.Project)
		}
	}
}

func TestCouncilPublishesOneEventPerChange(t *testing.T) {
	events := useCouncilRig(t, newCouncilFake())
	publishCouncilChanged(&council.Council{Id: "c1", Project: "D:/proj"})
	if got, want := events.all(), []wshrpc.CouncilChangedData{{Id: "c1", Project: "D:/proj"}}; !reflect.DeepEqual(got, want) {
		t.Errorf("events = %+v, want %+v", got, want)
	}
}

func TestCouncilStartNotRunThenStartById(t *testing.T) {
	fake := newCouncilFake()
	events := useCouncilRig(t, fake)
	ws := &WshServer{}
	ctx := context.Background()
	data := councilStartData(t)
	data.NotRun = true

	saved, err := ws.CouncilStartCommand(ctx, data)
	if err != nil {
		t.Fatalf("start with NotRun: %v", err)
	}
	if saved.State != council.StateNotRun || saved.Round != 0 || saved.Id == "" {
		t.Errorf("not-run council = %s at round %d with id %q", saved.State, saved.Round, saved.Id)
	}
	if fake.total() != 0 {
		t.Errorf("a not-run council made %d calls, want none", fake.total())
	}
	if evs := events.all(); len(evs) != 1 || evs[0].Id != saved.Id || evs[0].Project != data.Project {
		t.Errorf("events after the save = %+v, want one for %s", evs, saved.Id)
	}
	if got, err := ws.CouncilGetCommand(ctx, wshrpc.CommandCouncilIdData{Id: saved.Id}); err != nil || got.State != council.StateNotRun {
		t.Fatalf("get of the saved council = %+v, %v, want not-run", got, err)
	}

	// Id alone starts it: the fields of the request are ignored
	started, err := ws.CouncilStartCommand(ctx, wshrpc.CommandCouncilStartData{Id: saved.Id, Feature: "ignored"})
	if err != nil {
		t.Fatalf("start by id: %v", err)
	}
	if started.Id != saved.Id || started.State != council.StateRunning || started.Feature != data.Feature {
		t.Errorf("started by id = %s %s %q, want the saved council running", started.Id, started.State, started.Feature)
	}
	if done := waitCouncil(t, saved.Id); done.State != council.StateDone || fake.total() == 0 {
		t.Errorf("after the start the council is %s with %d calls, want done", done.State, fake.total())
	}
	list, _ := ws.CouncilListCommand(ctx, wshrpc.CommandCouncilListData{})
	if !reflect.DeepEqual(councilIds(list), []string{saved.Id}) {
		t.Errorf("councils = %v, want the one saved council", councilIds(list))
	}

	if _, err := ws.CouncilStartCommand(ctx, wshrpc.CommandCouncilStartData{Id: saved.Id}); err == nil {
		t.Error("a council that already ran should not start again")
	}
	if _, err := ws.CouncilStartCommand(ctx, wshrpc.CommandCouncilStartData{Id: "missing"}); err == nil {
		t.Error("starting a council that does not exist should fail")
	}
}

func TestCouncilStartWhileAnotherRunsIsQueued(t *testing.T) {
	fake := newCouncilFake()
	events := useCouncilRig(t, fake)
	ws := &WshServer{}
	ctx := context.Background()

	held := fake.hold("ux/r1")
	first, err := ws.CouncilStartCommand(ctx, councilStartData(t))
	if err != nil {
		t.Fatalf("first start: %v", err)
	}
	<-held

	// one council runs at a time across all projects: the second start (another project) is saved queued, and says so
	second, err := ws.CouncilStartCommand(ctx, councilStartData(t))
	if err != nil {
		t.Fatalf("second start: %v", err)
	}
	if second.State != council.StateQueued || second.QueuedAfter != first.Id || second.Id == "" {
		t.Fatalf("second start = %s after %q, want queued after %s", second.State, second.QueuedAfter, first.Id)
	}
	found := false
	for _, ev := range events.all() {
		found = found || (ev.Id == second.Id && ev.Project == second.Project)
	}
	if !found {
		t.Errorf("no council:changed event for the queued council: %+v", events.all())
	}

	// a council that is saved as not run is not queued: the gate refused it, and nothing runs for it
	data := councilStartData(t)
	data.NotRun = true
	if saved, err := ws.CouncilStartCommand(ctx, data); err != nil || saved.State != council.StateNotRun || saved.QueuedAfter != "" {
		t.Errorf("a not-run save while another runs = %+v, %v, want it not-run and not queued", saved, err)
	}

	// Stop on the queued one removes it; the one running ends, and nothing starts behind it
	removed, err := ws.CouncilStartCommand(ctx, councilStartData(t))
	if err != nil || removed.State != council.StateQueued {
		t.Fatalf("third start = %+v, %v", removed, err)
	}
	if err := ws.CouncilStopCommand(ctx, wshrpc.CommandCouncilIdData{Id: removed.Id}); err != nil {
		t.Fatalf("stop of a queued council: %v", err)
	}
	if got, _ := council.Load(removed.Id); got.State != council.StateStopped {
		t.Errorf("the removed council is %s, want stopped", got.State)
	}

	if err := ws.CouncilStopCommand(ctx, wshrpc.CommandCouncilIdData{Id: first.Id}); err != nil {
		t.Fatalf("stop of the running council: %v", err)
	}
	if done := waitCouncil(t, second.Id); done.State != council.StateDone || done.DocPath == "" {
		t.Errorf("the queued council ended %s with the document at %q, want it to have run by itself and saved", done.State, done.DocPath)
	}
	if got, _ := council.Load(removed.Id); got.State != council.StateStopped || got.Round != 0 {
		t.Errorf("the removed council is %s at round %d, want it still stopped and never run", got.State, got.Round)
	}
}

func TestStartCouncilRunnerStartsACouncilLeftQueued(t *testing.T) {
	fake := newCouncilFake()
	useCouncilRig(t, fake)
	experts, err := council.ExpertsFor("ui-feature")
	if err != nil {
		t.Fatalf("ExpertsFor: %v", err)
	}
	saveCouncil(t, &council.Council{
		Id: "queued1", Project: t.TempDir(), Feature: "Left queued", Experts: experts, State: council.StateQueued, QueuedAfter: "gone", Created: 1,
	})
	saveCouncil(t, &council.Council{
		Id: "stale1", Project: t.TempDir(), Feature: "Left running", Experts: experts, State: council.StateRunning, Round: 2, Created: 1,
	})

	StartCouncilRunner()

	if got, err := council.Load("stale1"); err != nil || got.State != council.StateStopped {
		t.Errorf("the council left running = %+v, %v, want it stopped", got, err)
	}
	if done := waitCouncil(t, "queued1"); done.State != council.StateDone || done.QueuedAfter != "" {
		t.Errorf("the council left queued ended %s after %q (%s), want it started by StartCouncilRunner and done", done.State, done.QueuedAfter, done.Error)
	}
}

func TestCouncilStartTakesTheGroupsPanelWhenNoExperts(t *testing.T) {
	fake := newCouncilFake()
	useCouncilRig(t, fake)
	ws := &WshServer{}
	ctx := context.Background()
	want, err := council.ExpertsFor("ui-feature")
	if err != nil {
		t.Fatalf("ExpertsFor: %v", err)
	}

	// `wsh council start --group ui-feature` sends no experts
	started, err := ws.CouncilStartCommand(ctx, wshrpc.CommandCouncilStartData{
		Project: t.TempDir(), Feature: "Idle sleep for services", Group: "ui-feature",
	})
	if err != nil {
		t.Fatalf("start with a group: %v", err)
	}
	if len(started.Experts) != 5 || !started.Experts[4].Coordinator || !reflect.DeepEqual(started.Experts, want) {
		t.Errorf("experts = %+v, want the five of the ui-feature group with the coordinator last", started.Experts)
	}
	for _, e := range started.Experts[:4] {
		if e.Coordinator {
			t.Errorf("expert %s is marked the coordinator, only the last should be", e.Id)
		}
	}
	if started.Group != "ui-feature" {
		t.Errorf("group = %q, want ui-feature", started.Group)
	}
	if done := waitCouncil(t, started.Id); done.State != council.StateDone || len(fake.calls("r1")) != 4 {
		t.Errorf("the council ended %s with %d round 1 calls, want done with 4", done.State, len(fake.calls("r1")))
	}

	// experts that are named win over the group
	two := []council.CouncilExpert{want[0], want[4]}
	saved, err := ws.CouncilStartCommand(ctx, wshrpc.CommandCouncilStartData{
		Project: t.TempDir(), Feature: "Dark mode", Group: "ui-feature", Experts: two, NotRun: true,
	})
	if err != nil {
		t.Fatalf("start with experts and a group: %v", err)
	}
	if !reflect.DeepEqual(saved.Experts, two) {
		t.Errorf("experts = %+v, want the two named", saved.Experts)
	}
}

func TestCouncilStartCopiesMode(t *testing.T) {
	fake := newCouncilFake()
	useCouncilRig(t, fake)
	ws := &WshServer{}
	ctx := context.Background()

	// a not-run council keeps the mode and the reason it was picked
	data := councilStartData(t)
	data.Mode, data.ModeWhy, data.NotRun = council.ModeBrainstorm, "a goal", true
	saved, err := ws.CouncilStartCommand(ctx, data)
	if err != nil {
		t.Fatalf("start with a mode: %v", err)
	}
	if saved.Mode != council.ModeBrainstorm || saved.ModeWhy != "a goal" {
		t.Errorf("saved mode = %q (%q), want brainstorm (a goal)", saved.Mode, saved.ModeWhy)
	}
	got, err := ws.CouncilGetCommand(ctx, wshrpc.CommandCouncilIdData{Id: saved.Id})
	if err != nil || got.Mode != council.ModeBrainstorm || got.ModeWhy != "a goal" {
		t.Errorf("get after the save = %+v, %v, want the mode on disk", got, err)
	}

	// a started council carries them too
	data = councilStartData(t)
	data.Mode, data.ModeWhy = council.ModeBrainstorm, "picked by hand"
	started, err := ws.CouncilStartCommand(ctx, data)
	if err != nil {
		t.Fatalf("start a running council with a mode: %v", err)
	}
	if started.Mode != council.ModeBrainstorm || started.ModeWhy != "picked by hand" {
		t.Errorf("started mode = %q (%q), want brainstorm (picked by hand)", started.Mode, started.ModeWhy)
	}
	waitCouncil(t, started.Id)

	// no mode on the wire is no mode on the council: it reads as review
	plain := councilStartData(t)
	plain.NotRun = true
	review, err := ws.CouncilStartCommand(ctx, plain)
	if err != nil {
		t.Fatalf("start without a mode: %v", err)
	}
	if review.Mode != "" || council.ModeOf(review) != council.ModeReview {
		t.Errorf("a start with no mode saved %q, want none, read as review", review.Mode)
	}
	data = councilStartData(t)
	data.Mode, data.NotRun = council.ModeReview, true
	if explicit, err := ws.CouncilStartCommand(ctx, data); err != nil || council.ModeOf(explicit) != council.ModeReview {
		t.Errorf("a start with mode review = %+v, %v, want a review council", explicit, err)
	}
}

func TestCouncilStartRefusesAnUnknownMode(t *testing.T) {
	fake := newCouncilFake()
	useCouncilRig(t, fake)
	ws := &WshServer{}
	ctx := context.Background()

	data := councilStartData(t)
	data.Mode = "debate"
	if c, err := ws.CouncilStartCommand(ctx, data); err == nil {
		t.Errorf("start with mode debate = %+v, want an error", c)
	}
	data.NotRun = true
	if c, err := ws.CouncilStartCommand(ctx, data); err == nil {
		t.Errorf("not-run start with mode debate = %+v, want an error", c)
	}
	if list, _ := council.List(""); len(list) != 0 || fake.total() != 0 {
		t.Errorf("a refused start left %d councils and %d calls", len(list), fake.total())
	}
}

func TestCouncilStartRefusesWhatCannotRun(t *testing.T) {
	fake := newCouncilFake()
	useCouncilRig(t, fake)
	ws := &WshServer{}
	ctx := context.Background()
	good := councilStartData(t)

	for _, tc := range []struct {
		name string
		edit func(d *wshrpc.CommandCouncilStartData)
	}{
		{"an unknown group", func(d *wshrpc.CommandCouncilStartData) { d.Experts, d.Group = nil, "nope" }},
		{"neither a group nor experts", func(d *wshrpc.CommandCouncilStartData) { d.Experts, d.Group = nil, "" }},
		{"no feature", func(d *wshrpc.CommandCouncilStartData) { d.Feature = "  " }},
		{"no project", func(d *wshrpc.CommandCouncilStartData) { d.Project = "" }},
		{"only a coordinator", func(d *wshrpc.CommandCouncilStartData) { d.Experts = d.Experts[len(d.Experts)-1:] }},
	} {
		data := good
		tc.edit(&data)
		if c, err := ws.CouncilStartCommand(ctx, data); err == nil {
			t.Errorf("start with %s = %+v, want an error", tc.name, c)
		}
		data.NotRun = true
		if c, err := ws.CouncilStartCommand(ctx, data); err == nil {
			t.Errorf("not-run start with %s = %+v, want an error", tc.name, c)
		}
	}
	if list, _ := council.List(""); len(list) != 0 || fake.total() != 0 {
		t.Errorf("a refused start left %d councils and %d calls", len(list), fake.total())
	}
}

func TestCouncilPauseThenContinueWithCutAndQuestion(t *testing.T) {
	fake := newCouncilFake()
	useCouncilRig(t, fake)
	ws := &WshServer{}
	ctx := context.Background()
	data := councilStartData(t)
	data.Pause = true

	started, err := ws.CouncilStartCommand(ctx, data)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	paused := waitCouncil(t, started.Id)
	if paused.State != council.StateAwaiting || len(paused.Proposals) != 4 || paused.Summary != nil {
		t.Fatalf("paused = %s with %d proposals and summary %v, want awaiting-you after round 1", paused.State, len(paused.Proposals), paused.Summary)
	}
	if len(fake.calls("r2")) != 0 {
		t.Fatalf("round 2 ran before Continue")
	}

	if err := ws.CouncilContinueCommand(ctx, wshrpc.CommandCouncilContinueData{Id: started.Id, Cut: []string{"P99"}}); err == nil {
		t.Error("cutting a proposal that does not exist should fail")
	}
	if err := ws.CouncilContinueCommand(ctx, wshrpc.CommandCouncilContinueData{Id: started.Id, Cut: []string{"P1"}, Question: "Which first?"}); err != nil {
		t.Fatalf("CouncilContinueCommand: %v", err)
	}
	done := waitCouncil(t, started.Id)
	if done.State != council.StateDone || done.Summary == nil {
		t.Fatalf("after Continue the council is %s (%s), want done with a summary", done.State, done.Error)
	}
	if !done.Proposals[0].Cut || done.Proposals[1].Cut {
		t.Errorf("cut flags = %v %v, want only P1 cut", done.Proposals[0].Cut, done.Proposals[1].Cut)
	}
	ask := findCouncilReply(done, func(r council.CouncilReply) bool { return r.Author == council.YouId })
	if ask == nil || ask.Text != "Which first?" || ask.ProposalId != "" || !ask.Answered {
		t.Errorf("the person's question = %+v, want a whole-council reply that was answered", ask)
	}
	if err := ws.CouncilContinueCommand(ctx, wshrpc.CommandCouncilContinueData{Id: started.Id}); err == nil {
		t.Error("a council that is done is not waiting on the person")
	}
}

func TestCouncilReplyValidatesAndAnswers(t *testing.T) {
	fake := newCouncilFake()
	useCouncilRig(t, fake)
	ws := &WshServer{}
	ctx := context.Background()
	done := startDoneCouncil(t, ws)
	before := len(done.Replies)

	for _, tc := range []struct {
		name string
		data wshrpc.CommandCouncilReplyData
	}{
		{"an unknown proposal", wshrpc.CommandCouncilReplyData{Id: done.Id, ProposalId: "P99", Text: "why?"}},
		{"an unknown parent", wshrpc.CommandCouncilReplyData{Id: done.Id, ProposalId: "P1", ParentId: "r99", Text: "why?"}},
		{"no text", wshrpc.CommandCouncilReplyData{Id: done.Id, ProposalId: "P1", Text: "  "}},
		{"an unknown council", wshrpc.CommandCouncilReplyData{Id: "missing", ProposalId: "P1", Text: "why?"}},
	} {
		if err := ws.CouncilReplyCommand(ctx, tc.data); err == nil {
			t.Errorf("reply with %s should be refused", tc.name)
		}
	}
	if got, _ := ws.CouncilGetCommand(ctx, wshrpc.CommandCouncilIdData{Id: done.Id}); len(got.Replies) != before || got.State != council.StateDone {
		t.Fatalf("a refused reply changed the council: %d replies (was %d), state %s", len(got.Replies), before, got.State)
	}

	// a reply to a proposal: the council answers it in a follow-up and returns to done
	if err := ws.CouncilReplyCommand(ctx, wshrpc.CommandCouncilReplyData{Id: done.Id, ProposalId: "P1", Text: "why does it break?"}); err != nil {
		t.Fatalf("CouncilReplyCommand: %v", err)
	}
	after := waitCouncil(t, done.Id)
	if after.State != council.StateDone {
		t.Fatalf("after the follow-up the council is %s (%s), want done", after.State, after.Error)
	}
	mine := findCouncilReply(after, func(r council.CouncilReply) bool { return r.Author == council.YouId })
	if mine == nil || mine.ProposalId != "P1" || !mine.Answered || len(mine.To) == 0 {
		t.Fatalf("the person's reply = %+v, want one on P1 that was answered by someone", mine)
	}
	if findCouncilReply(after, func(r council.CouncilReply) bool { return r.ParentId == mine.Id && r.Author != council.YouId }) == nil {
		t.Errorf("nobody answered the reply %s: %+v", mine.Id, after.Replies)
	}
	if len(fake.calls("ans")) == 0 {
		t.Error("the follow-up made no answer call")
	}

	// a reply to a reply takes its parent's proposal; a parent on another proposal is refused
	if err := ws.CouncilReplyCommand(ctx, wshrpc.CommandCouncilReplyData{Id: done.Id, ParentId: mine.Id, Text: "and then?"}); err != nil {
		t.Errorf("reply to a reply: %v", err)
	}
	waitCouncil(t, done.Id)
	if err := ws.CouncilReplyCommand(ctx, wshrpc.CommandCouncilReplyData{Id: done.Id, ProposalId: "P2", ParentId: mine.Id, Text: "wrong thread"}); err == nil {
		t.Error("a parent that belongs to another proposal should be refused")
	}
}

func TestCouncilRetryOfAFailedExpert(t *testing.T) {
	fake := newCouncilFake()
	useCouncilRig(t, fake)
	ws := &WshServer{}
	ctx := context.Background()
	fake.setFailure("ux/r1", errors.New("claude exited 1: overloaded"))

	started, err := ws.CouncilStartCommand(ctx, councilStartData(t))
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	ended := waitCouncil(t, started.Id)
	if f, ok := ended.Failed["ux"]; !ok || f.Round != 1 || !strings.Contains(f.Error, "overloaded") {
		t.Fatalf("failed = %+v, want ux failed in round 1 with the error", ended.Failed)
	}
	if len(ended.Proposals) != 3 {
		t.Fatalf("proposals = %d, want the 3 experts that worked", len(ended.Proposals))
	}

	if err := ws.CouncilRetryCommand(ctx, wshrpc.CommandCouncilRetryData{Id: started.Id, ExpertId: "skeptic"}); err == nil || !strings.Contains(err.Error(), "no failed call") {
		t.Errorf("retry of an expert with no failure = %v, want a 'no failed call' error", err)
	}
	if err := ws.CouncilRetryCommand(ctx, wshrpc.CommandCouncilRetryData{Id: "missing", ExpertId: "ux"}); err == nil {
		t.Error("retry on a council that does not exist should fail")
	}

	fake.setFailure("ux/r1", nil)
	if err := ws.CouncilRetryCommand(ctx, wshrpc.CommandCouncilRetryData{Id: started.Id, ExpertId: "ux"}); err != nil {
		t.Fatalf("CouncilRetryCommand: %v", err)
	}
	retried := waitCouncil(t, started.Id)
	if _, still := retried.Failed["ux"]; still || len(retried.Proposals) != 4 || retried.State != ended.State {
		t.Errorf("after the retry: failed %+v, %d proposals, state %s (was %s), want the failure cleared and ux's proposal in",
			retried.Failed, len(retried.Proposals), retried.State, ended.State)
	}
}

func TestCouncilSummarizeRerunsTheSynthesis(t *testing.T) {
	fake := newCouncilFake()
	useCouncilRig(t, fake)
	ws := &WshServer{}
	ctx := context.Background()
	done := startDoneCouncil(t, ws)

	if err := ws.CouncilSummarizeCommand(ctx, wshrpc.CommandCouncilIdData{Id: done.Id}); err != nil {
		t.Fatalf("CouncilSummarizeCommand: %v", err)
	}
	again := waitCouncil(t, done.Id)
	if again.State != council.StateDone || again.Summary == nil {
		t.Errorf("after Summarize the council is %s with summary %v, want done", again.State, again.Summary)
	}
	if got := len(fake.calls("r3")); got != 2 {
		t.Errorf("synthesis calls = %d, want 2 (the run's, and Summarize's)", got)
	}
	if err := ws.CouncilSummarizeCommand(ctx, wshrpc.CommandCouncilIdData{Id: "missing"}); err == nil {
		t.Error("summarizing a council that does not exist should fail")
	}
}

func TestCouncilStopEndsARunningCouncil(t *testing.T) {
	fake := newCouncilFake()
	useCouncilRig(t, fake)
	ws := &WshServer{}
	ctx := context.Background()
	entered := fake.hold("ux/r1")

	started, err := ws.CouncilStartCommand(ctx, councilStartData(t))
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("the held call never started")
	}

	if err := ws.CouncilStopCommand(ctx, wshrpc.CommandCouncilIdData{Id: started.Id}); err != nil {
		t.Fatalf("CouncilStopCommand: %v", err)
	}
	// Stop returns once the run saved the council stopped, so no wait is needed to read it
	got, err := ws.CouncilGetCommand(ctx, wshrpc.CommandCouncilIdData{Id: started.Id})
	if err != nil || got.State != council.StateStopped {
		t.Fatalf("after Stop the council is %+v, %v, want stopped", got, err)
	}
	if len(fake.calls("r2")) != 0 {
		t.Error("round 2 ran after the stop")
	}
	if err := ws.CouncilStopCommand(ctx, wshrpc.CommandCouncilIdData{Id: started.Id}); err != nil {
		t.Errorf("stopping a stopped council = %v, want no error", err)
	}
	if err := ws.CouncilStopCommand(ctx, wshrpc.CommandCouncilIdData{Id: "missing"}); err == nil {
		t.Error("stopping a council that does not exist should fail")
	}
}

func TestCouncilSuggestReadsTheProjectOnce(t *testing.T) {
	fake := newCouncilFake()
	useCouncilRig(t, fake)
	ws := &WshServer{}
	ctx := context.Background()
	project := t.TempDir()

	got, err := ws.CouncilSuggestCommand(ctx, wshrpc.CommandCouncilSuggestData{Project: project, Feature: "Idle sleep for services"})
	if err != nil {
		t.Fatalf("CouncilSuggestCommand: %v", err)
	}
	if !reflect.DeepEqual(got.Files, []string{"pkg/a.go"}) || got.Group != "ui-feature" || got.Roles == nil || len(got.Roles) != 0 {
		t.Errorf("suggestion = %+v, want pkg/a.go once, no roles and the ui-feature group", got)
	}
	reqs := fake.calls("suggest")
	if len(reqs) != 1 || !reqs[0].Tools || reqs[0].Cwd != project {
		t.Errorf("suggest calls = %+v, want one with tools in the project", reqs)
	}
	if _, err := ws.CouncilSuggestCommand(ctx, wshrpc.CommandCouncilSuggestData{Project: project}); err == nil {
		t.Error("a suggestion without a feature should fail")
	}
}

func TestStartCouncilRunnerMarksCouncilsLeftRunningAsStopped(t *testing.T) {
	events := useCouncilRig(t, newCouncilFake())
	ws := &WshServer{}
	ctx := context.Background()
	project := t.TempDir()
	saveCouncil(t, &council.Council{Id: "left", Project: project, Feature: "Idle sleep", State: council.StateRunning, Round: 2})
	saveCouncil(t, &council.Council{Id: "fine", Project: project, Feature: "Dark mode", State: council.StateDone, Round: 3})

	StartCouncilRunner()

	left, err := ws.CouncilGetCommand(ctx, wshrpc.CommandCouncilIdData{Id: "left"})
	if err != nil || left.State != council.StateStopped || !strings.Contains(left.Error, "round 2") {
		t.Errorf("the council left running = %+v, %v, want stopped with an error naming round 2", left, err)
	}
	if fine, _ := ws.CouncilGetCommand(ctx, wshrpc.CommandCouncilIdData{Id: "fine"}); fine.State != council.StateDone {
		t.Errorf("a finished council is %s after startup, want done", fine.State)
	}
	if got, want := events.all(), []wshrpc.CouncilChangedData{{Id: "left", Project: project}}; !reflect.DeepEqual(got, want) {
		t.Errorf("events = %+v, want just the council that was marked stopped", got)
	}
}
