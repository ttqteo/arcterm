// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	agentsTestTabA = "aaaaaaaa-1111-4111-8111-111111111111"
	agentsTestTabB = "bbbbbbbb-2222-4222-8222-222222222222"
	agentsTestTabC = "cccccccc-3333-4333-8333-333333333333"
	agentsTestRun  = "0f9e8d7c-6b5a-4433-8221-100000000000"
)

func agentsTestRoster() []wshrpc.AgentInfo {
	return []wshrpc.AgentInfo{
		{TabId: agentsTestTabA, Name: "design lead", ProjectPath: `C:\work\arc`, Project: "arc", RunId: agentsTestRun, Harness: "claude", State: wshrpc.AgentsState_Idle},
		{TabId: agentsTestTabB, Name: "scratch", ProjectPath: `C:\work\arc\pkg`, Project: "arc", Harness: "pi", State: wshrpc.AgentsState_Working},
		{TabId: agentsTestTabC, Name: "siem", ProjectPath: `C:\work\arc-siem`, Project: "arc-siem", Harness: "claude", State: wshrpc.AgentsState_Asking},
	}
}

func agentsTabIds(rows []wshrpc.AgentInfo) []string {
	ids := []string{}
	for _, r := range rows {
		ids = append(ids, r.TabId)
	}
	return ids
}

func TestAgentsListLines(t *testing.T) {
	lines := agentsListLines(agentsTestRoster(), false)
	want := [][]string{
		{"aaaaaaaa", "design", "lead", "arc", "0f9e8d7c", "claude", "idle"},
		{"bbbbbbbb", "scratch", "arc", "-", "pi", "working"},
		{"cccccccc", "siem", "arc-siem", "-", "claude", "asking"},
	}
	if len(lines) != len(want) {
		t.Fatalf("got %d lines, want %d: %q", len(lines), len(want), lines)
	}
	for i, line := range lines {
		if got := strings.Fields(line); !reflect.DeepEqual(got, want[i]) {
			t.Errorf("line %d = %q, want fields %q", i, line, want[i])
		}
	}
}

func TestAgentsListEmptyRoster(t *testing.T) {
	if got := agentsListLines(nil, false); !reflect.DeepEqual(got, []string{"no live agents"}) {
		t.Errorf("unfiltered empty roster = %q", got)
	}
	got := agentsListLines(nil, true)
	if len(got) != 1 || !strings.Contains(got[0], "no live agents") || !strings.Contains(got[0], "wsh agents list --all") {
		t.Errorf("filtered empty roster = %q, want one line naming --all", got)
	}
}

func TestAgentsListProjectFilter(t *testing.T) {
	roster := agentsTestRoster()
	cases := []struct {
		name    string
		project string
		want    []string
	}{
		// the registry and git spell the same path differently; arc-siem shares a name prefix and is outside
		{"inside the caller's project", "C:/work/arc", []string{agentsTestTabA, agentsTestTabB}},
		{"no agent in the caller's project", `C:\work\other`, []string{}},
		{"caller in no project", "", []string{agentsTestTabA, agentsTestTabB, agentsTestTabC}},
	}
	for _, tc := range cases {
		if got := agentsTabIds(agentsInProject(roster, tc.project)); !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%s: kept %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestAgentsListJSON(t *testing.T) {
	empty, err := json.Marshal(agentsInProject(nil, "C:/work/arc"))
	if err != nil || string(empty) != "[]" {
		t.Fatalf("no rows marshals to %s (%v), want []", empty, err)
	}
	b, err := json.Marshal(agentsInProject(agentsTestRoster(), "C:/work/arc"))
	if err != nil {
		t.Fatal(err)
	}
	var rows []map[string]any
	if err := json.Unmarshal(b, &rows); err != nil {
		t.Fatalf("not a JSON array: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("got %d rows, want 2", len(rows))
	}
	want := map[string]any{
		"tabid": agentsTestTabA, "name": "design lead", "projectpath": `C:\work\arc`, "project": "arc",
		"runid": agentsTestRun, "harness": "claude", "state": "idle",
	}
	if !reflect.DeepEqual(rows[0], want) {
		t.Errorf("row = %v, want %v", rows[0], want)
	}
}

func TestAgentsSendText(t *testing.T) {
	dir := t.TempDir()
	write := func(name, body string) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		return p
	}
	filled, blank := write("msg.md", "from the file\n"), write("blank.md", " \n\t\n")
	cases := []struct {
		name    string
		args    []string
		file    string
		want    string
		wantErr string
	}{
		{name: "argument only", args: []string{"do the thing"}, want: "do the thing"},
		{name: "file only", file: filled, want: "from the file\n"},
		{name: "both", args: []string{"do the thing"}, file: filled, wantErr: "one of them"},
		{name: "neither", wantErr: "one of them"},
		{name: "blank argument", args: []string{"  "}, wantErr: "empty"},
		{name: "blank file", file: blank, wantErr: "empty"},
		{name: "missing file", file: filepath.Join(dir, "nope.md"), wantErr: "reading --file"},
	}
	for _, tc := range cases {
		got, err := agentsSendText(tc.args, tc.file)
		if tc.wantErr != "" {
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("%s: err = %v, want one containing %q", tc.name, err, tc.wantErr)
			}
			continue
		}
		if err != nil || got != tc.want {
			t.Errorf("%s: got %q, %v; want %q", tc.name, got, err, tc.want)
		}
	}
}

func TestAgentsSendTextLines(t *testing.T) {
	started := agentsSendLines(&wshrpc.CommandAgentsSendRtnData{TabId: agentsTestTabA})
	joined := agentsSendLines(&wshrpc.CommandAgentsSendRtnData{TabId: agentsTestTabA, MidTurn: true})
	if !strings.Contains(started[0], "aaaaaaaa") || !strings.Contains(started[0], "started a turn") {
		t.Errorf("idle target: %q", started)
	}
	if !strings.Contains(joined[0], "joined") {
		t.Errorf("mid-turn target: %q", joined)
	}
	if started[len(started)-1] != "read the answer with: wsh agents read aaaaaaaa" {
		t.Errorf("read line: %q", started)
	}
}

const agentsTestSentTs = int64(1_000_000)

// agentsWaitScript runs agentsWait over scripted reads (the last one repeats) with a clock that only
// sleeping moves, and reports how many reads it took
func agentsWaitScript(t *testing.T, timeout time.Duration, reads ...wshrpc.CommandAgentsReadRtnData) (*wshrpc.CommandAgentsReadRtnData, int, error) {
	t.Helper()
	clock := time.UnixMilli(agentsTestSentTs)
	n := 0
	read := func() (*wshrpc.CommandAgentsReadRtnData, error) {
		r := reads[min(n, len(reads)-1)]
		r.TabId = agentsTestTabA
		n++
		return &r, nil
	}
	sleep := func(d time.Duration) {
		if d != agentsWaitPoll {
			t.Fatalf("slept %s, want the poll interval %s", d, agentsWaitPoll)
		}
		clock = clock.Add(d)
	}
	sent := &wshrpc.CommandAgentsSendRtnData{TabId: agentsTestTabA, SentTs: agentsTestSentTs}
	r, err := agentsWait(read, sleep, func() time.Time { return clock }, sent, timeout)
	return r, n, err
}

func TestAgentsWaitReturnsTheNewAnswer(t *testing.T) {
	r, n, err := agentsWaitScript(t, time.Minute,
		wshrpc.CommandAgentsReadRtnData{State: wshrpc.AgentsState_Working, Answer: "old", AnswerTs: agentsTestSentTs - 5},
		wshrpc.CommandAgentsReadRtnData{State: wshrpc.AgentsState_Working, Answer: "partial", AnswerTs: agentsTestSentTs + 5},
		wshrpc.CommandAgentsReadRtnData{State: wshrpc.AgentsState_Idle, Answer: "done", AnswerTs: agentsTestSentTs + 9},
	)
	if err != nil || n != 3 {
		t.Fatalf("reads = %d, err = %v; want 3 reads and no error", n, err)
	}
	if got := agentsWaitLines(r); !reflect.DeepEqual(got, []string{"done"}) {
		t.Errorf("printed %q, want the answer", got)
	}
}

func TestAgentsWaitKeepsWaitingOnAnOlderAnswer(t *testing.T) {
	// the target reads idle until it picks the message up, and its last answer is from before the send
	stale := wshrpc.CommandAgentsReadRtnData{State: wshrpc.AgentsState_Idle, Answer: "old", AnswerTs: agentsTestSentTs}
	r, n, err := agentsWaitScript(t, time.Minute, stale, stale,
		wshrpc.CommandAgentsReadRtnData{State: wshrpc.AgentsState_Idle, Answer: "new", AnswerTs: agentsTestSentTs + 1})
	if err != nil || n != 3 || r.Answer != "new" {
		t.Fatalf("reads = %d, answer = %+v, err = %v; want the third read's answer", n, r, err)
	}
}

func TestAgentsWaitEndsOnAsking(t *testing.T) {
	r, n, err := agentsWaitScript(t, time.Minute,
		wshrpc.CommandAgentsReadRtnData{State: wshrpc.AgentsState_Working},
		wshrpc.CommandAgentsReadRtnData{State: wshrpc.AgentsState_Asking, Answer: "old", AnswerTs: agentsTestSentTs - 5},
	)
	if err != nil || n != 2 {
		t.Fatalf("reads = %d, err = %v; want the wait to end on the second read", n, err)
	}
	lines := agentsWaitLines(r)
	if len(lines) != 1 || !strings.Contains(lines[0], "waiting on the user") || strings.Contains(lines[0], "old") {
		t.Errorf("printed %q, want one line saying the target waits on the user", lines)
	}
}

func TestAgentsWaitTimesOut(t *testing.T) {
	timeout := 3 * agentsWaitPoll
	r, n, err := agentsWaitScript(t, timeout, wshrpc.CommandAgentsReadRtnData{State: wshrpc.AgentsState_Working})
	if r != nil || err == nil {
		t.Fatalf("got %+v, %v; want a timeout error", r, err)
	}
	if !strings.Contains(err.Error(), "still working") || !strings.Contains(err.Error(), "wsh agents read aaaaaaaa") {
		t.Errorf("err = %v, want it to say the target is still working and how to read later", err)
	}
	if n != 4 {
		t.Errorf("reads = %d, want 4 (one at the start, one per poll until the timeout)", n)
	}
}

func TestAgentsWaitReturnsAReadError(t *testing.T) {
	boom := errors.New("is not a live agent session")
	read := func() (*wshrpc.CommandAgentsReadRtnData, error) { return nil, boom }
	sleep := func(time.Duration) { t.Fatal("slept after a failed read") }
	_, err := agentsWait(read, sleep, time.Now, &wshrpc.CommandAgentsSendRtnData{TabId: agentsTestTabA}, time.Minute)
	if !errors.Is(err, boom) {
		t.Errorf("err = %v, want the read's error as it came", err)
	}
}

func TestAgentsReadLines(t *testing.T) {
	answered := agentsReadLines(&wshrpc.CommandAgentsReadRtnData{TabId: agentsTestTabA, State: wshrpc.AgentsState_Idle, Answer: "line one\nline two", AnswerTs: 5})
	if !reflect.DeepEqual(answered, []string{"line one\nline two"}) {
		t.Errorf("with an answer: %q", answered)
	}
	none := agentsReadLines(&wshrpc.CommandAgentsReadRtnData{TabId: agentsTestTabA, State: wshrpc.AgentsState_Working})
	if len(none) != 1 || !strings.Contains(none[0], "has not answered yet") || !strings.Contains(none[0], "working") || !strings.Contains(none[0], "aaaaaaaa") {
		t.Errorf("without an answer: %q", none)
	}
}
