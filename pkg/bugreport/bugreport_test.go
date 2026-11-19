// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bugreport

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// pngBytes stands in for a screenshot: Save writes whatever the base64 holds.
var pngBytes = []byte("\x89PNG\r\n\x1a\nnot really a picture")

// harness is a Store on a temp dir with a clock the test moves, and a log dir of its own.
type harness struct {
	t      *testing.T
	s      *Store
	logDir string
	now    time.Time
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	h := &harness{t: t, logDir: t.TempDir(), now: time.Date(2026, 11, 19, 15, 30, 12, 0, time.Local)}
	h.s = &Store{Root: filepath.Join(t.TempDir(), "reports"), Now: func() time.Time { return h.now }}
	return h
}

// data is a Save request pressed at the harness's clock.
func (h *harness) data(text string) wshrpc.CommandBugReportSaveData {
	return wshrpc.CommandBugReportSaveData{
		Text:    text,
		Ts:      h.now.UnixMilli(),
		Version: "0.16.2",
		Commit:  "abc1234",
		Surface: "agent",
		Agent:   &wshrpc.BugReportAgent{Id: "tab-1", Name: "arcterm"},
	}
}

// save saves a report and advances the clock a second, so ids differ.
func (h *harness) save(text string) wshrpc.BugReport {
	h.t.Helper()
	r, err := h.s.Save(h.data(text), h.logDir)
	if err != nil {
		h.t.Fatalf("Save(%q): %v", text, err)
	}
	h.now = h.now.Add(time.Second)
	return r
}

func (h *harness) writeLog(name, content string) {
	h.t.Helper()
	if err := os.WriteFile(filepath.Join(h.logDir, name), []byte(content), 0o644); err != nil {
		h.t.Fatal(err)
	}
}

func ids(reports []wshrpc.BugReport) []string {
	out := []string{}
	for _, r := range reports {
		out = append(out, r.Id)
	}
	return out
}

func readReportFile(t *testing.T, dir string) wshrpc.BugReport {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(dir, "report.json"))
	if err != nil {
		t.Fatal(err)
	}
	var r wshrpc.BugReport
	if err := json.Unmarshal(raw, &r); err != nil {
		t.Fatal(err)
	}
	return r
}

func TestSaveWritesTheFolder(t *testing.T) {
	h := newHarness(t)
	h.writeLog("waveapp.log", logLine(h.now.Add(-20*time.Minute), "ancient")+
		logLine(h.now.Add(-3*time.Minute), "[tauri] three minutes ago")+
		logLine(h.now.Add(-time.Second), "[wavesrv] just before"))
	d := h.data("  the footer overlaps the chat \n")
	d.Screen64 = base64.StdEncoding.EncodeToString(pngBytes)

	r, err := h.s.Save(d, h.logDir)
	if err != nil {
		t.Fatal(err)
	}
	if r.Id != "20261119-153012" {
		t.Fatalf("the id is the press time in local time: %q", r.Id)
	}
	wantDir := filepath.Join(h.s.Root, "20261119-153012")
	if r.Dir != wantDir || !r.HasScreen || r.State != "waiting" {
		t.Fatalf("returned report: %+v", r)
	}

	onDisk := readReportFile(t, wantDir)
	want := wshrpc.BugReport{
		Id: "20261119-153012", Ts: d.Ts, Text: "the footer overlaps the chat", Version: "0.16.2", Commit: "abc1234",
		Surface: "agent", Agent: &wshrpc.BugReportAgent{Id: "tab-1", Name: "arcterm"}, State: "waiting",
	}
	if !reflect.DeepEqual(onDisk, want) {
		t.Fatalf("report.json:\n got %+v\nwant %+v", onDisk, want)
	}
	raw, _ := os.ReadFile(filepath.Join(wantDir, "report.json"))
	for _, key := range []string{`"dir"`, `"hasscreen"`, `"handler"`, `"claimedts"`, `"outcome"`, `"donets"`} {
		if strings.Contains(string(raw), key) {
			t.Errorf("report.json of a waiting report holds %s: %s", key, raw)
		}
	}

	png, err := os.ReadFile(filepath.Join(wantDir, "screen.png"))
	if err != nil || string(png) != string(pngBytes) {
		t.Fatalf("screen.png: %q %v", png, err)
	}
	log, err := os.ReadFile(filepath.Join(wantDir, "log.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(log), "three minutes ago") || !strings.Contains(string(log), "just before") {
		t.Errorf("log.txt misses the window:\n%s", log)
	}
	if strings.Contains(string(log), "ancient") {
		t.Errorf("log.txt holds a line from before the window:\n%s", log)
	}
}

func TestSaveLeavesNoTempFilesBehind(t *testing.T) {
	h := newHarness(t)
	r := h.save("a bug")
	entries, err := os.ReadDir(r.Dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if strings.Contains(e.Name(), "tmp") {
			t.Errorf("a temp file was left: %s", e.Name())
		}
	}
}

func TestSaveReadsTheRolledLogWhenTheWindowReachesIntoIt(t *testing.T) {
	h := newHarness(t)
	h.writeLog("waveapp.1.log", logLine(h.now.Add(-4*time.Minute), "from the rolled file"))
	h.writeLog("waveapp.log", logLine(h.now.Add(-2*time.Minute), "from the live file"))
	r := h.save("a bug")
	log, _ := os.ReadFile(filepath.Join(r.Dir, "log.txt"))
	if !strings.Contains(string(log), "from the rolled file") || !strings.Contains(string(log), "from the live file") {
		t.Fatalf("log.txt:\n%s", log)
	}
}

func TestSaveWithoutAScreenshot(t *testing.T) {
	h := newHarness(t)
	for name, screen := range map[string]string{"none": "", "not base64": "!!! not base64 !!!"} {
		d := h.data("a bug " + name)
		d.Screen64 = screen
		d.Ts += 60_000 // a minute apart, so the ids differ
		r, err := h.s.Save(d, h.logDir)
		if err != nil {
			t.Fatalf("%s: a missing picture is not an error: %v", name, err)
		}
		if r.HasScreen {
			t.Errorf("%s: HasScreen", name)
		}
		if _, err := os.Stat(filepath.Join(r.Dir, "screen.png")); !os.IsNotExist(err) {
			t.Errorf("%s: screen.png exists: %v", name, err)
		}
	}
}

func TestSaveKeepsTheRegionOnlyWithAPicture(t *testing.T) {
	h := newHarness(t)
	region := &wshrpc.BugReportRegion{X: 10, Y: 20, W: 300, H: 64}

	d := h.data("framed")
	d.Screen64 = base64.StdEncoding.EncodeToString(pngBytes)
	d.Region = region
	r, err := h.s.Save(d, h.logDir)
	if err != nil {
		t.Fatal(err)
	}
	if got := readReportFile(t, r.Dir).Region; got == nil || *got != *region {
		t.Fatalf("report.json region = %+v, want %+v", got, region)
	}

	// no picture to have drawn it on, or a region with no size: none is kept
	for i, tc := range []struct {
		screen string
		region *wshrpc.BugReportRegion
	}{
		{"", region},
		{base64.StdEncoding.EncodeToString(pngBytes), &wshrpc.BugReportRegion{X: 1, Y: 1, W: 0, H: 5}},
	} {
		d := h.data("no region")
		d.Ts += int64(i+1) * 60_000
		d.Screen64 = tc.screen
		d.Region = tc.region
		r, err := h.s.Save(d, h.logDir)
		if err != nil {
			t.Fatal(err)
		}
		if got := readReportFile(t, r.Dir).Region; got != nil {
			t.Errorf("case %d: report.json kept region %+v", i, got)
		}
	}
}

func TestSaveAcceptsADataURLPicture(t *testing.T) {
	h := newHarness(t)
	d := h.data("a bug")
	d.Screen64 = "data:image/png;base64," + base64.StdEncoding.EncodeToString(pngBytes)
	r, err := h.s.Save(d, h.logDir)
	if err != nil || !r.HasScreen {
		t.Fatalf("%+v %v", r, err)
	}
}

func TestSaveWithoutALogFileSaysSo(t *testing.T) {
	h := newHarness(t)
	r := h.save("a bug")
	log, err := os.ReadFile(filepath.Join(r.Dir, "log.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.TrimSpace(string(log)); got == "" || strings.Contains(got, "\n") {
		t.Fatalf("log.txt is one line saying there was no log: %q", log)
	}
}

func TestSaveWithAnEmptyWindowSaysSo(t *testing.T) {
	h := newHarness(t)
	h.writeLog("waveapp.log", logLine(h.now.Add(-time.Hour), "an hour ago"))
	r := h.save("a bug")
	log, _ := os.ReadFile(filepath.Join(r.Dir, "log.txt"))
	if got := strings.TrimSpace(string(log)); got == "" || strings.Contains(got, "an hour ago") || strings.Contains(got, "\n") {
		t.Fatalf("log.txt is one line saying the window was empty: %q", log)
	}
}

func TestSaveCapsTheLogAtOneMegabyteKeepingTheTail(t *testing.T) {
	h := newHarness(t)
	var b strings.Builder
	line := strings.Repeat("x", 990)
	n := 0
	for b.Len() < 2<<20 { // 2 MB inside the window
		b.WriteString(logLine(h.now.Add(-2*time.Minute), line))
		n++
	}
	b.WriteString(logLine(h.now.Add(-time.Second), "THE NEWEST LINE"))
	h.writeLog("waveapp.log", b.String())
	r := h.save("a bug")
	log, _ := os.ReadFile(filepath.Join(r.Dir, "log.txt"))
	if len(log) > 1<<20 || len(log) < (1<<20)-2000 {
		t.Fatalf("log.txt is %d bytes, want just under 1 MB", len(log))
	}
	if !strings.HasSuffix(string(log), "THE NEWEST LINE\n") {
		t.Fatal("the tail is kept")
	}
}

func TestSaveRefusesEmptyText(t *testing.T) {
	h := newHarness(t)
	for _, text := range []string{"", "   ", "\n\t \r\n"} {
		if _, err := h.s.Save(h.data(text), h.logDir); err == nil {
			t.Errorf("Save(%q) must be refused", text)
		}
	}
	if entries, _ := os.ReadDir(h.s.Root); len(entries) != 0 {
		t.Fatalf("a refused report leaves no folder: %v", entries)
	}
}

func TestSaveUsesTheClockWhenThePressTimeIsMissing(t *testing.T) {
	h := newHarness(t)
	d := h.data("a bug")
	d.Ts = 0
	r, err := h.s.Save(d, h.logDir)
	if err != nil {
		t.Fatal(err)
	}
	if r.Id != "20261119-153012" || r.Ts != h.now.UnixMilli() {
		t.Fatalf("%+v", r)
	}
}

func TestSaveIdCollisionGetsASuffix(t *testing.T) {
	h := newHarness(t)
	d := h.data("a bug")
	var got []string
	for i := 0; i < 3; i++ {
		r, err := h.s.Save(d, h.logDir)
		if err != nil {
			t.Fatal(err)
		}
		got = append(got, r.Id)
	}
	want := []string{"20261119-153012", "20261119-153012-2", "20261119-153012-3"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v want %v", got, want)
	}
}

func TestSaveIdCollisionSeesTheDoneFolder(t *testing.T) {
	h := newHarness(t)
	d := h.data("a bug")
	first, err := h.s.Save(d, h.logDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.s.Claim("tab-9", []string{first.Id}); err != nil {
		t.Fatal(err)
	}
	if err := h.s.Done(first.Id, wshrpc.BugReportOutcome{Text: "fixed"}); err != nil {
		t.Fatal(err)
	}
	second, err := h.s.Save(d, h.logDir)
	if err != nil {
		t.Fatal(err)
	}
	if second.Id != first.Id+"-2" {
		t.Fatalf("a report moved to done still owns its id: %q", second.Id)
	}
}

func TestSaveWithoutARootFails(t *testing.T) {
	s := &Store{}
	if _, err := s.Save(wshrpc.CommandBugReportSaveData{Text: "a bug"}, t.TempDir()); err == nil {
		t.Fatal("a store with no root has nowhere to save")
	}
	if got, err := s.List(""); err != nil || len(got) != 0 {
		t.Fatalf("a store with no root lists nothing: %v %v", got, err)
	}
}

func TestListOldestFirstAndByState(t *testing.T) {
	h := newHarness(t)
	// saved out of order: the press times, not the order of saving, decide
	late, early := h.data("late"), h.data("early")
	late.Ts += 120_000
	var rs []wshrpc.BugReport
	for _, d := range []wshrpc.CommandBugReportSaveData{late, h.data("middle"), early} {
		r, err := h.s.Save(d, h.logDir)
		if err != nil {
			t.Fatal(err)
		}
		rs = append(rs, r)
	}
	// "middle" and "early" were pressed at the same time: the id suffix keeps their order stable
	got, err := h.s.List("")
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"20261119-153012", "20261119-153012-2", "20261119-153212"}; !reflect.DeepEqual(ids(got), want) {
		t.Fatalf("got %v want %v", ids(got), want)
	}
	if got[0].Dir == "" {
		t.Fatalf("Dir is filled: %+v", got[0])
	}

	if _, err := h.s.Claim("tab-1", []string{rs[0].Id}); err != nil {
		t.Fatal(err)
	}
	waiting, _ := h.s.List("waiting")
	handling, _ := h.s.List("handling")
	if len(waiting) != 2 || len(handling) != 1 || handling[0].Id != rs[0].Id {
		t.Fatalf("waiting %v handling %v", ids(waiting), ids(handling))
	}
	both, _ := h.s.List("")
	if len(both) != 3 {
		t.Fatalf("an empty state lists waiting and handling: %v", ids(both))
	}
	done, err := h.s.List("done")
	if err != nil || len(done) != 0 {
		t.Fatalf("done: %v %v", ids(done), err)
	}
	if _, err := h.s.List("sideways"); err == nil {
		t.Fatal("an unknown state is an error")
	}
}

func TestListSkipsFoldersThatAreNotReports(t *testing.T) {
	h := newHarness(t)
	h.save("a bug")
	for _, name := range []string{"stray", ".hidden"} {
		if err := os.MkdirAll(filepath.Join(h.s.Root, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(h.s.Root, "broken"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(h.s.Root, "broken", "report.json"), []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := h.s.List("")
	if err != nil || len(got) != 1 {
		t.Fatalf("a folder with no (or a broken) report.json is not a report: %v %v", ids(got), err)
	}
}

func TestListWithNoRootIsEmpty(t *testing.T) {
	s := &Store{Root: filepath.Join(t.TempDir(), "never made")}
	for _, state := range []string{"", "waiting", "handling", "done"} {
		got, err := s.List(state)
		if err != nil || len(got) != 0 {
			t.Fatalf("%q: %v %v", state, got, err)
		}
	}
}

func TestHasScreenIsPerReport(t *testing.T) {
	h := newHarness(t)
	d := h.data("with")
	d.Screen64 = base64.StdEncoding.EncodeToString(pngBytes)
	if _, err := h.s.Save(d, h.logDir); err != nil {
		t.Fatal(err)
	}
	h.now = h.now.Add(time.Minute)
	h.save("without")
	got, _ := h.s.List("")
	if len(got) != 2 || !got[0].HasScreen || got[1].HasScreen {
		t.Fatalf("%+v", got)
	}
}

func TestStatus(t *testing.T) {
	h := newHarness(t)
	w, hd, handler, err := h.s.Status()
	if err != nil || w != 0 || hd != 0 || handler != "" {
		t.Fatalf("an empty store: %d %d %q %v", w, hd, handler, err)
	}
	a, b, c := h.save("a"), h.save("b"), h.save("c")
	if _, err := h.s.Claim("tab-7", []string{a.Id, b.Id}); err != nil {
		t.Fatal(err)
	}
	w, hd, handler, err = h.s.Status()
	if err != nil || w != 1 || hd != 2 || handler != "tab-7" {
		t.Fatalf("%d %d %q %v", w, hd, handler, err)
	}
	_ = c
}

func TestClaimMovesOnlyTheListedWaitingReports(t *testing.T) {
	h := newHarness(t)
	a, b, c := h.save("a"), h.save("b"), h.save("c")
	got, err := h.s.Claim("tab-7", []string{a.Id, b.Id})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, []string{a.Id, b.Id}) {
		t.Fatalf("claimed %v", got)
	}
	h.now = h.now.Add(time.Minute)
	for _, r := range []wshrpc.BugReport{a, b} {
		onDisk := readReportFile(t, r.Dir)
		if onDisk.State != "handling" || onDisk.Handler != "tab-7" {
			t.Errorf("%s: %+v", r.Id, onDisk)
		}
		if onDisk.ClaimedTs == 0 {
			t.Errorf("%s: claimedts is set", r.Id)
		}
	}
	if onDisk := readReportFile(t, c.Dir); onDisk.State != "waiting" || onDisk.Handler != "" {
		t.Fatalf("a report that was not listed stays waiting: %+v", onDisk)
	}
}

func TestClaimStampsTheClock(t *testing.T) {
	h := newHarness(t)
	a := h.save("a")
	h.now = h.now.Add(time.Hour)
	if _, err := h.s.Claim("tab-7", []string{a.Id}); err != nil {
		t.Fatal(err)
	}
	if got := readReportFile(t, a.Dir).ClaimedTs; got != h.now.UnixMilli() {
		t.Fatalf("claimedts = %d, want %d", got, h.now.UnixMilli())
	}
}

func TestClaimRefusesWhileAnyReportIsHandling(t *testing.T) {
	h := newHarness(t)
	a, b := h.save("a"), h.save("b")
	if _, err := h.s.Claim("tab-1", []string{a.Id}); err != nil {
		t.Fatal(err)
	}
	if _, err := h.s.Claim("tab-2", []string{b.Id}); err == nil {
		t.Fatal("two agents must never hold reports at once")
	}
	if onDisk := readReportFile(t, b.Dir); onDisk.State != "waiting" || onDisk.Handler != "" {
		t.Fatalf("a refused claim changes nothing: %+v", onDisk)
	}
	if onDisk := readReportFile(t, a.Dir); onDisk.Handler != "tab-1" {
		t.Fatalf("the first claim stands: %+v", onDisk)
	}
}

func TestClaimSkipsUnknownAndAlreadyClaimedIds(t *testing.T) {
	h := newHarness(t)
	a := h.save("a")
	none, err := h.s.Claim("tab-2", []string{"20200101-000000"})
	if err != nil || none == nil || len(none) != 0 {
		t.Fatalf("nothing to claim is an empty list, not an error or nil: %#v %v", none, err)
	}
	got, err := h.s.Claim("tab-1", []string{"20200101-000000", a.Id, a.Id})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, []string{a.Id}) {
		t.Fatalf("an unknown id is skipped, a repeated one claimed once: %v", got)
	}
}

func TestClaimRefusesABadAgentOrId(t *testing.T) {
	h := newHarness(t)
	a := h.save("a")
	if _, err := h.s.Claim("", []string{a.Id}); err == nil {
		t.Error("an empty agent id is refused")
	}
	for _, bad := range []string{"..", "../x", `..\x`, "a/b", ".", "done", ""} {
		if _, err := h.s.Claim("tab-1", []string{bad}); err == nil {
			t.Errorf("id %q is refused", bad)
		}
	}
	if onDisk := readReportFile(t, a.Dir); onDisk.State != "waiting" {
		t.Fatalf("%+v", onDisk)
	}
}

func TestDoneMovesTheFolderToDone(t *testing.T) {
	h := newHarness(t)
	a, b := h.save("a"), h.save("b")
	if _, err := h.s.Claim("tab-1", []string{a.Id, b.Id}); err != nil {
		t.Fatal(err)
	}
	h.now = h.now.Add(time.Minute)
	out := wshrpc.BugReportOutcome{Text: "fixed in a run", RunId: "run-1", EffortOID: "eff-1"}
	if err := h.s.Done(a.Id, out); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(a.Dir); !os.IsNotExist(err) {
		t.Fatalf("the live folder is gone: %v", err)
	}
	doneDir := filepath.Join(h.s.Root, "done", a.Id)
	got := readReportFile(t, doneDir)
	if got.State != "done" || !reflect.DeepEqual(*got.Outcome, out) || got.DoneTs != h.now.UnixMilli() || got.Handler != "tab-1" {
		t.Fatalf("done report: %+v", got)
	}
	for _, f := range []string{"log.txt"} {
		if _, err := os.Stat(filepath.Join(doneDir, f)); err != nil {
			t.Errorf("the folder moves whole: %v", err)
		}
	}
	listed, err := h.s.List("done")
	if err != nil || len(listed) != 1 || listed[0].Id != a.Id || listed[0].Dir != doneDir {
		t.Fatalf("List(done): %+v %v", listed, err)
	}
	if rest, _ := h.s.List(""); len(rest) != 1 || rest[0].Id != b.Id {
		t.Fatalf("the other report is still handling: %v", ids(rest))
	}
	if w, hd, _, _ := h.s.Status(); w != 0 || hd != 1 {
		t.Fatalf("status %d %d", w, hd)
	}
}

func TestDoneRefusesAReportThatIsNotHandling(t *testing.T) {
	h := newHarness(t)
	a := h.save("a")
	if err := h.s.Done(a.Id, wshrpc.BugReportOutcome{Text: "x"}); err == nil {
		t.Fatal("a waiting report is not done by an agent that never claimed it")
	}
	if onDisk := readReportFile(t, a.Dir); onDisk.State != "waiting" {
		t.Fatalf("%+v", onDisk)
	}
	if _, err := h.s.Claim("tab-1", []string{a.Id}); err != nil {
		t.Fatal(err)
	}
	if err := h.s.Done(a.Id, wshrpc.BugReportOutcome{Text: "x"}); err != nil {
		t.Fatal(err)
	}
	if err := h.s.Done(a.Id, wshrpc.BugReportOutcome{Text: "again"}); err == nil {
		t.Fatal("a done report is not done twice")
	}
}

func TestDoneRefusesUnknownAndBadIds(t *testing.T) {
	h := newHarness(t)
	h.save("a")
	for _, id := range []string{"20200101-000000", "..", "../x", "done", ""} {
		if err := h.s.Done(id, wshrpc.BugReportOutcome{Text: "x"}); err == nil {
			t.Errorf("Done(%q) must fail", id)
		}
	}
}

func TestReconcileRevertsReportsOfAClosedAgent(t *testing.T) {
	h := newHarness(t)
	a, b, c := h.save("a"), h.save("b"), h.save("c")
	if _, err := h.s.Claim("tab-closed", []string{a.Id, b.Id}); err != nil {
		t.Fatal(err)
	}
	calls := map[string]int{}
	err := h.s.Reconcile(func(tab string) bool {
		calls[tab]++
		return false
	})
	if err != nil {
		t.Fatal(err)
	}
	if calls["tab-closed"] != 1 || len(calls) != 1 {
		t.Fatalf("the store asks once per handler, and only about handlers: %v", calls)
	}
	for _, r := range []wshrpc.BugReport{a, b, c} {
		got := readReportFile(t, r.Dir)
		if got.State != "waiting" || got.Handler != "" || got.ClaimedTs != 0 {
			t.Errorf("%s: %+v", r.Id, got)
		}
	}
	// the reports can be claimed again
	if got, err := h.s.Claim("tab-new", []string{a.Id, b.Id, c.Id}); err != nil || len(got) != 3 {
		t.Fatalf("%v %v", got, err)
	}
}

func TestReconcileLeavesAnOpenAgentsReports(t *testing.T) {
	h := newHarness(t)
	a := h.save("a")
	if _, err := h.s.Claim("tab-open", []string{a.Id}); err != nil {
		t.Fatal(err)
	}
	if err := h.s.Reconcile(func(string) bool { return true }); err != nil {
		t.Fatal(err)
	}
	if got := readReportFile(t, a.Dir); got.State != "handling" || got.Handler != "tab-open" || got.ClaimedTs == 0 {
		t.Fatalf("%+v", got)
	}
}

func TestReconcileRevertsAHandlingReportWithNoHandler(t *testing.T) {
	h := newHarness(t)
	a := h.save("a")
	r := readReportFile(t, a.Dir)
	r.State = "handling" // a hand-edited report.json: nobody holds it
	if err := writeJSONAtomic(filepath.Join(a.Dir, "report.json"), r); err != nil {
		t.Fatal(err)
	}
	asked := false
	if err := h.s.Reconcile(func(string) bool { asked = true; return true }); err != nil {
		t.Fatal(err)
	}
	if asked {
		t.Error("there is no tab to ask about")
	}
	if got := readReportFile(t, a.Dir); got.State != "waiting" {
		t.Fatalf("%+v", got)
	}
}

func TestReconcileWithNothingToDo(t *testing.T) {
	h := newHarness(t)
	if err := h.s.Reconcile(func(string) bool { t.Fatal("no handlers"); return false }); err != nil {
		t.Fatalf("no root yet: %v", err)
	}
	h.save("a")
	if err := h.s.Reconcile(func(string) bool { t.Fatal("no handling reports"); return false }); err != nil {
		t.Fatal(err)
	}
}

// doneReport takes a report to done at the harness's clock and returns it with the moment it was done.
func (h *harness) doneReport(text string) (wshrpc.BugReport, time.Time) {
	h.t.Helper()
	r := h.save(text)
	if _, err := h.s.Claim("tab-1", []string{r.Id}); err != nil {
		h.t.Fatal(err)
	}
	doneAt := h.now
	if err := h.s.Done(r.Id, wshrpc.BugReportOutcome{Text: "ok"}); err != nil {
		h.t.Fatal(err)
	}
	return r, doneAt
}

func TestPruneDeletesDoneReportsOlderThanThirtyDaysOnSave(t *testing.T) {
	h := newHarness(t)
	old, oldDoneAt := h.doneReport("old")
	h.now = h.now.Add(24 * time.Hour)
	recent, _ := h.doneReport("recent")

	// 29 days after the first was done: both stay
	h.now = oldDoneAt.Add(29 * 24 * time.Hour)
	h.save("fresh one")
	if got, _ := h.s.List("done"); len(got) != 2 {
		t.Fatalf("both done reports are under 30 days old: %v", ids(got))
	}
	// 31 days after the first, a little under 30 after the second: only the first goes
	h.now = oldDoneAt.Add(31 * 24 * time.Hour)
	h.save("another")
	got, _ := h.s.List("done")
	if len(got) != 1 || got[0].Id != recent.Id {
		t.Fatalf("only the one done over 30 days ago is deleted: %v", ids(got))
	}
	if _, err := os.Stat(filepath.Join(h.s.Root, "done", old.Id)); !os.IsNotExist(err) {
		t.Fatalf("the folder is gone: %v", err)
	}
}

func TestPruneRunsOnDoneToo(t *testing.T) {
	h := newHarness(t)
	next := h.save("next")
	// an old done folder that is there already (a restored backup, say) goes at the next Done
	stale := filepath.Join(h.s.Root, "done", "20200101-000000")
	if err := os.MkdirAll(stale, 0o755); err != nil {
		t.Fatal(err)
	}
	writeStale(t, stale, h.now.Add(-45*24*time.Hour))
	if _, err := h.s.Claim("tab-1", []string{next.Id}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(stale); err != nil {
		t.Fatalf("a Claim does not prune: %v", err)
	}
	if err := h.s.Done(next.Id, wshrpc.BugReportOutcome{Text: "ok"}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatalf("Done prunes too: %v", err)
	}
	if got, _ := h.s.List("done"); len(got) != 1 || got[0].Id != next.Id {
		t.Fatalf("the report just done stays: %v", ids(got))
	}
}

func TestPruneNeverTouchesWaitingOrHandlingReports(t *testing.T) {
	h := newHarness(t)
	waiting := h.save("waiting a long time")
	h.now = h.now.Add(90 * 24 * time.Hour)
	h.save("fresh")
	if _, err := os.Stat(waiting.Dir); err != nil {
		t.Fatalf("a report that waits is never pruned: %v", err)
	}
}

func TestPruneGoesByTheFolderTimeWhenThereIsNoDoneTimestamp(t *testing.T) {
	h := newHarness(t)
	fresh := filepath.Join(h.s.Root, "done", "fresh")
	stale := filepath.Join(h.s.Root, "done", "stale")
	for dir, age := range map[string]time.Duration{fresh: 24 * time.Hour, stale: 40 * 24 * time.Hour} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		// no report.json to read a donets from: the folder's own time is all there is
		if err := os.Chtimes(dir, h.now.Add(-age), h.now.Add(-age)); err != nil {
			t.Fatal(err)
		}
	}
	h.save("a")
	if _, err := os.Stat(fresh); err != nil {
		t.Fatalf("a recent folder stays: %v", err)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatalf("an old folder with no report goes: %v", err)
	}
}

// writeStale writes a done report's report.json that was done at doneAt.
func writeStale(t *testing.T, dir string, doneAt time.Time) {
	t.Helper()
	r := wshrpc.BugReport{Id: filepath.Base(dir), State: "done", DoneTs: doneAt.UnixMilli()}
	if err := writeJSONAtomic(filepath.Join(dir, "report.json"), r); err != nil {
		t.Fatal(err)
	}
}
