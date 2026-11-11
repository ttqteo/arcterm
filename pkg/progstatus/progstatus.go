// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package progstatus reads the Program Status Protocol (OSC 7501) out of a terminal's output: a program asks
// whether the terminal takes it (`OSC 7501 ; ? ST`), and once answered reports what it is doing
// (`OSC 7501 ; state=working:app=claude-code ST`). Claude Code reports since v2.1.295 when the terminal answers its
// probe. arcterm answers it in wavesrv, where the PTY's output is read, and keeps the reports as a second signal
// beside the agent hooks: one the cockpit falls back on when the hooks fall silent (a killed wsh, a hook another
// plugin skips). Spec: https://www.superlogical.com/rex/docs/build/program-status
package progstatus

import (
	"bytes"
	"strconv"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

// Reply is the terminal's answer to the probe: supported, with the default states and kinds. It is the only thing
// the protocol ever writes back to the program.
const Reply = "\x1b]7501;?\x1b\\"

// QuietMs is how long the hooks must have said nothing on either side of a reported change before the cockpit
// takes the report instead: a working hook reports every change the program makes within a second or so.
const QuietMs = 10_000

const (
	// maxSeq is the longest sequence the spec allows; a longer one is discarded whole
	maxSeq   = 4096
	maxKey   = 16
	maxApp   = 32
	maxID    = 128
	introLen = len(intro)
	intro    = "\x1b]7501;"
)

var states = map[string]bool{"idle": true, "working": true, "done": true, "blocked": true, "error": true, "clear": true}

var kinds = map[string]bool{"permission": true, "question": true, "auth": true}

// Report is one status report. Progress is -1 when the program gave none.
type Report struct {
	State    string
	Kind     string // set only on blocked
	ID       string // "" is the root record
	App      string
	Progress int
}

// Event is what one complete sequence was: the probe, or a report.
type Event struct {
	Probe  bool
	Report *Report
}

// Scanner finds the sequences in a stream of output chunks. A sequence split across chunks is held until it ends.
type Scanner struct {
	pending []byte
}

// Feed reads one chunk of output and returns the sequences it completed. It never keeps a reference to chunk.
func (s *Scanner) Feed(chunk []byte) []Event {
	data := chunk
	if len(s.pending) > 0 {
		data = append(s.pending, chunk...)
		s.pending = nil
	}
	var events []Event
	for len(data) > 0 {
		i := bytes.Index(data, []byte(intro))
		if i < 0 {
			s.keep(data[len(data)-partialIntro(data):])
			break
		}
		body := data[i+introLen:]
		end, after := terminator(body)
		if end < 0 {
			if len(data)-i <= maxSeq {
				s.keep(data[i:])
			}
			break
		}
		// after == end: another escape cut the sequence off, and what follows is read as output again
		if after > end && introLen+after <= maxSeq {
			if ev, ok := parse(string(body[:end])); ok {
				events = append(events, ev)
			}
		}
		data = body[after:]
	}
	return events
}

func (s *Scanner) keep(b []byte) {
	if len(b) > 0 {
		s.pending = append([]byte(nil), b...)
	}
}

// partialIntro is the length of data's longest suffix that could be the start of an introducer
func partialIntro(data []byte) int {
	for n := min(len(data), introLen-1); n > 0; n-- {
		if bytes.HasPrefix([]byte(intro), data[len(data)-n:]) {
			return n
		}
	}
	return 0
}

// terminator finds the end of a sequence's body: BEL or ST (ESC \). It returns where the body ends and where the
// output after the terminator starts (the same place when another escape cut the body off), or -1 when the body
// has not ended yet.
func terminator(body []byte) (end, after int) {
	for i := 0; i < len(body); i++ {
		switch body[i] {
		case 0x07:
			return i, i + 1
		case 0x1b:
			if i+1 == len(body) {
				return -1, 0
			}
			if body[i+1] == '\\' {
				return i, i + 2
			}
			// another escape before the end: the sequence was cut off, so drop it
			return i, i
		}
	}
	return -1, 0
}

func parse(body string) (Event, bool) {
	if strings.HasPrefix(strings.TrimSpace(body), "?") {
		return Event{Probe: true}, true
	}
	pairs := map[string]string{}
	for _, pair := range strings.Split(body, ":") {
		key, value, ok := strings.Cut(pair, "=")
		key, value = strings.TrimSpace(key), strings.TrimSpace(value)
		if !ok || !validKey(key) || !validValue(value) {
			continue
		}
		pairs[key] = value
	}
	r := Report{State: pairs["state"], ID: pairs["id"], App: pairs["app"], Progress: -1}
	if !states[r.State] || len(r.App) > maxApp || len(r.ID) > maxID {
		return Event{}, false
	}
	if r.State == "blocked" && kinds[pairs["kind"]] {
		r.Kind = pairs["kind"]
	}
	if p, err := strconv.Atoi(pairs["progress"]); err == nil && p >= 0 && p <= 100 {
		r.Progress = p
	}
	return Event{Report: &r}, true
}

func validKey(k string) bool {
	if k == "" || len(k) > maxKey {
		return false
	}
	for _, c := range k {
		if c < 'a' || c > 'z' {
			return false
		}
	}
	return true
}

func validValue(v string) bool {
	for _, c := range v {
		ok := c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || strings.ContainsRune("_.,+/=-", c)
		if !ok {
			return false
		}
	}
	return true
}

// AgentState is the cockpit state a report stands for: blocked is asking, and idle, done and error are all idle.
// "" for clear, which names no state.
func AgentState(r Report) string {
	switch r.State {
	case "working":
		return baseds.AgentState_Working
	case "blocked":
		return baseds.AgentState_Asking
	case "idle", "done", "error":
		return baseds.AgentState_Idle
	}
	return ""
}

// Fallback is the state the cockpit should take from a root report made at reportMs, checked at nowMs, when the
// block's newest hook report is latest; "" when it should not. It takes over only for an agent the hooks reported
// before (a plain terminal running a program that reports never becomes an agent), only when the report says
// something else than the hooks last did, and only when the hooks said nothing for QuietMs on either side of the
// change: a hook that reports the change itself, even one that deliberately reads it otherwise (an agent kept
// working while its background work runs), always wins.
func Fallback(r Report, reportMs int64, latest baseds.AgentStatusData, nowMs int64) string {
	state := AgentState(r)
	switch {
	case r.ID != "", state == "", latest.State == "", latest.State == state:
		return ""
	case reportMs-latest.Ts < QuietMs, nowMs-reportMs < QuietMs:
		return ""
	}
	return state
}
