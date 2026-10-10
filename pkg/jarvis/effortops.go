// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Effort mutation logic, pure and DB-free: one validation pass, then one apply pass. The handler
// wraps this in effortstore.Update so a rejected batch never touches the store.
//
// It lives here rather than in jarvisstate because both the engine and the wsh CLI reach it; wsh builds
// with CGO_ENABLED=0, so keep this file's imports to waveobj, wshrpc and the standard library.

package jarvis

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

var effortChunkStatuses = map[string]bool{
	"pending": true, "active": true, "done": true, "deferred": true, "blocked": true, "skipped": true,
}

var effortStatuses = map[string]bool{"active": true, "paused": true, "done": true, "archived": true}

// delta-event kinds only; renames/moves/owner/remove/link are trail-only by design (the delta is
// "what changed that matters", the trail is the full record).
var effortEventKinds = map[string]bool{
	"effort-created": true, "chunk-done": true, "chunk-added": true,
	"chunk-status": true, "effort-status": true, "effort-note": true,
}

// ResolveChunkIndex resolves a chunk ref (exact label, or 1-based index string) to a 0-based index.
// A ref that is a valid integer is treated as an index; otherwise it must match one label exactly.
func ResolveChunkIndex(e *waveobj.Effort, ref string) (int, error) {
	if ref == "" {
		return -1, fmt.Errorf("EC-UNKNOWN-CHUNK: empty chunk ref")
	}
	if idx, err := strconv.Atoi(ref); err == nil {
		if idx < 1 || idx > len(e.Chunks) {
			return -1, fmt.Errorf("EC-UNKNOWN-CHUNK: chunk index %d out of range (1..%d)", idx, len(e.Chunks))
		}
		return idx - 1, nil
	}
	for i, c := range e.Chunks {
		if c.Label == ref {
			return i, nil
		}
	}
	return -1, fmt.Errorf("EC-UNKNOWN-CHUNK: no chunk named %q (labels: %s)", ref, chunkLabels(e))
}

func chunkLabels(e *waveobj.Effort) string {
	labels := make([]string, 0, len(e.Chunks))
	for _, c := range e.Chunks {
		labels = append(labels, c.Label)
	}
	return strings.Join(labels, ", ")
}

// NoteAuthor is who the notes a batch appends are attributed to. The zero value writes no author.
type NoteAuthor struct {
	Who     string // "you" | "agent" | ""
	Session string // "agent:<tabid>"
	Run     string // "run:<oid>"
}

func chunkNote(e *waveobj.Effort, idx int, text string, now int64, by NoteAuthor) {
	e.Chunks[idx].Notes = append(e.Chunks[idx].Notes, waveobj.EffortNote{
		Ts: now, Text: text, Author: by.Who, Session: by.Session, Run: by.Run,
	})
	e.Chunks[idx].UpdatedTs = now
}

func effortNote(e *waveobj.Effort, text string, now int64) {
	e.Notes = append(e.Notes, waveobj.EffortNote{Ts: now, Text: text})
}

func effortEvent(e *waveobj.Effort, kind, label, text string, now int64) {
	if !effortEventKinds[kind] {
		return // trail-only mutation
	}
	e.Events = append(e.Events, waveobj.EffortEvent{Ts: now, Kind: kind, Label: label, Text: text})
}

// resolveNote finds the note an editNote/removeNote names. At is its 1-based place in the chunk's trail
// and NoteTs the stamp the caller last saw there; both must agree, because one batch can stamp several
// notes with the same ts and an index alone goes stale the moment the trail changes.
func resolveNote(c waveobj.EffortChunk, op wshrpc.EffortOp) (int, error) {
	at := derefAt(op.At)
	if at < 1 || at > len(c.Notes) {
		return -1, fmt.Errorf("EC-INVALID-INDEX: note %d out of range (1..%d)", at, len(c.Notes))
	}
	if c.Notes[at-1].Ts != op.NoteTs {
		return -1, fmt.Errorf("EC-STALE-NOTE: note %d on %q changed since it was read", at, c.Label)
	}
	return at - 1, nil
}

// noteEvent is the effort-note event a chunk note was written with (appendNote writes both with one
// stamp and one text), so the feed, which reads events, stays in step with the chunk's trail.
func noteEvent(e *waveobj.Effort, label string, n waveobj.EffortNote) int {
	for i, ev := range e.Events {
		if ev.Kind == "effort-note" && ev.Ts == n.Ts && ev.Label == label && ev.Text == n.Text {
			return i
		}
	}
	return -1
}

// preArchiveStatus is the status an unarchive restores. Archiving does not record what it replaced,
// but the event log already has it: the last effort-status before the archive is where the effort
// came from. Trailing archive events are skipped so a second archive cycle does not read its own
// restore as the answer. Falls back to active — an effort archived straight from creation has no
// earlier status event to find.
func preArchiveStatus(e *waveobj.Effort) string {
	seenArchived := false
	for i := len(e.Events) - 1; i >= 0; i-- {
		ev := e.Events[i]
		if ev.Kind != "effort-status" {
			continue
		}
		if ev.Text == "archived" {
			seenArchived = true
			continue
		}
		if seenArchived {
			return ev.Text
		}
	}
	return "active"
}

// noteSuffix appends the batch note to effort-trail stamps; chunk ops fold it into their own text.
func noteSuffix(cmdNote string) string {
	if cmdNote == "" {
		return ""
	}
	return " · " + cmdNote
}

// ApplyEffortOps validates every op first, then applies them in order. On any validation failure
// nothing is applied (the caller runs this inside a store transaction for atomicity). cmdNote is
// appended to the affected trail as the batch's note when an op carries no note of its own.
func ApplyEffortOps(e *waveobj.Effort, ops []wshrpc.EffortOp, cmdNote string, now int64) error {
	return ApplyEffortOpsAs(e, ops, cmdNote, now, NoteAuthor{})
}

// ApplyEffortOpsAs is ApplyEffortOps with every chunk note the batch appends attributed to by.
func ApplyEffortOpsAs(e *waveobj.Effort, ops []wshrpc.EffortOp, cmdNote string, now int64, by NoteAuthor) error {
	// ---- validation pass ----
	for _, op := range ops {
		switch op.Op {
		case "rename":
			if strings.TrimSpace(op.Title) == "" {
				return fmt.Errorf("EC-INVALID-TITLE: title cannot be empty")
			}
		case "setStatus":
			if !effortStatuses[op.Status] {
				return fmt.Errorf("EC-INVALID-STATUS: %q not one of active|paused|done|archived", op.Status)
			}
		case "unarchive":
			if e.Status != "archived" {
				return fmt.Errorf("EC-NOT-ARCHIVED: effort is %s, not archived", e.Status)
			}
		case "addChunk":
			label := strings.TrimSpace(op.Label)
			if label == "" {
				return fmt.Errorf("EC-INVALID-LABEL: chunk label cannot be empty")
			}
			for _, c := range e.Chunks {
				if c.Label == label {
					return fmt.Errorf("EC-DUPLICATE-LABEL: chunk %q already exists", label)
				}
			}
			if op.At != nil && (*op.At < 1 || *op.At > len(e.Chunks)+1) {
				return fmt.Errorf("EC-INVALID-INDEX: at %d out of range", *op.At)
			}
			if err := validDue(op.Due); err != nil {
				return err
			}
		case "removeChunk":
			if _, err := ResolveChunkIndex(e, op.Chunk); err != nil {
				return err
			}
			if len(e.Chunks) == 1 {
				return fmt.Errorf("EC-LAST-CHUNK: cannot remove the last chunk")
			}
		case "renameChunk", "moveChunk", "setChunkStatus", "setChunkStage", "setChunkDue", "setOwner":
			if _, err := ResolveChunkIndex(e, op.Chunk); err != nil {
				return err
			}
			switch op.Op {
			case "setChunkDue":
				if err := validDue(op.Due); err != nil {
					return err
				}
			case "setChunkStatus":
				if !effortChunkStatuses[op.Status] {
					return fmt.Errorf("EC-INVALID-STATUS: %q not one of pending|active|done|deferred|blocked|skipped", op.Status)
				}
			case "renameChunk":
				if strings.TrimSpace(op.Label) == "" {
					return fmt.Errorf("EC-INVALID-LABEL: chunk label cannot be empty")
				}
				for _, c := range e.Chunks {
					if c.Label == op.Label && op.Chunk != op.Label {
						return fmt.Errorf("EC-DUPLICATE-LABEL: chunk %q already exists", op.Label)
					}
				}
			case "moveChunk":
				if op.At == nil || *op.At < 1 || *op.At > len(e.Chunks) {
					return fmt.Errorf("EC-INVALID-INDEX: at %d out of range", derefAt(op.At))
				}
			}
		case "reopen":
			idx, err := ResolveChunkIndex(e, op.Chunk)
			if err != nil {
				return err
			}
			if e.Chunks[idx].Status != "done" {
				return fmt.Errorf("EC-INVALID-STATUS: reopen requires a done chunk, %q is %s", op.Chunk, e.Chunks[idx].Status)
			}
		case "appendNote":
			if _, err := ResolveChunkIndex(e, op.Chunk); err != nil {
				return err
			}
			if strings.TrimSpace(op.Note) == "" && strings.TrimSpace(cmdNote) == "" {
				return fmt.Errorf("EC-EMPTY-NOTE: note text is empty")
			}
		case "editNote", "removeNote":
			idx, err := ResolveChunkIndex(e, op.Chunk)
			if err != nil {
				return err
			}
			if _, err := resolveNote(e.Chunks[idx], op); err != nil {
				return err
			}
			if op.Op == "editNote" && strings.TrimSpace(op.Note) == "" {
				return fmt.Errorf("EC-EMPTY-NOTE: note text is empty")
			}
		case "setProject", "setTicket", "link", "advance":
			// no chunk-level validation
		case "attachWork":
			if op.Kind != "run" && op.Kind != "agent" {
				return fmt.Errorf("EC-INVALID-KIND: %q not one of run|agent", op.Kind)
			}
			if strings.TrimSpace(op.ORef) == "" {
				return fmt.Errorf("EC-INVALID-OREF: oref cannot be empty")
			}
			idx, err := ResolveChunkIndex(e, op.Chunk)
			if err != nil {
				return err
			}
			for i, c := range e.Chunks {
				if i == idx {
					continue
				}
				for _, w := range c.WorkRefs {
					if w.ORef == op.ORef {
						return fmt.Errorf("EC-REF-ALREADY-ATTACHED: %s is already attached to chunk %q", op.ORef, c.Label)
					}
				}
			}
		case "detachWork":
			if strings.TrimSpace(op.ORef) == "" {
				return fmt.Errorf("EC-INVALID-OREF: oref cannot be empty")
			}
			if op.Chunk != "" {
				if _, err := ResolveChunkIndex(e, op.Chunk); err != nil {
					return err
				}
			}
		default:
			return fmt.Errorf("EC-UNKNOWN-OP: %q", op.Op)
		}
	}

	// ---- apply pass ----
	for _, op := range ops {
		note := op.Note
		if note == "" {
			note = cmdNote
		}
		switch op.Op {
		case "rename":
			e.Title = op.Title
			effortNote(e, "renamed to "+op.Title+noteSuffix(cmdNote), now)
		case "setProject":
			e.Project = op.Project
			effortNote(e, "project set to "+orNone(op.Project)+noteSuffix(cmdNote), now)
		case "setTicket":
			e.Ticket = op.Ticket
			effortNote(e, "ticket set to "+orNone(op.Ticket)+noteSuffix(cmdNote), now)
		case "setStatus":
			e.Status = op.Status
			effortNote(e, "effort "+op.Status+noteSuffix(cmdNote), now)
			effortEvent(e, "effort-status", "", op.Status, now)
		case "unarchive":
			prev := preArchiveStatus(e)
			e.Status = prev
			effortNote(e, "effort unarchived to "+prev+noteSuffix(cmdNote), now)
			effortEvent(e, "effort-status", "", prev, now)
		case "link":
			e.ParentOID = op.ParentOID
			effortNote(e, "linked to parent "+orNone(op.ParentOID)+noteSuffix(cmdNote), now)
		case "addChunk":
			idx := len(e.Chunks)
			if op.At != nil {
				idx = *op.At - 1
			}
			c := waveobj.EffortChunk{Label: op.Label, Status: "pending", Stage: strings.TrimSpace(op.Stage), Owner: op.Owner, Due: op.Due, UpdatedTs: now}
			e.Chunks = append(e.Chunks[:idx], append([]waveobj.EffortChunk{c}, e.Chunks[idx:]...)...)
			effortNote(e, "chunk added: "+op.Label+noteSuffix(cmdNote), now)
			effortEvent(e, "chunk-added", op.Label, "", now)
		case "removeChunk":
			idx, _ := ResolveChunkIndex(e, op.Chunk)
			e.Chunks = append(e.Chunks[:idx], e.Chunks[idx+1:]...)
			effortNote(e, "chunk removed: "+op.Chunk+noteSuffix(cmdNote), now)
		case "renameChunk":
			idx, _ := ResolveChunkIndex(e, op.Chunk)
			old := e.Chunks[idx].Label
			e.Chunks[idx].Label = op.Label
			chunkNote(e, idx, "renamed from "+old, now, by)
		case "moveChunk":
			idx, _ := ResolveChunkIndex(e, op.Chunk)
			c := e.Chunks[idx]
			e.Chunks = append(e.Chunks[:idx], e.Chunks[idx+1:]...)
			at := *op.At - 1
			e.Chunks = append(e.Chunks[:at], append([]waveobj.EffortChunk{c}, e.Chunks[at:]...)...)
			chunkNote(e, at, "moved to position "+strconv.Itoa(*op.At), now, by)
		case "setChunkStatus":
			idx, _ := ResolveChunkIndex(e, op.Chunk)
			e.Chunks[idx].Status = op.Status
			text := "marked " + op.Status
			if note != "" {
				text += " · " + note
			}
			chunkNote(e, idx, text, now, by)
			kind := "chunk-status"
			if op.Status == "done" {
				kind = "chunk-done"
			}
			effortEvent(e, kind, e.Chunks[idx].Label, note, now)
		case "appendNote":
			idx, _ := ResolveChunkIndex(e, op.Chunk)
			chunkNote(e, idx, note, now, by)
			effortEvent(e, "effort-note", e.Chunks[idx].Label, note, now)
		case "editNote":
			idx, _ := ResolveChunkIndex(e, op.Chunk)
			ni, err := resolveNote(e.Chunks[idx], op)
			if err != nil {
				return err
			}
			// no trail stamp: this edits the trail itself, and a note about a note says nothing
			n := &e.Chunks[idx].Notes[ni]
			text := strings.TrimSpace(op.Note)
			if ev := noteEvent(e, e.Chunks[idx].Label, *n); ev >= 0 {
				e.Events[ev].Text = text
			}
			n.Text = text
			n.Edited = true
			e.Chunks[idx].UpdatedTs = now
		case "removeNote":
			idx, _ := ResolveChunkIndex(e, op.Chunk)
			ni, err := resolveNote(e.Chunks[idx], op)
			if err != nil {
				return err
			}
			c := &e.Chunks[idx]
			if ev := noteEvent(e, c.Label, c.Notes[ni]); ev >= 0 {
				e.Events = append(e.Events[:ev], e.Events[ev+1:]...)
			}
			c.Notes = append(c.Notes[:ni], c.Notes[ni+1:]...)
			c.UpdatedTs = now
		case "setChunkStage":
			// trail-only, like rename/move/owner: a stage is a grouping label, so changing it moves
			// nothing and completes nothing. The delta stays "what changed that matters".
			idx, _ := ResolveChunkIndex(e, op.Chunk)
			e.Chunks[idx].Stage = strings.TrimSpace(op.Stage)
			chunkNote(e, idx, "stage set to "+orNone(e.Chunks[idx].Stage), now, by)
		case "setChunkDue":
			// trail-only too: a date completes nothing. The note keeps the history of a date moved on.
			idx, _ := ResolveChunkIndex(e, op.Chunk)
			e.Chunks[idx].Due = op.Due
			chunkNote(e, idx, "due set to "+orNone(op.Due), now, by)
		case "setOwner":
			idx, _ := ResolveChunkIndex(e, op.Chunk)
			e.Chunks[idx].Owner = op.Owner
			chunkNote(e, idx, "owner set to "+orNone(op.Owner), now, by)
		case "advance":
			advance(e, note, now, by)
		case "reopen":
			idx, _ := ResolveChunkIndex(e, op.Chunk)
			// undo of advance: reopened chunk active, the previously active chunk back to pending
			for i := range e.Chunks {
				if i != idx && e.Chunks[i].Status == "active" {
					e.Chunks[i].Status = "pending"
				}
			}
			e.Chunks[idx].Status = "active"
			chunkNote(e, idx, "reopened"+noteSuffix(note), now, by)
		case "attachWork":
			idx, _ := ResolveChunkIndex(e, op.Chunk)
			ref := waveobj.ChunkWorkRef{Kind: op.Kind, ORef: op.ORef, Ts: now}
			replaced := false
			for i := range e.Chunks[idx].WorkRefs {
				if e.Chunks[idx].WorkRefs[i].ORef == op.ORef {
					e.Chunks[idx].WorkRefs[i] = ref // refresh ts; idempotent
					replaced = true
					break
				}
			}
			if !replaced {
				e.Chunks[idx].WorkRefs = append(e.Chunks[idx].WorkRefs, ref)
			}
			chunkNote(e, idx, op.Kind+" attached: "+op.ORef, now, by)
		case "detachWork":
			removeRef := func(idx int) bool {
				out := e.Chunks[idx].WorkRefs[:0]
				removed := false
				for _, w := range e.Chunks[idx].WorkRefs {
					if w.ORef == op.ORef {
						removed = true
						continue
					}
					out = append(out, w)
				}
				e.Chunks[idx].WorkRefs = out
				return removed
			}
			if op.Chunk != "" {
				idx, _ := ResolveChunkIndex(e, op.Chunk)
				if removeRef(idx) {
					chunkNote(e, idx, "detached: "+op.ORef, now, by)
				}
			} else {
				for i := range e.Chunks {
					if removeRef(i) {
						chunkNote(e, i, "detached: "+op.ORef, now, by)
					}
				}
			}
		}
	}
	return nil
}

// advance marks the active chunk done and activates the next non-done chunk (the run-card contract:
// one active at a time). With no active chunk it activates the first non-done.
func advance(e *waveobj.Effort, note string, now int64, by NoteAuthor) {
	active := -1
	for i, c := range e.Chunks {
		if c.Status == "active" {
			active = i
			break
		}
	}
	if active >= 0 {
		e.Chunks[active].Status = "done"
		text := "marked done"
		if note != "" {
			text += " · " + note
		}
		chunkNote(e, active, text, now, by)
		effortEvent(e, "chunk-done", e.Chunks[active].Label, note, now)
	}
	for i, c := range e.Chunks {
		if c.Status == "pending" || c.Status == "blocked" || c.Status == "deferred" {
			e.Chunks[i].Status = "active"
			chunkNote(e, i, "activated", now, by)
			return
		}
	}
}

func orNone(s string) string {
	if s == "" {
		return "(none)"
	}
	return s
}

// validDue accepts "" (no date) or a calendar date spelled YYYY-MM-DD. A past date is allowed: the chunk is
// simply due at once. Relative forms like "+14d" are resolved by the client, against its own local today.
func validDue(due string) error {
	if due == "" {
		return nil
	}
	if _, err := time.Parse(DueLayout, due); err != nil {
		return fmt.Errorf("EC-INVALID-DUE: %q is not a date (YYYY-MM-DD)", due)
	}
	return nil
}

// DueLayout is how a chunk's due date is spelled, and how the attention list spells today to compare it.
const DueLayout = "2006-01-02"

func derefAt(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}
