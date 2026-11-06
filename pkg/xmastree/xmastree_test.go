// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package xmastree

import (
	"context"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
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
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

// resetLedger empties the ledger and the run events, and forgets the backfill, so each test starts from a fresh
// process's store.
func resetLedger(t *testing.T) {
	t.Helper()
	err := wstore.WithTx(context.Background(), func(tx *wstore.TxWrap) error {
		tx.Exec(`DELETE FROM db_xmastask`)
		tx.Exec(`DELETE FROM db_runevent`)
		return tx.Err
	})
	if err != nil {
		t.Fatal(err)
	}
	forgetBackfill()
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
