// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func TestGetChannelRunsAndMessagesCommands(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	ch, err := wstore.CreateChannel(ctx, "rpc", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if err := wstore.AppendRun(ctx, ch.OID, waveobj.Run{ID: "r1", Goal: "g", Status: "planning", CreatedTs: 1}); err != nil {
		t.Fatalf("append run: %v", err)
	}
	if _, err := wstore.PostChannelMessage(ctx, ch.OID, wstore.NewChannelMessage("human", "you", "hi", "", 5)); err != nil {
		t.Fatalf("post msg: %v", err)
	}
	runsRtn, err := ws.GetChannelRunsCommand(ctx, wshrpc.CommandGetChannelRunsData{ChannelId: ch.OID})
	if err != nil || len(runsRtn.Runs) != 1 || runsRtn.Runs[0].ID != "r1" {
		t.Fatalf("GetChannelRuns wrong: %+v err=%v", runsRtn, err)
	}
	held := map[string]int{"r1": runsRtn.Runs[0].Version}
	chgRtn, err := ws.GetChannelRunChangesCommand(ctx, wshrpc.CommandGetChannelRunChangesData{ChannelId: ch.OID, Known: held})
	if err != nil || len(chgRtn.RunIds) != 1 || chgRtn.RunIds[0] != "r1" || len(chgRtn.Runs) != 0 {
		t.Fatalf("GetChannelRunChanges with the run held wrong: %+v err=%v", chgRtn, err)
	}
	msgRtn, err := ws.GetChannelMessagesCommand(ctx, wshrpc.CommandGetChannelMessagesData{ChannelId: ch.OID})
	if err != nil || len(msgRtn.Messages) != 1 || msgRtn.Messages[0].Text != "hi" {
		t.Fatalf("GetChannelMessages wrong: %+v err=%v", msgRtn, err)
	}
}

func TestGetAttentionCommandSeesAHeldLandInAnyChannel(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	ch, err := wstore.CreateChannel(ctx, "attn", "/p")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	run := waveobj.Run{
		ID: "r-held", Goal: "refactor auth", Status: "done", CreatedTs: 1, CompletedTs: 700,
		Land: &waveobj.RunLand{State: "held", Reason: "dirty"},
	}
	if err := wstore.AppendRun(ctx, ch.OID, run); err != nil {
		t.Fatalf("append run: %v", err)
	}

	rtn, err := ws.GetAttentionCommand(ctx)
	if err != nil {
		t.Fatalf("GetAttention: %v", err)
	}
	var found *wshrpc.AttentionItem
	for i := range rtn.Items {
		if rtn.Items[i].RunId == "r-held" && rtn.Items[i].Kind == "run-land-held" {
			found = &rtn.Items[i]
		}
	}
	if found == nil {
		t.Fatalf("held land not reported: %+v", rtn.Items)
	}
	if found.ChannelId != ch.OID || found.WaitingSince != 700 {
		t.Fatalf("wrong held-land item: %+v", *found)
	}
}

func TestCreateChannelCommandIsIdempotentPerProject(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	first, err := ws.CreateChannelCommand(ctx, wshrpc.CommandCreateChannelData{Name: "wave", ProjectPath: "/repo/wave"})
	if err != nil {
		t.Fatalf("first CreateChannelCommand: %v", err)
	}
	second, err := ws.CreateChannelCommand(ctx, wshrpc.CommandCreateChannelData{Name: "wave again", ProjectPath: "/repo/wave/"})
	if err != nil {
		t.Fatalf("second CreateChannelCommand: %v", err)
	}
	if second.OID != first.OID {
		t.Fatalf("second create made a new channel %s, want the existing %s", second.OID, first.OID)
	}
	// the existing channel is returned as it stands: a second create does not rename it
	if second.Name != "wave" {
		t.Fatalf("second create renamed the channel to %q, want %q", second.Name, "wave")
	}
}

func TestCreateChannelCommandStillCreatesWithoutAProject(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	a, err := ws.CreateChannelCommand(ctx, wshrpc.CommandCreateChannelData{Name: "scratch one"})
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	b, err := ws.CreateChannelCommand(ctx, wshrpc.CommandCreateChannelData{Name: "scratch two"})
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if a.OID == b.OID {
		t.Fatalf("two pathless channels collapsed onto %s; a pathless channel is not a project", a.OID)
	}
}

func channelsAt(t *testing.T, path string) int {
	t.Helper()
	chans, err := wstore.GetChannels(context.Background())
	if err != nil {
		t.Fatalf("GetChannels: %v", err)
	}
	n := 0
	for _, ch := range chans {
		if wstore.MatchChannelAtPath([]*waveobj.Channel{ch}, path) != nil {
			n++
		}
	}
	return n
}

func TestSyncProjectChannelsGivesEachRegisteredProjectOneChannel(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	existing, err := ws.CreateChannelCommand(ctx, wshrpc.CommandCreateChannelData{Name: "ran-before", ProjectPath: "/sync/ran-before"})
	if err != nil {
		t.Fatalf("seed channel: %v", err)
	}
	projects := map[string]wconfig.ProjectKeywords{
		"ran-before": {Path: "/sync/ran-before"},
		"never-ran":  {Path: "/sync/never-ran"},
		"no-path":    {},
	}

	SyncProjectChannels(ctx, projects)
	SyncProjectChannels(ctx, projects) // the watcher fires on every config change, so it must be idempotent

	if n := channelsAt(t, "/sync/never-ran"); n != 1 {
		t.Fatalf("never-ran has %d channels, want 1", n)
	}
	if n := channelsAt(t, "/sync/ran-before"); n != 1 {
		t.Fatalf("ran-before has %d channels, want 1 (the existing one)", n)
	}
	got, err := wstore.ChannelAtPath(ctx, "/sync/ran-before")
	if err != nil || got == nil || got.OID != existing.OID {
		t.Fatalf("ran-before's channel = %v (err %v), want the existing %s", got, err, existing.OID)
	}
	created, err := wstore.ChannelAtPath(ctx, "/sync/never-ran")
	if err != nil || created == nil || created.Name != "never-ran" {
		t.Fatalf("never-ran's channel = %v (err %v), want one named after the project", created, err)
	}
}

// A run's update can follow the delete of its channel: there is no row left to send, and no panic.
func TestSendWaveObjUpdateForADeletedRowDoesNothing(t *testing.T) {
	ctx := context.Background()
	ch, err := wstore.CreateChannel(ctx, "deleted-before-update", t.TempDir())
	if err != nil {
		t.Fatalf("CreateChannel: %v", err)
	}
	if err := wstore.DeleteChannel(ctx, ch.OID); err != nil {
		t.Fatalf("DeleteChannel: %v", err)
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, ch.OID))
}

func TestPostChannelMessageCommandStoresItsData(t *testing.T) {
	ctx := context.Background()
	ws := &WshServer{}
	ch, err := wstore.CreateChannel(ctx, "post-data", "")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	const card = `{"askId":"ask-1"}`
	if _, err := ws.PostChannelMessageCommand(ctx, wshrpc.CommandPostChannelMessageData{
		ChannelId: ch.OID, Kind: "jarvis-answered", Author: "jarvis", Text: "Answered", Data: card,
	}); err != nil {
		t.Fatalf("post: %v", err)
	}
	msgs, err := wstore.GetChannelMessages(ctx, ch.OID, 0, 0)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if len(msgs) != 1 || msgs[0].Data != card {
		t.Fatalf("data not stored as given: %+v", msgs)
	}
	if _, err := ws.PostChannelMessageCommand(ctx, wshrpc.CommandPostChannelMessageData{
		ChannelId: ch.OID, Kind: "jarvis-answered", Author: "jarvis", Text: "Answered", Data: "{not json",
	}); err == nil {
		t.Fatal("data that is not JSON must be refused")
	}
}
