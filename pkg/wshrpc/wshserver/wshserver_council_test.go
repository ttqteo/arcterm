// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
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
	"github.com/wavetermdev/waveterm/pkg/council/bench"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
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

// ---- the benchmark ----

// writeBenchCases writes cases.json under dataDir with one usable case per id (a project folder, a key file with two
// key lines), and one case named "gamma" whose project folder is gone, which the plan skips.
func writeBenchCases(t *testing.T, dataDir string, withGone bool, ids ...string) {
	t.Helper()
	benchDir := filepath.Join(dataDir, bench.BenchDir)
	if err := os.MkdirAll(benchDir, 0o755); err != nil {
		t.Fatal(err)
	}
	var cases []map[string]string
	for _, id := range ids {
		key := filepath.Join(benchDir, id+"-key.md")
		if err := os.WriteFile(key, []byte("K1: The retry loop never backs off.\nK2: The cache is never cleared.\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		cases = append(cases, map[string]string{
			"id": id, "mode": council.ModeReview, "project": t.TempDir(), "group": "ui-feature", "solo_group": "ui-feature",
			"feature": "Idle sleep for " + id, "question": "What breaks?", "files": "a.go", "key": key,
		})
	}
	if withGone {
		cases = append(cases, map[string]string{
			"id": "gamma", "mode": council.ModeReview, "project": filepath.Join(dataDir, "gone"), "group": "ui-feature",
			"solo_group": "ui-feature", "feature": "Gone", "key": filepath.Join(benchDir, ids[0]+"-key.md"),
		})
	}
	data, err := json.Marshal(cases)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(benchDir, bench.CasesFile), data, 0o644); err != nil {
		t.Fatal(err)
	}
}

// useCouncilBench points the data dir at a temp dir and the bench's wiring at wire (nil: any call of it fails the
// test). At the end a bench still running is stopped and waited for, so nothing writes when the temp dirs go.
func useCouncilBench(t *testing.T, wire func() councilBenchWiring) string {
	t.Helper()
	dataDir := t.TempDir()
	prevDir, prevWire := wavebase.DataHome_VarCache, councilBenchWire
	wavebase.DataHome_VarCache = dataDir
	if wire == nil {
		wire = func() councilBenchWiring {
			return councilBenchWiring{
				start: func(context.Context, *council.Council) (*council.Council, error) {
					t.Error("the bench started a council")
					return nil, errors.New("not wired")
				},
				wait: func(context.Context, string) (*council.Council, error) {
					t.Error("the bench waited")
					return nil, errors.New("not wired")
				},
				judge: func(context.Context, bench.Case, *council.Council) (bench.Verdict, error) {
					t.Error("the bench judged")
					return bench.Verdict{}, errors.New("not wired")
				},
				remind: func(context.Context) error { t.Error("the bench reminded"); return errors.New("not wired") },
			}
		}
	}
	councilBenchWire = wire
	t.Cleanup(func() {
		(&WshServer{}).CouncilBenchStopCommand(context.Background())
		councilBenchWire, wavebase.DataHome_VarCache = prevWire, prevDir
	})
	return dataDir
}

// waitBenchIdle waits until no bench runs in this wavesrv.
func waitBenchIdle(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for {
		councilBenchMu.Lock()
		idle := councilBenchCur == nil
		councilBenchMu.Unlock()
		if idle {
			return
		}
		if time.Now().After(deadline) {
			t.Fatal("the bench never ended")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// benchFake is the bench's wiring with no council behind it: start numbers the councils it is given, wait ends them done,
// the judge finds K1, and the hooks let a test hold the bench at its first council.
type benchFake struct {
	mu      sync.Mutex
	started []*council.Council
	reminds int

	entered chan struct{} // receives once for each council start is given
	release chan struct{} // start waits for it to close; nil does not wait
}

func newBenchFake() *benchFake { return &benchFake{entered: make(chan struct{}, 16)} }

func (f *benchFake) wiring() councilBenchWiring {
	return councilBenchWiring{
		start: func(ctx context.Context, c *council.Council) (*council.Council, error) {
			f.mu.Lock()
			f.started = append(f.started, c)
			id := fmt.Sprintf("fake%d", len(f.started))
			f.mu.Unlock()
			f.entered <- struct{}{}
			if f.release != nil {
				select {
				case <-f.release:
				case <-ctx.Done():
					return nil, ctx.Err()
				}
			}
			return &council.Council{Id: id, State: council.StateRunning, Bench: true}, nil
		},
		wait: func(ctx context.Context, id string) (*council.Council, error) {
			return &council.Council{Id: id, State: council.StateDone, Harness: "test.1", Tokens: 100}, nil
		},
		judge: func(context.Context, bench.Case, *council.Council) (bench.Verdict, error) {
			return bench.Verdict{Matches: map[string]int{"K1": 1}}, nil
		},
		remind: func(context.Context) error {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.reminds++
			return nil
		},
	}
}

func (f *benchFake) startCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.started)
}

func TestCouncilBenchDryRunStartsNothing(t *testing.T) {
	useCouncilStore(t)
	dataDir := useCouncilBench(t, nil) // any call of the wiring fails the test
	writeBenchCases(t, dataDir, true, "alpha")
	ws := &WshServer{}
	ctx := context.Background()

	got, err := ws.CouncilBenchCommand(ctx, wshrpc.CommandCouncilBenchData{DryRun: true})
	if err != nil {
		t.Fatalf("CouncilBenchCommand dry run: %v", err)
	}
	wantItems := []bench.CouncilBenchPlanItem{{Case: "alpha", Variant: bench.VariantSolo, Run: 1}, {Case: "alpha", Variant: bench.VariantCouncil, Run: 1}}
	if !reflect.DeepEqual(got.Items, wantItems) {
		t.Errorf("items = %+v, want %+v", got.Items, wantItems)
	}
	if got.Estimate != 550_000+1_400_000 {
		t.Errorf("estimate = %d, want Phase 0's solo and council figures summed (1950000)", got.Estimate)
	}
	if len(got.Skipped) != 1 || !strings.Contains(got.Skipped[0], "gamma") {
		t.Errorf("skipped = %v, want the one case whose project folder is gone, named", got.Skipped)
	}

	// --runs multiplies the plan, a variant narrows it
	got, err = ws.CouncilBenchCommand(ctx, wshrpc.CommandCouncilBenchData{DryRun: true, Variants: []string{bench.VariantCouncil}, Runs: 3})
	if err != nil || len(got.Items) != 3 || got.Estimate != 3*1_400_000 {
		t.Errorf("3 runs of the council variant = %+v, %v, want 3 items at 4.2M", got, err)
	}

	// a case named with --case that was skipped is unknown, and the error says why it was left out
	if _, err = ws.CouncilBenchCommand(ctx, wshrpc.CommandCouncilBenchData{DryRun: true, Cases: []string{"gamma"}}); err == nil ||
		!strings.Contains(err.Error(), `unknown case "gamma"`) || !strings.Contains(err.Error(), "skipped case gamma") {
		t.Errorf("--case gamma = %v, want an unknown-case error with the skipped case beside it", err)
	}
	if _, err = ws.CouncilBenchCommand(ctx, wshrpc.CommandCouncilBenchData{DryRun: true, Variants: []string{"v1"}}); err == nil {
		t.Error("an unknown variant should be refused")
	}

	// nothing started: no council saved, no line in the results file, nothing running
	if list, _ := council.List(""); len(list) != 0 {
		t.Errorf("a dry run saved %d councils", len(list))
	}
	if _, err := os.Stat(bench.ResultsPath(dataDir)); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("a dry run left a results file (%v)", err)
	}
	if stopped, _ := ws.CouncilBenchStopCommand(ctx); stopped.Stopped {
		t.Error("a dry run started a bench")
	}
}

func TestCouncilBenchRefusesWithoutCases(t *testing.T) {
	useCouncilStore(t)
	useCouncilBench(t, nil)
	ws := &WshServer{}
	for _, dry := range []bool{true, false} {
		if got, err := ws.CouncilBenchCommand(context.Background(), wshrpc.CommandCouncilBenchData{DryRun: dry}); err == nil || !strings.Contains(err.Error(), "no benchmark cases") {
			t.Errorf("a bench (dry run %v) with no cases.json = %+v, %v, want an error naming the missing cases", dry, got, err)
		}
	}
	waitBenchIdle(t)
}

func TestCouncilBenchOneAtATime(t *testing.T) {
	useCouncilStore(t)
	fake := newBenchFake()
	fake.release = make(chan struct{})
	dataDir := useCouncilBench(t, fake.wiring)
	writeBenchCases(t, dataDir, false, "alpha")
	ws := &WshServer{}
	ctx := context.Background()

	first, err := ws.CouncilBenchCommand(ctx, wshrpc.CommandCouncilBenchData{})
	if err != nil {
		t.Fatalf("first bench: %v", err)
	}
	if len(first.Items) != 2 {
		t.Errorf("the plan the start returned = %+v, want 2 items", first.Items)
	}
	select {
	case <-fake.entered:
	case <-time.After(10 * time.Second):
		t.Fatal("the bench never started its first council")
	}

	// a second bench is refused and starts nothing; a dry run still answers
	if _, err := ws.CouncilBenchCommand(ctx, wshrpc.CommandCouncilBenchData{}); err == nil || !strings.Contains(err.Error(), "a bench is already running") {
		t.Errorf("second bench = %v, want 'a bench is already running'", err)
	}
	if dry, err := ws.CouncilBenchCommand(ctx, wshrpc.CommandCouncilBenchData{DryRun: true}); err != nil || len(dry.Items) != 2 {
		t.Errorf("dry run while a bench runs = %+v, %v, want the plan", dry, err)
	}
	if got := fake.startCount(); got != 1 {
		t.Errorf("councils started = %d, want only the first bench's one in flight", got)
	}

	// the first bench goes on to the end: both councils scored, the reminder added (a full bench), and the slot is free
	close(fake.release)
	waitBenchIdle(t)
	runs, _, err := bench.LoadResults(dataDir)
	if err != nil || len(runs) != 2 {
		t.Fatalf("results = %+v, %v, want one line per council", runs, err)
	}
	for _, r := range runs {
		if r.State != "done" || r.Case != "alpha" || r.Recall != 1 || r.Keys != 2 || r.Harness != "test.1" {
			t.Errorf("result line = %+v, want a done alpha run with recall 1 of 2 under test.1", r)
		}
	}
	fake.mu.Lock()
	reminds := fake.reminds
	fake.mu.Unlock()
	if reminds != 1 {
		t.Errorf("reminders = %d, want 1 after a full bench", reminds)
	}
	if stopped, _ := ws.CouncilBenchStopCommand(ctx); stopped.Stopped {
		t.Error("a bench is still running after it finished")
	}
	if _, err := ws.CouncilBenchCommand(ctx, wshrpc.CommandCouncilBenchData{DryRun: true}); err != nil {
		t.Errorf("dry run after the bench: %v", err)
	}
}

func TestCouncilBenchOfOneCaseAddsNoReminder(t *testing.T) {
	useCouncilStore(t)
	fake := newBenchFake()
	dataDir := useCouncilBench(t, fake.wiring)
	writeBenchCases(t, dataDir, false, "alpha", "beta")
	ws := &WshServer{}

	if _, err := ws.CouncilBenchCommand(context.Background(), wshrpc.CommandCouncilBenchData{Cases: []string{"beta"}, Variants: []string{bench.VariantSolo}}); err != nil {
		t.Fatalf("bench of one case: %v", err)
	}
	waitBenchIdle(t)
	runs, _, _ := bench.LoadResults(dataDir)
	if len(runs) != 1 || runs[0].Case != "beta" || runs[0].Variant != bench.VariantSolo {
		t.Errorf("results = %+v, want one solo run of beta", runs)
	}
	if fake.reminds != 0 {
		t.Errorf("reminders = %d, want none: only a full bench is a measurement worth a monthly reminder", fake.reminds)
	}
}

func TestCouncilBenchStop(t *testing.T) {
	useCouncilStore(t)
	dataDir := useCouncilBench(t, nil)
	project := t.TempDir()
	entered := make(chan struct{}, 1)
	councilBenchWire = func() councilBenchWiring {
		return councilBenchWiring{
			// the council in flight is really saved, as the runner would have: Stop must end it, not just the bench
			start: func(ctx context.Context, c *council.Council) (*council.Council, error) {
				saved := &council.Council{Id: "inflight", Project: project, Feature: c.Feature, State: council.StateRunning, Round: 1, Bench: true}
				return saved, council.Save(saved)
			},
			wait: func(ctx context.Context, id string) (*council.Council, error) {
				entered <- struct{}{}
				<-ctx.Done()
				return nil, ctx.Err()
			},
			judge: func(context.Context, bench.Case, *council.Council) (bench.Verdict, error) {
				t.Error("the stopped council was judged")
				return bench.Verdict{}, nil
			},
			remind: func(context.Context) error { t.Error("a stopped bench reminded"); return nil },
		}
	}
	writeBenchCases(t, dataDir, false, "alpha")
	ws := &WshServer{}
	ctx := context.Background()

	if stopped, err := ws.CouncilBenchStopCommand(ctx); err != nil || stopped.Stopped {
		t.Fatalf("stop with no bench = %+v, %v, want Stopped false", stopped, err)
	}
	if _, err := ws.CouncilBenchCommand(ctx, wshrpc.CommandCouncilBenchData{}); err != nil {
		t.Fatalf("bench: %v", err)
	}
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("the bench never began waiting on its first council")
	}

	stopped, err := ws.CouncilBenchStopCommand(ctx)
	if err != nil || !stopped.Stopped {
		t.Fatalf("stop = %+v, %v, want Stopped true", stopped, err)
	}
	// Stop returns once the bench ended: the slot is free, the council in flight is stopped and left no document in the
	// project, and the interrupted item has no line in the results
	councilBenchMu.Lock()
	running := councilBenchCur != nil
	councilBenchMu.Unlock()
	if running {
		t.Error("the bench still holds its slot after Stop returned")
	}
	if got, err := council.Load("inflight"); err != nil || got.State != council.StateStopped {
		t.Errorf("the council in flight = %+v, %v, want stopped", got, err)
	}
	if entries, _ := os.ReadDir(project); len(entries) != 0 {
		t.Errorf("the project holds %d entries after a stopped bench council, want none (no document)", len(entries))
	}
	if runs, _, _ := bench.LoadResults(dataDir); len(runs) != 0 {
		t.Errorf("results = %+v, want no line for the interrupted council", runs)
	}
	if again, _ := ws.CouncilBenchStopCommand(ctx); again.Stopped {
		t.Error("a second stop found a bench to stop")
	}
}

// TestCouncilBenchRunsCouncilsThroughTheRunner wires the real start and wait to a runner with a fake caller: the panel
// is filled from the case's group, the council is a bench one (not listed, no document), and its row carries the harness
// version and the tokens it spent.
func TestCouncilBenchRunsCouncilsThroughTheRunner(t *testing.T) {
	fake := newCouncilFake()
	useCouncilRig(t, fake)
	dataDir := useCouncilBench(t, nil)
	reminds := 0
	councilBenchWire = func() councilBenchWiring {
		return councilBenchWiring{
			start: benchStartCouncil,
			wait:  benchWaitCouncil,
			judge: func(context.Context, bench.Case, *council.Council) (bench.Verdict, error) {
				return bench.Verdict{Matches: map[string]int{"K1": 1}}, nil
			},
			remind: func(context.Context) error { reminds++; return nil },
		}
	}
	writeBenchCases(t, dataDir, false, "alpha")
	ws := &WshServer{}
	ctx := context.Background()

	if _, err := ws.CouncilBenchCommand(ctx, wshrpc.CommandCouncilBenchData{Variants: []string{bench.VariantCouncil}}); err != nil {
		t.Fatalf("bench: %v", err)
	}
	waitBenchIdle(t)

	runs, _, err := bench.LoadResults(dataDir)
	if err != nil || len(runs) != 1 {
		t.Fatalf("results = %+v, %v, want one line", runs, err)
	}
	row := runs[0]
	if row.State != "done" || row.Recall != 1 || row.Keys != 2 || row.Harness != council.HarnessVersion || row.Tokens == 0 || row.Council == "" {
		t.Errorf("result line = %+v, want a done run under harness %s with the council's spend", row, council.HarnessVersion)
	}
	c, err := council.Load(row.Council)
	if err != nil {
		t.Fatal(err)
	}
	if !c.Bench || c.State != council.StateDone || len(c.Experts) != 5 || !c.Experts[4].Coordinator || c.Group != "ui-feature" {
		t.Errorf("bench council = bench %v, %s, %d experts, group %q, want a done bench council on the 5-expert ui-feature panel", c.Bench, c.State, len(c.Experts), c.Group)
	}
	if c.PauseAfterRound1 {
		t.Error("a bench council must never pause: it would wait on a person who is not there")
	}
	if c.DocPath != "" {
		if _, err := os.Stat(c.DocPath); err == nil {
			t.Errorf("a bench council wrote its document at %s", c.DocPath)
		}
	}
	if entries, _ := os.ReadDir(c.Project); len(entries) != 0 {
		t.Errorf("the case's project holds %d entries after the bench, want none", len(entries))
	}
	if list, _ := ws.CouncilListCommand(ctx, wshrpc.CommandCouncilListData{}); len(list) != 0 {
		t.Errorf("the cockpit's list holds %v, want no bench council", councilIds(list))
	}
	if reminds != 1 {
		t.Errorf("reminders = %d, want 1: the bench named no case, so it ran them all", reminds)
	}
}

// TestStartCouncilRunnerStopsBenchCouncilsLeftQueued: the bench that queued a council ended with wavesrv, so the
// council must not start by itself at the next launch; the person's own council left queued behind it still does.
func TestStartCouncilRunnerStopsBenchCouncilsLeftQueued(t *testing.T) {
	fake := newCouncilFake()
	useCouncilRig(t, fake)
	experts, err := council.ExpertsFor("ui-feature")
	if err != nil {
		t.Fatalf("ExpertsFor: %v", err)
	}
	saveCouncil(t, &council.Council{
		Id: "bench1", Project: t.TempDir(), Feature: "Bench case", Experts: experts, State: council.StateQueued, QueuedAfter: "gone", Created: 1, Bench: true,
	})
	saveCouncil(t, &council.Council{
		Id: "mine", Project: t.TempDir(), Feature: "Left queued", Experts: experts, State: council.StateQueued, QueuedAfter: "gone", Created: 2,
	})

	StartCouncilRunner()

	if done := waitCouncil(t, "mine"); done.State != council.StateDone {
		t.Errorf("the person's council left queued ended %s (%s), want it started by StartCouncilRunner and done", done.State, done.Error)
	}
	if got, err := council.Load("bench1"); err != nil || got.State != council.StateStopped || got.Round != 0 {
		t.Errorf("the bench council left queued = %+v, %v, want it stopped and never run", got, err)
	}
	if got := len(fake.calls("r1")); got != 4 {
		t.Errorf("round 1 calls = %d, want only the person's council's 4", got)
	}
}

// TestBenchWaitStopsWhatNobodyReads covers the two councils the bench must not leave alone: one that paused for a
// person who is not there, and one still queued when the bench is cancelled (a queued council starts on a background
// context, so it would run later with nobody reading it).
func TestBenchWaitStopsWhatNobodyReads(t *testing.T) {
	fake := newCouncilFake()
	useCouncilRig(t, fake)
	ctx := context.Background()
	experts, err := council.ExpertsFor("ui-feature")
	if err != nil {
		t.Fatal(err)
	}
	newBench := func(pause bool) *council.Council {
		return &council.Council{Project: t.TempDir(), Feature: "Idle sleep", Experts: experts, Bench: true, PauseAfterRound1: pause}
	}

	paused, err := councilRunner.Start(ctx, newBench(true))
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	got, err := benchWaitCouncil(ctx, paused.Id)
	if err != nil || got.State != council.StateStopped {
		t.Fatalf("a bench council paused after round 1 = %+v, %v, want it stopped", got, err)
	}

	held := fake.hold("ux/r1")
	running, err := councilRunner.Start(ctx, newBench(false))
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	<-held
	queued, err := councilRunner.Start(ctx, newBench(false))
	if err != nil || queued.State != council.StateQueued {
		t.Fatalf("second start = %+v, %v, want it queued behind %s", queued, err, running.Id)
	}
	waitCtx, cancel := context.WithCancel(ctx)
	done := make(chan error, 1)
	go func() {
		_, err := benchWaitCouncil(waitCtx, queued.Id)
		done <- err
	}()
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Errorf("wait after the bench was cancelled = %v, want the cancellation", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("wait never returned after its context ended")
	}
	if got, _ := council.Load(queued.Id); got.State != council.StateStopped || got.Round != 0 {
		t.Errorf("the queued bench council = %s at round %d, want it stopped and never run", got.State, got.Round)
	}
}

func TestCouncilBenchResultsGroupsByHarness(t *testing.T) {
	useCouncilStore(t)
	dataDir := useCouncilBench(t, nil)
	ws := &WshServer{}
	ctx := context.Background()

	empty, err := ws.CouncilBenchResultsCommand(ctx)
	if err != nil || empty.Runs == nil || empty.Ratings == nil || len(empty.Runs)+len(empty.Ratings) != 0 {
		t.Fatalf("results with no file = %+v, %v, want empty lists the frontend can map over", empty, err)
	}

	for _, r := range []bench.CouncilBenchResult{
		{Harness: "2026-10-22.1", Case: "alpha", Variant: bench.VariantSolo, Run: 1, State: "done", Recall: 1, Keys: 2, Tokens: 500_000},
		{Harness: "2026-10-23.1", Case: "alpha", Variant: bench.VariantSolo, Run: 1, State: "done", Recall: 2, Keys: 2, Tokens: 500_000},
		{Harness: "2026-10-23.1", Case: "alpha", Variant: bench.VariantCouncil, Run: 1, State: "stopped", Tokens: 200_000},
	} {
		if err := bench.AppendResult(dataDir, r); err != nil {
			t.Fatal(err)
		}
	}
	// a council rated twice counts once, by its later rating
	for _, r := range []bench.CouncilBenchRating{
		{RatedAt: "2026-10-22T10:00:00Z", Harness: "2026-10-23.1", Mode: council.ModeReview, Council: "c1", Rating: bench.RatingNot},
		{RatedAt: "2026-10-22T11:00:00Z", Harness: "2026-10-23.1", Mode: council.ModeReview, Council: "c1", Rating: bench.RatingUseful},
	} {
		if err := bench.AppendRating(dataDir, r); err != nil {
			t.Fatal(err)
		}
	}

	got, err := ws.CouncilBenchResultsCommand(ctx)
	if err != nil {
		t.Fatalf("CouncilBenchResultsCommand: %v", err)
	}
	type key struct{ harness, variant string }
	var order []key
	for _, row := range got.Runs {
		order = append(order, key{row.Harness, row.Variant})
	}
	if want := []key{{"2026-10-23.1", bench.VariantSolo}, {"2026-10-23.1", bench.VariantCouncil}, {"2026-10-22.1", bench.VariantSolo}}; !reflect.DeepEqual(order, want) {
		t.Errorf("rows = %v, want one per harness × variant, the newest harness first", order)
	}
	if stoppedRow := got.Runs[1]; stoppedRow.Runs != 1 || stoppedRow.Scored != 0 || stoppedRow.Tokens != 200_000 {
		t.Errorf("the stopped council's row = %+v, want it counted in runs and tokens but not scored", stoppedRow)
	}
	if want := []bench.CouncilBenchRatingRow{{Harness: "2026-10-23.1", Mode: council.ModeReview, Useful: 1}}; !reflect.DeepEqual(got.Ratings, want) {
		t.Errorf("ratings = %+v, want %+v", got.Ratings, want)
	}
}

// ---- the monthly reminder ----

// fakeEfforts is the initiative store of a test: create makes an effort, mutate applies the three ops the reminder uses.
type fakeEfforts struct {
	efforts []*waveobj.Effort
	creates int
	mutates []wshrpc.CommandEffortMutateData

	listErr, mutateErr error
}

func (f *fakeEfforts) api() councilBenchEfforts {
	return councilBenchEfforts{
		list: func(context.Context) ([]*waveobj.Effort, error) { return f.efforts, f.listErr },
		create: func(_ context.Context, d wshrpc.CommandEffortCreateData) (*wshrpc.CommandEffortCreateRtnData, error) {
			f.creates++
			e := &waveobj.Effort{OID: fmt.Sprintf("e%d", f.creates), Title: d.Title, Status: "active"}
			f.efforts = append(f.efforts, e)
			return &wshrpc.CommandEffortCreateRtnData{EffortOID: e.OID}, nil
		},
		mutate: func(_ context.Context, d wshrpc.CommandEffortMutateData) (*wshrpc.CommandEffortMutateRtnData, error) {
			if f.mutateErr != nil {
				return nil, f.mutateErr
			}
			f.mutates = append(f.mutates, d)
			for _, e := range f.efforts {
				if e.OID != d.EffortOID {
					continue
				}
				for _, op := range d.Ops {
					switch op.Op {
					case "addChunk":
						e.Chunks = append(e.Chunks, waveobj.EffortChunk{Label: op.Label, Status: "pending", Due: op.Due})
					case "setChunkDue", "setChunkStatus":
						for i := range e.Chunks {
							if e.Chunks[i].Label != op.Chunk {
								continue
							}
							if op.Op == "setChunkDue" {
								e.Chunks[i].Due = op.Due
							} else {
								e.Chunks[i].Status = op.Status
							}
						}
					}
				}
				return &wshrpc.CommandEffortMutateRtnData{Effort: e}, nil
			}
			return nil, errors.New("no such effort " + d.EffortOID)
		},
	}
}

func TestBenchReminderAddsOneChunk(t *testing.T) {
	f := &fakeEfforts{}
	ctx := context.Background()
	now := time.Date(2026, 10, 22, 15, 0, 0, 0, time.Local)

	if err := addBenchReminder(ctx, f.api(), now); err != nil {
		t.Fatalf("addBenchReminder: %v", err)
	}
	if f.creates != 1 || len(f.efforts) != 1 || f.efforts[0].Title != "Council benchmark" {
		t.Fatalf("efforts = %+v after %d creates, want the Council benchmark initiative made once", f.efforts, f.creates)
	}
	wantChunk := waveobj.EffortChunk{Label: "Re-measure the council: wsh council bench", Status: "pending", Due: "2026-11-21"}
	if !reflect.DeepEqual(f.efforts[0].Chunks, []waveobj.EffortChunk{wantChunk}) {
		t.Errorf("chunks = %+v, want %+v (due 30 days later)", f.efforts[0].Chunks, []waveobj.EffortChunk{wantChunk})
	}
	if len(f.mutates) != 1 || f.mutates[0].EffortOID != "e1" || f.mutates[0].Note == "" {
		t.Errorf("mutates = %+v, want one batch on the new initiative with a note saying what decides it", f.mutates)
	}

	// a second bench finds the initiative by its title and moves the one chunk's due date: it adds no second chunk and
	// makes no second initiative
	later := now.AddDate(0, 0, 3)
	if err := addBenchReminder(ctx, f.api(), later); err != nil {
		t.Fatalf("second addBenchReminder: %v", err)
	}
	if f.creates != 1 || len(f.efforts) != 1 {
		t.Errorf("the second call made another initiative: %d creates, %d efforts", f.creates, len(f.efforts))
	}
	if got := f.efforts[0].Chunks; len(got) != 1 || got[0].Due != "2026-11-24" || got[0].Status != "pending" {
		t.Errorf("chunks after the second call = %+v, want the one chunk due 2026-11-24", got)
	}

	// the person closed the reminder when they re-measured: the next bench reopens it with a new date
	f.efforts[0].Chunks[0].Status = "done"
	if err := addBenchReminder(ctx, f.api(), later.AddDate(0, 1, 0)); err != nil {
		t.Fatalf("third addBenchReminder: %v", err)
	}
	if got := f.efforts[0].Chunks; len(got) != 1 || got[0].Status != "pending" || got[0].Due != "2026-12-25" {
		t.Errorf("chunks after the closed one was found = %+v, want it pending again, due 2026-12-25", got)
	}
}

func TestBenchReminderIgnoresArchivedAndReportsFailures(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 10, 22, 15, 0, 0, 0, time.Local)

	// an archived initiative of that title takes no new work: a live one is made
	f := &fakeEfforts{efforts: []*waveobj.Effort{{OID: "old", Title: "Council benchmark", Status: "archived"}}}
	if err := addBenchReminder(ctx, f.api(), now); err != nil {
		t.Fatalf("addBenchReminder: %v", err)
	}
	if f.creates != 1 || len(f.mutates) != 1 || f.mutates[0].EffortOID == "old" {
		t.Errorf("creates %d, mutates %+v, want a new initiative and nothing written to the archived one", f.creates, f.mutates)
	}

	// a failure comes back, so the bench can say its reminder was not added
	f = &fakeEfforts{listErr: errors.New("vault locked")}
	if err := addBenchReminder(ctx, f.api(), now); err == nil || !strings.Contains(err.Error(), "vault locked") {
		t.Errorf("list failure = %v, want it returned", err)
	}
	f = &fakeEfforts{mutateErr: errors.New("EC-INVALID-DUE")}
	if err := addBenchReminder(ctx, f.api(), now); err == nil || !strings.Contains(err.Error(), "EC-INVALID-DUE") {
		t.Errorf("mutate failure = %v, want it returned", err)
	}
}
