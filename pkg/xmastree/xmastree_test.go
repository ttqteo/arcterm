// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package xmastree

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wavevault"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// TestMain gives the ledger tests a real store in a throwaway data dir, with the migrations run.
func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "xmastree-test-*")
	if err != nil {
		panic(err)
	}
	wavebase.DataHome_VarCache = dir
	if err := wavebase.EnsureWaveDBDir(); err != nil {
		panic(err)
	}
	if err := wstore.InitWStore(); err != nil {
		panic(err)
	}
	// a vault of the test's own, never the user's
	testVault = filepath.Join(dir, "vault")
	vaultRoot = func() string { return testVault }
	clientID = func() string { return testClient }
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

var testVault string

const testClient = "client-mac"

// resetLedger empties the ledger, the run events and the test vault's ledger files, and forgets the backfill, so each
// test starts from a fresh process's store.
func resetLedger(t *testing.T) {
	t.Helper()
	pendingExports.Wait()
	clearStore(t)
	if err := os.RemoveAll(filepath.Join(testVault, VaultDir)); err != nil {
		t.Fatal(err)
	}
	forgetBackfill()
}

// clearStore empties the ledger and the run events, as a store cleared by hand would be.
func clearStore(t *testing.T) {
	t.Helper()
	err := wstore.WithTx(context.Background(), func(tx *wstore.TxWrap) error {
		tx.Exec(`DELETE FROM db_xmastask`)
		tx.Exec(`DELETE FROM db_runevent`)
		return tx.Err
	})
	if err != nil {
		t.Fatal(err)
	}
}

func ledgerPath(season int, client string) string {
	return filepath.Join(testVault, VaultDir, strconv.Itoa(season), client+ledgerExt)
}

func writeLedgerFile(t *testing.T, season int, client string, content string) {
	t.Helper()
	p := ledgerPath(season, client)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func readOwnFile(t *testing.T, season int) []ledgerTask {
	t.Helper()
	tasks, err := readLedgerFile(ledgerPath(season, testClient))
	if err != nil {
		t.Fatal(err)
	}
	return tasks
}

// forgetBackfill makes the next Read backfill again, as a new wavesrv process would.
func forgetBackfill() {
	backfill.Lock()
	backfill.from = time.Time{}
	backfill.Unlock()
}

func ledgerCount(t *testing.T) int {
	t.Helper()
	n, err := wstore.WithReadTxRtn(context.Background(), func(tx *wstore.TxWrap) (int, error) {
		return tx.GetInt(`SELECT COUNT(*) FROM db_xmastask`), tx.Err
	})
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func ms(y int, m time.Month, d, h int) int64 {
	return time.Date(y, m, d, h, 0, 0, 0, time.Local).UnixMilli()
}

var midSeason = time.Date(2026, time.November, 20, 10, 0, 0, 0, time.Local)

func appendEvent(t *testing.T, ts int64, runID, kind string, detail any) {
	t.Helper()
	if _, err := wstore.AppendRunEventAt(context.Background(), ts, "ch-1", runID, kind, nil, detail); err != nil {
		t.Fatal(err)
	}
}

func TestRecordTaskDone(t *testing.T) {
	resetLedger(t)
	ctx := context.Background()
	ts := ms(2026, time.November, 3, 9)
	if err := RecordTaskDone(ctx, "run-1", "t-1", ts); err != nil {
		t.Fatal(err)
	}
	// a retried task finishes again later: it still counts once, at its first finish
	if err := RecordTaskDone(ctx, "run-1", "t-1", ts+60_000); err != nil {
		t.Fatal(err)
	}
	if n := ledgerCount(t); n != 1 {
		t.Fatalf("ledger rows = %d, want 1", n)
	}
	// the same task id in another run is another task
	if err := RecordTaskDone(ctx, "run-2", "t-1", ts); err != nil {
		t.Fatal(err)
	}
	data, err := Read(ctx, midSeason)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(data.Done, []int64{ts, ts}) {
		t.Fatalf("Done = %v, want [%d %d]", data.Done, ts, ts)
	}
}

func TestBackfill(t *testing.T) {
	resetLedger(t)
	ctx := context.Background()
	inA := ms(2026, time.November, 2, 9)
	inB := ms(2026, time.December, 31, 23)
	live := ms(2026, time.November, 4, 9)
	appendEvent(t, inA, "run-1", waveobj.RunEventKindTaskDone, map[string]any{"taskid": "t-1", "runid": "child-1"})
	appendEvent(t, inB, "run-1", waveobj.RunEventKindTaskDone, map[string]any{"taskid": "t-2", "runid": "child-2"})
	// before the season opens
	appendEvent(t, ms(2026, time.October, 31, 23), "run-1", waveobj.RunEventKindTaskDone, map[string]any{"taskid": "t-0"})
	// another kind
	appendEvent(t, ms(2026, time.November, 3, 9), "run-1", waveobj.RunEventKindTaskFailed, map[string]any{"taskid": "t-3"})
	// no task id
	appendEvent(t, ms(2026, time.November, 3, 10), "run-1", waveobj.RunEventKindTaskDone, map[string]any{"runid": "child-4"})
	// a task both in the events and recorded live
	appendEvent(t, live, "run-2", waveobj.RunEventKindTaskDone, map[string]any{"taskid": "t-1"})
	if err := RecordTaskDone(ctx, "run-2", "t-1", live); err != nil {
		t.Fatal(err)
	}
	data, err := Read(ctx, midSeason)
	if err != nil {
		t.Fatal(err)
	}
	want := []int64{inA, live, inB}
	if !slices.Equal(data.Done, want) {
		t.Fatalf("Done = %v, want %v", data.Done, want)
	}
	// a second read adds nothing, even with a new event in the run log: the backfill ran once
	appendEvent(t, ms(2026, time.November, 5, 9), "run-3", waveobj.RunEventKindTaskDone, map[string]any{"taskid": "t-9"})
	data, err = Read(ctx, midSeason)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(data.Done, want) {
		t.Fatalf("second Read Done = %v, want %v", data.Done, want)
	}
	if n := ledgerCount(t); n != 3 {
		t.Fatalf("ledger rows = %d, want 3", n)
	}
}

func TestRead(t *testing.T) {
	resetLedger(t)
	ctx := context.Background()
	a := ms(2026, time.November, 10, 9)
	b := ms(2026, time.November, 2, 9)
	c := ms(2027, time.January, 1, 9) // new year's day still counts
	for _, r := range []struct {
		run, task string
		ts        int64
	}{{"run-b", "t-1", a}, {"run-a", "t-1", a}, {"run-a", "t-2", c}, {"run-a", "t-3", b},
		{"run-a", "t-4", ms(2027, time.January, 2, 9)}, {"run-a", "t-5", ms(2025, time.December, 20, 9)}} {
		if err := RecordTaskDone(ctx, r.run, r.task, r.ts); err != nil {
			t.Fatal(err)
		}
	}
	data, err := Read(ctx, midSeason)
	if err != nil {
		t.Fatal(err)
	}
	if want := []int64{b, a, a, c}; !slices.Equal(data.Done, want) {
		t.Fatalf("Done = %v, want %v (oldest first, outside the window left out)", data.Done, want)
	}
	// the ledger outlives the run log's pruning, even across a restart's backfill
	if err := wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		tx.Exec(`DELETE FROM db_runevent`)
		return tx.Err
	}); err != nil {
		t.Fatal(err)
	}
	forgetBackfill()
	data, err = Read(ctx, midSeason)
	if err != nil {
		t.Fatal(err)
	}
	if len(data.Done) != 4 {
		t.Fatalf("after pruning run events Done = %v, want 4 rows", data.Done)
	}
	// off: no rows, whatever the ledger holds
	data, err = Read(ctx, time.Date(2027, time.March, 1, 9, 0, 0, 0, time.Local))
	if err != nil {
		t.Fatal(err)
	}
	if data.Phase != PhaseOff || data.Done == nil || len(data.Done) != 0 {
		t.Fatalf("off: phase %q Done %#v, want off and empty", data.Phase, data.Done)
	}
}

func TestSeasonAt(t *testing.T) {
	loc := time.Local
	at := func(y int, m time.Month, d, h, min int) time.Time { return time.Date(y, m, d, h, min, 0, 0, loc) }
	cases := []struct {
		name   string
		now    time.Time
		season int
		phase  string
	}{
		{"31 Oct 23:59 is off", at(2026, time.October, 31, 23, 59), 2026, PhaseOff},
		{"1 Nov 00:00 opens the season", at(2026, time.November, 1, 0, 0), 2026, PhaseSeason},
		{"31 Dec 23:59 is still the season", at(2026, time.December, 31, 23, 59), 2026, PhaseSeason},
		{"1 Jan 12:00 is new year, last year's season", at(2027, time.January, 1, 12, 0), 2026, PhaseNewYear},
		{"2 Jan 00:00 is off", at(2027, time.January, 2, 0, 0), 2027, PhaseOff},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			season, phase, from, to := SeasonAt(c.now)
			if phase != c.phase {
				t.Fatalf("phase = %q, want %q", phase, c.phase)
			}
			if season != c.season {
				t.Fatalf("season = %d, want %d", season, c.season)
			}
			if c.phase == PhaseOff {
				if !from.IsZero() || !to.IsZero() {
					t.Fatalf("off has a window: [%v, %v)", from, to)
				}
				return
			}
			wantFrom := time.Date(c.season, time.November, 1, 0, 0, 0, 0, loc)
			wantTo := time.Date(c.season+1, time.January, 2, 0, 0, 0, 0, loc)
			if !from.Equal(wantFrom) || !to.Equal(wantTo) {
				t.Fatalf("window = [%v, %v), want [%v, %v)", from, to, wantFrom, wantTo)
			}
			if c.now.Before(from) || !c.now.Before(to) {
				t.Fatalf("now %v outside its window [%v, %v)", c.now, from, to)
			}
		})
	}
}

func TestReadStub(t *testing.T) {
	resetLedger(t)
	data, err := Read(context.Background(), time.Date(2026, time.November, 5, 10, 0, 0, 0, time.Local))
	if err != nil {
		t.Fatal(err)
	}
	if data.Season != 2026 || data.Phase != PhaseSeason {
		t.Fatalf("got season %d phase %q", data.Season, data.Phase)
	}
	if data.Done == nil || len(data.Done) != 0 {
		t.Fatalf("Done = %#v, want empty non-nil", data.Done)
	}
}

func insertLedger(t *testing.T, runID, taskID string, ts int64) {
	t.Helper()
	err := wstore.WithTx(context.Background(), func(tx *wstore.TxWrap) error {
		tx.Exec(`INSERT INTO db_xmastask (runid, taskid, ts) VALUES (?, ?, ?)`, runID, taskID, ts)
		return tx.Err
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestReadCountsOtherMachines(t *testing.T) {
	resetLedger(t)
	ctx := context.Background()
	local := ms(2026, time.November, 3, 9)
	remote := ms(2026, time.November, 10, 9)
	insertLedger(t, "run-m", "t-1", local)
	writeLedgerFile(t, 2026, "client-win", `[
  {"runid": "run-w", "taskid": "t-1", "ts": `+strconv.FormatInt(remote, 10)+`},
  {"runid": "run-m", "taskid": "t-1", "ts": `+strconv.FormatInt(remote, 10)+`},
  {"runid": "run-w", "taskid": "t-2", "ts": `+strconv.FormatInt(ms(2026, time.October, 20, 9), 10)+`},
  {"runid": "run-w", "taskid": "", "ts": `+strconv.FormatInt(remote, 10)+`}
]`)
	writeLedgerFile(t, 2026, "client-bad", `{not json`)
	writeLedgerFile(t, 2025, "client-old", `[{"runid": "run-o", "taskid": "t-1", "ts": `+strconv.FormatInt(remote, 10)+`}]`)
	data, err := Read(ctx, midSeason)
	if err != nil {
		t.Fatal(err)
	}
	// the other machine's task counts; the task both hold counts once at its first finish; a task outside the window,
	// one with no task id, a malformed file and another season's folder add nothing
	if want := []int64{local, remote}; !slices.Equal(data.Done, want) {
		t.Fatalf("Done = %v, want %v", data.Done, want)
	}
	if n := ledgerCount(t); n != 1 {
		t.Fatalf("ledger rows = %d, want 1: the other machine's tasks stay in its file", n)
	}
}

func TestExportWritesOwnFile(t *testing.T) {
	resetLedger(t)
	ctx := context.Background()
	_, _, from, to := SeasonAt(midSeason)
	a, b := ms(2026, time.November, 2, 9), ms(2026, time.November, 10, 9)
	insertLedger(t, "run-b", "t-1", b)
	insertLedger(t, "run-a", "t-1", b)
	insertLedger(t, "run-a", "t-2", a)
	insertLedger(t, "run-a", "t-9", ms(2026, time.October, 30, 9))
	wavevault.PokedForTest()
	if err := exportSeason(ctx, 2026, from, to); err != nil {
		t.Fatal(err)
	}
	want := []ledgerTask{{"run-a", "t-2", a}, {"run-a", "t-1", b}, {"run-b", "t-1", b}}
	if got := readOwnFile(t, 2026); !slices.Equal(got, want) {
		t.Fatalf("own file = %v, want %v", got, want)
	}
	if !wavevault.PokedForTest() {
		t.Fatal("a written ledger file must poke the vault sync")
	}
	// nothing new: the file is left alone and the sync is not poked
	if err := exportSeason(ctx, 2026, from, to); err != nil {
		t.Fatal(err)
	}
	if wavevault.PokedForTest() {
		t.Fatal("an unchanged ledger file must not poke the vault sync")
	}
	// a cleared store keeps the file's tasks, and a new one joins them
	clearStore(t)
	c := ms(2026, time.November, 20, 9)
	insertLedger(t, "run-c", "t-1", c)
	if err := exportSeason(ctx, 2026, from, to); err != nil {
		t.Fatal(err)
	}
	want = append(want, ledgerTask{"run-c", "t-1", c})
	if got := readOwnFile(t, 2026); !slices.Equal(got, want) {
		t.Fatalf("own file after clearing the store = %v, want %v", got, want)
	}
	data, err := Read(ctx, midSeason)
	if err != nil {
		t.Fatal(err)
	}
	if len(data.Done) != 4 {
		t.Fatalf("Done = %v, want the file's 4 tasks though the store holds 1", data.Done)
	}
}

func TestExportWritesNothing(t *testing.T) {
	resetLedger(t)
	ctx := context.Background()
	_, _, from, to := SeasonAt(midSeason)
	// no task this season
	insertLedger(t, "run-a", "t-1", ms(2026, time.October, 30, 9))
	if err := exportSeason(ctx, 2026, from, to); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(ledgerPath(2026, testClient)); !os.IsNotExist(err) {
		t.Fatalf("a season with no task wrote a file (stat err %v)", err)
	}
	// no client id
	insertLedger(t, "run-a", "t-2", ms(2026, time.November, 3, 9))
	old := clientID
	clientID = func() string { return "" }
	defer func() { clientID = old }()
	if err := exportSeason(ctx, 2026, from, to); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(ledgerPath(2026, "")); !os.IsNotExist(err) {
		t.Fatalf("an install with no client id wrote a file (stat err %v)", err)
	}
}

func TestBackfillWritesOwnFile(t *testing.T) {
	resetLedger(t)
	ts := ms(2026, time.November, 2, 9)
	appendEvent(t, ts, "run-1", waveobj.RunEventKindTaskDone, map[string]any{"taskid": "t-1"})
	if _, err := Read(context.Background(), midSeason); err != nil {
		t.Fatal(err)
	}
	pendingExports.Wait()
	if got, want := readOwnFile(t, 2026), []ledgerTask{{"run-1", "t-1", ts}}; !slices.Equal(got, want) {
		t.Fatalf("own file after the backfill = %v, want %v", got, want)
	}
}

func TestNoVaultReadsStoreOnly(t *testing.T) {
	resetLedger(t)
	local := ms(2026, time.November, 3, 9)
	insertLedger(t, "run-m", "t-1", local)
	writeLedgerFile(t, 2026, "client-win", `[{"runid": "run-w", "taskid": "t-1", "ts": `+
		strconv.FormatInt(ms(2026, time.November, 10, 9), 10)+`}]`)
	old := vaultRoot
	vaultRoot = nil
	defer func() { vaultRoot = old }()
	data, err := Read(context.Background(), midSeason)
	if err != nil {
		t.Fatal(err)
	}
	if want := []int64{local}; !slices.Equal(data.Done, want) {
		t.Fatalf("Done = %v, want only the store's %v before EnableVaultSync", data.Done, want)
	}
	pendingExports.Wait()
	if _, err := os.Stat(ledgerPath(2026, testClient)); !os.IsNotExist(err) {
		t.Fatalf("a Read before EnableVaultSync wrote a ledger file (stat err %v)", err)
	}
}
