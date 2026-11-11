// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package progstatus

import (
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

func feedAll(chunks ...string) []Event {
	var s Scanner
	var got []Event
	for _, c := range chunks {
		got = append(got, s.Feed([]byte(c))...)
	}
	return got
}

func report(state string) Event {
	return Event{Report: &Report{State: state, Progress: -1}}
}

func TestScannerFindsTheProbe(t *testing.T) {
	for name, out := range map[string]string{
		"ST":                "\x1b]7501;?\x1b\\",
		"BEL":               "\x1b]7501;?\x07",
		"amid other output": "hello\x1b[1m\x1b]7501;?\x1b\\\x1b[c world",
	} {
		if got := feedAll(out); !reflect.DeepEqual(got, []Event{{Probe: true}}) {
			t.Errorf("%s: got %+v, want the probe", name, got)
		}
	}
}

func TestScannerReadsReports(t *testing.T) {
	got := feedAll("\x1b]7501;state=blocked:kind=permission:app=claude-code:msg=QWxsb3c/\x1b\\")
	want := []Event{{Report: &Report{State: "blocked", Kind: "permission", App: "claude-code", Progress: -1}}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	got = feedAll("\x1b]7501; state = working : progress=40 : id=build/test \x07")
	want = []Event{{Report: &Report{State: "working", ID: "build/test", Progress: 40}}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("spaces, progress and id: got %+v, want %+v", got, want)
	}
}

func TestScannerHoldsASequenceSplitAcrossChunks(t *testing.T) {
	whole := "out\x1b]7501;state=working:app=claude-code\x1b\\more"
	for cut := 1; cut < len(whole); cut++ {
		got := feedAll(whole[:cut], whole[cut:])
		want := []Event{{Report: &Report{State: "working", App: "claude-code", Progress: -1}}}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("cut at %d (%q | %q): got %+v, want %+v", cut, whole[:cut], whole[cut:], got, want)
		}
	}
	// split across three chunks, the terminator's ESC and \ apart
	if got := feedAll("\x1b]75", "01;state=idle\x1b", "\\"); !reflect.DeepEqual(got, []Event{report("idle")}) {
		t.Fatalf("three chunks: got %+v", got)
	}
}

func TestScannerSkipsWhatTheSpecRefuses(t *testing.T) {
	for name, out := range map[string]string{
		"unknown state":          "\x1b]7501;state=sleeping\x1b\\",
		"no state":               "\x1b]7501;app=claude-code\x1b\\",
		"other osc":              "\x1b]7502;state=idle\x1b\\\x1b]0;title\x07",
		"app over 32 bytes":      "\x1b]7501;state=idle:app=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\x1b\\",
		"cut off by another esc": "\x1b]7501;state=idle\x1b[0m",
	} {
		if got := feedAll(out); len(got) != 0 {
			t.Errorf("%s: got %+v, want nothing", name, got)
		}
	}
	// a malformed pair (no =, an upper-case key, a value with a space) is skipped, the rest still counts; the last of
	// a repeated key wins
	if got := feedAll("\x1b]7501;bogus:state=working:state=done:Key=x:app=two words\x1b\\"); !reflect.DeepEqual(got, []Event{report("done")}) {
		t.Errorf("malformed and repeated: got %+v, want done", got)
	}
	// the escape that cut a sequence off is read as output again: a report right after it still counts
	if got := feedAll("\x1b]7501;state=idle\x1b]7501;state=working\x07"); !reflect.DeepEqual(got, []Event{report("working")}) {
		t.Errorf("cut off then a report: got %+v, want working", got)
	}
	// kind is read on blocked only
	if got := feedAll("\x1b]7501;state=idle:kind=permission\x1b\\"); !reflect.DeepEqual(got, []Event{report("idle")}) {
		t.Errorf("kind on idle: got %+v, want no kind", got)
	}
}

func TestScannerDropsAnOverlongSequence(t *testing.T) {
	var s Scanner
	long := "\x1b]7501;state=working:title="
	for len(long) < maxSeq+10 {
		long += "QUFB"
	}
	if got := s.Feed([]byte(long)); len(got) != 0 {
		t.Fatalf("got %+v", got)
	}
	if len(s.pending) != 0 {
		t.Fatalf("held %d bytes of a sequence past the limit", len(s.pending))
	}
	// the stream goes on reading after it
	if got := s.Feed([]byte("\x1b\\\x1b]7501;state=idle\x07")); !reflect.DeepEqual(got, []Event{report("idle")}) {
		t.Fatalf("after the long one: got %+v", got)
	}
}

func TestScannerDoesNotKeepTheCallersBuffer(t *testing.T) {
	var s Scanner
	buf := []byte("\x1b]7501;state=wor")
	s.Feed(buf)
	copy(buf, "xxxxxxxxxxxxxxxx")
	if got := s.Feed([]byte("king\x1b\\")); !reflect.DeepEqual(got, []Event{report("working")}) {
		t.Fatalf("got %+v: the held part changed with the caller's buffer", got)
	}
}

func TestAgentState(t *testing.T) {
	for state, want := range map[string]string{
		"working": baseds.AgentState_Working,
		"blocked": baseds.AgentState_Asking,
		"idle":    baseds.AgentState_Idle,
		"done":    baseds.AgentState_Idle,
		"error":   baseds.AgentState_Idle,
		"clear":   "",
	} {
		if got := AgentState(Report{State: state}); got != want {
			t.Errorf("%s: got %q, want %q", state, got, want)
		}
	}
}

func TestFallback(t *testing.T) {
	const at = int64(1_000_000)
	hooks := func(state string, ts int64) baseds.AgentStatusData {
		return baseds.AgentStatusData{State: state, Ts: ts}
	}
	idle := Report{State: "done"}
	// the hooks went quiet a while before the turn ended and said nothing since: the report is taken
	if got := Fallback(idle, at, hooks(baseds.AgentState_Working, at-60_000), at+QuietMs); got != baseds.AgentState_Idle {
		t.Fatalf("quiet hooks: got %q, want idle", got)
	}
	for name, tc := range map[string]struct {
		r      Report
		latest baseds.AgentStatusData
		now    int64
	}{
		"a hook reported the change after it":        {idle, hooks(baseds.AgentState_Working, at+200), at + QuietMs},
		"a hook reported just before it (kept busy)": {idle, hooks(baseds.AgentState_Working, at-300), at + QuietMs},
		"too soon to tell":                           {idle, hooks(baseds.AgentState_Working, at-60_000), at + QuietMs - 1},
		"the hooks already say so":                   {idle, hooks(baseds.AgentState_Idle, at-60_000), at + QuietMs},
		"never an agent":                             {idle, baseds.AgentStatusData{}, at + QuietMs},
		"a child record":                             {Report{State: "done", ID: "build"}, hooks(baseds.AgentState_Working, at-60_000), at + QuietMs},
		"clear":                                      {Report{State: "clear"}, hooks(baseds.AgentState_Working, at-60_000), at + QuietMs},
	} {
		if got := Fallback(tc.r, at, tc.latest, tc.now); got != "" {
			t.Errorf("%s: got %q, want nothing", name, got)
		}
	}
}
