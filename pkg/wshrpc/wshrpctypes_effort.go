// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshrpc

import (
	"context"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// EffortCommands is the tracker surface: one atomic create, one atomic op-union mutate, plus
// lightweight list/get for the CLI (independent of the heavy WorkState ledger query).
type EffortCommands interface {
	EffortCreateCommand(ctx context.Context, data CommandEffortCreateData) (*CommandEffortCreateRtnData, error)
	EffortMutateCommand(ctx context.Context, data CommandEffortMutateData) (*CommandEffortMutateRtnData, error)
	EffortListCommand(ctx context.Context, data CommandEffortListData) (*CommandEffortListRtnData, error)
	EffortGetCommand(ctx context.Context, data CommandEffortGetData) (*CommandEffortGetRtnData, error)
	EffortDeleteCommand(ctx context.Context, data CommandEffortDeleteData) error
}

type CommandEffortCreateData struct {
	Title     string                   `json:"title"`
	Project   string                   `json:"project,omitempty"`
	Ticket    string                   `json:"ticket,omitempty"`
	ParentOID string                   `json:"parentoid,omitempty"`
	Chunks    []CommandEffortChunkSeed `json:"chunks,omitempty"` // may be empty; chunks can be added later
}

type CommandEffortChunkSeed struct {
	Label string `json:"label"`
	Owner string `json:"owner,omitempty"`
}

type CommandEffortCreateRtnData struct {
	EffortOID string `json:"effortoid"`
}

// CommandEffortMutateData carries one atomic batch: all ops validate, then all apply. A failing op
// aborts the whole command.
type CommandEffortMutateData struct {
	EffortOID string     `json:"effortoid"`
	Ops       []EffortOp `json:"ops"`
	Note      string     `json:"note,omitempty"` // appended to the affected trail as the batch's note
	// Author stamps the notes this batch writes; only "you" is accepted from a caller (the cockpit). A
	// terminal sends SourceBlock instead and the server derives "agent", its session and its run.
	Author      string `json:"author,omitempty"`
	SourceBlock string `json:"sourceblock,omitempty"` // "block:<id>" of the calling terminal
}

type CommandEffortMutateRtnData struct {
	Effort *waveobj.Effort `json:"effort"` // post-mutation object
}

type CommandEffortListData struct {
	Project         string `json:"project,omitempty"`         // "" = all non-archived efforts
	IncludeArchived bool   `json:"includearchived,omitempty"` // archived efforts are hidden unless asked for
}

type CommandEffortListRtnData struct {
	Efforts []EffortSummary `json:"efforts"`
}

type CommandEffortGetData struct {
	EffortOID string `json:"effortoid"`
	// SourceBlock is the calling terminal ("block:<id>"), sent by `wsh effort show`: an agent that reads an
	// initiative is working on it, so its session is linked to it. The cockpit's own reads send none.
	SourceBlock string `json:"sourceblock,omitempty"`
}

type CommandEffortGetRtnData struct {
	Effort *waveobj.Effort `json:"effort"`
}

type CommandEffortDeleteData struct {
	EffortOID string `json:"effortoid"`
}

// EffortOp is one typed mutation. Op selects the behavior; the remaining fields are the op's
// arguments (validation picks which are required per op).
type EffortOp struct {
	Op        string `json:"op"`                  // rename | setProject | setTicket | setStatus | unarchive | link | addChunk | removeChunk | renameChunk | moveChunk | setChunkStatus | setChunkStage | setChunkDue | appendNote | editNote | removeNote | setOwner | advance | reopen
	Title     string `json:"title,omitempty"`     // rename
	Project   string `json:"project,omitempty"`   // setProject ("" clears)
	Ticket    string `json:"ticket,omitempty"`    // setTicket ("" clears)
	Status    string `json:"status,omitempty"`    // setStatus (effort) | setChunkStatus (chunk)
	ParentOID string `json:"parentoid,omitempty"` // link ("" = unlink)
	Chunk     string `json:"chunk,omitempty"`     // chunk ref: exact label or 1-based index string
	Label     string `json:"label,omitempty"`     // addChunk label / renameChunk new label
	At        *int   `json:"at,omitempty"`        // addChunk insert position / moveChunk target / editNote,removeNote note index (1-based)
	Owner     string `json:"owner,omitempty"`     // addChunk / setOwner ("" clears)
	Stage     string `json:"stage,omitempty"`     // addChunk / setChunkStage ("" clears)
	Due       string `json:"due,omitempty"`       // addChunk / setChunkDue: a local date, YYYY-MM-DD ("" clears)
	Note      string `json:"note,omitempty"`      // appendNote text; also honored by setChunkStatus/advance/reopen as extra text; editNote new text
	NoteTs    int64  `json:"notets,omitempty"`    // editNote/removeNote: the note's ts, a stale guard beside At
	Kind      string `json:"kind,omitempty"`      // attachWork: "run" | "agent"
	ORef      string `json:"oref,omitempty"`      // attachWork/detachWork: "run:<oid>" | "agent:<tabid>"
}

// EffortSummary is the ledger-friendly projection of an effort (no note trails).
type EffortSummary struct {
	ORef        string               `json:"oref"`
	Title       string               `json:"title"`
	Project     string               `json:"project,omitempty"`
	Ticket      string               `json:"ticket,omitempty"`
	Status      string               `json:"status"`
	ParentOID   string               `json:"parentoid,omitempty"`
	Chunks      []EffortChunkSummary `json:"chunks,omitempty"`
	Done        int                  `json:"done"`
	Total       int                  `json:"total"`
	ActiveChunk string               `json:"activechunk,omitempty"` // first chunk with status active, else first non-done label
	UpdatedTs   int64                `json:"updatedts"`
	LastNote    *EffortLastNote      `json:"lastnote,omitempty"` // the newest note on the effort or any chunk
}

// EffortLastNote is where an initiative was left: its newest note, cut to its first line so the ledger does
// not carry note trails.
type EffortLastNote struct {
	Ts      int64  `json:"ts"`
	Text    string `json:"text"`
	Chunk   string `json:"chunk,omitempty"` // the chunk the note is on; empty for an effort-level note
	Author  string `json:"author,omitempty"`
	Session string `json:"session,omitempty"` // "agent:<tabid>" when an agent wrote it
}

type EffortChunkSummary struct {
	Label    string                 `json:"label"`
	Status   string                 `json:"status"`
	Stage    string                 `json:"stage,omitempty"`
	Owner    string                 `json:"owner,omitempty"`
	WorkRefs []waveobj.ChunkWorkRef `json:"workrefs,omitempty"`
}
