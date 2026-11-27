// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package dume

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// Owner is the chunk owner that hands a chunk to DUM-E (`wsh effort chunk owner <effort> <chunk> dum-e`).
const Owner = "dum-e"

// DUM-E's notes on a chunk are its whole state: the newest one says where the chunk is.
const (
	notePrefix  = "DUM-E: "
	startedHead = notePrefix + "started run "
	toLandHead  = notePrefix + "ready to land "
	nothingHead = notePrefix + "nothing committed on "
)

func StartedNote(runId, branch string) string { return startedHead + runId + " on " + branch }
func ToLandNote(branch string, commits int) string {
	return fmt.Sprintf("%s%s (%d commits): git merge %s", toLandHead, branch, commits, branch)
}
func NothingNote(branch string) string {
	return nothingHead + branch + "; set the chunk back to pending to try again"
}

// ParseStarted reads a StartedNote.
func ParseStarted(text string) (runId, branch string, ok bool) {
	rest, found := strings.CutPrefix(text, startedHead)
	if !found {
		return "", "", false
	}
	runId, branch, found = strings.Cut(rest, " on ")
	return runId, branch, found && runId != "" && branch != ""
}

type State int

const (
	StateNone     State = iota // not DUM-E's, or a person took it (active with no DUM-E note)
	StateWaiting               // pending: in line
	StateRunning               // its run is live
	StateFinished              // its run ended; the loop has not checked the branch yet
	StateToLand                // committed on its branch, waiting for the person to land it
	StateBlocked
	StateDone
)

// ClassifyChunk is where a chunk stands for DUM-E. runLive says whether a run id is still going (neither done nor
// cancelled); a run that no longer exists is not live.
func ClassifyChunk(c waveobj.EffortChunk, runLive func(runId string) bool) State {
	if c.Owner != Owner {
		return StateNone
	}
	switch c.Status {
	case "pending":
		return StateWaiting
	case "done":
		return StateDone
	case "blocked":
		return StateBlocked
	case "active":
	default:
		return StateNone
	}
	note := newestNote(c)
	if strings.HasPrefix(note, toLandHead) {
		return StateToLand
	}
	if runId, _, ok := ParseStarted(note); ok {
		if runLive(runId) {
			return StateRunning
		}
		return StateFinished
	}
	return StateNone
}

func newestNote(c waveobj.EffortChunk) string {
	for i := len(c.Notes) - 1; i >= 0; i-- {
		if strings.HasPrefix(c.Notes[i].Text, notePrefix) {
			return c.Notes[i].Text
		}
	}
	return ""
}

// Ref names one DUM-E chunk.
type Ref struct {
	EffortOID   string
	EffortTitle string
	Project     string
	Chunk       string // the chunk's label
	RunId       string // from its newest started note
	Branch      string // ditto
	Notes       []string
}

type Summary struct {
	Waiting  []Ref // in order: the first is next
	Running  []Ref
	Finished []Ref
	ToLand   []Ref
	Blocked  int
	Done     int
}

// refOf is the Ref for one of e's chunks.
func refOf(e *waveobj.Effort, c waveobj.EffortChunk) Ref {
	r := Ref{EffortOID: e.OID, EffortTitle: e.Title, Project: e.Project, Chunk: c.Label}
	for _, n := range c.Notes {
		r.Notes = append(r.Notes, n.Text)
	}
	if id, br, ok := ParseStarted(lastStarted(c)); ok {
		r.RunId, r.Branch = id, br
	}
	return r
}

// Summarize reads DUM-E's queue off the initiatives: only active ones, and a waiting chunk only when its
// initiative names a project (the run needs a checkout). Within one initiative the waiting chunks come in its order
// of work (the highest-ranked first, ties by position: waveobj.ChunkOrderOfWork), so the first of Waiting is the one
// DUM-E takes next; initiatives keep their order. The other queues keep plan order.
func Summarize(efforts []*waveobj.Effort, runLive func(runId string) bool) Summary {
	var s Summary
	for _, e := range efforts {
		if e == nil || e.Status != "active" {
			continue
		}
		for _, c := range e.Chunks {
			st := ClassifyChunk(c, runLive)
			if st == StateNone || st == StateWaiting {
				continue
			}
			r := refOf(e, c)
			switch st {
			case StateRunning:
				s.Running = append(s.Running, r)
			case StateFinished:
				s.Finished = append(s.Finished, r)
			case StateToLand:
				s.ToLand = append(s.ToLand, r)
			case StateBlocked:
				s.Blocked++
			case StateDone:
				s.Done++
			}
		}
		if e.Project == "" {
			continue
		}
		for _, i := range waveobj.ChunkOrderOfWorkOf(e.Chunks) {
			if ClassifyChunk(e.Chunks[i], runLive) == StateWaiting {
				s.Waiting = append(s.Waiting, refOf(e, e.Chunks[i]))
			}
		}
	}
	return s
}

func lastStarted(c waveobj.EffortChunk) string {
	for i := len(c.Notes) - 1; i >= 0; i-- {
		if strings.HasPrefix(c.Notes[i].Text, startedHead) {
			return c.Notes[i].Text
		}
	}
	return ""
}

// Goal is the quick run's goal for a chunk.
func Goal(r Ref) string {
	var b strings.Builder
	fmt.Fprintf(&b, "DUM-E chore for the initiative %q, chunk %q.\n", r.EffortTitle, r.Chunk)
	if len(r.Notes) > 0 {
		b.WriteString("\nThe chunk's notes:\n")
		for _, n := range r.Notes {
			b.WriteString("- " + n + "\n")
		}
	}
	b.WriteString("\nDo the chunk in this checkout and commit on its branch. Do not merge, push or land, and do not " +
		"change the chunk's status: the person lands it. Do not spawn subagents or workflows. If the chunk needs a " +
		"decision only the person can make, write the question as a chunk note (`wsh effort chunk note`) and finish " +
		"without committing.\n")
	return b.String()
}

// TreeKey is the worktree key (and, as wave/<key>, the branch) of one attempt at a chunk.
func TreeKey(effortOID string, now time.Time) string {
	short := effortOID
	if len(short) > 8 {
		short = short[:8]
	}
	return "dume-" + short + "-" + strconv.FormatInt(now.Unix(), 36)
}
