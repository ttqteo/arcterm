// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/gitinfo"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jarvisstate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func (ws *WshServer) EffortCreateCommand(ctx context.Context, data wshrpc.CommandEffortCreateData) (*wshrpc.CommandEffortCreateRtnData, error) {
	title := strings.TrimSpace(data.Title)
	if title == "" {
		return nil, fmt.Errorf("EC-INVALID-TITLE: title cannot be empty")
	}
	if len(title) > 200 {
		return nil, fmt.Errorf("EC-INVALID-TITLE: title exceeds 200 chars")
	}
	data.ParentOID = effortstore.BareOID(data.ParentOID)
	if data.ParentOID != "" {
		if _, err := effortstore.Get(ctx, data.ParentOID); err != nil {
			return nil, fmt.Errorf("EC-BAD-PARENT: parent effort not found: %v", err)
		}
	}
	e := &waveobj.Effort{
		Title: title, Project: data.Project, Ticket: data.Ticket, Status: "active",
		ParentOID: data.ParentOID,
	}
	seen := map[string]bool{}
	head := ""
	if len(data.Chunks) > 0 {
		head = effortHead(ctx, data.Project)
	}
	// --proposed seeds proposals the way `chunk add --proposed` writes one: the chunk is proposed, and a "proposed"
	// note keeps who proposed it (its session and run) when there is a session to keep, since To review groups a
	// run's proposals by that note
	var proposer jarvis.NoteAuthor
	if data.Proposed && data.SourceBlock != "" {
		proposer = agentAuthorForBlock(ctx, data.SourceBlock)
	}
	now := time.Now().UnixMilli()
	for _, seed := range data.Chunks {
		label := strings.TrimSpace(seed.Label)
		if label == "" {
			return nil, fmt.Errorf("EC-INVALID-LABEL: chunk label cannot be empty")
		}
		if len(label) > 200 {
			return nil, fmt.Errorf("EC-INVALID-LABEL: chunk label exceeds 200 chars")
		}
		if seen[label] {
			return nil, fmt.Errorf("EC-DUPLICATE-LABEL: chunk %q already exists", label)
		}
		seen[label] = true
		c := waveobj.EffortChunk{Label: label, Status: "pending", Owner: seed.Owner, BaseCommit: head}
		if data.Proposed {
			c.Status, c.UpdatedTs = "proposed", now
			if proposer.Session != "" {
				c.Notes = append(c.Notes, waveobj.EffortNote{
					Ts: now, Text: jarvis.ProposedNote, Author: proposer.Who, Session: proposer.Session, Run: proposer.Run,
				})
			}
		}
		e.Chunks = append(e.Chunks, c)
	}
	if err := effortstore.Create(ctx, e); err != nil {
		return nil, err
	}
	// the created event is the delta source; the trail note documents it for humans, or says what the idea was saved
	// from when the caller wrote that
	first := waveobj.EffortNote{Ts: e.CreatedTs, Text: "effort created"}
	if note := strings.TrimSpace(data.Note); note != "" {
		first = waveobj.EffortNote{Ts: e.CreatedTs, Text: note, Author: "you", Session: strings.TrimSpace(data.NoteSession)}
	}
	e.Notes = append(e.Notes, first)
	if len(e.Chunks) > 0 {
		e.Events = append(e.Events, waveobj.EffortEvent{Ts: e.CreatedTs, Kind: "effort-created", Text: fmt.Sprintf("%d chunks", len(e.Chunks))})
	} else {
		e.Events = append(e.Events, waveobj.EffortEvent{Ts: e.CreatedTs, Kind: "effort-created"})
	}
	if err := effortstore.Update(ctx, e.OID, func(store *waveobj.Effort) error {
		store.Notes = e.Notes
		store.Events = e.Events
		return nil
	}); err != nil {
		return nil, err
	}
	return &wshrpc.CommandEffortCreateRtnData{EffortOID: e.OID}, nil
}

func (ws *WshServer) EffortMutateCommand(ctx context.Context, data wshrpc.CommandEffortMutateData) (*wshrpc.CommandEffortMutateRtnData, error) {
	// ids are made bare once, here, so the self-link guard, the stored parent and the session link all
	// see one form
	data.EffortOID = effortstore.BareOID(data.EffortOID)
	for i := range data.Ops {
		data.Ops[i].ParentOID = effortstore.BareOID(data.Ops[i].ParentOID)
	}
	cur, err := effortstore.Get(ctx, data.EffortOID)
	if err != nil {
		return nil, err
	}
	// link op: parent must exist and not be self — pre-validated outside the txn so the error is
	// deterministic and cheap; a parent deleted mid-flight fails the same lookup below.
	for _, op := range data.Ops {
		if op.Op == "link" && op.ParentOID != "" {
			if op.ParentOID == data.EffortOID {
				return nil, fmt.Errorf("EC-BAD-PARENT: cannot link an effort to itself")
			}
			if _, err := effortstore.Get(ctx, op.ParentOID); err != nil {
				return nil, fmt.Errorf("EC-BAD-PARENT: parent effort not found")
			}
			cycle, err := jarvis.LinkMakesCycle(data.EffortOID, op.ParentOID, func(oid string) (string, error) {
				p, err := effortstore.Get(ctx, oid)
				if errors.Is(err, wstore.ErrNotFound) {
					// an ancestor deleted under its child leaves a dangling parent: the chain ends there
					return "", nil
				}
				if err != nil {
					return "", err
				}
				return p.ParentOID, nil
			})
			if err != nil {
				return nil, fmt.Errorf("EC-BAD-PARENT: %w", err)
			}
			if cycle {
				return nil, fmt.Errorf("EC-BAD-PARENT: that would put the initiative under itself")
			}
		}
	}
	// the ops that write a chunk's text carry the project's HEAD, read once, outside the store transaction
	head, headRead := "", false
	for i := range data.Ops {
		if !jarvis.StampsBase(data.Ops[i].Op) {
			continue
		}
		if !headRead {
			head, headRead = effortHead(ctx, cur.Project), true
		}
		data.Ops[i].Base = head
	}
	author := noteAuthorFor(ctx, data)
	var updated *waveobj.Effort
	err = effortstore.Update(ctx, data.EffortOID, func(e *waveobj.Effort) error {
		if err := jarvis.ApplyEffortOpsAs(e, data.Ops, data.Note, time.Now().UnixMilli(), author); err != nil {
			return err
		}
		updated = e
		return nil
	})
	if err != nil {
		return nil, err
	}
	linkSessionToEffort(ctx, data.SourceBlock, data.EffortOID)
	return &wshrpc.CommandEffortMutateRtnData{Effort: updated}, nil
}

func (ws *WshServer) EffortListCommand(ctx context.Context, data wshrpc.CommandEffortListData) (*wshrpc.CommandEffortListRtnData, error) {
	all, err := effortstore.GetAll(ctx)
	if err != nil {
		return nil, err
	}
	var out []wshrpc.EffortSummary
	for _, e := range all {
		if e.Status == "archived" && !data.IncludeArchived {
			continue
		}
		if data.Project != "" && e.Project != data.Project {
			continue
		}
		out = append(out, jarvisstate.EffortSummaryOf(e))
	}
	return &wshrpc.CommandEffortListRtnData{Efforts: out}, nil
}

func (ws *WshServer) EffortGetCommand(ctx context.Context, data wshrpc.CommandEffortGetData) (*wshrpc.CommandEffortGetRtnData, error) {
	e, err := effortstore.Get(ctx, data.EffortOID)
	if err != nil {
		return nil, err
	}
	linkSessionToEffort(ctx, data.SourceBlock, e.OID)
	return &wshrpc.CommandEffortGetRtnData{Effort: e}, nil
}

// linkSessionToEffort records on an agent session's tab the initiative it is working on: the first one it
// read or wrote through `wsh effort`, unless the tab already names one. A tab keeps the initiative it was
// launched for (Work on) or picked in the header: an agent on one initiative often reads another it depends
// on, and that read used to take the session over. The Brief reads the link to send you to an open session
// instead of starting a second one. A run's worker is left alone — its run owns it. Best effort: a failed
// link must not fail the read or write that caused it.
func linkSessionToEffort(ctx context.Context, sourceBlock string, effortOID string) {
	if sourceBlock == "" {
		return
	}
	oref, err := waveobj.ParseORef(sourceBlock)
	if err != nil || oref.OType != waveobj.OType_Block {
		return
	}
	block, err := wstore.DBMustGet[*waveobj.Block](ctx, oref.OID)
	if err != nil {
		return
	}
	tab, err := waveobj.ParseORef(block.ParentORef)
	if err != nil || tab.OType != waveobj.OType_Tab {
		return
	}
	if _, _, ok := ownerRunForBlock(ctx, sourceBlock); ok {
		return
	}
	cur, err := wstore.DBMustGet[*waveobj.Tab](ctx, tab.OID)
	if err != nil || cur.Meta.GetString(waveobj.MetaKey_SessionEffort, "") != "" {
		return
	}
	meta := waveobj.MetaMapType{waveobj.MetaKey_SessionEffort: "effort:" + effortOID}
	changed, err := wstore.UpdateObjectMeta(ctx, tab, meta, false)
	if err != nil {
		log.Printf("effort link: tab %s -> effort %s: %v", tab.OID, effortOID, err)
		return
	}
	if changed {
		wcore.SendWaveObjUpdate(tab)
	}
}

// effortProjectPath is the folder of the initiative's registered project, "" when it has none: the same lookup the
// Brief's Work on uses (initiativework.ts projectPathFor).
func effortProjectPath(project string) string {
	if project == "" {
		return ""
	}
	return strings.TrimSpace(wconfig.GetWatcher().GetFullConfig().Projects[project].Path)
}

// effortHead is the HEAD of the initiative's project checkout, "" when there is none to read. Best effort: a chunk
// written without a base only loses its staleness count.
func effortHead(ctx context.Context, project string) string {
	dir := effortProjectPath(project)
	if dir == "" {
		return ""
	}
	head, err := gitinfo.HeadCommit(ctx, dir)
	if err != nil {
		return ""
	}
	return head
}

func (ws *WshServer) EffortChunkDriftCommand(ctx context.Context, data wshrpc.CommandEffortChunkDriftData) (*wshrpc.CommandEffortChunkDriftRtnData, error) {
	e, err := effortstore.Get(ctx, effortstore.BareOID(data.EffortOID))
	if err != nil {
		return nil, err
	}
	idx, err := jarvis.ResolveChunkIndex(e, data.Chunk)
	if err != nil {
		return nil, err
	}
	c := e.Chunks[idx]
	base := c.BaseCommit
	dir := effortProjectPath(e.Project)
	if dir == "" {
		return &wshrpc.CommandEffortChunkDriftRtnData{Base: base}, nil
	}
	// a chunk older than BaseCommit is measured from the commit HEAD was at when it was written (ChunkWrittenTs)
	written := jarvis.ChunkWrittenTs(e, c)
	var hist *jarvis.StaleHistory
	if written > 0 {
		hist, _ = staleHistoryFor(ctx, dir, written-staleMarginMs)
	}
	inferred := false
	if base == "" {
		if hist != nil {
			base = hist.InferredBase(c, written)
		}
		if base == "" && written > 0 {
			base, _ = gitinfo.CommitBefore(ctx, dir, written/1000)
		}
		if base == "" {
			return &wshrpc.CommandEffortChunkDriftRtnData{}, nil
		}
		inferred = true
	}
	n, ts, err := gitinfo.CommitsSince(ctx, dir, base)
	if err != nil {
		// a base gone from the checkout (history rewritten, another clone) measures nothing
		return &wshrpc.CommandEffortChunkDriftRtnData{Base: base, Inferred: inferred}, nil
	}
	rtn := &wshrpc.CommandEffortChunkDriftRtnData{Known: true, Base: base, Behind: n, BaseTs: ts, Inferred: inferred}
	if hist != nil {
		if res, ok := hist.AssessChunk(c, written); ok {
			rtn.Files = res.Files
		}
	}
	return rtn, nil
}

func (ws *WshServer) EffortDeleteCommand(ctx context.Context, data wshrpc.CommandEffortDeleteData) error {
	return effortstore.Delete(ctx, data.EffortOID)
}

// pinMu serializes pin calls: the cap is read over every effort and then written effort by effort, so two
// pins racing past the same count would land a seventh.
var pinMu sync.Mutex

// EffortPinCommand pins or unpins an effort to the Brief's cards. A pin is a view preference: it is written
// through the keep-UpdatedTs update, with no event or note, so it neither reorders "most recent" nor shows
// as work. The caller reloads the briefing, as after a mutate.
func (ws *WshServer) EffortPinCommand(ctx context.Context, data wshrpc.CommandEffortPinData) (*wshrpc.CommandEffortPinRtnData, error) {
	oid := effortstore.BareOID(data.EffortOID)
	pinMu.Lock()
	defer pinMu.Unlock()
	all, err := effortstore.GetAll(ctx)
	if err != nil {
		return nil, err
	}
	plan, err := jarvis.PlanPin(all, oid, data.Pin, data.ReplaceOldest, time.Now().UnixMilli())
	if err != nil {
		return nil, err
	}
	if plan.CapReached {
		return &wshrpc.CommandEffortPinRtnData{
			CapReached: true,
			Oldest:     &wshrpc.EffortPinRef{OID: plan.Oldest.OID, Title: plan.Oldest.Title},
		}, nil
	}
	for _, clearOID := range plan.Clear {
		if err := effortstore.UpdateKeepTs(ctx, clearOID, func(e *waveobj.Effort) error {
			e.PinnedTs = 0
			return nil
		}); err != nil {
			return nil, err
		}
	}
	if plan.Stamp != "" {
		if err := effortstore.UpdateKeepTs(ctx, plan.Stamp, func(e *waveobj.Effort) error {
			if e.PinnedTs == 0 {
				e.PinnedTs = plan.StampTs
			}
			return nil
		}); err != nil {
			return nil, err
		}
	}
	return &wshrpc.CommandEffortPinRtnData{Pinned: plan.Pinned}, nil
}

// noteAuthorFor attributes a batch's notes. A source block means `wsh effort` ran in a terminal, which
// in this app is an agent: its tab is the session, and the run owning that tab, if any, is the run. A
// caller-supplied Author is honoured only as "you" — anything else would let a terminal claim the human.
func noteAuthorFor(ctx context.Context, data wshrpc.CommandEffortMutateData) jarvis.NoteAuthor {
	if data.SourceBlock == "" {
		if data.Author == "you" {
			return jarvis.NoteAuthor{Who: "you"}
		}
		return jarvis.NoteAuthor{}
	}
	return agentAuthorForBlock(ctx, data.SourceBlock)
}

// agentAuthorForBlock is the author of what an agent writes from a terminal: the tab of sourceBlock is its session,
// and the run owning that tab, if any, its run (a dag child's included: the run it belongs to). `wsh effort` writes
// notes through it, both a mutate batch (noteAuthorFor) and a create (EffortCreateCommand --proposed).
func agentAuthorForBlock(ctx context.Context, sourceBlock string) jarvis.NoteAuthor {
	by := jarvis.NoteAuthor{Who: "agent"}
	if oref, err := waveobj.ParseORef(sourceBlock); err == nil && oref.OType == waveobj.OType_Block {
		if block, err := wstore.DBMustGet[*waveobj.Block](ctx, oref.OID); err == nil {
			if tab, err := waveobj.ParseORef(block.ParentORef); err == nil && tab.OType == waveobj.OType_Tab {
				by.Session = "agent:" + tab.OID
			}
		}
	}
	if run, _, ok := ownerRunForBlock(ctx, sourceBlock); ok {
		by.Run = "run:" + run.OID
	}
	return by
}
