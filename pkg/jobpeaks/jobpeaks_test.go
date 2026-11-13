// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobpeaks

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/memgate"
)

const (
	mb = uint64(1) << 20
	gb = uint64(1) << 30
)

// clock is a scripted `now`.
type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

type env struct {
	t       *testing.T
	dir     string
	peaks   string // jobpeaks.json
	learned string // jobslot-learned.json
	clk     *clock
}

func newEnv(t *testing.T) *env {
	dir := t.TempDir()
	return &env{
		t:       t,
		dir:     dir,
		peaks:   filepath.Join(dir, "data", "jobpeaks.json"),
		learned: filepath.Join(dir, "home", ".arc", "jobslot-learned.json"),
		clk:     &clock{t: time.Date(2026, 11, 12, 10, 0, 0, 0, time.UTC)},
	}
}

func (e *env) open() *Store { return Open(e.peaks, e.learned, e.clk.now) }

func (e *env) learnedFile() []string {
	set := memgate.ReadLearned(e.learned)
	var out []string
	for p := range set {
		out = append(out, p)
	}
	slices.Sort(out)
	return out
}

func TestEstimateMaxOfLastFiveTimesTwelveTenths(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	// six records keep the last five: the 10 GB run falls off
	for _, gbs := range []uint64{10, 1, 2, 3, 4, 5} {
		s.Record("task check:ts", "/p", true, gbs*gb)
	}
	got, basis := s.Estimate("task check:ts", "/p", 3*gb)
	if want := 5*gb + gb; got != want {
		t.Fatalf("estimate = %d, want %d (5 GB × 1.2)", got, want)
	}
	if !basis.Measured || basis.Elsewhere {
		t.Fatalf("basis = %+v, want measured here", basis)
	}
	if want := [5]uint64{5 * gb, 4 * gb, 3 * gb, 2 * gb, gb}; basis.Peaks != want {
		t.Fatalf("peaks = %v, want %v (newest first)", basis.Peaks, want)
	}
}

// a peak under a tenth of the table's figure is a command that never ran: a skipped task check:ts measured 14 MB
func TestRanIsATenthOfTheTableFigure(t *testing.T) {
	for _, c := range []struct {
		peak, table uint64
		want        bool
	}{
		{14 * mb, 3 * gb, false},
		{3*gb/10 - 1, 3 * gb, false},
		{3 * gb / 10, 3 * gb, true},
		{2 * gb, 3 * gb, true},
		{5 * gb, 3 * gb, true},
	} {
		if got := Ran(c.peak, c.table); got != c.want {
			t.Errorf("Ran(%d, %d) = %v, want %v", c.peak, c.table, got, c.want)
		}
	}
}

func TestEstimateOneColdRunAmongFourWarmOnes(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	for _, m := range []uint64{800, 800, 2560, 800, 800} {
		s.Record("task check:ts", "/p", true, m*mb)
	}
	got, _ := s.Estimate("task check:ts", "/p", 3*gb)
	if got != 3*gb {
		t.Fatalf("estimate = %d, want 3 GB (2.5 GB × 1.2); an average would read 1.4 GB × 1.2", got)
	}
}

func TestEstimateFewerThanFivePeaks(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	s.Record("task check:ts", "/p", true, 500*mb)
	s.Record("task check:ts", "/p", true, 250*mb)
	got, basis := s.Estimate("task check:ts", "/p", 3*gb)
	if got != 600*mb {
		t.Fatalf("estimate = %d, want 600 MB", got)
	}
	if want := [5]uint64{250 * mb, 500 * mb}; basis.Peaks != want {
		t.Fatalf("peaks = %v, want %v with zeros for the runs not seen yet", basis.Peaks, want)
	}
}

func TestEstimateNoKeyIsTheTable(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	got, basis := s.Estimate("task check:ts", "/p", 3*gb)
	if got != 3*gb || basis != (jobqueue.Basis{}) {
		t.Fatalf("empty store: got %d %+v, want the table's 3 GB, not measured", got, basis)
	}
	// a known command measured in another project is not borrowed: only an unknown, learned pattern is
	s.Record("task check:ts", "/other", true, gb)
	got, basis = s.Estimate("task check:ts", "/p", 3*gb)
	if got != 3*gb || basis != (jobqueue.Basis{}) {
		t.Fatalf("known command, other project measured: got %d %+v, want the table's 3 GB", got, basis)
	}
	// nor is another pattern's key
	s.Record("task build", "/p", true, gb)
	got, basis = s.Estimate("task check:ts", "/p", 3*gb)
	if got != 3*gb || basis.Measured {
		t.Fatalf("other pattern, same project: got %d %+v, want the table's 3 GB", got, basis)
	}
}

func TestEstimateElsewhereForALearnedPattern(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	s.Record("make build", "/a", false, 1200*mb)
	s.Record("make build", "/c", false, 2000*mb)
	s.Record("make build", "/c", false, 1500*mb)

	got, basis := s.Estimate("make build", "/b", memgate.LearnedBytes)
	if want := 2000*mb + 400*mb; got != want {
		t.Fatalf("elsewhere estimate = %d, want %d (the largest peak in any project × 1.2)", got, want)
	}
	if !basis.Measured || !basis.Elsewhere {
		t.Fatalf("basis = %+v, want measured, elsewhere", basis)
	}
	if want := [5]uint64{1500 * mb, 2000 * mb}; basis.Peaks != want {
		t.Fatalf("peaks = %v, want those of /c, the project holding the max: %v", basis.Peaks, want)
	}

	// once /b has a run of its own, that is the figure
	s.Record("make build", "/b", false, 1100*mb)
	got, basis = s.Estimate("make build", "/b", memgate.LearnedBytes)
	if got != 1320*mb || basis.Elsewhere || !basis.Measured {
		t.Fatalf("after a run in /b: got %d %+v, want 1320 MB measured here", got, basis)
	}
}

func TestEstimateElsewhereTieIsDeterministic(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	s.Record("make build", "/z", false, 2*gb)
	s.Record("make build", "/a", false, 2*gb)
	s.Record("make build", "/a", false, 1100*mb)
	_, basis := s.Estimate("make build", "/b", memgate.LearnedBytes)
	if want := [5]uint64{1100 * mb, 2 * gb}; basis.Peaks != want {
		t.Fatalf("peaks = %v, want /a's %v on a tie", basis.Peaks, want)
	}
}

func TestRecordUnknownLightRunOfAnUnstoredPatternStoresNothing(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	s.Record("ls src", "/p", false, 500*mb)
	if got := s.Learned(); len(got) != 0 {
		t.Fatalf("learned = %v, want none", got)
	}
	got, basis := s.Estimate("ls src", "/p", memgate.LearnedBytes)
	if got != memgate.LearnedBytes || basis.Measured {
		t.Fatalf("estimate = %d %+v, want the table figure, not measured", got, basis)
	}
	// whatever the file holds, it holds no key: a reopened store has nothing to estimate from either
	if got, basis := e.open().Estimate("ls src", "/p", memgate.LearnedBytes); got != memgate.LearnedBytes || basis.Measured {
		t.Fatalf("reopened estimate = %d %+v, want the table figure", got, basis)
	}
	if data, err := os.ReadFile(e.peaks); err == nil {
		var onDisk struct {
			Keys []json.RawMessage `json:"keys"`
		}
		if err := json.Unmarshal(data, &onDisk); err != nil || len(onDisk.Keys) != 0 {
			t.Fatalf("jobpeaks.json = %s, want no keys", data)
		}
	}
	if got := e.learnedFile(); len(got) != 0 {
		t.Fatalf("learned file = %v, want empty", got)
	}
}

func TestRecordUnknownHeavyRunMakesThePatternLearned(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	s.Record("make build", "/p", false, 1200*mb)
	if got := s.Learned(); !got["make build"] || len(got) != 1 {
		t.Fatalf("learned = %v, want make build", got)
	}
	if got := e.learnedFile(); !slices.Equal(got, []string{"make build"}) {
		t.Fatalf("learned file = %v, want [make build]", got)
	}
	got, basis := s.Estimate("make build", "/p", memgate.LearnedBytes)
	if got != 1440*mb || !basis.Measured {
		t.Fatalf("estimate = %d %+v, want 1440 MB measured", got, basis)
	}
}

func TestRecordUnknownRunAtTheThresholdIsKept(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	s.Record("make build", "/p", false, Threshold-1)
	if len(s.Learned()) != 0 {
		t.Fatal("a run just under the threshold made the pattern learned")
	}
	s.Record("make build", "/p", false, Threshold)
	if !s.Learned()["make build"] {
		t.Fatal("a run of exactly the threshold did not make the pattern learned")
	}
}

func TestRecordLightRunsOfAStoredPatternAreKeptUntilTheHeavyOneFallsOff(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	s.Record("make build", "/p", false, 1200*mb)
	for range 4 {
		s.Record("make build", "/p", false, 300*mb)
	}
	if !s.Learned()["make build"] {
		t.Fatal("pattern left the store with the heavy run still among the last five")
	}
	got, _ := s.Estimate("make build", "/p", memgate.LearnedBytes)
	if got != 1440*mb {
		t.Fatalf("estimate = %d, want the heavy run's 1440 MB while it is kept", got)
	}
	// the fifth light run pushes the heavy one out: all kept peaks are light now
	s.Record("make build", "/p", false, 300*mb)
	if len(s.Learned()) != 0 {
		t.Fatalf("learned = %v, want none after five light runs", s.Learned())
	}
	if got := e.learnedFile(); len(got) != 0 {
		t.Fatalf("learned file = %v, want empty: the pattern is back to light", got)
	}
	got, basis := s.Estimate("make build", "/p", memgate.LearnedBytes)
	if got != memgate.LearnedBytes || basis.Measured {
		t.Fatalf("estimate = %d %+v, want the table figure again", got, basis)
	}
	// and the store holds nothing of it: a reopen sees nothing either
	if len(e.open().Learned()) != 0 {
		t.Fatal("reopened store still holds the light pattern")
	}
}

func TestRecordUnknownPatternStaysWhileAnyProjectIsHeavy(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	s.Record("make build", "/a", false, 2*gb)
	// the pattern is stored, so /b's light runs are kept too
	for range 5 {
		s.Record("make build", "/b", false, 200*mb)
	}
	if !s.Learned()["make build"] {
		t.Fatal("pattern left the store while /a still holds a heavy peak")
	}
	if got, basis := s.Estimate("make build", "/b", memgate.LearnedBytes); got != 240*mb || basis.Elsewhere {
		t.Fatalf("/b estimate = %d %+v, want its own 240 MB", got, basis)
	}
}

func TestRecordKnownRunIsAlwaysKept(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	s.Record("task check:ts", "/p", true, 100*mb)
	got, basis := s.Estimate("task check:ts", "/p", 3*gb)
	if got != 120*mb || !basis.Measured {
		t.Fatalf("estimate = %d %+v, want 120 MB measured: a known command queues whatever it peaks at", got, basis)
	}
	if len(s.Learned()) != 0 {
		t.Fatalf("a known command is not learned: %v", s.Learned())
	}
	if got := e.learnedFile(); len(got) != 0 {
		t.Fatalf("learned file = %v, want empty: it lists unknown patterns only", got)
	}
}

func TestRecordIgnoresAZeroPeak(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	s.Record("task check:ts", "/p", true, 0)
	got, basis := s.Estimate("task check:ts", "/p", 3*gb)
	if got != 3*gb || basis.Measured {
		t.Fatalf("estimate = %d %+v, want the table: a zero peak is no measurement", got, basis)
	}
	s.Record("task check:ts", "/p", true, gb)
	s.Record("task check:ts", "/p", true, 0)
	if got, _ := s.Estimate("task check:ts", "/p", 3*gb); got != gb+gb/5 {
		t.Fatalf("estimate = %d after a zero, want 1.2 GB", got)
	}
}

func TestLearnedIsACopyOfTheUnknownPatternsOnly(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	s.Record("task check:ts", "/p", true, 2*gb)
	s.Record("make build", "/p", false, 2*gb)
	s.Record("gradle build", "/q", false, 2*gb)
	got := s.Learned()
	if len(got) != 2 || !got["make build"] || !got["gradle build"] {
		t.Fatalf("learned = %v, want make build and gradle build", got)
	}
	got["scribble"] = true
	delete(got, "make build")
	if again := s.Learned(); !again["make build"] || again["scribble"] {
		t.Fatalf("learned = %v, the caller's edits reached the store", again)
	}
}

func TestLearnedFileIsWrittenWhenItsSetChanges(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	// the file is written once at Open, even when the set is empty
	if _, err := os.Stat(e.learned); err != nil {
		t.Fatalf("no learned file after Open: %v", err)
	}
	if err := os.Remove(e.learned); err != nil {
		t.Fatal(err)
	}
	// a record that leaves the set alone does not touch it
	s.Record("task check:ts", "/p", true, gb)
	if _, err := os.Stat(e.learned); err == nil {
		t.Fatal("the learned file was rewritten though its set did not change")
	}
	s.Record("make build", "/p", false, 2*gb)
	if got := e.learnedFile(); !slices.Equal(got, []string{"make build"}) {
		t.Fatalf("learned file = %v, want [make build]", got)
	}
}

func TestLearnedFileWriteIsRetriedAfterAFailure(t *testing.T) {
	e := newEnv(t)
	// the learned file's directory cannot be created while a regular file sits where it would go
	blocker := filepath.Join(e.dir, "blocker")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	e.learned = filepath.Join(blocker, "jobslot-learned.json")
	s := e.open()
	s.Record("make build", "/p", false, 2000*mb) // the write fails; the store is unharmed
	if got, _ := s.Estimate("make build", "/p", memgate.LearnedBytes); got != 2400*mb {
		t.Fatalf("estimate = %d, want 2400 MB: a failed learned-file write must not lose the measurement", got)
	}
	if err := os.Remove(blocker); err != nil {
		t.Fatal(err)
	}
	// the set has not changed since, but the file never got it: the next record writes it
	s.Record("task check:ts", "/p", true, gb)
	if got := e.learnedFile(); !slices.Equal(got, []string{"make build"}) {
		t.Fatalf("learned file = %v, want [make build] once the write can succeed", got)
	}
}

func TestLearnedFileIsNeverWrittenForAnEmptyPath(t *testing.T) {
	e := newEnv(t)
	e.learned = ""
	s := e.open()
	s.Record("make build", "/p", false, 2*gb)
	if !s.Learned()["make build"] {
		t.Fatal("the store stopped learning without a learned file")
	}
	entries, err := os.ReadDir(e.dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, ent := range entries {
		if ent.Name() != "data" {
			t.Fatalf("stray %q beside the data dir: nothing but jobpeaks.json may be written", ent.Name())
		}
	}
}

func TestExpiryDropsAKeyIdleForMoreThanThirtyDaysAtOpen(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	s.Record("make build", "/p", false, 2*gb)
	s.Record("task check:ts", "/p", true, 2*gb)
	if got := e.learnedFile(); !slices.Equal(got, []string{"make build"}) {
		t.Fatalf("learned file = %v, want [make build]", got)
	}

	e.clk.t = e.clk.t.Add(30 * 24 * time.Hour)
	again := e.open()
	if !again.Learned()["make build"] {
		t.Fatal("a key idle exactly 30 days was dropped")
	}

	e.clk.t = e.clk.t.Add(24*time.Hour + time.Second) // 31 days since the records
	again = e.open()
	if len(again.Learned()) != 0 {
		t.Fatalf("learned = %v, want none after 31 days idle", again.Learned())
	}
	if got := e.learnedFile(); len(got) != 0 {
		t.Fatalf("learned file = %v, want the stale pattern gone", got)
	}
	got, basis := again.Estimate("task check:ts", "/p", 3*gb)
	if got != 3*gb || basis.Measured {
		t.Fatalf("estimate = %d %+v, a known command with a stale key falls back to the table", got, basis)
	}
}

func TestExpiryRunsOnEachRecord(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	s.Record("make build", "/old", false, 2*gb)
	s.Record("task check:ts", "/old", true, 2*gb)

	e.clk.t = e.clk.t.Add(31 * 24 * time.Hour)
	s.Record("task build", "/new", true, gb)

	if len(s.Learned()) != 0 {
		t.Fatalf("learned = %v, want the stale pattern gone", s.Learned())
	}
	if got := e.learnedFile(); len(got) != 0 {
		t.Fatalf("learned file = %v, want empty", got)
	}
	if got, basis := s.Estimate("task check:ts", "/old", 3*gb); got != 3*gb || basis.Measured {
		t.Fatalf("stale known key still read: %d %+v", got, basis)
	}
	if got, _ := s.Estimate("task build", "/new", 3*gb); got != gb+gb/5 {
		t.Fatalf("the fresh key = %d, want 1.2 GB", got)
	}
}

func TestExpiryAKeyRunAgainStaysFresh(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	s.Record("make build", "/p", false, 2*gb)
	e.clk.t = e.clk.t.Add(20 * 24 * time.Hour)
	s.Record("make build", "/p", false, 2*gb)
	e.clk.t = e.clk.t.Add(20 * 24 * time.Hour) // 40 days after the first run, 20 after the last
	if !e.open().Learned()["make build"] {
		t.Fatal("a key run 20 days ago expired")
	}
}

func TestExpiryTakesAStaleHeavyKeyOutAndTheLightKeyWithIt(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	s.Record("make build", "/a", false, 2*gb)
	e.clk.t = e.clk.t.Add(20 * 24 * time.Hour)
	s.Record("make build", "/b", false, 100*mb) // kept: the pattern is stored
	e.clk.t = e.clk.t.Add(15 * 24 * time.Hour)  // /a is 35 days idle, /b 15
	again := e.open()
	if len(again.Learned()) != 0 {
		t.Fatalf("learned = %v: with /a gone, /b's light peaks leave nothing heavy", again.Learned())
	}
	if got, basis := again.Estimate("make build", "/b", memgate.LearnedBytes); got != memgate.LearnedBytes || basis.Measured {
		t.Fatalf("estimate = %d %+v, want the table figure", got, basis)
	}
}

func TestPersistReopenGivesTheSameEstimates(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	s.Record("task check:ts", "/p", true, 800*mb)
	s.Record("task check:ts", "/p", true, 2560*mb)
	s.Record("task check:ts", "", true, 400*mb) // the "no project" key
	s.Record("make build", "/p", false, 1500*mb)
	s.Record("make build", "/q", false, 1100*mb)

	again := e.open()
	for _, q := range []struct{ pattern, project string }{
		{"task check:ts", "/p"},
		{"task check:ts", ""},
		{"task check:ts", "/never"},
		{"make build", "/p"},
		{"make build", "/q"},
		{"make build", "/r"},
		{"nothing", "/p"},
	} {
		wantBytes, wantBasis := s.Estimate(q.pattern, q.project, 3*gb)
		gotBytes, gotBasis := again.Estimate(q.pattern, q.project, 3*gb)
		if gotBytes != wantBytes || gotBasis != wantBasis {
			t.Errorf("%v: reopened %d %+v, want %d %+v", q, gotBytes, gotBasis, wantBytes, wantBasis)
		}
	}
	if !slices.Equal(sortedKeys(again.Learned()), sortedKeys(s.Learned())) {
		t.Errorf("learned: reopened %v, want %v", again.Learned(), s.Learned())
	}
}

func TestPersistWritesAfterEachRecord(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	s.Record("task check:ts", "/p", true, gb)
	// no reopen needed to see it: a second store opened now reads the file the first one wrote
	got, basis := e.open().Estimate("task check:ts", "/p", 3*gb)
	if got != gb+gb/5 || !basis.Measured {
		t.Fatalf("a fresh store read %d %+v, want the record on disk", got, basis)
	}
}

func TestPersistMissingFileOpensEmpty(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	if got, basis := s.Estimate("task check:ts", "/p", 3*gb); got != 3*gb || basis.Measured {
		t.Fatalf("estimate = %d %+v", got, basis)
	}
	if len(s.Learned()) != 0 {
		t.Fatalf("learned = %v", s.Learned())
	}
}

func TestPersistBrokenFileOpensEmptyAndIsReplacedByTheNextRecord(t *testing.T) {
	e := newEnv(t)
	if err := os.MkdirAll(filepath.Dir(e.peaks), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(e.peaks, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	s := e.open()
	if got, basis := s.Estimate("task check:ts", "/p", 3*gb); got != 3*gb || basis.Measured {
		t.Fatalf("estimate = %d %+v, want the table", got, basis)
	}
	if len(s.Learned()) != 0 {
		t.Fatalf("learned = %v", s.Learned())
	}
	s.Record("task check:ts", "/p", true, gb)
	if got, _ := e.open().Estimate("task check:ts", "/p", 3*gb); got != gb+gb/5 {
		t.Fatalf("after the next record the file reads %d, want 1.2 GB", got)
	}
}

func TestPersistReadsOnlyWhatItCanTrust(t *testing.T) {
	e := newEnv(t)
	if err := os.MkdirAll(filepath.Dir(e.peaks), 0o755); err != nil {
		t.Fatal(err)
	}
	// seven peaks (one a zero, so six real ones: one too many), an entry with no peaks at all, and an unknown pattern
	// holding only light peaks: none of it may reach an estimate
	body := `{"keys":[
	  {"pattern":"task check:ts","project":"/p","known":true,"peaks":[100,0,200,300,400,500,600],"last":"2026-11-12T09:00:00Z"},
	  {"pattern":"task build","project":"/p","known":true,"peaks":[],"last":"2026-11-12T09:00:00Z"},
	  {"pattern":"ls src","project":"/p","peaks":[500],"last":"2026-11-12T09:00:00Z"}
	]}`
	if err := os.WriteFile(e.peaks, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	s := e.open()
	got, basis := s.Estimate("task check:ts", "/p", 3*gb)
	if want := uint64(500 + 100); got != want { // 500/5 = 100
		t.Fatalf("estimate = %d, want %d: the first five non-zero peaks (100,200,300,400,500) max 500 × 1.2", got, want)
	}
	if want := [5]uint64{100, 200, 300, 400, 500}; basis.Peaks != want {
		t.Fatalf("peaks = %v, want %v", basis.Peaks, want)
	}
	if got, basis := s.Estimate("task build", "/p", 3*gb); got != 3*gb || basis.Measured {
		t.Fatalf("an entry with no peaks read as measured: %d %+v", got, basis)
	}
	if len(s.Learned()) != 0 {
		t.Fatalf("learned = %v: a light unknown pattern is not learned", s.Learned())
	}
}

func TestEstimateNilStoreIsTheTable(t *testing.T) {
	var s *Store
	s.Record("task check:ts", "/p", true, gb) // no panic
	got, basis := s.Estimate("task check:ts", "/p", 3*gb)
	if got != 3*gb || basis != (jobqueue.Basis{}) {
		t.Fatalf("nil store: %d %+v, want the table", got, basis)
	}
	if learned := s.Learned(); learned == nil || len(learned) != 0 {
		t.Fatalf("nil store learned = %v, want an empty, non-nil set", learned)
	}
}

func TestRecordConcurrentWithEstimate(t *testing.T) {
	e := newEnv(t)
	s := e.open()
	var wg sync.WaitGroup
	for i := range 4 {
		wg.Go(func() {
			for range 5 {
				s.Record("make build", "/p", false, 2*gb)
				s.Record("task check:ts", "/p", true, uint64(i+1)*100*mb)
				s.Estimate("make build", "/q", memgate.LearnedBytes)
				s.Learned()
			}
		})
	}
	wg.Wait()
	if got, _ := s.Estimate("task check:ts", "/p", 3*gb); got == 0 || got > 4*100*mb*6/5 {
		t.Fatalf("estimate = %d after concurrent records", got)
	}
}

func sortedKeys(m map[string]bool) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	slices.Sort(out)
	return out
}
