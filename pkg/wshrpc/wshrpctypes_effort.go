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
	// EffortPinCommand pins or unpins an effort to the Brief's cards. A pin is a view preference: it writes
	// no event or note and keeps UpdatedTs.
	EffortPinCommand(ctx context.Context, data CommandEffortPinData) (*CommandEffortPinRtnData, error)
	// EffortChunkDriftCommand counts the commits on the initiative's project since the chunk was written.
	EffortChunkDriftCommand(ctx context.Context, data CommandEffortChunkDriftData) (*CommandEffortChunkDriftRtnData, error)
	// EffortStaleCommand lists the open chunks whose named files changed or went away since they were written.
	EffortStaleCommand(ctx context.Context, data CommandEffortStaleData) (*CommandEffortStaleRtnData, error)
	// EffortBackfillBaseCommand stamps a BaseCommit on the open chunks written before chunks kept one.
	EffortBackfillBaseCommand(ctx context.Context, data CommandEffortBackfillBaseData) (*CommandEffortBackfillBaseRtnData, error)
	// EffortBackfillProposedCommand moves the pending chunks that name a recent orchestrator run to proposed, so they
	// show in To review (the one-time backlog pass; see jarvis.PickBacklogProposals).
	EffortBackfillProposedCommand(ctx context.Context) (*CommandEffortBackfillProposedRtnData, error)
}

// CommandEffortPinData pins (Pin true) or unpins an effort. Past the cap (jarvis.MaxPinnedEfforts), a pin
// without ReplaceOldest changes nothing and answers CapReached with the oldest pin; with ReplaceOldest it
// unpins that one and pins this one in one call.
type CommandEffortPinData struct {
	EffortOID     string `json:"effortoid"`
	Pin           bool   `json:"pin"`
	ReplaceOldest bool   `json:"replaceoldest,omitempty"`
}

type CommandEffortPinRtnData struct {
	Pinned     bool          `json:"pinned"`               // the effort's pin state after the call
	CapReached bool          `json:"capreached,omitempty"` // the pin was refused: the cap is full
	Oldest     *EffortPinRef `json:"oldest,omitempty"`     // the oldest pin, when CapReached
}

// EffortPinRef names a pinned effort, for the cap-reached answer.
type EffortPinRef struct {
	OID   string `json:"oid"`
	Title string `json:"title"`
}

type CommandEffortCreateData struct {
	Title     string                   `json:"title"`
	Project   string                   `json:"project,omitempty"`
	Ticket    string                   `json:"ticket,omitempty"`
	ParentOID string                   `json:"parentoid,omitempty"`
	Chunks    []CommandEffortChunkSeed `json:"chunks,omitempty"` // may be empty; chunks can be added later
	// Proposed seeds every chunk as a proposal (status proposed, with the "proposed" note), the way `chunk add
	// --proposed` does. SourceBlock is the calling terminal ("block:<id>"), from which the server derives the notes'
	// author, session and run, as on CommandEffortMutateData.
	Proposed    bool   `json:"proposed,omitempty"`
	SourceBlock string `json:"sourceblock,omitempty"`
	// Note, when set, is the initiative's first note in place of "effort created", written by you: Chat's Save as
	// idea puts the passage it was saved from there, and where it was said. NoteSession is that agent
	// ("agent:<tabid>"), kept on the note as an agent's note keeps its session.
	Note        string `json:"note,omitempty"`
	NoteSession string `json:"notesession,omitempty"`
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
	Op        string `json:"op"`                  // rename | setProject | setTicket | setStatus | unarchive | link | addChunk | removeChunk | renameChunk | recheckChunk | moveChunk | setChunkStatus | setChunkStage | setChunkDue | setChunkLater | setChunkPriority | appendNote | editNote | removeNote | setOwner | advance | reopen
	Title     string `json:"title,omitempty"`     // rename
	Project   string `json:"project,omitempty"`   // setProject ("" clears)
	Ticket    string `json:"ticket,omitempty"`    // setTicket ("" clears)
	Status    string `json:"status,omitempty"`    // setStatus (effort) | setChunkStatus (chunk) | addChunk ("proposed" only)
	ParentOID string `json:"parentoid,omitempty"` // link ("" = unlink)
	Chunk     string `json:"chunk,omitempty"`     // chunk ref: exact label or 1-based index string
	Label     string `json:"label,omitempty"`     // addChunk label / renameChunk new label
	At        *int   `json:"at,omitempty"`        // addChunk insert position / moveChunk target / editNote,removeNote note index (1-based)
	Owner     string `json:"owner,omitempty"`     // addChunk / setOwner ("" clears)
	Stage     string `json:"stage,omitempty"`     // addChunk / setChunkStage ("" clears)
	Due       string `json:"due,omitempty"`       // addChunk / setChunkDue: a local date, YYYY-MM-DD ("" clears)
	Priority  string `json:"priority,omitempty"`  // addChunk / setChunkPriority: critical | high | medium | low | information ("" clears)
	Note      string `json:"note,omitempty"`      // appendNote text; also honored by setChunkStatus/advance/reopen as extra text, and by addChunk as the chunk's first note; editNote new text
	NoteTs    int64  `json:"notets,omitempty"`    // editNote/removeNote: the note's ts, a stale guard beside At
	Kind      string `json:"kind,omitempty"`      // attachWork: "run" | "agent"
	ORef      string `json:"oref,omitempty"`      // attachWork/detachWork: "run:<oid>" | "agent:<tabid>"
	// Later is the chunk's later mark (EffortChunk.Later): addChunk makes the chunk later, setChunkLater sets the mark
	// to this value (false drops it, as "" clears a due). Later chunks are not the initiative's work: see EffortChunk.Later.
	Later bool `json:"later,omitempty"`
	// Session and Conversation are the agent session ("agent:<tabid>") and the conversation id that addChunk's first
	// note (Note) records. Honored only when the batch's author is "you", the cockpit saving a passage from a Chat; from
	// a terminal the server derives both from the calling block (NoteAuthor), so a caller's values are ignored.
	Session      string `json:"session,omitempty"`
	Conversation string `json:"conversation,omitempty"`
	// Base is the project's HEAD that addChunk, renameChunk and recheckChunk stamp on the chunk (BaseCommit).
	// The server fills it from the initiative's project; a caller's value is overwritten.
	Base string `json:"base,omitempty"`
}

// CommandEffortChunkDriftData asks how far the code has moved since a chunk was written.
type CommandEffortChunkDriftData struct {
	EffortOID string `json:"effortoid"`
	Chunk     string `json:"chunk"` // exact label or 1-based index string
}

// CommandEffortChunkDriftRtnData answers it. Known is false when there is nothing to measure: the chunk has no
// base, the initiative no project with a git checkout, or the base is not in that checkout's history.
type CommandEffortChunkDriftRtnData struct {
	Known  bool   `json:"known"`
	Base   string `json:"base,omitempty"`
	Behind int    `json:"behind"`           // commits on HEAD since Base
	BaseTs int64  `json:"basets,omitempty"` // unix ms of Base's commit
	// Inferred: the chunk has no BaseCommit (it predates the field), so Base is the commit HEAD was at when the
	// chunk was last updated.
	Inferred bool `json:"inferred,omitempty"`
	// Files are the files the chunk's text names that changed, or went away, since Base.
	Files []EffortStaleFile `json:"files,omitempty"`
}

// EffortStaleFile is one file a chunk's label or notes name, measured against the commits landed on the project's
// HEAD since the chunk was written.
type EffortStaleFile struct {
	Mention   string `json:"mention"`             // as the chunk wrote it: "councilstore.ts", "pkg/x/y.go"
	Path      string `json:"path"`                // the repo path it resolved to (the first, when a bare name matches several)
	Changes   int    `json:"changes"`             // landed commits that touched it since the chunk was written
	Gone      bool   `json:"gone,omitempty"`      // no file by that name is tracked at HEAD any more
	RenamedTo string `json:"renamedto,omitempty"` // when Gone came from a rename, where it went
}

// EffortChunkStale is one open chunk the stale scan flags: a file it names changed or went away.
type EffortChunkStale struct {
	Chunk    string            `json:"chunk"` // label
	Index    int               `json:"index"` // 1-based
	Base     string            `json:"base,omitempty"`
	Inferred bool              `json:"inferred,omitempty"`
	Landed   int               `json:"landed"` // commits landed on HEAD's first-parent line since Base
	Files    []EffortStaleFile `json:"files"`
}

// EffortStaleEntry is one initiative's flagged chunks.
type EffortStaleEntry struct {
	EffortOID string             `json:"effortoid"`
	Title     string             `json:"title"`
	Project   string             `json:"project,omitempty"`
	Chunks    []EffortChunkStale `json:"chunks"`
}

// CommandEffortStaleData asks for the stale scan of one initiative, or every active one when EffortOID is "".
type CommandEffortStaleData struct {
	EffortOID string `json:"effortoid,omitempty"`
}

type CommandEffortStaleRtnData struct {
	Efforts   []EffortStaleEntry `json:"efforts"`
	ScannedTs int64              `json:"scannedts"`
}

// CommandEffortBackfillBaseData stamps a BaseCommit on the open chunks that have none (they predate the field):
// the commit HEAD was at when each was last updated. One initiative, or every one when EffortOID is "".
type CommandEffortBackfillBaseData struct {
	EffortOID string `json:"effortoid,omitempty"`
}

type CommandEffortBackfillBaseRtnData struct {
	Chunks  int `json:"chunks"`  // chunks stamped
	Efforts int `json:"efforts"` // initiatives touched
}

type CommandEffortBackfillProposedRtnData struct {
	Chunks  int `json:"chunks"`  // chunks moved to proposed
	Efforts int `json:"efforts"` // initiatives touched
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
	ActiveChunk string               `json:"activechunk,omitempty"` // the chunk next in the order of work (waveobj.NextChunkIndex): the active chunk, else the highest-ranked pending one
	UpdatedTs   int64                `json:"updatedts"`
	PinnedTs    int64                `json:"pinnedts,omitempty"` // when it was pinned to the Brief's cards; 0 = not pinned
	LastNote    *EffortLastNote      `json:"lastnote,omitempty"` // the newest note on the effort or any chunk
	// Later lists the chunks saved for later that are still open (status pending, active or blocked), in chunk order.
	// A later chunk is in no other field here: not in Chunks, Done, Total or ActiveChunk, and its notes are no LastNote
	// candidates, so the summary's readers follow "later is not the initiative's work" without learning of the mark.
	Later []EffortLaterItem `json:"later,omitempty"`
}

// EffortLaterItem is one open later chunk as the Brief's Later section draws it, without its note trail.
type EffortLaterItem struct {
	Label  string `json:"label"`
	Status string `json:"status"` // pending | active | blocked
	Due    string `json:"due,omitempty"`
	// Since is when the item was saved, unix ms: the first note's ts, else the chunk-added event's, else the chunk's UpdatedTs.
	Since int64 `json:"since"`
	// Note is the first note's text, cut to 1,000 runes: the passage Ask agent quotes.
	Note string `json:"note,omitempty"`
	// Session and Conversation are the first note's agent session ("agent:<tabid>") and conversation id: Ask agent looks
	// for the live agent by the conversation, then by the tab, and resumes by the conversation only when neither is live.
	Session      string `json:"session,omitempty"`
	Conversation string `json:"conversation,omitempty"`
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
	Priority string                 `json:"priority,omitempty"` // critical | high | medium | low | information; "" when unset (ranks as medium)
	WorkRefs []waveobj.ChunkWorkRef `json:"workrefs,omitempty"`
	Blocked  *EffortChunkBlocked    `json:"blocked,omitempty"` // set only on a blocked chunk
}

// EffortChunkBlocked is what the waiting queue shows for a blocked chunk without loading its trail.
type EffortChunkBlocked struct {
	Since  int64           `json:"since,omitempty"`  // when the chunk was marked blocked; 0 when no note recorded it
	Needs  string          `json:"needs,omitempty"`  // the note given with the status: what the blocker needs
	Latest *EffortLastNote `json:"latest,omitempty"` // the newest note, when it came after the marking
}
