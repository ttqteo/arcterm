// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/effortstore"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/sessionarchive"
	"github.com/wavetermdev/waveterm/pkg/sessionideas"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// wavesrv finds a command's handler by reflection on its name, so a renamed or re-typed method would drop out of the
// wire without an error: this keeps all five, with the interface's signatures, compiled in.
var _ wshrpc.SessionIdeasCommands = (*WshServer)(nil)

// snoozeFor is how long Snooze puts the nudges off.
const snoozeFor = 7 * 24 * time.Hour

// SessionIdeasGetCommand is the store with the session list and the counts of the transcripts on disk (or the seeded
// sessions in fixture mode) against the marks. The list and the counts are computed on each read, never stored.
func (ws *WshServer) SessionIdeasGetCommand(ctx context.Context) (*wshrpc.SessionIdeasData, error) {
	store := sessionideas.Default()
	d, err := store.Load()
	if err != nil {
		return nil, err
	}
	cands, days := sessionIdeasOnDisk()
	d.Sessions, d.Scanned, d.NotYet, d.LeavingSoon = sessionideas.Sessions(d, cands, days, store.Clock())
	return &d, nil
}

// storageMarksTTL is how long the marks Storage's card asks about are kept: its scan asks once for each of thousands of
// sessions, and parsing state.json for each would take minutes.
const storageMarksTTL = 10 * time.Second

var storageMarks struct {
	sync.Mutex
	readAt time.Time
	ok     bool // the store could be read
	marks  []wshrpc.SessionIdeaMark
	paths  map[string]bool // the transcripts with a mark of any outcome
}

// storagePathKey makes two spellings of one transcript path equal: cleaned, and without case on Windows.
func storagePathKey(p string) string {
	p = filepath.Clean(p)
	if runtime.GOOS == "windows" {
		return strings.ToLower(p)
	}
	return p
}

// storageMarkIndex is the marks, read at most once every storageMarksTTL. A store that cannot be read is logged once per
// read, and answers ok false: the card then claims nothing about any session.
func storageMarkIndex() (marks []wshrpc.SessionIdeaMark, paths map[string]bool, ok bool) {
	storageMarks.Lock()
	defer storageMarks.Unlock()
	if storageMarks.paths != nil && time.Since(storageMarks.readAt) < storageMarksTTL {
		return storageMarks.marks, storageMarks.paths, storageMarks.ok
	}
	d, err := sessionideas.Default().Load()
	if err != nil {
		log.Printf("sessionideas: storage: reading the marks, so no session reads as unscanned: %v", err)
	}
	storageMarks.readAt, storageMarks.ok, storageMarks.marks = time.Now(), err == nil, d.Marks
	storageMarks.paths = map[string]bool{}
	for _, m := range d.Marks {
		storageMarks.paths[storagePathKey(m.TranscriptPath)] = true
	}
	return storageMarks.marks, storageMarks.paths, storageMarks.ok
}

// underDir says path lies inside dir.
func underDir(path, dir string) bool {
	rel, err := filepath.Rel(dir, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// sessionIdeasUnscanned is storage.SessionUnscanned: a transcript is unscanned when no scan marked it, of any outcome
// (a skipped session is scanned for good), and a scan would read it (it is not in the archive, and has been quiet for 2
// days). Nothing scans inside a clean: Storage's Scan them first starts one. The transcript's size and mtime are the
// ones the measure just read when it listed the session.
func sessionIdeasUnscanned(path string, size int64, mtime time.Time) bool {
	marks, paths, ok := storageMarkIndex()
	if !ok || paths[storagePathKey(path)] {
		return false
	}
	return sessionideas.Eligible(agentsessions.DigestSession{
		Path: path, Size: size, Mtime: mtime, Archived: underDir(path, sessionarchive.Dir()),
	}, marks, time.Now())
}

// SessionIdeasResolveCommand keeps or drops an idea that waits for review.
func (ws *WshServer) SessionIdeasResolveCommand(ctx context.Context, data wshrpc.CommandSessionIdeasResolveData) error {
	switch data.Op {
	case "drop":
		return dropSessionIdea(sessionideas.Default(), data.ID)
	case "keep":
		return keepSessionIdea(ctx, sessionideas.Default(), data.ID, data.Label)
	}
	return fmt.Errorf("unknown op %q: keep or drop", data.Op)
}

// reviewIdea is the idea with this id, which must still wait for review: keep and drop both settle an idea once.
func reviewIdea(d *wshrpc.SessionIdeasData, id string) (*wshrpc.SessionIdea, error) {
	for i := range d.Ideas {
		if d.Ideas[i].ID != id {
			continue
		}
		if d.Ideas[i].State != wshrpc.SessionIdeaState_Review {
			return nil, fmt.Errorf("idea %s is already %s", id, d.Ideas[i].State)
		}
		return &d.Ideas[i], nil
	}
	return nil, fmt.Errorf("no idea %s", id)
}

// dropSessionIdea is the idea gone from the review list; the scan does not propose it again (its gist stays in the store).
func dropSessionIdea(store *sessionideas.Store, id string) error {
	return store.Update(func(d *wshrpc.SessionIdeasData) error {
		i, err := reviewIdea(d, id)
		if err != nil {
			return err
		}
		i.State = wshrpc.SessionIdeaState_Dropped
		i.ResolvedTs = store.Clock().UnixMilli()
		return nil
	})
}

// keepSessionIdea puts an idea on its initiative as a pending chunk, or makes it a new idea when it has no initiative
// (or the initiative is gone), then marks it kept. The initiative is written inside the store's update, so two keeps of
// one idea cannot both write, and a write the initiative refuses leaves the idea in review.
func keepSessionIdea(ctx context.Context, store *sessionideas.Store, id, label string) error {
	d, err := store.Load()
	if err != nil {
		return err
	}
	first, err := reviewIdea(&d, id)
	if err != nil {
		return err
	}
	if sessionideas.ChunkLabel(*first, label) == "" {
		return fmt.Errorf("idea %s has no gist to name it by: pass a label", id)
	}
	// the project's HEAD stamps the chunk, and git runs here rather than under the store's lock. Best effort, as
	// EffortMutateCommand has it: an effort that cannot be read now fails the same way, and says why, in the write below.
	head := ""
	if oid := effortstore.BareOID(first.EffortOID); oid != "" {
		if e, err := effortstore.Get(ctx, oid); err == nil {
			head = effortHead(ctx, e.Project)
		}
	}
	return store.Update(func(d *wshrpc.SessionIdeasData) error {
		i, err := reviewIdea(d, id)
		if err != nil {
			return err
		}
		now := store.Clock().UnixMilli()
		keptAs, err := writeKeptIdea(ctx, *i, sessionideas.ChunkLabel(*i, label), head, now)
		if err != nil {
			return err
		}
		i.State = wshrpc.SessionIdeaState_Kept
		i.KeptAs = keptAs
		i.ResolvedTs = now
		return nil
	})
}

// writeKeptIdea writes a kept idea to the vault and says where it went (the idea's KeptAs): "chunk:<effort oid>:<label>"
// for a pending chunk on its initiative, "effort:<oid>" for a new idea.
func writeKeptIdea(ctx context.Context, i wshrpc.SessionIdea, name, head string, now int64) (string, error) {
	note := sessionideas.KeepNote(i)
	if oid := effortstore.BareOID(i.EffortOID); oid != "" {
		// the chunk, then its first note: one batch cannot do both, since a batch validates every op before applying any
		err := effortstore.Update(ctx, oid, func(e *waveobj.Effort) error {
			add := []wshrpc.EffortOp{{Op: "addChunk", Label: name, Base: head}}
			if err := jarvis.ApplyEffortOpsAs(e, add, "", now, jarvis.NoteAuthor{}); err != nil {
				return err
			}
			// by exact label, so a label of digits is not read as a position
			text := []wshrpc.EffortOp{{Op: "appendNote", Chunk: jarvis.ExactLabelRef + name, Note: note}}
			return jarvis.ApplyEffortOpsAs(e, text, "", now, jarvis.NoteAuthor{})
		})
		if err == nil {
			return "chunk:" + oid + ":" + name, nil
		}
		if !errors.Is(err, wstore.ErrNotFound) {
			return "", err
		}
		log.Printf("sessionideas: keep %s: initiative %s is gone since the scan, keeping it as a new idea", i.ID, oid)
	}
	// an idea: an initiative with no chunk, written as EffortCreateCommand writes one, but with the note as its first
	e := &waveobj.Effort{
		Title: name, Project: i.Project, Status: "active",
		Notes:  []waveobj.EffortNote{{Ts: now, Text: note}},
		Events: []waveobj.EffortEvent{{Ts: now, Kind: "effort-created"}},
	}
	if err := effortstore.Create(ctx, e); err != nil {
		return "", err
	}
	return "effort:" + e.OID, nil
}

// SessionIdeasMarkCommand records that the person looked (seen) or put the nudges off for a week (snooze).
func (ws *WshServer) SessionIdeasMarkCommand(ctx context.Context, data wshrpc.CommandSessionIdeasMarkData) error {
	store := sessionideas.Default()
	switch data.Op {
	case "seen":
		return store.Update(func(d *wshrpc.SessionIdeasData) error {
			d.SeenTs = store.Clock().UnixMilli()
			return nil
		})
	case "snooze":
		return store.Update(func(d *wshrpc.SessionIdeasData) error {
			d.SnoozedUntil = store.Clock().Add(snoozeFor).UnixMilli()
			return nil
		})
	}
	return fmt.Errorf("unknown op %q: seen or snooze", data.Op)
}

// SessionIdeasScanCommand starts a scan, or stops the one that runs.
func (ws *WshServer) SessionIdeasScanCommand(ctx context.Context, data wshrpc.CommandSessionIdeasScanData) error {
	if data.Stop {
		stopSessionIdeasScan()
		return nil
	}
	return startSessionIdeasScan(sessionideas.ScanOpts{Paths: data.Paths})
}

// SessionIdeasSeedCommand is the dev app's fixture door: it writes Data to the store, turns fixture mode on when Fixture
// is set (a Seed without it leaves the mode as it was), or, with Clear, empties the store and turns the mode off.
func (ws *WshServer) SessionIdeasSeedCommand(ctx context.Context, data wshrpc.CommandSessionIdeasSeedData) error {
	if !wavebase.IsDevMode() && !wavebase.IsDevApp() {
		return errors.New("sessionideasseed is for the dev app only")
	}
	store := sessionideas.Default()
	if data.Clear {
		setSessionIdeasFixture(nil)
		return store.Update(func(d *wshrpc.SessionIdeasData) error {
			*d = wshrpc.SessionIdeasData{}
			return nil
		})
	}
	if err := store.Update(func(d *wshrpc.SessionIdeasData) error {
		*d = data.Data
		return nil
	}); err != nil {
		return err
	}
	if data.Fixture {
		setSessionIdeasFixture(&data)
		log.Printf("sessionideas: fixture mode on, %d sessions", len(data.Sessions))
	}
	return nil
}
