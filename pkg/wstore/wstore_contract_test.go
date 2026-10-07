// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// maxContractedChannelBytes bounds a channel's stored data once it holds no messages or runs.
const maxContractedChannelBytes = 4 * 1024

const (
	contractTestRuns     = 500
	contractTestGoalSize = 15 * 1024
	contractTestBurst    = 50
)

// legacyChannelBlob is a channel as a pre-contract build stored it, arrays embedded. waveobj.Channel can
// no longer produce one, so the tests write it raw.
func legacyChannelBlob(oid, messages, runs string) []byte {
	return []byte(fmt.Sprintf(`{"otype":"channel","oid":%q,"version":1,"name":"legacy","createdts":1,"messages":%s,"runs":%s,"meta":{}}`, oid, messages, runs))
}

func legacyMessage(id, text string) string {
	return fmt.Sprintf(`{"id":%q,"kind":"human","author":"you","text":%q,"ts":10}`, id, text)
}

func legacyRun(id, status string) string {
	return fmt.Sprintf(`{"id":%q,"goal":"g","status":%q,"createdts":5}`, id, status)
}

func seedLegacyChannel(t *testing.T, oid string, blob []byte) {
	t.Helper()
	if err := WithTx(context.Background(), func(tx *TxWrap) error {
		tx.Exec(`INSERT INTO db_channel (oid, version, data) VALUES (?, 1, ?)`, oid, blob)
		return nil
	}); err != nil {
		t.Fatalf("seed legacy channel: %v", err)
	}
}

func storedData(t *testing.T, table, oid string) []byte {
	t.Helper()
	data, err := WithTxRtn(context.Background(), func(tx *TxWrap) ([]byte, error) {
		return tx.GetByteArr(`SELECT data FROM `+table+` WHERE oid = ?`, oid), nil
	})
	if err != nil {
		t.Fatalf("read %s %s: %v", table, oid, err)
	}
	return data
}

func hasArrays(t *testing.T, oid string) bool {
	t.Helper()
	data := storedData(t, "db_channel", oid)
	return bytes.Contains(data, []byte(`"messages"`)) || bytes.Contains(data, []byte(`"runs"`))
}

// armContractPass makes the next ContractChannels run for real: it needs a MainServer row to carry the
// marker, and the marker cleared.
func armContractPass(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	ms, err := DBGetSingleton[*waveobj.MainServer](ctx)
	if errors.Is(err, ErrNotFound) {
		ms = &waveobj.MainServer{OID: uuid.NewString(), Meta: waveobj.MetaMapType{}}
		err = DBInsert(ctx, ms)
	}
	if err != nil {
		t.Fatalf("main server: %v", err)
	}
	ms.Meta[MetaKey_ChannelsContracted] = false
	if err := DBUpdate(ctx, ms); err != nil {
		t.Fatalf("clear contract marker: %v", err)
	}
}

func contractMarker(t *testing.T) bool {
	t.Helper()
	done, err := SingletonMetaBool(context.Background(), MetaKey_ChannelsContracted)
	if err != nil {
		t.Fatalf("read contract marker: %v", err)
	}
	return done
}

func TestContractChannelsMovesArraysToRows(t *testing.T) {
	ctx := context.Background()
	chId := uuid.NewString()
	newMsg, keptMsg, newRun, keptRun := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	// the rows of keptMsg and keptRun are newer than their embedded copies
	if err := DBInsert(ctx, &waveobj.ChannelMessage{OID: keptMsg, ID: keptMsg, ChannelOID: chId, Kind: "human", Text: "row copy", Ts: 10}); err != nil {
		t.Fatal(err)
	}
	if err := DBInsert(ctx, &waveobj.Run{OID: keptRun, ID: keptRun, ChannelOID: chId, Goal: "g", Status: "done", CreatedTs: 5}); err != nil {
		t.Fatal(err)
	}
	keptMsgData, keptRunData := storedData(t, "db_channelmessage", keptMsg), storedData(t, "db_run", keptRun)
	seedLegacyChannel(t, chId, legacyChannelBlob(chId,
		"["+legacyMessage(newMsg, "embedded only")+","+legacyMessage(keptMsg, "embedded copy")+"]",
		"["+legacyRun(newRun, "planning")+","+legacyRun(keptRun, "executing")+"]"))

	armContractPass(t)
	if err := ContractChannels(); err != nil {
		t.Fatalf("contract: %v", err)
	}

	msgs, err := GetChannelMessages(ctx, chId, 0, 0)
	if err != nil || len(msgs) != 2 {
		t.Fatalf("want 2 message rows, got %+v (err %v)", msgs, err)
	}
	for _, m := range msgs {
		if m.OID != m.ID || m.ChannelOID != chId {
			t.Errorf("message row identity not stamped: %+v", m)
		}
		if want := map[string]string{newMsg: "embedded only", keptMsg: "row copy"}[m.ID]; m.Text != want {
			t.Errorf("message %s text = %q, want %q", m.ID, m.Text, want)
		}
	}
	inserted, err := GetRun(ctx, chId, newRun)
	if err != nil || inserted.OID != newRun || inserted.Status != "planning" {
		t.Fatalf("embedded-only run did not become a row: %+v (err %v)", inserted, err)
	}
	if got := storedData(t, "db_channelmessage", keptMsg); !bytes.Equal(got, keptMsgData) {
		t.Errorf("an existing message row was rewritten:\n%s", got)
	}
	if got := storedData(t, "db_run", keptRun); !bytes.Equal(got, keptRunData) {
		t.Errorf("an existing run row was rewritten:\n%s", got)
	}
	if hasArrays(t, chId) {
		t.Errorf("blob still holds its arrays: %s", storedData(t, "db_channel", chId))
	}
	if ch, err := DBMustGet[*waveobj.Channel](ctx, chId); err != nil || ch.Name != "legacy" || ch.CreatedTs != 1 {
		t.Errorf("channel metadata did not survive: %+v (err %v)", ch, err)
	}
	if !contractMarker(t) {
		t.Errorf("marker not set after a clean pass")
	}

	// a second pass, marker cleared so it really runs, changes nothing
	stripped := storedData(t, "db_channel", chId)
	armContractPass(t)
	if err := ContractChannels(); err != nil {
		t.Fatalf("second contract: %v", err)
	}
	if got := storedData(t, "db_channel", chId); !bytes.Equal(got, stripped) {
		t.Errorf("second pass rewrote the blob:\n%s", got)
	}
	if got := storedData(t, "db_channelmessage", keptMsg); !bytes.Equal(got, keptMsgData) {
		t.Errorf("second pass rewrote a message row:\n%s", got)
	}
	if again, err := GetRun(ctx, chId, newRun); err != nil || again.Version != inserted.Version {
		t.Errorf("second pass rewrote a run row: %+v (err %v)", again, err)
	}
	if msgs, err := GetChannelMessages(ctx, chId, 0, 0); err != nil || len(msgs) != 2 {
		t.Errorf("second pass changed the message rows: %+v (err %v)", msgs, err)
	}
}

// a pass killed between two channels leaves the first done and the second whole; the next start finishes.
func TestContractChannelsResumesAfterInterruption(t *testing.T) {
	ctx := context.Background()
	first, second := uuid.NewString(), uuid.NewString()
	firstMsg, secondMsg, secondRun := uuid.NewString(), uuid.NewString(), uuid.NewString()
	seedLegacyChannel(t, first, legacyChannelBlob(first, "["+legacyMessage(firstMsg, "one")+"]", "[]"))
	seedLegacyChannel(t, second, legacyChannelBlob(second, "["+legacyMessage(secondMsg, "two")+"]", "["+legacyRun(secondRun, "done")+"]"))

	armContractPass(t)
	if err := contractChannel(ctx, first, &contractStats{}); err != nil {
		t.Fatalf("contract first: %v", err)
	}
	if hasArrays(t, first) || !hasArrays(t, second) || contractMarker(t) {
		t.Fatalf("interrupted state wrong: first arrays=%v second arrays=%v marker=%v", hasArrays(t, first), hasArrays(t, second), contractMarker(t))
	}

	if err := ContractChannels(); err != nil {
		t.Fatalf("resumed contract: %v", err)
	}
	if hasArrays(t, first) || hasArrays(t, second) || !contractMarker(t) {
		t.Fatalf("resumed pass did not finish: first arrays=%v second arrays=%v marker=%v", hasArrays(t, first), hasArrays(t, second), contractMarker(t))
	}
	for chId, msgId := range map[string]string{first: firstMsg, second: secondMsg} {
		if msgs, err := GetChannelMessages(ctx, chId, 0, 0); err != nil || len(msgs) != 1 || msgs[0].ID != msgId {
			t.Errorf("channel %s lost its message: %+v (err %v)", chId, msgs, err)
		}
	}
	if _, err := GetRun(ctx, second, secondRun); err != nil {
		t.Errorf("second channel lost its run: %v", err)
	}
}

func TestContractChannelsStopsAtAChannelItCannotMigrate(t *testing.T) {
	ctx := context.Background()
	// the pass goes in oid order: the good channel has to come first
	good, bad := uuid.NewString(), uuid.NewString()
	if good > bad {
		good, bad = bad, good
	}
	goodMsg, badMsg, badRun := uuid.NewString(), uuid.NewString(), uuid.NewString()
	seedLegacyChannel(t, good, legacyChannelBlob(good, "["+legacyMessage(goodMsg, "good")+"]", "[]"))
	badBlob := legacyChannelBlob(bad, `"not an array"`, "["+legacyRun(badRun, "done")+"]")
	seedLegacyChannel(t, bad, badBlob)
	// a channel left unmigratable would fail every later pass in this store
	t.Cleanup(func() {
		if hasArrays(t, bad) {
			_ = DeleteChannel(context.Background(), bad)
		}
	})

	armContractPass(t)
	err := ContractChannels()
	if err == nil || !strings.Contains(err.Error(), bad) {
		t.Fatalf("want an error naming channel %s, got %v", bad, err)
	}
	if contractMarker(t) {
		t.Errorf("marker set over a channel that still holds its arrays")
	}
	if got := storedData(t, "db_channel", bad); !bytes.Equal(got, badBlob) {
		t.Errorf("failed channel's data changed:\n%s", got)
	}
	if run, err := DBGet[*waveobj.Run](ctx, badRun); err != nil || run != nil {
		t.Errorf("failed channel's run was inserted anyway: %+v (err %v)", run, err)
	}
	if hasArrays(t, good) {
		t.Errorf("the channel before the failure was not migrated")
	}
	if msgs, err := GetChannelMessages(ctx, good, 0, 0); err != nil || len(msgs) != 1 || msgs[0].ID != goodMsg {
		t.Errorf("good channel's message is not a row: %+v (err %v)", msgs, err)
	}

	// repaired, the next pass takes everything the blob holds and only then sets the marker
	if err := WithTx(ctx, func(tx *TxWrap) error {
		tx.Exec(`UPDATE db_channel SET data = ? WHERE oid = ?`,
			legacyChannelBlob(bad, "["+legacyMessage(badMsg, "repaired")+"]", "["+legacyRun(badRun, "done")+"]"), bad)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := ContractChannels(); err != nil {
		t.Fatalf("contract after repair: %v", err)
	}
	if msgs, err := GetChannelMessages(ctx, bad, 0, 0); err != nil || len(msgs) != 1 || msgs[0].ID != badMsg {
		t.Errorf("repaired channel lost its message: %+v (err %v)", msgs, err)
	}
	if _, err := GetRun(ctx, bad, badRun); err != nil {
		t.Errorf("repaired channel lost its run: %v", err)
	}
	if hasArrays(t, bad) || !contractMarker(t) {
		t.Errorf("repaired pass did not finish: arrays=%v marker=%v", hasArrays(t, bad), contractMarker(t))
	}
}

// migration 000023 keeps each blob as it was, and its down puts the blobs back; 000024 drops the copy.
func TestChannelPrecontractKeepsTheBlobs(t *testing.T) {
	ctx := context.Background()
	execFile := func(name string) {
		t.Helper()
		sql, err := os.ReadFile("../../db/migrations-wstore/" + name)
		if err != nil {
			t.Fatalf("read migration: %v", err)
		}
		if err := WithTx(ctx, func(tx *TxWrap) error {
			tx.Exec(string(sql))
			return nil
		}); err != nil {
			t.Fatalf("apply %s: %v", name, err)
		}
	}
	tableExists := func() bool {
		name, err := WithTxRtn(ctx, func(tx *TxWrap) (string, error) {
			return tx.GetString(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'db_channel_precontract'`), nil
		})
		if err != nil {
			t.Fatalf("query sqlite_master: %v", err)
		}
		return name != ""
	}
	if tableExists() {
		t.Fatalf("db_channel_precontract still there after the migrations ran")
	}

	chId, msgId, runId := uuid.NewString(), uuid.NewString(), uuid.NewString()
	blob := legacyChannelBlob(chId, "["+legacyMessage(msgId, "kept")+"]", "["+legacyRun(runId, "done")+"]")
	seedLegacyChannel(t, chId, blob)
	// TestMain's migrations ran over an empty store and dropped the copy: take it over the seeded one
	execFile("000023_channel_precontract.up.sql")
	t.Cleanup(func() { execFile("000024_drop_channel_precontract.up.sql") })

	armContractPass(t)
	if err := ContractChannels(); err != nil {
		t.Fatalf("contract: %v", err)
	}
	if hasArrays(t, chId) {
		t.Fatalf("channel not contracted")
	}
	if got := storedData(t, "db_channel_precontract", chId); !bytes.Equal(got, blob) {
		t.Fatalf("recovery copy is not the blob as it was:\n%s", got)
	}

	execFile("000023_channel_precontract.down.sql")
	if got := storedData(t, "db_channel", chId); !bytes.Equal(got, blob) {
		t.Errorf("down did not restore the blob:\n%s", got)
	}
	if tableExists() {
		t.Errorf("down left db_channel_precontract behind")
	}
	// leave the store contracted for the tests that follow
	armContractPass(t)
	if err := ContractChannels(); err != nil {
		t.Fatalf("contract after down: %v", err)
	}
}

func TestChannelStaysSmallUnderRunAndMessageWrites(t *testing.T) {
	ctx := context.Background()
	ch, err := CreateChannel(ctx, "contract", "/contract")
	if err != nil {
		t.Fatal(err)
	}
	goal := strings.Repeat("g", contractTestGoalSize)
	runIds := make([]string, contractTestRuns)
	for i := range runIds {
		runIds[i] = uuid.NewString()
		if err := AppendRun(ctx, ch.OID, waveobj.Run{ID: runIds[i], Goal: goal, Status: "planning", CreatedTs: int64(i)}); err != nil {
			t.Fatal(err)
		}
	}
	before, err := DBMustGet[*waveobj.Channel](ctx, ch.OID)
	if err != nil {
		t.Fatal(err)
	}

	added := waveobj.Run{ID: uuid.NewString(), Goal: goal, Status: "planning", CreatedTs: contractTestRuns}
	if err := AppendRun(ctx, ch.OID, added); err != nil {
		t.Fatalf("append: %v", err)
	}
	if err := UpdateRun(ctx, ch.OID, runIds[0], func(r *waveobj.Run) error {
		r.Status = "executing"
		return nil
	}); err != nil {
		t.Fatalf("update: %v", err)
	}
	msg, err := PostChannelMessage(ctx, ch.OID, NewChannelMessage("human", "you", "hello", "", 100))
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	dagId := uuid.NewString()
	dag := &waveobj.TaskGroup{OID: dagId, ID: dagId, RunID: added.ID, ChannelId: ch.OID, Parallelism: 1, Status: "running"}
	if _, created, err := CreateDagForRun(ctx, ch.OID, added.ID, dag, nil); err != nil || !created {
		t.Fatalf("create dag: created=%v err=%v", created, err)
	}

	const mutations = 4
	after, err := DBMustGet[*waveobj.Channel](ctx, ch.OID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Version != before.Version+mutations {
		t.Errorf("channel version = %d, want %d (one bump per mutation)", after.Version, before.Version+mutations)
	}
	if size := len(storedData(t, "db_channel", ch.OID)); size >= maxContractedChannelBytes {
		t.Errorf("channel data is %d bytes, want under %d", size, maxContractedChannelBytes)
	}
	if got, err := GetRun(ctx, ch.OID, runIds[0]); err != nil || got.Status != "executing" || got.Goal != goal {
		t.Errorf("updated run reads back wrong: status=%q err=%v", got.Status, err)
	}
	if got, err := GetRun(ctx, ch.OID, added.ID); err != nil || got.DagORef != dagId {
		t.Errorf("run does not carry its dag: %+v err=%v", got.DagORef, err)
	}
	if runs, err := GetChannelRuns(ctx, ch.OID); err != nil || len(runs) != contractTestRuns+1 || runs[len(runs)-1].ID != added.ID {
		t.Errorf("want %d runs ending with the appended one, got %d (err %v)", contractTestRuns+1, len(runs), err)
	}
	if msgs, err := GetChannelMessages(ctx, ch.OID, 0, 0); err != nil || len(msgs) != 1 || msgs[0].ID != msg.ID || msgs[0].Text != "hello" {
		t.Errorf("posted message reads back wrong: %+v (err %v)", msgs, err)
	}

	missing := uuid.NewString()
	if err := AppendRun(ctx, missing, waveobj.Run{ID: uuid.NewString()}); !errors.Is(err, ErrNotFound) {
		t.Errorf("append to a missing channel: err = %v, want not found", err)
	}
	if _, err := PostChannelMessage(ctx, missing, NewChannelMessage("human", "you", "x", "", 1)); !errors.Is(err, ErrNotFound) {
		t.Errorf("post to a missing channel: err = %v, want not found", err)
	}

	// measured, not asserted: the write cost no longer follows the channel's history
	start := time.Now()
	for i := range contractTestBurst {
		if err := UpdateRun(ctx, ch.OID, runIds[i], func(r *waveobj.Run) error {
			r.Status = "executing"
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	updates := time.Since(start)
	start = time.Now()
	for i := range contractTestBurst {
		if _, err := PostChannelMessage(ctx, ch.OID, NewChannelMessage("human", "you", fmt.Sprintf("m%d", i), "", int64(i))); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("%d UpdateRun in %v, %d PostChannelMessage in %v, on a channel of %d runs", contractTestBurst, updates, contractTestBurst, time.Since(start), contractTestRuns)
}
