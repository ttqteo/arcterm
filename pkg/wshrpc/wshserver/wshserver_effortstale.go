// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/gitinfo"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// The stale scan reads one first-parent log per project checkout and keeps it until HEAD moves; a move along the
// same line reads only the new commits. Every chunk of every initiative on that project is then measured in memory.

// staleMarginMs widens a history's reach past the oldest chunk it must place: a chunk's BaseCommit is the HEAD of the
// day it was written, which can be days older than the chunk when the project sat still.
const staleMarginMs = int64(14 * 24 * time.Hour / time.Millisecond)

// staleHeadTTL is how long a read of HEAD stands for: `wsh effort show` asks once per open chunk.
const staleHeadTTL = 3 * time.Second

type staleCacheEntry struct {
	hist     *jarvis.StaleHistory
	headRead time.Time
}

var (
	staleMu    sync.Mutex // guards staleCache; held across a load so two callers never read the same log twice
	staleCache = map[string]*staleCacheEntry{}
)

// staleHistoryFor is dir's history reaching back to at least fromMs.
func staleHistoryFor(ctx context.Context, dir string, fromMs int64) (*jarvis.StaleHistory, error) {
	staleMu.Lock()
	defer staleMu.Unlock()
	cached := staleCache[dir]
	if cached != nil && cached.hist.FromMs <= fromMs && time.Since(cached.headRead) < staleHeadTTL {
		return cached.hist, nil
	}
	head, err := gitinfo.HeadCommit(ctx, dir)
	if err != nil {
		return nil, err
	}
	if cached != nil && cached.hist.FromMs <= fromMs {
		if cached.hist.Head == head {
			cached.headRead = time.Now()
			return cached.hist, nil
		}
		if gitinfo.IsAncestor(ctx, dir, cached.hist.Head, head) {
			if newer, err := gitinfo.FirstParentLog(ctx, dir, 0, cached.hist.Head); err == nil {
				if tracked, err := gitinfo.TrackedFiles(ctx, dir); err == nil {
					commits := append(newer, cached.hist.Commits...)
					h := jarvis.NewStaleHistory(head, cached.hist.FromMs, commits, tracked)
					staleCache[dir] = &staleCacheEntry{hist: h, headRead: time.Now()}
					return h, nil
				}
			}
		}
	}
	if cached != nil && cached.hist.FromMs < fromMs {
		fromMs = cached.hist.FromMs // a reload never reaches less far than the last one did
	}
	commits, err := gitinfo.FirstParentLog(ctx, dir, fromMs, "")
	if err != nil {
		return nil, err
	}
	tracked, err := gitinfo.TrackedFiles(ctx, dir)
	if err != nil {
		return nil, err
	}
	h := jarvis.NewStaleHistory(head, fromMs, commits, tracked)
	staleCache[dir] = &staleCacheEntry{hist: h, headRead: time.Now()}
	return h, nil
}

// staleGroup is the initiatives on one project checkout, and how far back its history must reach.
type staleGroup struct {
	dir     string
	fromMs  int64
	efforts []*waveobj.Effort
}

// staleGroups gathers the initiatives to measure, by project checkout: one, or every one not done or archived.
func staleGroups(ctx context.Context, oid string) ([]*staleGroup, error) {
	var efforts []*waveobj.Effort
	if oid != "" {
		e, err := effortstore.Get(ctx, effortstore.BareOID(oid))
		if err != nil {
			return nil, err
		}
		efforts = []*waveobj.Effort{e}
	} else {
		all, err := effortstore.GetAll(ctx)
		if err != nil {
			return nil, err
		}
		for _, e := range all {
			if e.Status == "active" || e.Status == "paused" {
				efforts = append(efforts, e)
			}
		}
	}
	byDir := map[string]*staleGroup{}
	var groups []*staleGroup
	for _, e := range efforts {
		dir := effortProjectPath(e.Project)
		if dir == "" {
			continue
		}
		oldest := int64(0)
		for _, c := range e.Chunks {
			if w := jarvis.ChunkWrittenTs(e, c); jarvis.ChunkIsScanned(c) && w > 0 && (oldest == 0 || w < oldest) {
				oldest = w
			}
		}
		if oldest == 0 {
			continue
		}
		g := byDir[dir]
		if g == nil {
			g = &staleGroup{dir: dir}
			byDir[dir] = g
			groups = append(groups, g)
		}
		g.efforts = append(g.efforts, e)
		if from := oldest - staleMarginMs; g.fromMs == 0 || from < g.fromMs {
			g.fromMs = from
		}
	}
	return groups, nil
}

// scanStale measures every open plan chunk of the initiatives staleGroups picks (a chunk saved for later is left out);
// it returns only the flagged ones.
func scanStale(ctx context.Context, oid string) ([]wshrpc.EffortStaleEntry, error) {
	groups, err := staleGroups(ctx, oid)
	if err != nil {
		return nil, err
	}
	out := []wshrpc.EffortStaleEntry{}
	for _, g := range groups {
		h, err := staleHistoryFor(ctx, g.dir, g.fromMs)
		if err != nil {
			log.Printf("effort stale: %s: %v", g.dir, err)
			continue
		}
		for _, e := range g.efforts {
			entry := wshrpc.EffortStaleEntry{EffortOID: e.OID, Title: e.Title, Project: e.Project, Chunks: []wshrpc.EffortChunkStale{}}
			for i, c := range e.Chunks {
				if !jarvis.ChunkIsScanned(c) {
					continue
				}
				res, ok := h.AssessChunk(c, jarvis.ChunkWrittenTs(e, c))
				if !ok || len(res.Files) == 0 {
					continue
				}
				res.Index = i + 1
				entry.Chunks = append(entry.Chunks, res)
			}
			if len(entry.Chunks) > 0 || oid != "" {
				out = append(out, entry)
			}
		}
	}
	return out, nil
}

// backfillBases stamps the commit HEAD was at when each open plan chunk with no BaseCommit was written
// (ChunkWrittenTs); a chunk saved for later is left alone. The stamp goes through the keep-UpdatedTs update, with no
// note: it records when the chunk was written, it is not new work. A base an earlier backfill dated by UpdatedTs
// (jarvis.BaseFromBackfill) is re-derived the same way and corrected.
func backfillBases(ctx context.Context, oid string) (int, int, error) {
	groups, err := staleGroups(ctx, oid)
	if err != nil {
		return 0, 0, err
	}
	chunks, efforts := 0, 0
	for _, g := range groups {
		var h *jarvis.StaleHistory
		for _, e := range g.efforts {
			bases := map[string]string{}
			was := map[string]string{} // the base each re-derived chunk held, so a recheck meanwhile is never undone
			for _, c := range e.Chunks {
				written := jarvis.ChunkWrittenTs(e, c)
				if !jarvis.ChunkIsScanned(c) || written <= 0 {
					continue
				}
				if c.BaseCommit != "" {
					if !jarvis.BaseFromBackfill(e, c) {
						continue
					}
					was[c.Label] = c.BaseCommit
					c.BaseCommit = ""
				}
				if h == nil {
					if h, err = staleHistoryFor(ctx, g.dir, g.fromMs); err != nil {
						log.Printf("effort backfill: %s: %v", g.dir, err)
						break
					}
				}
				base := h.InferredBase(c, written)
				if base == "" {
					base, _ = gitinfo.CommitBefore(ctx, g.dir, written/1000)
				}
				if base != "" && base != was[c.Label] {
					bases[c.Label] = base
				}
			}
			if len(bases) == 0 {
				continue
			}
			n := 0
			err := effortstore.UpdateKeepTs(ctx, e.OID, func(st *waveobj.Effort) error {
				for i := range st.Chunks {
					if base, ok := bases[st.Chunks[i].Label]; ok && st.Chunks[i].BaseCommit == was[st.Chunks[i].Label] {
						st.Chunks[i].BaseCommit = base
						n++
					}
				}
				return nil
			})
			if err != nil {
				log.Printf("effort backfill: %s: %v", e.OID, err)
				continue
			}
			if n > 0 {
				chunks += n
				efforts++
			}
		}
	}
	return chunks, efforts, nil
}

func (ws *WshServer) EffortStaleCommand(ctx context.Context, data wshrpc.CommandEffortStaleData) (*wshrpc.CommandEffortStaleRtnData, error) {
	efforts, err := scanStale(ctx, data.EffortOID)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandEffortStaleRtnData{Efforts: efforts, ScannedTs: time.Now().UnixMilli()}, nil
}

func (ws *WshServer) EffortBackfillBaseCommand(ctx context.Context, data wshrpc.CommandEffortBackfillBaseData) (*wshrpc.CommandEffortBackfillBaseRtnData, error) {
	chunks, efforts, err := backfillBases(ctx, data.EffortOID)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandEffortBackfillBaseRtnData{Chunks: chunks, Efforts: efforts}, nil
}

// StartEffortStaleLoop keeps the stale scan ready before anyone opens an initiative: two minutes after start, then
// every 15 minutes, it stamps a base on the chunks that predate BaseCommit and re-reads each project's history when
// its HEAD moved, so a card's check is an in-memory read.
func StartEffortStaleLoop(ctx context.Context) {
	go func() {
		defer func() {
			panichandler.PanicHandler("effort-stale-loop", recover())
		}()
		timer := time.NewTimer(2 * time.Minute)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
			}
			if n, ne, err := backfillBases(ctx, ""); err != nil {
				log.Printf("effort stale: backfill: %v", err)
			} else if n > 0 {
				log.Printf("effort stale: stamped a base on %d chunks in %d initiatives", n, ne)
			}
			if _, err := scanStale(ctx, ""); err != nil {
				log.Printf("effort stale: scan: %v", err)
			}
			timer.Reset(15 * time.Minute)
		}
	}()
}
