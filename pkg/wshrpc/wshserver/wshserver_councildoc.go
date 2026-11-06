// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"log"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
)

// councilDocSync keeps each project's instruction file in step with its councils' Memory: a save that changes what a
// council has settled (council.DocSection) schedules a rewrite of its project's block (council.SyncProjectDoc) after
// delay, so a run's burst of saves writes the file once. A save that changes nothing settled schedules nothing.
type councilDocSync struct {
	mu     sync.Mutex
	seen   map[string]string      // council id → its section as last seen
	timers map[string]*time.Timer // project → its pending rewrite
	delay  time.Duration
}

var councilDocs = &councilDocSync{seen: map[string]string{}, timers: map[string]*time.Timer{}, delay: 3 * time.Second}

// noteCouncilDoc is told every council publishCouncilChanged announces. The council tests replace it with a no-op, so no
// rewrite outlives a test's temp folders.
var noteCouncilDoc = func(c *council.Council) { councilDocs.note(c) }

// startCouncilDocs brings every project's block up to date once at startup, in the background: a Memory changed while
// wavesrv was down, or before the block existed, would otherwise wait for the council's next change. The council tests
// replace it with a no-op.
var startCouncilDocs = func() { go councilDocs.syncAll() }

func (s *councilDocSync) note(c *council.Council) {
	if c == nil || c.Bench || c.Project == "" {
		return
	}
	key := council.DocSection(c)
	s.mu.Lock()
	prev, known := s.seen[c.Id]
	s.seen[c.Id] = key
	s.mu.Unlock()
	if prev == key || (!known && key == c.Project+"\x00") { // nothing settled changed, or a council first seen with nothing settled
		return
	}
	if old := sectionProject(prev); known && old != c.Project && old != "" {
		s.schedule(old) // moved to another project: the old one loses its section
	}
	s.schedule(c.Project)
}

// forget is a council deleted: its project's block loses its section.
func (s *councilDocSync) forget(c *council.Council) {
	if c == nil || c.Bench || c.Project == "" {
		return
	}
	s.mu.Lock()
	delete(s.seen, c.Id)
	s.mu.Unlock()
	s.schedule(c.Project)
}

// schedule rewrites project's block after delay, or pushes back the rewrite already waiting.
func (s *councilDocSync) schedule(project string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if t := s.timers[project]; t != nil {
		t.Reset(s.delay)
		return
	}
	s.timers[project] = time.AfterFunc(s.delay, func() {
		s.mu.Lock()
		delete(s.timers, project)
		s.mu.Unlock()
		syncCouncilDoc(project)
	})
}

// syncAll rewrites the block of every project a council with something settled belongs to, and seeds what each council
// has settled so its next save is compared against it.
func (s *councilDocSync) syncAll() {
	defer func() {
		panichandler.PanicHandler("councilDocs.syncAll", recover())
	}()
	all, err := council.List("")
	if err != nil {
		log.Printf("[council] project instruction files not brought up to date: %v", err)
		return
	}
	projects := map[string]bool{}
	s.mu.Lock()
	for _, c := range all {
		if c.Bench || c.Project == "" {
			continue
		}
		key := council.DocSection(c)
		if _, known := s.seen[c.Id]; !known {
			s.seen[c.Id] = key
		}
		if key != c.Project+"\x00" {
			projects[c.Project] = true
		}
	}
	s.mu.Unlock()
	for p := range projects {
		syncCouncilDoc(p)
	}
}

// syncCouncilDoc rewrites one project's block and logs what it wrote, or why it could not.
func syncCouncilDoc(project string) {
	defer func() {
		panichandler.PanicHandler("syncCouncilDoc", recover())
	}()
	path, changed, err := council.SyncProjectDoc(project)
	switch {
	case err != nil:
		log.Printf("[council] %s: council decisions not written: %v", project, err)
	case changed:
		log.Printf("[council] %s: council decisions written to %s", project, path)
	}
}

// sectionProject is the project a council.DocSection key names.
func sectionProject(key string) string {
	for i := 0; i < len(key); i++ {
		if key[i] == 0 {
			return key[:i]
		}
	}
	return ""
}
