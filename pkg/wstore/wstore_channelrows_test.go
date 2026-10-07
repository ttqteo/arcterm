// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"fmt"
	"slices"
	"testing"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// The 000014 migration must create both row tables and both expression indexes. TestMain already ran
// InitWStore (which runs the migration), so this reads the live schema out of sqlite_master.
func TestChannelRowSchemaExists(t *testing.T) {
	ctx := context.Background()
	objs := map[string]string{
		"db_run":                           "table",
		"db_channelmessage":                "table",
		"idx_run_channeloid":               "index",
		"idx_channelmessage_channeloid_ts": "index",
	}
	for name, kind := range objs {
		got, err := WithReadTxRtn(ctx, func(tx *TxWrap) (string, error) {
			return tx.GetString("SELECT name FROM sqlite_master WHERE type = ? AND name = ?", kind, name), nil
		})
		if err != nil {
			t.Fatalf("query sqlite_master for %s %q: %v", kind, name, err)
		}
		if got != name {
			t.Fatalf("expected %s %q to exist, sqlite_master returned %q", kind, name, got)
		}
	}
}

// Run and ChannelMessage must be registered WaveObj types whose table names resolve and whose JSON
// round-trips through the waveobj machinery (what the row writes and the contract pass rely on).
// getOTypeGen/waveObjTableName are the same helpers DBInsert/DBGetAllObjsByType use.
func TestRunAndChannelMessageRegistered(t *testing.T) {
	if got := getOTypeGen[*waveobj.Run](); got != waveobj.OType_Run {
		t.Fatalf("Run otype = %q, want %q", got, waveobj.OType_Run)
	}
	if got := getOTypeGen[*waveobj.ChannelMessage](); got != waveobj.OType_ChannelMessage {
		t.Fatalf("ChannelMessage otype = %q, want %q", got, waveobj.OType_ChannelMessage)
	}
	if got := waveObjTableName(&waveobj.Run{}); got != "db_run" {
		t.Fatalf("Run table = %q, want db_run", got)
	}
	if got := waveObjTableName(&waveobj.ChannelMessage{}); got != "db_channelmessage" {
		t.Fatalf("ChannelMessage table = %q, want db_channelmessage", got)
	}

	run := &waveobj.Run{OID: "run-abc", ID: "run-abc", ChannelOID: "ch-1", Goal: "do the thing"}
	data, err := waveobj.ToJson(run)
	if err != nil {
		t.Fatalf("ToJson(run): %v", err)
	}
	back, err := waveobj.FromJson(data)
	if err != nil {
		t.Fatalf("FromJson(run): %v", err)
	}
	gotRun, ok := back.(*waveobj.Run)
	if !ok {
		t.Fatalf("FromJson returned %T, want *waveobj.Run", back)
	}
	if gotRun.OID != "run-abc" || gotRun.ChannelOID != "ch-1" || gotRun.Goal != "do the thing" {
		t.Fatalf("run round-trip mismatch: %+v", gotRun)
	}
	if waveobj.GetOID(gotRun) != "run-abc" {
		t.Fatalf("GetOID(run) = %q, want run-abc", waveobj.GetOID(gotRun))
	}
}

// PostChannelMessage must write the message into db_channelmessage (with oid = message id, channeloid =
// channel oid).
func TestPostChannelMessageWritesRow(t *testing.T) {
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "dual-msg", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	msg := NewChannelMessage("human", "you", "hello", "", 100)
	if _, err := PostChannelMessage(ctx, ch.OID, msg); err != nil {
		t.Fatalf("post: %v", err)
	}
	gotChannelOID, err := WithReadTxRtn(ctx, func(tx *TxWrap) (string, error) {
		return tx.GetString("SELECT json_extract(data, '$.channeloid') FROM db_channelmessage WHERE oid = ?", msg.ID), nil
	})
	if err != nil {
		t.Fatalf("read row: %v", err)
	}
	if gotChannelOID != ch.OID {
		t.Fatalf("row channeloid = %q, want %q", gotChannelOID, ch.OID)
	}
}

// AppendRun + UpdateRun must write the db_run row.
func TestAppendAndUpdateRunWriteRow(t *testing.T) {
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "dual-run", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	run := waveobj.Run{ID: "run-1", Goal: "g", Status: "planning", CreatedTs: 1}
	if err := AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("append run: %v", err)
	}
	status, err := WithReadTxRtn(ctx, func(tx *TxWrap) (string, error) {
		return tx.GetString("SELECT json_extract(data, '$.status') FROM db_run WHERE oid = ?", "run-1"), nil
	})
	if err != nil || status != "planning" {
		t.Fatalf("row status after append = %q (err %v), want planning", status, err)
	}
	if err := UpdateRun(ctx, ch.OID, "run-1", func(r *waveobj.Run) error {
		r.Status = "done"
		return nil
	}); err != nil {
		t.Fatalf("update run: %v", err)
	}
	status, err = WithReadTxRtn(ctx, func(tx *TxWrap) (string, error) {
		return tx.GetString("SELECT json_extract(data, '$.status') FROM db_run WHERE oid = ?", "run-1"), nil
	})
	if err != nil || status != "done" {
		t.Fatalf("row status after update = %q (err %v), want done", status, err)
	}
}

// StampWorkerOwner records the owning run/channel oref on a worker tab's meta so the owner lookup is a
// direct field read. Seed a tab, stamp it, read the meta back.
func TestStampWorkerOwner(t *testing.T) {
	ctx := context.Background()
	// ParseORef (used by StampWorkerOwner) requires a UUID oid, matching real tab oids.
	tabOID := uuid.NewString()
	tab := &waveobj.Tab{OID: tabOID, Name: "worker", Meta: waveobj.MetaMapType{}}
	if err := DBInsert(ctx, tab); err != nil {
		t.Fatalf("seed tab: %v", err)
	}
	tabORef := waveobj.MakeORef(waveobj.OType_Tab, tabOID).String()
	runORef := waveobj.MakeORef(waveobj.OType_Run, "r-1").String()
	chORef := waveobj.MakeORef(waveobj.OType_Channel, "c-1").String()
	if err := StampWorkerOwner(ctx, tabORef, runORef, chORef); err != nil {
		t.Fatalf("stamp: %v", err)
	}
	got, err := DBMustGet[*waveobj.Tab](ctx, tabOID)
	if err != nil {
		t.Fatalf("read tab: %v", err)
	}
	if got.Meta.GetString(MetaKey_JarvisRunORef, "") != runORef {
		t.Fatalf("run oref meta = %q, want %q", got.Meta.GetString(MetaKey_JarvisRunORef, ""), runORef)
	}
	if got.Meta.GetString(MetaKey_JarvisChannelORef, "") != chORef {
		t.Fatalf("channel oref meta = %q, want %q", got.Meta.GetString(MetaKey_JarvisChannelORef, ""), chORef)
	}
}

// GetChannelRuns returns exactly the db_run rows for a channel, in createdts order.
func TestGetChannelRuns(t *testing.T) {
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "runs-query", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if err := AppendRun(ctx, ch.OID, waveobj.Run{ID: "r-b", Goal: "b", Status: "planning", CreatedTs: 20}); err != nil {
		t.Fatalf("append r-b: %v", err)
	}
	if err := AppendRun(ctx, ch.OID, waveobj.Run{ID: "r-a", Goal: "a", Status: "planning", CreatedTs: 10}); err != nil {
		t.Fatalf("append r-a: %v", err)
	}
	// a run in a different channel must not leak in
	other, _ := CreateChannel(ctx, "other", "/p")
	if err := AppendRun(ctx, other.OID, waveobj.Run{ID: "r-x", Goal: "x", Status: "planning", CreatedTs: 5}); err != nil {
		t.Fatalf("append r-x: %v", err)
	}
	runs, err := GetChannelRuns(ctx, ch.OID)
	if err != nil {
		t.Fatalf("GetChannelRuns: %v", err)
	}
	if len(runs) != 2 {
		t.Fatalf("want 2 runs, got %d", len(runs))
	}
	if runs[0].ID != "r-a" || runs[1].ID != "r-b" {
		t.Fatalf("want [r-a r-b] by createdts, got [%s %s]", runs[0].ID, runs[1].ID)
	}
	if runs[0].ChannelOID != ch.OID {
		t.Fatalf("channeloid = %q, want %q", runs[0].ChannelOID, ch.OID)
	}
}

// A caller holding a channel's runs gets back every id, and only the rows it does not hold as they are now.
func TestGetChannelRunChanges(t *testing.T) {
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "run-changes", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	for i, id := range []string{"chg-a", "chg-b", "chg-c"} {
		if err := AppendRun(ctx, ch.OID, waveobj.Run{ID: id, Goal: id, Status: "planning", CreatedTs: int64(10 * (i + 1))}); err != nil {
			t.Fatalf("append %s: %v", id, err)
		}
	}
	other, _ := CreateChannel(ctx, "run-changes-other", "/p")
	if err := AppendRun(ctx, other.OID, waveobj.Run{ID: "chg-x", Goal: "x", Status: "planning", CreatedTs: 5}); err != nil {
		t.Fatalf("append chg-x: %v", err)
	}
	runIDs := func(runs []*waveobj.Run) []string {
		out := []string{}
		for _, r := range runs {
			out = append(out, r.ID)
		}
		return out
	}

	// a caller holding nothing gets every row, in createdts order
	ids, runs, err := GetChannelRunChanges(ctx, ch.OID, nil)
	if err != nil {
		t.Fatalf("GetChannelRunChanges: %v", err)
	}
	slices.Sort(ids)
	if !slices.Equal(ids, []string{"chg-a", "chg-b", "chg-c"}) || !slices.Equal(runIDs(runs), []string{"chg-a", "chg-b", "chg-c"}) {
		t.Fatalf("first read: ids=%v runs=%v", ids, runIDs(runs))
	}
	known := map[string]int{}
	for _, r := range runs {
		known[r.ID] = r.Version
	}

	// a caller holding every row at its version gets the ids and no row
	ids, runs, err = GetChannelRunChanges(ctx, ch.OID, known)
	if err != nil || len(ids) != 3 || len(runs) != 0 {
		t.Fatalf("nothing changed: ids=%v runs=%v err=%v", ids, runIDs(runs), err)
	}

	// one run updated and one appended: exactly those two rows come back, the updated one as it is now
	if err := UpdateRun(ctx, ch.OID, "chg-b", func(r *waveobj.Run) error { r.Status = "done"; return nil }); err != nil {
		t.Fatalf("update chg-b: %v", err)
	}
	if err := AppendRun(ctx, ch.OID, waveobj.Run{ID: "chg-d", Goal: "d", Status: "planning", CreatedTs: 40}); err != nil {
		t.Fatalf("append chg-d: %v", err)
	}
	ids, runs, err = GetChannelRunChanges(ctx, ch.OID, known)
	if err != nil {
		t.Fatalf("GetChannelRunChanges: %v", err)
	}
	if len(ids) != 4 || !slices.Equal(runIDs(runs), []string{"chg-b", "chg-d"}) {
		t.Fatalf("after changes: ids=%v runs=%v", ids, runIDs(runs))
	}
	if runs[0].Status != "done" || runs[0].Version == known["chg-b"] {
		t.Fatalf("chg-b came back stale: status=%q version=%d (held %d)", runs[0].Status, runs[0].Version, known["chg-b"])
	}

	// a run the caller holds that another channel owns is not this channel's to return
	ids, runs, err = GetChannelRunChanges(ctx, other.OID, map[string]int{"chg-a": 99})
	if err != nil || !slices.Equal(ids, []string{"chg-x"}) || !slices.Equal(runIDs(runs), []string{"chg-x"}) {
		t.Fatalf("other channel: ids=%v runs=%v err=%v", ids, runIDs(runs), err)
	}
}

// The Shared readers hand back the object they already hold while a row's version is unchanged, and a
// fresh decode once it moves: the first is what makes a poll cheap, the second what keeps it correct.
func TestSharedReadersDecodeOnlyChangedRows(t *testing.T) {
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "shared-reads", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	for _, r := range []waveobj.Run{{ID: "shr-late", CreatedTs: 20}, {ID: "shr-early", CreatedTs: 10}} {
		r.Status = "planning"
		if err := AppendRun(ctx, ch.OID, r); err != nil {
			t.Fatalf("append %s: %v", r.ID, err)
		}
	}
	first, err := GetChannelRunsShared(ctx, ch.OID)
	if err != nil || len(first) != 2 || first[0].ID != "shr-early" || first[1].ID != "shr-late" {
		t.Fatalf("first read: %+v err=%v", first, err)
	}
	again, _ := GetChannelRunsShared(ctx, ch.OID)
	if again[0] != first[0] || again[1] != first[1] {
		t.Fatalf("unchanged rows were decoded again")
	}

	if err := UpdateRun(ctx, ch.OID, "shr-late", func(r *waveobj.Run) error { r.Status = "done"; return nil }); err != nil {
		t.Fatalf("update: %v", err)
	}
	after, err := GetChannelRunsShared(ctx, ch.OID)
	if err != nil || len(after) != 2 {
		t.Fatalf("after update: %+v err=%v", after, err)
	}
	if after[0] != first[0] {
		t.Fatalf("the untouched run was decoded again")
	}
	if after[1] == first[1] || after[1].Status != "done" || first[1].Status != "planning" {
		t.Fatalf("the updated run came back stale: %q (held copy now %q)", after[1].Status, first[1].Status)
	}

	chans, err := GetChannelsShared(ctx)
	if err != nil || !slices.ContainsFunc(chans, func(c *waveobj.Channel) bool { return c.OID == ch.OID }) {
		t.Fatalf("GetChannelsShared missed the channel: err=%v", err)
	}
	if _, err := GetDagShared(ctx, "shr-no-such-dag"); err != ErrNotFound {
		t.Fatalf("missing dag: want ErrNotFound, got %v", err)
	}
}

func TestGetChannelMessages(t *testing.T) {
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "msgs-query", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	for i, ts := range []int64{10, 20, 30, 40} {
		m := NewChannelMessage("human", "you", fmt.Sprintf("m%d", i), "", ts)
		if _, err := PostChannelMessage(ctx, ch.OID, m); err != nil {
			t.Fatalf("post m%d: %v", i, err)
		}
	}
	// latest window, limit 2 -> the two newest, returned chronological (ts 30 then 40)
	got, err := GetChannelMessages(ctx, ch.OID, 0, 2)
	if err != nil {
		t.Fatalf("GetChannelMessages latest: %v", err)
	}
	if len(got) != 2 || got[0].Ts != 30 || got[1].Ts != 40 {
		t.Fatalf("latest window wrong: %+v", got)
	}
	// load-older before ts=30, limit 2 -> ts 10 then 20
	older, err := GetChannelMessages(ctx, ch.OID, 30, 2)
	if err != nil {
		t.Fatalf("GetChannelMessages older: %v", err)
	}
	if len(older) != 2 || older[0].Ts != 10 || older[1].Ts != 20 {
		t.Fatalf("older window wrong: %+v", older)
	}
}

func TestGetChannelMessagesOrdersTiedTsByInsert(t *testing.T) {
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "msgs-tied", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	const tiedTs = 50
	for _, text := range []string{"a", "b", "c", "d"} {
		if _, err := PostChannelMessage(ctx, ch.OID, NewChannelMessage("human", "you", text, "", tiedTs)); err != nil {
			t.Fatalf("post %s: %v", text, err)
		}
	}
	texts := func(msgs []*waveobj.ChannelMessage) []string {
		var rtn []string
		for _, m := range msgs {
			rtn = append(rtn, m.Text)
		}
		return rtn
	}
	all, err := GetChannelMessages(ctx, ch.OID, 0, 0)
	if err != nil || !slices.Equal(texts(all), []string{"a", "b", "c", "d"}) {
		t.Fatalf("tied messages out of insert order: %v err=%v", texts(all), err)
	}
	// a window cut inside the tie keeps the newest inserts
	newest, err := GetChannelMessages(ctx, ch.OID, 0, 2)
	if err != nil || !slices.Equal(texts(newest), []string{"c", "d"}) {
		t.Fatalf("tied window wrong: %v err=%v", texts(newest), err)
	}
}

func TestGetMessagesByRef(t *testing.T) {
	ctx := context.Background()
	first, err := CreateChannel(ctx, "byref-a", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	second, err := CreateChannel(ctx, "byref-b", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	ref := waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String()
	other := waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String()
	// posted newest first, and across two channels, so the order can only come from ts
	for _, m := range []struct {
		channel, kind, ref string
		ts                 int64
	}{
		{second.OID, "outcome", ref, 30},
		{first.OID, "dispatch", ref, 10},
		{first.OID, "dispatch", other, 20},
		{first.OID, "human", "", 25},
	} {
		if _, err := PostChannelMessage(ctx, m.channel, NewChannelMessage(m.kind, "claude", "t", m.ref, m.ts)); err != nil {
			t.Fatalf("post: %v", err)
		}
	}
	got, err := GetMessagesByRef(ctx, ref)
	if err != nil {
		t.Fatalf("GetMessagesByRef: %v", err)
	}
	if len(got) != 2 || got[0].Ts != 10 || got[0].ChannelOID != first.OID || got[1].Ts != 30 || got[1].ChannelOID != second.OID {
		t.Fatalf("want the ref's two messages oldest first, got %+v", got)
	}
	if none, err := GetMessagesByRef(ctx, ""); err != nil || len(none) != 0 {
		t.Fatalf("an empty ref must match nothing, got %+v err=%v", none, err)
	}
}

func TestGetRunCandidatesByWorker(t *testing.T) {
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "run-by-worker", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	worker := waveobj.MakeORef(waveobj.OType_Tab, uuid.NewString()).String()
	owner := waveobj.Run{ID: uuid.NewString(), Goal: "g", CreatedTs: 2,
		Phases: []waveobj.RunPhase{{Kind: "execute", WorkerOrefs: []string{worker}}}}
	// a candidate only: it quotes the oref in its goal, which the caller has to rule out
	quoting := waveobj.Run{ID: uuid.NewString(), Goal: "look at " + worker, CreatedTs: 1}
	unrelated := waveobj.Run{ID: uuid.NewString(), Goal: "g", CreatedTs: 3}
	for _, r := range []waveobj.Run{owner, quoting, unrelated} {
		if err := AppendRun(ctx, ch.OID, r); err != nil {
			t.Fatalf("append: %v", err)
		}
	}
	got, err := GetRunCandidatesByWorker(ctx, worker)
	if err != nil {
		t.Fatalf("GetRunCandidatesByWorker: %v", err)
	}
	if len(got) != 2 || got[0].ID != quoting.ID || got[1].ID != owner.ID {
		t.Fatalf("want the quoting run then the owner, oldest first, got %+v", got)
	}
	if none, err := GetRunCandidatesByWorker(ctx, ""); err != nil || len(none) != 0 {
		t.Fatalf("an empty oref must match nothing, got %+v err=%v", none, err)
	}
}

func TestGetRunReadsRow(t *testing.T) {
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "getrun-row", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if err := AppendRun(ctx, ch.OID, waveobj.Run{ID: "r-1", Goal: "g", Status: "planning", CreatedTs: 1}); err != nil {
		t.Fatalf("append: %v", err)
	}
	got, err := GetRun(ctx, ch.OID, "r-1")
	if err != nil || got == nil || got.ID != "r-1" || got.ChannelOID != ch.OID {
		t.Fatalf("GetRun row read wrong: %+v err=%v", got, err)
	}
	// a run inserted straight into db_run, with no AppendRun, is found: the row is all a run is
	if err := DBInsert(ctx, &waveobj.Run{OID: "r-rowonly", ID: "r-rowonly", ChannelOID: ch.OID, Goal: "g", Status: "planning", CreatedTs: 2}); err != nil {
		t.Fatalf("seed row-only run: %v", err)
	}
	rowOnly, err := GetRun(ctx, ch.OID, "r-rowonly")
	if err != nil || rowOnly == nil || rowOnly.ID != "r-rowonly" {
		t.Fatalf("GetRun did not read the row-only run: %+v err=%v", rowOnly, err)
	}
	if _, err := GetRun(ctx, "wrong-channel", "r-1"); err == nil {
		t.Fatalf("expected error for mismatched channel id")
	}
	if _, err := GetRun(ctx, ch.OID, "nope"); err == nil {
		t.Fatalf("expected error for missing run")
	}
}

func TestAppendRunBroadcastsRunUpdate(t *testing.T) {
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "run-bcast", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	// Wrap in an explicit updates context so we can read what was queued for broadcast.
	ctx = waveobj.ContextWithUpdates(ctx)
	if err := AppendRun(ctx, ch.OID, waveobj.Run{ID: "r-1", Goal: "g", Status: "planning", CreatedTs: 1}); err != nil {
		t.Fatalf("append: %v", err)
	}
	updates := waveobj.ContextGetUpdates(ctx)
	sawRun := false
	for _, u := range updates {
		if u.OType == waveobj.OType_Run && u.OID == "r-1" {
			sawRun = true
		}
	}
	if !sawRun {
		t.Fatalf("expected a run:r-1 waveobj update to be queued, got %+v", updates)
	}
}

func TestStampWorkerOwnerOmitsEmpty(t *testing.T) {
	ctx := context.Background()
	tabOID := uuid.NewString()
	if err := DBInsert(ctx, &waveobj.Tab{OID: tabOID, Name: "worker", Meta: waveobj.MetaMapType{}}); err != nil {
		t.Fatalf("seed tab: %v", err)
	}
	tabORef := waveobj.MakeORef(waveobj.OType_Tab, tabOID).String()
	chORef := waveobj.MakeORef(waveobj.OType_Channel, "c-1").String()
	// concierge stamp: channel only, empty run
	if err := StampWorkerOwner(ctx, tabORef, "", chORef); err != nil {
		t.Fatalf("stamp: %v", err)
	}
	runORef, gotCh, err := GetWorkerOwner(ctx, tabORef)
	if err != nil {
		t.Fatalf("GetWorkerOwner: %v", err)
	}
	if runORef != "" {
		t.Fatalf("expected empty runoref, got %q", runORef)
	}
	if gotCh != chORef {
		t.Fatalf("channeloref = %q, want %q", gotCh, chORef)
	}
}

func TestDispatchMessageStampsWorkerChannel(t *testing.T) {
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "dispatch-stamp", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	workerTabOID := uuid.NewString()
	if err := DBInsert(ctx, &waveobj.Tab{OID: workerTabOID, Name: "w", Meta: waveobj.MetaMapType{}}); err != nil {
		t.Fatalf("seed worker tab: %v", err)
	}
	workerTabORef := waveobj.MakeORef(waveobj.OType_Tab, workerTabOID).String()
	msg := NewChannelMessage("dispatch", "claude", "do the thing", workerTabORef, 100)
	if _, err := PostChannelMessage(ctx, ch.OID, msg); err != nil {
		t.Fatalf("post dispatch: %v", err)
	}
	_, chORef, err := GetWorkerOwner(ctx, workerTabORef)
	if err != nil {
		t.Fatalf("GetWorkerOwner: %v", err)
	}
	if chORef != waveobj.MakeORef(waveobj.OType_Channel, ch.OID).String() {
		t.Fatalf("dispatch did not stamp channeloref: got %q", chORef)
	}
}

func TestGetChannelProjectPaths(t *testing.T) {
	ctx := context.Background()
	a, _ := CreateChannel(ctx, "pa", "/proj/a")
	b, _ := CreateChannel(ctx, "pb", "/proj/b")
	m, err := GetChannelProjectPaths(ctx)
	if err != nil {
		t.Fatalf("GetChannelProjectPaths: %v", err)
	}
	if m[a.OID] != "/proj/a" || m[b.OID] != "/proj/b" {
		t.Fatalf("wrong map: %+v", m)
	}
}

// Deleting a channel takes its runs, their events and dags, and its messages, and leaves another channel's alone.
func TestDeleteChannelDeletesItsRows(t *testing.T) {
	ctx := context.Background()
	seed := func(name string) (string, string, string) {
		ch, err := CreateChannel(ctx, name, t.TempDir())
		if err != nil {
			t.Fatalf("create channel: %v", err)
		}
		runId := uuid.NewString()
		if err := AppendRun(ctx, ch.OID, waveobj.Run{ID: runId, Goal: "g", Status: "planning", CreatedTs: 1}); err != nil {
			t.Fatalf("append run: %v", err)
		}
		if _, err := AppendRunEvent(ctx, ch.OID, runId, "phase-started", nil, map[string]any{}); err != nil {
			t.Fatalf("append run event: %v", err)
		}
		if _, err := PostChannelMessage(ctx, ch.OID, NewChannelMessage("say", "user", "hi", "", 1)); err != nil {
			t.Fatalf("post message: %v", err)
		}
		dagId := uuid.NewString()
		if err := AppendDag(ctx, &waveobj.TaskGroup{OID: dagId, ID: dagId, RunID: runId, ChannelId: ch.OID}); err != nil {
			t.Fatalf("append dag: %v", err)
		}
		return ch.OID, runId, dagId
	}
	counts := func(channelId, runId string) [3]int {
		runs, _ := GetChannelRuns(ctx, channelId)
		msgs, _ := GetChannelMessages(ctx, channelId, 0, 0)
		events, _ := QueryRunEvents(ctx, channelId, runId, 0)
		return [3]int{len(runs), len(msgs), len(events)}
	}
	gone, goneRun, goneDag := seed("delete-me")
	kept, keptRun, keptDag := seed("keep-me")

	if err := DeleteChannel(ctx, gone); err != nil {
		t.Fatalf("DeleteChannel: %v", err)
	}
	if got := counts(gone, goneRun); got != [3]int{} {
		t.Errorf("deleted channel still has runs/messages/events = %v", got)
	}
	if got := counts(kept, keptRun); got != [3]int{1, 1, 1} {
		t.Errorf("other channel's runs/messages/events = %v, want 1 each", got)
	}
	if _, err := GetDag(ctx, goneDag); err == nil {
		t.Errorf("deleted channel still has its dag")
	}
	if _, err := GetDag(ctx, keptDag); err != nil {
		t.Errorf("other channel's dag: %v", err)
	}
}
