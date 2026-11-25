// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentpair

import (
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	docWorkerTab = "w0w0w0w0-1111"
	docJudgeA    = "4c6ba858-aaaa"
	docJudgeB    = "9d1e0b77-bbbb"
)

// docTime is hh:mm of the test day in the pinned zone, as a message's ms timestamp.
func docTime(loc *time.Location, h, m int) int64 {
	return time.Date(2026, 11, 25, h, m, 0, 0, loc).UnixMilli()
}

// docView is a pair of two judges with a person's message to one of them, a quoted reply, a held command let through
// and every Decided section.
func docView(loc *time.Location) *wshrpc.PairView {
	return &wshrpc.PairView{
		PairInfo: wshrpc.PairInfo{
			Id:      "3f9a1c2e-0000-4000-8000-000000000001",
			Project: "D:/proj",
			Worker:  wshrpc.PairSide{Tab: docWorkerTab, Name: "Plan oracle", Harness: "claude"},
			Judges: []wshrpc.PairSide{
				{Tab: docJudgeA, Name: "judge a", Harness: "claude"},
				{Tab: docJudgeB, Name: "judge b", Harness: "pi"},
			},
			State:      StateStopped,
			StopReason: StopSettled,
			UpdatedTs:  docTime(loc, 11, 0),
		},
		TokenCap: 3_000_000,
		Tokens:   1_240_000,
		Messages: []wshrpc.PairMessage{
			{Id: "m1", From: FromWorker, Tab: docWorkerTab, Ts: docTime(loc, 10, 0), Text: "Plan is ready.\nTwo steps.", Held: []wshrpc.PairHeld{}},
			{Id: "m2", From: FromJudge, Tab: docJudgeA, Ts: docTime(loc, 10, 5), Text: "Step two has no owner.", Quote: "Plan is ready.", ReplyTo: "m1", Held: []wshrpc.PairHeld{}},
			{Id: "m3", From: FromPerson, Ts: docTime(loc, 10, 6), Text: "Judge a, check the owner.", To: docJudgeA, Held: []wshrpc.PairHeld{}},
			{Id: "m4", From: FromWorker, Tab: docWorkerTab, Ts: docTime(loc, 10, 10), Text: "Owner set.", Held: []wshrpc.PairHeld{
				{Command: "go test ./...", Ts: docTime(loc, 10, 8), RunTs: docTime(loc, 10, 9)},
				{Command: "npm run build", Ts: docTime(loc, 10, 8)},
			}},
			{Id: "m5", From: FromSystem, Ts: docTime(loc, 10, 12), Text: "Both sides settled.", Held: []wshrpc.PairHeld{}},
		},
		Decided: wshrpc.PairDecided{
			Agreed: []wshrpc.PairItem{
				{Num: 1, Kind: KindAgreed, Text: "Lock the threshold"},
				{Num: 3, Kind: KindAgreed, Text: "Name an owner for step two"},
			},
			Asks: []wshrpc.PairItem{
				{Num: 4, Kind: KindAsks, Text: "Is 50% fine?", Answer: "Yes"},
				{Num: 5, Kind: KindAsks, Text: "Which dataset?"},
			},
			Open: []wshrpc.PairItem{
				{Num: 2, Kind: KindOpen, Text: "Pilot cases outside the split", ReopenedBy: docJudgeA},
				{Kind: KindOpen, Text: "Log the seed", NewBy: docJudgeB},
				{Num: 6, Kind: KindOpen, Text: "Write the report"},
			},
		},
	}
}

func TestDocumentPrintsTheThreadAndEveryDecidedSection(t *testing.T) {
	loc := time.FixedZone("test", 7*3600)
	got := Document(docView(loc), loc)
	want := "# Pair 3f9a1c2e · Plan oracle · judge 4c6ba858, 9d1e0b77\n" +
		"Project: D:/proj · stopped: both sides settled · 1.2M of 3.0M tokens\n" +
		"\n" +
		"[10:00] Worker → Judges\n" +
		"Plan is ready.\n" +
		"Two steps.\n" +
		"\n" +
		"[10:05] Judge 4c6ba858 → Worker\n" +
		"> Plan is ready.\n" +
		"Step two has no owner.\n" +
		"\n" +
		"[10:06] You → Judge 4c6ba858\n" +
		"Judge a, check the owner.\n" +
		"\n" +
		"[10:10] Worker → Judges\n" +
		"Owner set.\n" +
		"  held: go test ./... (let through 10:09)\n" +
		"  held: npm run build\n" +
		"\n" +
		"[10:12] System\n" +
		"Both sides settled.\n" +
		"\n" +
		"## Decided\n" +
		"\n" +
		"### Agreed\n" +
		"1. Lock the threshold\n" +
		"3. Name an owner for step two\n" +
		"\n" +
		"### Your answers\n" +
		"- Is 50% fine? → Yes\n" +
		"\n" +
		"### Still open\n" +
		"- Pilot cases outside the split (reopened by Judge 4c6ba858)\n" +
		"- Log the seed (new point from Judge 9d1e0b77)\n" +
		"- Write the report\n"
	if got != want {
		t.Fatalf("Document =\n%s\nwant\n%s", got, want)
	}
}

func TestDocumentSyncedEndedPairWithNothingDecided(t *testing.T) {
	loc := time.FixedZone("test", 7*3600)
	v := &wshrpc.PairView{
		PairInfo: wshrpc.PairInfo{
			Id:        "aabbccdd-1",
			Project:   "D:/proj",
			Worker:    wshrpc.PairSide{Tab: docWorkerTab, Name: "Plan oracle"},
			Judges:    []wshrpc.PairSide{{Tab: docJudgeA, Name: "judge a"}},
			State:     StateEnded,
			UpdatedTs: time.Date(2026, 11, 24, 18, 30, 0, 0, loc).UnixMilli(),
			Synced:    true,
		},
		TokenCap: 3_000_000,
		Tokens:   512,
		Messages: []wshrpc.PairMessage{
			{Id: "m1", From: FromWorker, Tab: docWorkerTab, Ts: docTime(loc, 9, 30), Text: "Hello", Held: []wshrpc.PairHeld{}},
			{Id: "m2", From: FromPerson, Ts: docTime(loc, 9, 31), Text: "Carry on", To: ToBoth, Held: []wshrpc.PairHeld{}},
			{Id: "m3", From: FromPerson, Ts: docTime(loc, 9, 32), Text: "Worker only", To: ToWorker, Held: []wshrpc.PairHeld{}},
			{Id: "m4", From: FromPerson, Ts: docTime(loc, 9, 33), Text: "Judge only", To: ToJudge, Held: []wshrpc.PairHeld{}},
		},
	}
	got := Document(v, loc)
	want := "# Pair aabbccdd · Plan oracle · judge 4c6ba858\n" +
		"Project: D:/proj · ended · 512 of 3.0M tokens\n" +
		"Synced from another machine; as of 2026-11-24 18:30\n" +
		"\n" +
		"[09:30] Worker → Judge\n" +
		"Hello\n" +
		"\n" +
		"[09:31] You → Both\n" +
		"Carry on\n" +
		"\n" +
		"[09:32] You → Worker\n" +
		"Worker only\n" +
		"\n" +
		"[09:33] You → Judge\n" +
		"Judge only\n" +
		"\n" +
		"## Decided\n" +
		"\n" +
		"### Agreed\n" +
		"(none)\n" +
		"\n" +
		"### Your answers\n" +
		"(none)\n" +
		"\n" +
		"### Still open\n" +
		"(none)\n"
	if got != want {
		t.Fatalf("Document =\n%s\nwant\n%s", got, want)
	}
}

func TestDocumentStateWords(t *testing.T) {
	loc := time.UTC
	cases := []struct {
		state, reason, want string
	}{
		{StateRelaying, "", "relaying"},
		{StateStopped, StopSettled, "stopped: both sides settled"},
		{StateStopped, StopTokenCap, "stopped: token cap reached"},
		{StateStopped, StopNoNewPoints, "stopped: no new points"},
		{StateStopped, StopJudgesGone, "stopped: judges gone"},
		{StateStopped, "", "stopped"},
		{StateEnded, "", "ended"},
		// a pair that stopped and was then ended keeps why it stopped
		{StateEnded, StopTokenCap, "ended · stopped: token cap reached"},
	}
	for _, c := range cases {
		v := &wshrpc.PairView{PairInfo: wshrpc.PairInfo{Id: "abcdef012345", State: c.state, StopReason: c.reason}}
		line := "Project:  · " + c.want + " · 0 of 0 tokens\n"
		if got := Document(v, loc); !strings.Contains(got, "\n"+line) {
			t.Errorf("state %q reason %q: Document =\n%s\nwant a line %q", c.state, c.reason, got, line)
		}
	}
}
