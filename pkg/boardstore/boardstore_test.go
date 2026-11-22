// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package boardstore

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const testProject = "waveterm"

var testAgent = wshrpc.BoardAgent{TabId: "tab-1", Title: "claude · waveterm", SessionId: "s-1"}

// useDataDir points the package at a data dir of its own, so Root and ProjectDir land in the test's temp dir.
func useDataDir(t *testing.T) string {
	t.Helper()
	saved := wavebase.DataHome_VarCache
	wavebase.DataHome_VarCache = filepath.Join(t.TempDir(), "data")
	t.Cleanup(func() { wavebase.DataHome_VarCache = saved })
	return wavebase.DataHome_VarCache
}

func mustCreate(t *testing.T, dir, name string, now int64) wshrpc.BoardInfo {
	t.Helper()
	info, err := Create(dir, testProject, name, testAgent, now)
	if err != nil {
		t.Fatalf("create %q: %v", name, err)
	}
	return info
}

// putTalk replaces a board's turns (and its agent, when given one).
func putTalk(t *testing.T, dir, id string, agent *wshrpc.BoardAgent, turns ...wshrpc.BoardTurn) {
	t.Helper()
	if _, err := UpdateTalk(dir, id, func(tk *wshrpc.BoardTalk) error {
		if agent != nil {
			tk.Agent = agent
		}
		tk.Turns = turns
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestCreateWritesTheDrawingAndItsTalk(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "not-yet") // Create makes the project folder
	info, err := Create(dir, testProject, "  Auth flow ", testAgent, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if info.Name != "Auth flow" || !ValidID(info.ID) || info.Project != testProject || info.CreatedTs != 1000 ||
		info.ActiveTs != 1000 || info.AgentTabId != "tab-1" || info.AgentTitle != "claude · waveterm" {
		t.Fatalf("create info: %+v", info)
	}
	if !filepath.IsAbs(info.Path) || filepath.Base(info.Path) != info.ID+".excalidraw" {
		t.Fatalf("path: %q", info.Path)
	}

	raw, err := os.ReadFile(boardPath(dir, info.ID))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(raw), `{"arc":`) {
		t.Fatalf("arc must be the first key, got %.40s", raw)
	}
	var file map[string]any
	if err := json.Unmarshal(raw, &file); err != nil || file["type"] != "excalidraw" || file["source"] != "arc" {
		t.Fatalf("not an excalidraw file: %v %v", err, file)
	}
	if elements, ok := file["elements"].([]any); !ok || len(elements) != 0 {
		t.Fatalf("a new board has an empty drawing, got %v", file["elements"])
	}

	talk, err := ReadTalk(dir, info.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := wshrpc.BoardTalk{Project: testProject, BoardId: info.ID, Agent: &testAgent, Turns: []wshrpc.BoardTurn{}}
	if !reflect.DeepEqual(talk, want) {
		t.Fatalf("talk:\n got %+v\nwant %+v", talk, want)
	}
	if _, err := os.Stat(filepath.Join(dir, info.ID+".talk.json")); err != nil {
		t.Fatalf("the talk sidecar: %v", err)
	}
}

func TestCreateRefusesEmptyNameAndMissingAgent(t *testing.T) {
	dir := t.TempDir()
	if _, err := Create(dir, testProject, "   ", testAgent, 1); err == nil {
		t.Error("an empty name should be refused")
	}
	if _, err := Create(dir, testProject, "Flow", wshrpc.BoardAgent{Title: "claude"}, 1); err == nil {
		t.Error("a board with no agent tab should be refused")
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("a refused create wrote %d entries", len(entries))
	}
}

func TestCreateFailsWhenTheFolderCannotBeMade(t *testing.T) {
	blocked := filepath.Join(t.TempDir(), "boards")
	if err := os.WriteFile(blocked, []byte("a file where the project folder should go"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Create(blocked, testProject, "Flow", testAgent, 1); err == nil {
		t.Fatal("create into a path that is a file should fail")
	}
}

func TestCreateThenRead(t *testing.T) {
	dir := t.TempDir()
	info := mustCreate(t, dir, "Auth flow", 1000)
	read, err := Read(dir, testProject, info.ID)
	if err != nil {
		t.Fatal(err)
	}
	if read.Info.ID != info.ID || read.Info.Name != "Auth flow" || read.Info.CreatedTs != 1000 || read.Info.Project != testProject ||
		read.Rev == "" || read.Rev != revOf([]byte(read.Data)) {
		t.Fatalf("read: %+v", read)
	}
	if _, err := Read(dir, testProject, "00000000"); err == nil {
		t.Error("reading a missing board should fail")
	}
	for _, id := range []string{"../x", "ABCDEF12", "7c1e0b4", "7c1e0b4ff", "", `..\x`} {
		if _, err := Read(dir, testProject, id); err == nil {
			t.Errorf("Read(%q) should refuse", id)
		}
	}
}

func TestListNewestActiveFirstThenById(t *testing.T) {
	dir := t.TempDir()
	a := mustCreate(t, dir, "a", 1000)
	b := mustCreate(t, dir, "b", 2000)
	c1 := mustCreate(t, dir, "c1", 3000)
	c2 := mustCreate(t, dir, "c2", 3000)

	// a turn is activity: a board talked to after b was made lists before it
	putTalk(t, dir, a.ID, nil, wshrpc.BoardTurn{ID: "t1", Ts: 2500, Kind: "ask", State: "forwarded"})

	list, err := List(dir, testProject, nil)
	if err != nil || len(list) != 4 {
		t.Fatalf("list: %v %+v", err, list)
	}
	tied := []string{c1.ID, c2.ID}
	sort.Strings(tied)
	want := append(append([]string{}, tied...), a.ID, b.ID)
	for i, id := range want {
		if list[i].ID != id {
			t.Fatalf("order[%d] = %s, want %s (ActiveTs newest first, then id): %+v", i, list[i].ID, id, list)
		}
	}
	if list[2].ActiveTs != 2500 || list[3].ActiveTs != 2000 {
		t.Fatalf("ActiveTs: %+v", list)
	}
}

func TestListMissingDirIsEmpty(t *testing.T) {
	list, err := List(filepath.Join(t.TempDir(), "nope"), testProject, nil)
	if err != nil || list == nil || len(list) != 0 {
		t.Fatalf("got %v %v", list, err)
	}
}

func TestListFillsTheRowFromTheTalk(t *testing.T) {
	dir := t.TempDir()
	tied := mustCreate(t, dir, "tied", 1)
	words := mustCreate(t, dir, "forwarded only", 2)
	bare := mustCreate(t, dir, "bare", 3)
	other := &wshrpc.BoardAgent{TabId: "tab-2", Title: "claude · other"}
	putTalk(t, dir, tied.ID, other,
		wshrpc.BoardTurn{ID: "t1", Ts: 100, Kind: "ask", State: "answered", Added: 2, AnsweredTs: 150},
		wshrpc.BoardTurn{ID: "t2", Ts: 200, Kind: "ask", State: "forwarded", Forward: &wshrpc.BoardForward{State: "replied"}},
		wshrpc.BoardTurn{ID: "t3", Ts: 300, Kind: "request", State: "answered", Changed: 1, Removed: 1, AnsweredTs: 350},
		// an answer that changed nothing is not a drawing
		wshrpc.BoardTurn{ID: "t4", Ts: 400, Kind: "request", State: "answered", AnsweredTs: 450})
	putTalk(t, dir, words.ID, nil, wshrpc.BoardTurn{ID: "t1", Ts: 100, Kind: "ask", State: "forwarded"})

	list, err := List(dir, testProject, nil)
	if err != nil {
		t.Fatal(err)
	}
	byID := map[string]wshrpc.BoardInfo{}
	for _, b := range list {
		byID[b.ID] = b
	}
	got := byID[tied.ID]
	if got.Turns != 4 || got.DrawnTs != 350 || got.ActiveTs != 450 || got.AgentTabId != "tab-2" ||
		got.AgentTitle != "claude · other" || got.State != "" || got.Project != testProject || got.Name != "tied" {
		t.Errorf("tied: %+v", got)
	}
	if got := byID[words.ID]; got.Turns != 1 || got.DrawnTs != 0 || got.ActiveTs != 100 || got.AgentTabId != "tab-1" || got.State != "" {
		t.Errorf("forwarded only: %+v", got)
	}
	if got := byID[bare.ID]; got.Turns != 0 || got.DrawnTs != 0 || got.ActiveTs != 3 || got.State != "" {
		t.Errorf("bare: %+v", got)
	}
}

func TestListState(t *testing.T) {
	dir := t.TempDir()
	failed := mustCreate(t, dir, "failed", 1)
	stale := mustCreate(t, dir, "stale answering", 2)
	queued := mustCreate(t, dir, "stale waiting", 3)
	running := mustCreate(t, dir, "running", 4)
	stopped := mustCreate(t, dir, "stopped", 5)
	retried := mustCreate(t, dir, "failed then answered", 6)
	putTalk(t, dir, failed.ID, nil, wshrpc.BoardTurn{ID: "t1", Ts: 10, State: "failed", Reason: "r"})
	putTalk(t, dir, stale.ID, nil, wshrpc.BoardTurn{ID: "t1", Ts: 10, State: "answering"})
	putTalk(t, dir, queued.ID, nil, wshrpc.BoardTurn{ID: "t1", Ts: 10, State: "waiting"})
	putTalk(t, dir, running.ID, nil, wshrpc.BoardTurn{ID: "t1", Ts: 10, State: "answering"})
	putTalk(t, dir, stopped.ID, nil, wshrpc.BoardTurn{ID: "t1", Ts: 10, State: "stopped"})
	putTalk(t, dir, retried.ID, nil,
		wshrpc.BoardTurn{ID: "t1", Ts: 10, State: "failed"}, wshrpc.BoardTurn{ID: "t2", Ts: 20, State: "answered", AnsweredTs: 25})

	// the drawer is busy on running: what the caller says wins over the turn
	state := func(id string) string {
		if id == running.ID {
			return "answering"
		}
		return ""
	}
	list, err := List(dir, testProject, state)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, b := range list {
		got[b.Name] = b.State
	}
	want := map[string]string{
		"failed": "failed", "stale answering": "failed", "stale waiting": "failed",
		"running": "answering", "stopped": "", "failed then answered": "",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("states:\n got %v\nwant %v", got, want)
	}

	// with nothing running, a turn left answering reads failed too
	plain, _ := List(dir, testProject, nil)
	for _, b := range plain {
		if b.ID == running.ID && b.State != "failed" {
			t.Errorf("an answering turn nothing runs: state = %q, want failed", b.State)
		}
	}
}

func TestListTakesTheProjectFromTheTalkWhenNoneIsGiven(t *testing.T) {
	dir := t.TempDir()
	if _, err := Create(dir, "wave:term", "Flow", testAgent, 1); err != nil {
		t.Fatal(err)
	}
	// the all-projects list reads folders, whose names are only the project's made safe for a path
	list, err := List(dir, "", nil)
	if err != nil || len(list) != 1 || list[0].Project != "wave:term" {
		t.Fatalf("list: %v %+v", err, list)
	}
	if list, _ := List(dir, "asked-for", nil); len(list) != 1 || list[0].Project != "asked-for" {
		t.Fatalf("a project the caller names is the row's: %+v", list)
	}
}

func TestListShapesSkipBoundTextAndDeletedElements(t *testing.T) {
	dir := t.TempDir()
	info := mustCreate(t, dir, "Shapes", 1)
	read, err := Read(dir, testProject, info.ID)
	if err != nil {
		t.Fatal(err)
	}
	// a labelled box and an arrow, a deleted box, its deleted label, and a free text: bound text is part of its
	// container, a deleted element is gone
	data := `{"arc":{"name":"Shapes","createdts":1},"type":"excalidraw","elements":[` +
		`{"id":"n1","type":"rectangle"},` +
		`{"id":"n2","type":"text","containerId":"n1","text":"wavesrv"},` +
		`{"id":"n3","type":"arrow"},` +
		`{"id":"n4","type":"rectangle","isDeleted":true},` +
		`{"id":"n5","type":"text","containerId":"n4","isDeleted":true},` +
		`{"id":"n6","type":"text","text":"free"},` +
		`{"id":"","type":"rectangle"}]}`
	if res, err := Save(dir, info.ID, data, read.Rev); err != nil || res.Conflict {
		t.Fatalf("save: %v %+v", err, res)
	}
	list, err := List(dir, testProject, nil)
	if err != nil || len(list) != 1 || list[0].Shapes != 3 {
		t.Fatalf("list: %v %+v (want n1, n3 and n6)", err, list)
	}
	if again, err := Read(dir, testProject, info.ID); err != nil || again.Info.Shapes != 3 {
		t.Fatalf("read: %v %+v", err, again.Info)
	}
	// a new board has none
	empty := mustCreate(t, dir, "Empty", 2)
	rows, _ := List(dir, testProject, nil)
	for _, r := range rows {
		if r.ID == empty.ID && r.Shapes != 0 {
			t.Errorf("an empty board has %d shapes", r.Shapes)
		}
	}
}

func TestListDamagedFile(t *testing.T) {
	dir := t.TempDir()
	info := mustCreate(t, dir, "Auth flow", 1)
	path := boardPath(dir, info.ID)
	raw, _ := os.ReadFile(path)
	cut := raw[:len(raw)/2]
	if err := os.WriteFile(path, cut, 0o644); err != nil {
		t.Fatal(err)
	}

	list, err := List(dir, testProject, nil)
	if err != nil || len(list) != 1 {
		t.Fatalf("list: %v %+v", err, list)
	}
	row := list[0]
	if !strings.HasPrefix(row.LoadError, "its file is not valid Excalidraw JSON (") || !strings.Contains(row.LoadError, ", at line 1)") {
		t.Fatalf("load error: %q", row.LoadError)
	}
	if row.Name != "Auth flow" || row.Shapes != 0 {
		t.Fatalf("name should come from the arc prefix, got %+v", row)
	}
	if row.AgentTabId != "tab-1" {
		t.Fatalf("a damaged board is still tied to its agent: %+v", row)
	}

	read, err := Read(dir, testProject, info.ID)
	if err == nil || err.Error() != row.LoadError || read.Info.LoadError != row.LoadError {
		t.Fatalf("read: %v %+v", err, read.Info)
	}

	// no arc prefix at all: the id stands in for the name
	if err := os.WriteFile(path, []byte(`{`), 0o644); err != nil {
		t.Fatal(err)
	}
	list, _ = List(dir, testProject, nil)
	if list[0].Name != info.ID || list[0].LoadError == "" {
		t.Fatalf("fallback name: %+v", list[0])
	}
}

func TestListLeavesOutWhatIsNotABoard(t *testing.T) {
	dir := t.TempDir()
	info := mustCreate(t, dir, "Real", 1)
	if err := PutAnswer(dir, newAnswer(info.ID, 1)); err != nil { // the inbox folder
		t.Fatal(err)
	}
	for _, name := range []string{"notes.txt", "x.excalidraw", "ABCDEF12.excalidraw", info.ID + ".talk.json.tmp"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(`{"arc":{"name":"x"}}`), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(dir, "7c1e0b4f.excalidraw"), 0o755); err != nil { // a folder is not a board
		t.Fatal(err)
	}
	list, err := List(dir, testProject, nil)
	if err != nil || len(list) != 1 || list[0].ID != info.ID {
		t.Fatalf("list: %v %+v", err, list)
	}
}

func TestListWithADamagedTalkStillListsTheBoard(t *testing.T) {
	dir := t.TempDir()
	info := mustCreate(t, dir, "Flow", 1)
	if err := os.WriteFile(talkPath(dir, info.ID), []byte(`{"turns":`), 0o644); err != nil {
		t.Fatal(err)
	}
	list, err := List(dir, testProject, nil)
	if err != nil || len(list) != 1 || list[0].Name != "Flow" || list[0].Turns != 0 {
		t.Fatalf("list: %v %+v", err, list)
	}
	if _, err := ReadTalk(dir, info.ID); err == nil {
		t.Error("a damaged talk should read as an error")
	}
}

func TestFindByName(t *testing.T) {
	dir := t.TempDir()
	older := mustCreate(t, dir, "Auth flow", 1000)
	newer := mustCreate(t, dir, "auth FLOW", 2000)
	other := mustCreate(t, dir, "Deploy", 3000)

	for _, name := range []string{"Auth flow", "  auth flow\n", "AUTH FLOW", "auth FLOW"} {
		got, ok, err := FindByName(dir, testProject, name)
		if err != nil || !ok || got.ID != newer.ID {
			t.Errorf("FindByName(%q) = %+v %v %v, want the most recently active, %s", name, got, ok, err, newer.ID)
		}
	}
	// activity decides which of two boards of one name is meant, not the order they were made in
	putTalk(t, dir, older.ID, nil, wshrpc.BoardTurn{ID: "t1", Ts: 5000, Kind: "request", State: "answered", AnsweredTs: 5100})
	if got, ok, _ := FindByName(dir, testProject, "auth flow"); !ok || got.ID != older.ID {
		t.Errorf("after a turn on the older board: %+v %v", got, ok)
	}
	if got, ok, err := FindByName(dir, testProject, "deploy"); err != nil || !ok || got.ID != other.ID || got.Project != testProject {
		t.Errorf("deploy: %+v %v %v", got, ok, err)
	}
	for _, name := range []string{"Auth", "Auth flow 2", "", "   "} {
		if got, ok, err := FindByName(dir, testProject, name); err != nil || ok {
			t.Errorf("FindByName(%q) = %+v %v %v, want none", name, got, ok, err)
		}
	}
	if _, ok, err := FindByName(filepath.Join(t.TempDir(), "nope"), testProject, "Auth flow"); err != nil || ok {
		t.Errorf("a project with no boards: %v %v", ok, err)
	}
}

func TestFindByNameTakesABoardRef(t *testing.T) {
	// Chat's @ picker writes board:<id>; it names that board, whatever the board is called
	dir := t.TempDir()
	first := mustCreate(t, dir, "Auth flow", 1000)
	mustCreate(t, dir, "Deploy", 2000)
	for _, name := range []string{"board:" + first.ID, " BOARD:" + strings.ToUpper(first.ID) + " "} {
		if got, ok, err := FindByName(dir, testProject, name); err != nil || !ok || got.ID != first.ID {
			t.Errorf("FindByName(%q) = %+v %v %v, want %s", name, got, ok, err, first.ID)
		}
	}
	for _, name := range []string{"board:00000000", "board:", "board:xyz"} {
		if got, ok, err := FindByName(dir, testProject, name); err != nil || ok {
			t.Errorf("FindByName(%q) = %+v %v %v, want none", name, got, ok, err)
		}
	}
	if _, ok := RefID("board:xyz"); ok {
		t.Error(`RefID("board:xyz") is no board id`)
	}
	if id, ok := RefID("Board:" + first.ID); !ok || id != first.ID {
		t.Errorf("RefID = %q %v", id, ok)
	}
}

func TestFindByNameFindsADamagedBoardForItsCaller(t *testing.T) {
	// a board whose file broke keeps its name, so a request for it names the problem rather than starting a twin
	dir := t.TempDir()
	info := mustCreate(t, dir, "Auth flow", 1)
	if err := os.WriteFile(boardPath(dir, info.ID), []byte(`{"arc":{"name":"Auth flow","createdts":1},`), 0o644); err != nil {
		t.Fatal(err)
	}
	got, ok, err := FindByName(dir, testProject, "auth flow")
	if err != nil || !ok || got.ID != info.ID || got.LoadError == "" {
		t.Fatalf("FindByName = %+v %v %v", got, ok, err)
	}
}

func TestSaveConflictWritesNothing(t *testing.T) {
	dir := t.TempDir()
	info := mustCreate(t, dir, "Flow", 1)
	first, err := Read(dir, testProject, info.ID)
	if err != nil {
		t.Fatal(err)
	}
	saved := `{"arc":{"name":"Flow","createdts":1},"type":"excalidraw","elements":[{"id":"a","type":"rectangle"}]}`
	res, err := Save(dir, info.ID, saved, first.Rev)
	if err != nil || res.Conflict || res.Rev == "" || res.Rev == first.Rev {
		t.Fatalf("first save: %v %+v", err, res)
	}
	if after, _ := os.ReadFile(boardPath(dir, info.ID)); string(after) != saved {
		t.Fatal("saved bytes differ")
	}
	if reread, _ := Read(dir, testProject, info.ID); reread.Rev != res.Rev {
		t.Fatalf("rev %q != saved rev %q", reread.Rev, res.Rev)
	}

	// a writer still holding the old rev loses and the file stays as the winner wrote it
	stale, err := Save(dir, info.ID, `{"arc":{"name":"Other"}}`, first.Rev)
	if err != nil || !stale.Conflict || stale.Rev != "" {
		t.Fatalf("stale save: %v %+v", err, stale)
	}
	if now, _ := os.ReadFile(boardPath(dir, info.ID)); string(now) != saved {
		t.Fatal("a conflicting save changed the file")
	}
	// holding the new rev, it goes through
	if res, err := Save(dir, info.ID, `{"arc":{"name":"Flow"},"elements":[]}`, res.Rev); err != nil || res.Conflict {
		t.Fatalf("save on the new rev: %v %+v", err, res)
	}
}

// the hand edit and the ack-time save both read the board, then both save: whoever lands second held a stale rev,
// so it writes nothing and gets the conflict, which sends it back to read again
func TestSaveHandEditAndAckTimeSaveNeverOverwriteEachOther(t *testing.T) {
	dir := t.TempDir()
	info := mustCreate(t, dir, "Flow", 1)
	read, err := Read(dir, testProject, info.ID)
	if err != nil {
		t.Fatal(err)
	}
	hand := `{"arc":{"name":"Flow","createdts":1},"elements":[{"id":"hand","type":"rectangle"}]}`
	drawn := `{"arc":{"name":"Flow","createdts":1},"elements":[{"id":"drawn","type":"rectangle"}]}`

	const writers = 16
	var wg sync.WaitGroup
	results := make([]wshrpc.BoardSaveRtnData, writers)
	start := make(chan struct{})
	for i := range writers {
		wg.Go(func() {
			<-start
			data := hand
			if i%2 == 1 {
				data = drawn
			}
			res, err := Save(dir, info.ID, data, read.Rev)
			if err != nil {
				t.Error(err)
			}
			results[i] = res
		})
	}
	close(start)
	wg.Wait()

	winners := 0
	var winner wshrpc.BoardSaveRtnData
	for _, res := range results {
		if !res.Conflict {
			winners++
			winner = res
		} else if res.Rev != "" {
			t.Errorf("a conflict carries no rev: %+v", res)
		}
	}
	if winners != 1 {
		t.Fatalf("%d saves from one rev went through, want exactly 1: %+v", winners, results)
	}
	now, _ := os.ReadFile(boardPath(dir, info.ID))
	if string(now) != hand && string(now) != drawn {
		t.Fatalf("the file is neither writer's: %s", now)
	}
	if revOf(now) != winner.Rev {
		t.Fatalf("the winner's rev %q is not the file's %q", winner.Rev, revOf(now))
	}
}

func TestSaveRefusesBadData(t *testing.T) {
	dir := t.TempDir()
	info := mustCreate(t, dir, "Flow", 1)
	read, _ := Read(dir, testProject, info.ID)
	for name, data := range map[string]string{
		"not json":           `{"arc":`,
		"no arc":             `{"elements":[]}`,
		"empty name":         `{"arc":{"name":"  "}}`,
		"arc string":         `{"arc":"x"}`,
		"elements not array": `{"arc":{"name":"x"},"elements":"x"}`,
	} {
		if _, err := Save(dir, info.ID, data, read.Rev); err == nil {
			t.Errorf("%s: save should refuse", name)
		}
	}
	if _, err := Save(dir, "00000000", `{"arc":{"name":"x"}}`, ""); err == nil {
		t.Error("save to a missing board should refuse")
	}
	if now, _ := os.ReadFile(boardPath(dir, info.ID)); revOf(now) != read.Rev {
		t.Error("a refused save changed the file")
	}
}

func TestSaveRefusesToOverwriteADamagedFile(t *testing.T) {
	dir := t.TempDir()
	info := mustCreate(t, dir, "Flow", 1)
	path := boardPath(dir, info.ID)
	raw, _ := os.ReadFile(path)
	cut := raw[:len(raw)/2]
	if err := os.WriteFile(path, cut, 0o644); err != nil {
		t.Fatal(err)
	}
	list, _ := List(dir, testProject, nil)
	if _, err := Save(dir, info.ID, `{"arc":{"name":"x"}}`, revOf(cut)); err == nil || !strings.Contains(err.Error(), list[0].LoadError) {
		t.Fatalf("save should refuse naming the load error, got %v", err)
	}
	if now, _ := os.ReadFile(path); string(now) != string(cut) {
		t.Fatal("a refused save changed the damaged file")
	}
}

func TestSaveRefusesBadIDs(t *testing.T) {
	dir := t.TempDir()
	for _, id := range []string{"../x", "ABCDEF12", "7c1e0b4", "7c1e0b4ff", "", `..\x`} {
		if ValidID(id) {
			t.Errorf("ValidID(%q) = true", id)
		}
		if _, err := Save(dir, id, `{"arc":{"name":"x"}}`, ""); err == nil {
			t.Errorf("Save(%q) should refuse", id)
		}
	}
	if !ValidID("7c1e0b4f") {
		t.Error("ValidID rejects a good id")
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("a refused call wrote into the dir: %v", entries)
	}
}

func TestProjectDirSanitizes(t *testing.T) {
	useDataDir(t)
	cases := map[string]string{
		`a:b?`:       "a_b_",
		`x/y\z`:      "x_y_z",
		`a<b>c"d|e*`: "a_b_c_d_e_",
		"name. .":    "name___",
		"":           "_",
		"..":         "__",
		".":          "_",
		"wave term":  "wave term",
		"arcterm":    "arcterm",
	}
	for in, want := range cases {
		got := ProjectDir(in)
		if filepath.Base(got) != want || filepath.Dir(got) != Root() {
			t.Errorf("ProjectDir(%q) = %q, want base %q under %q", in, got, want, Root())
		}
	}
	if filepath.Base(Root()) != "boards" || filepath.Dir(Root()) != wavebase.GetWaveDataDir() {
		t.Errorf("Root() = %q", Root())
	}
}

func TestProjectDirsListsTheProjectFolders(t *testing.T) {
	useDataDir(t)
	if dirs, err := ProjectDirs(); err != nil || dirs == nil || len(dirs) != 0 {
		t.Fatalf("no boards folder yet: %v %v", dirs, err)
	}
	for _, project := range []string{"waveterm", "arcterm", "wave:term"} {
		if _, err := Create(ProjectDir(project), project, "Flow", testAgent, 1); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(Root(), "stray.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	dirs, err := ProjectDirs()
	if err != nil {
		t.Fatal(err)
	}
	want := []string{ProjectDir("arcterm"), ProjectDir("wave:term"), ProjectDir("waveterm")}
	sort.Strings(want)
	if !reflect.DeepEqual(dirs, want) {
		t.Fatalf("dirs:\n got %v\nwant %v", dirs, want)
	}
	// each folder lists its own boards, and a row knows its project though the folder name is not it
	var projects []string
	for _, d := range dirs {
		list, err := List(d, "", nil)
		if err != nil || len(list) != 1 {
			t.Fatalf("list %s: %v %+v", d, err, list)
		}
		projects = append(projects, list[0].Project)
	}
	sort.Strings(projects)
	if !reflect.DeepEqual(projects, []string{"arcterm", "wave:term", "waveterm"}) {
		t.Fatalf("projects: %v", projects)
	}
}

const unknownBoard = "7c1e0b4f"

func TestTalkMissingIsEmpty(t *testing.T) {
	dir := t.TempDir()
	talk, err := ReadTalk(dir, unknownBoard)
	if err != nil || talk.Turns == nil || len(talk.Turns) != 0 || talk.BoardId != unknownBoard {
		t.Fatalf("missing talk: %v %+v", err, talk)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("reading wrote %d entries", len(entries))
	}
}

func TestTalkUpdateRoundTrip(t *testing.T) {
	dir := t.TempDir()
	want := wshrpc.BoardTalk{
		Project:       testProject,
		BoardId:       unknownBoard,
		SessionId:     uuid.NewString(),
		ContextTokens: 1200,
		Agent:         &wshrpc.BoardAgent{TabId: "tab-1", Title: "claude · waveterm", SessionId: "s-9", ReadTs: 77},
		Turns: []wshrpc.BoardTurn{
			{ID: "t1", Ts: 5, Kind: "ask", Question: "q", On: "wavesrv", SelectedIds: []string{"a"}, State: "answered", ShapeIds: []string{"a", "b"}, Added: 2},
			{ID: "t2", Ts: 6, Kind: "request", Context: "x", Question: "y", State: "failed", Reason: "r"},
			{ID: "t3", Ts: 7, Kind: "ask", Question: "z", State: "forwarded", From: "t1", Forward: &wshrpc.BoardForward{State: "replied", Reply: "two", ReplyTs: 9}},
		},
	}
	got, err := UpdateTalk(dir, unknownBoard, func(tk *wshrpc.BoardTalk) error {
		*tk = want
		return nil
	})
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("update returned: %v %+v", err, got)
	}
	read, err := ReadTalk(dir, unknownBoard)
	if err != nil || !reflect.DeepEqual(read, want) {
		t.Fatalf("read back: %v %+v", err, read)
	}
	if _, err := os.Stat(filepath.Join(dir, unknownBoard+".talk.json")); err != nil {
		t.Fatalf("talk file: %v", err)
	}
}

func TestTalkUpdateSerializesConcurrentUpdates(t *testing.T) {
	dir := t.TempDir()
	const n = 20
	var wg sync.WaitGroup
	for range n {
		wg.Go(func() {
			_, err := UpdateTalk(dir, unknownBoard, func(tk *wshrpc.BoardTalk) error {
				tk.Turns = append(tk.Turns, wshrpc.BoardTurn{ID: uuid.NewString(), State: "answered"})
				return nil
			})
			if err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if talk, err := ReadTalk(dir, unknownBoard); err != nil || len(talk.Turns) != n {
		t.Fatalf("turns after %d updates: %v %d", n, err, len(talk.Turns))
	}
}

func TestTalkUpdateErrorWritesNothing(t *testing.T) {
	dir := t.TempDir()
	boom := errors.New("boom")
	if _, err := UpdateTalk(dir, unknownBoard, func(tk *wshrpc.BoardTalk) error {
		tk.Turns = append(tk.Turns, wshrpc.BoardTurn{ID: "x"})
		return boom
	}); !errors.Is(err, boom) {
		t.Fatalf("err: %v", err)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("a failed update created %d entries", len(entries))
	}

	if _, err := UpdateTalk(dir, unknownBoard, func(tk *wshrpc.BoardTalk) error {
		tk.Turns = append(tk.Turns, wshrpc.BoardTurn{ID: "one", State: "answered"})
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, unknownBoard+".talk.json")
	before, _ := os.ReadFile(path)
	if _, err := UpdateTalk(dir, unknownBoard, func(tk *wshrpc.BoardTalk) error {
		tk.Turns = append(tk.Turns, wshrpc.BoardTurn{ID: "two"})
		return boom
	}); !errors.Is(err, boom) {
		t.Fatalf("err: %v", err)
	}
	if after, _ := os.ReadFile(path); string(after) != string(before) {
		t.Fatal("a failed update changed the talk file")
	}
}

func TestTalkDamagedIsAnErrorAndStaysAsItIs(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, unknownBoard+".talk.json")
	if err := os.WriteFile(path, []byte(`{"turns":[`), 0o644); err != nil {
		t.Fatal(err)
	}
	called := false
	_, err := UpdateTalk(dir, unknownBoard, func(*wshrpc.BoardTalk) error { called = true; return nil })
	if err == nil || called {
		t.Fatalf("a damaged talk must not be written over a guess: %v, fn called %v", err, called)
	}
	if now, _ := os.ReadFile(path); string(now) != `{"turns":[` {
		t.Fatal("the damaged talk was changed")
	}
}

func TestTalkRefusesBadId(t *testing.T) {
	dir := t.TempDir()
	for _, id := range []string{"../x", "ABCDEF12", "7c1e0b4", "", `..\x`} {
		if _, err := ReadTalk(dir, id); err == nil {
			t.Errorf("ReadTalk(%q) should refuse", id)
		}
		called := false
		if _, err := UpdateTalk(dir, id, func(*wshrpc.BoardTalk) error { called = true; return nil }); err == nil || called {
			t.Errorf("UpdateTalk(%q) should refuse before calling fn", id)
		}
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("a refused call wrote into the dir: %v", entries)
	}
}

func newAnswer(board string, ts int64) wshrpc.BoardAnswer {
	return wshrpc.BoardAnswer{ID: uuid.NewString(), Project: testProject, BoardId: board, TurnId: "t", Add: `[{"id":"n"}]`, Remove: []string{"r"}, Ts: ts}
}

func TestAnswersPutListAck(t *testing.T) {
	dir := t.TempDir()
	a := mustCreate(t, dir, "A", 1)
	b := mustCreate(t, dir, "B", 2)
	older, newer, other := newAnswer(a.ID, 100), newAnswer(a.ID, 200), newAnswer(b.ID, 150)
	for _, ans := range []wshrpc.BoardAnswer{newer, older, other} { // written out of order
		if err := PutAnswer(dir, ans); err != nil {
			t.Fatal(err)
		}
	}
	junk := filepath.Join(dir, a.ID+".answers", uuid.NewString()+".json")
	if err := os.WriteFile(junk, []byte("{nope"), 0o644); err != nil {
		t.Fatal(err)
	}

	got, err := Answers(dir, a.ID)
	if err != nil || len(got) != 2 || got[0].ID != older.ID || got[1].ID != newer.ID {
		t.Fatalf("oldest first, unreadable skipped: %v %+v", err, got)
	}
	if !reflect.DeepEqual(got[1], newer) {
		t.Fatalf("round trip: %+v", got[1])
	}
	if gotB, err := Answers(dir, b.ID); err != nil || len(gotB) != 1 || gotB[0].ID != other.ID {
		t.Fatalf("each board has its own inbox: %v %+v", err, gotB)
	}

	if err := AckAnswer(dir, a.ID, newer.ID); err != nil {
		t.Fatal(err)
	}
	if err := AckAnswer(dir, a.ID, newer.ID); err != nil {
		t.Fatalf("acking twice: %v", err)
	}
	if err := AckAnswer(dir, unknownBoard, uuid.NewString()); err != nil {
		t.Fatalf("acking on a board with no inbox: %v", err)
	}
	if left, _ := Answers(dir, a.ID); len(left) != 1 || left[0].ID != older.ID {
		t.Fatalf("left: %+v", left)
	}
	if none, err := Answers(dir, unknownBoard); err != nil || none == nil || len(none) != 0 {
		t.Fatalf("no inbox: %v %v", none, err)
	}
	if none, err := Answers(filepath.Join(dir, "nope"), a.ID); err != nil || len(none) != 0 {
		t.Fatalf("missing dir: %v %v", none, err)
	}
}

func TestAnswersRefuseBadIDs(t *testing.T) {
	dir := t.TempDir()
	// an empty board id is refused too: the wire has no call for every board's answers
	for _, id := range []string{"../x", "ABCDEF12", "7c1e0b4", "7c1e0b4ff", "", `..\x`} {
		if err := PutAnswer(dir, newAnswer(id, 1)); err == nil {
			t.Errorf("PutAnswer(%q) should refuse", id)
		}
		if _, err := Answers(dir, id); err == nil {
			t.Errorf("Answers(%q) should refuse", id)
		}
		if err := AckAnswer(dir, id, uuid.NewString()); err == nil {
			t.Errorf("AckAnswer(%q) should refuse", id)
		}
	}
	bad := newAnswer(unknownBoard, 1)
	bad.ID = "../x"
	if err := PutAnswer(dir, bad); err == nil {
		t.Error("PutAnswer should refuse an answer id that is not a uuid")
	}
	if err := AckAnswer(dir, unknownBoard, "../../x"); err == nil {
		t.Error("AckAnswer should refuse an answer id that is not a uuid")
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("a refused call wrote into the dir: %v", entries)
	}
}

func TestTrashMovesTheBoardItsTalkAndInboxIntoOneEntry(t *testing.T) {
	dir := t.TempDir()
	trash := filepath.Join(t.TempDir(), "trash")
	info := mustCreate(t, dir, "Auth flow", 1000)
	if err := PutAnswer(dir, newAnswer(info.ID, 1)); err != nil {
		t.Fatal(err)
	}
	now := time.UnixMilli(5000)
	entry, err := Trash(dir, testProject, info.ID, trash, now)
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(trash, "5000-board-"+info.ID); entry != want {
		t.Fatalf("entry = %q, want %q", entry, want)
	}
	for _, p := range []string{boardPath(dir, info.ID), talkPath(dir, info.ID), answersDir(dir, info.ID)} {
		if _, err := os.Lstat(p); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("%s still there (err %v)", p, err)
		}
	}
	for _, name := range []string{"meta.json", info.ID + boardExt, info.ID + talkExt, info.ID + answersExt} {
		if _, err := os.Lstat(filepath.Join(entry, name)); err != nil {
			t.Fatalf("%s not in the trash entry: %v", name, err)
		}
	}
	raw, err := os.ReadFile(filepath.Join(entry, "meta.json"))
	if err != nil {
		t.Fatal(err)
	}
	var m trashMeta
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	if m.OriginalDir != dir || m.BoardId != info.ID || m.Name != "Auth flow" || m.Project != testProject {
		t.Fatalf("meta = %+v", m)
	}
	boards, err := List(dir, testProject, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(boards) != 0 {
		t.Fatalf("list still holds %d boards", len(boards))
	}
}

func TestTrashRefusesAMissingBoardAndLeavesNoEntry(t *testing.T) {
	dir := t.TempDir()
	trash := filepath.Join(t.TempDir(), "trash")
	if _, err := Trash(dir, testProject, "0badc0de", trash, time.UnixMilli(1)); err == nil {
		t.Fatal("a missing board was trashed")
	}
	if entries, _ := os.ReadDir(trash); len(entries) != 0 {
		t.Fatalf("trash holds %d entries", len(entries))
	}
	if _, err := Trash(dir, testProject, "../x", trash, time.UnixMilli(1)); err == nil {
		t.Fatal("a bad id was accepted")
	}
}
