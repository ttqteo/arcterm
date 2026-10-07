// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jarvisstate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
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
		e.Chunks = append(e.Chunks, waveobj.EffortChunk{Label: label, Status: "pending", Owner: seed.Owner})
	}
	if err := effortstore.Create(ctx, e); err != nil {
		return nil, err
	}
	// the created event is the delta source; the trail note documents it for humans
	e.Notes = append(e.Notes, waveobj.EffortNote{Ts: e.CreatedTs, Text: "effort created"})
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
	if _, err := effortstore.Get(ctx, data.EffortOID); err != nil {
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
		}
	}
	author := noteAuthorFor(ctx, data)
	var updated *waveobj.Effort
	err := effortstore.Update(ctx, data.EffortOID, func(e *waveobj.Effort) error {
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

// linkSessionToEffort records on an agent session's tab the initiative it is working on: the one it last
// read or wrote through `wsh effort`. The Brief reads the link to send you to an open session instead of
// starting a second one. A run's worker is left alone — its run owns it. Best effort: a failed link must not
// fail the read or write that caused it.
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

func (ws *WshServer) EffortDeleteCommand(ctx context.Context, data wshrpc.CommandEffortDeleteData) error {
	return effortstore.Delete(ctx, data.EffortOID)
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
	by := jarvis.NoteAuthor{Who: "agent"}
	if oref, err := waveobj.ParseORef(data.SourceBlock); err == nil && oref.OType == waveobj.OType_Block {
		if block, err := wstore.DBMustGet[*waveobj.Block](ctx, oref.OID); err == nil {
			if tab, err := waveobj.ParseORef(block.ParentORef); err == nil && tab.OType == waveobj.OType_Tab {
				by.Session = "agent:" + tab.OID
			}
		}
	}
	if run, _, ok := ownerRunForBlock(ctx, data.SourceBlock); ok {
		by.Run = "run:" + run.OID
	}
	return by
}
