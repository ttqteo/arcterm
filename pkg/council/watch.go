// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
)

// watchDebounce is how long a council file stays quiet before Watch publishes it, so a sync tool writing it in
// several steps, or a Save's temp file and rename, publishes once.
const watchDebounce = 300 * time.Millisecond

// Watch watches dir for council files changed from outside the runner (a council synced in from another machine, a
// file removed by hand) and calls publish once per file per burst: a file created, written or renamed in publishes its
// id and project, once it parses (a half-written file waits for its next event); a file that is gone publishes its id
// with deleted. Files that are not <id>.json are ignored. A missing dir is created first. Watch returns once the watch
// is in place, and the watch runs until ctx is done; an error setting it up comes back, later ones are logged.
func Watch(ctx context.Context, dir string, publish func(id, project string, deleted bool)) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create %s: %w", dir, err)
	}
	fw, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("watch %s: %w", dir, err)
	}
	if err := fw.Add(dir); err != nil {
		fw.Close()
		return fmt.Errorf("watch %s: %w", dir, err)
	}
	w := &councilWatch{ctx: ctx, dir: dir, publish: publish, timers: map[string]*time.Timer{}}
	go func() {
		defer func() {
			panichandler.PanicHandler("council:Watch", recover())
		}()
		defer w.stop(fw)
		for {
			select {
			case <-ctx.Done():
				return
			case ev, ok := <-fw.Events:
				if !ok {
					return
				}
				w.event(ev)
			case err, ok := <-fw.Errors:
				if !ok {
					return
				}
				log.Printf("[council] watching %s: %v", dir, err)
			}
		}
	}()
	return nil
}

type councilWatch struct {
	ctx     context.Context
	dir     string
	publish func(id, project string, deleted bool)

	mu     sync.Mutex
	timers map[string]*time.Timer // the pending publish of each council id
}

// watchedId is the council id a path in the watched dir names, or "" when it is not a council file.
func watchedId(path string) string {
	name := filepath.Base(path)
	if !strings.HasSuffix(name, fileExt) {
		return ""
	}
	id := strings.TrimSuffix(name, fileExt)
	if !idRe.MatchString(id) {
		return ""
	}
	return id
}

// event (re)starts the quiet period of the council the event touched.
func (w *councilWatch) event(ev fsnotify.Event) {
	if ev.Op == fsnotify.Chmod {
		return
	}
	id := watchedId(ev.Name)
	if id == "" {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if t, ok := w.timers[id]; ok {
		t.Stop()
	}
	w.timers[id] = time.AfterFunc(watchDebounce, func() { w.fire(id) })
}

// fire publishes the council as the file stands once it went quiet: what decides created or deleted is whether the
// file is there now, not which events came, since a rename over a file reads as a remove and a create.
func (w *councilWatch) fire(id string) {
	defer func() {
		panichandler.PanicHandler("council:Watch fire", recover())
	}()
	w.mu.Lock()
	delete(w.timers, id)
	w.mu.Unlock()
	if w.ctx.Err() != nil {
		return
	}
	c, err := readFile(filepath.Join(w.dir, id+fileExt))
	switch {
	case errors.Is(err, fs.ErrNotExist):
		w.publish(id, "", true)
	case err != nil:
		// most likely still being written: its next write starts a new quiet period
		log.Printf("[council] council file %s changed but does not read yet: %v", id, err)
	default:
		w.publish(id, c.Project, false)
	}
}

// stop closes the watcher and drops the publishes still waiting.
func (w *councilWatch) stop(fw *fsnotify.Watcher) {
	if err := fw.Close(); err != nil {
		log.Printf("[council] closing the watch on %s: %v", w.dir, err)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	for id, t := range w.timers {
		t.Stop()
		delete(w.timers, id)
	}
}
