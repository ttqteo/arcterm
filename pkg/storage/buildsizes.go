// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
)

// A scan lists build output and never walks it: sizing a repo's node_modules and cargo targets took minutes to hours on
// a loaded machine. A folder is sized when its project's row opens, or by Size all, and the size is kept in
// <data>/storage/buildsizes.json, which a scan reads to fill each listed folder's Bytes and SizedTs.

const (
	buildSizesFile = "buildsizes.json"
	// sizeFreshFor is how long a kept size counts as current for a row open: a size from the last day is shown as is
	sizeFreshFor = 24 * time.Hour
)

// keptSize is what a build folder measured when it was last sized, and when (unix ms).
type keptSize struct {
	Bytes int64 `json:"bytes"`
	Ts    int64 `json:"ts"`
}

// keptSizes is the file: folder path (the item's ID) -> its kept size.
type keptSizes map[string]keptSize

// buildSizesMu orders every read and write of the file in this process.
var buildSizesMu sync.Mutex

// buildSizesPath is the kept-size file, "" when the Env has no data dir: such an Env keeps no sizes, and nothing is
// read or written (the tests' Envs have none).
func buildSizesPath(env *Env) string {
	if env == nil || env.DataDir == "" {
		return ""
	}
	return filepath.Join(env.DataDir, "storage", buildSizesFile)
}

// readKeptSizes reads the file: a missing one is empty, and an unreadable or corrupt one is logged and read as empty,
// never a failed scan. The caller holds buildSizesMu.
func readKeptSizes(env *Env) keptSizes {
	kept := keptSizes{}
	path := buildSizesPath(env)
	if path == "" {
		return kept
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			log.Printf("storage: reading %s: %v\n", path, err)
		}
		return kept
	}
	if err := json.Unmarshal(raw, &kept); err != nil || kept == nil {
		log.Printf("storage: %s is not readable as kept sizes, reading it as empty: %v\n", path, err)
		return keptSizes{}
	}
	return kept
}

// writeKeptSizes writes the file through a temp file and a rename, so a reader never sees half of it. A failure is
// logged: a size not kept is sized again, it never fails the walk. The caller holds buildSizesMu.
func writeKeptSizes(env *Env, kept keptSizes) {
	path := buildSizesPath(env)
	if path == "" {
		return
	}
	raw, err := json.MarshalIndent(kept, "", "  ")
	if err == nil {
		err = os.MkdirAll(filepath.Dir(path), 0o755)
	}
	var tmp *os.File
	if err == nil {
		tmp, err = os.CreateTemp(filepath.Dir(path), "buildsizes-*.tmp")
	}
	if err == nil {
		_, err = tmp.Write(raw)
		if cerr := tmp.Close(); err == nil {
			err = cerr
		}
		if err == nil {
			err = os.Rename(tmp.Name(), path)
		}
		if err != nil {
			_ = os.Remove(tmp.Name())
		}
	}
	if err != nil {
		log.Printf("storage: writing %s: %v\n", path, err)
	}
}

// readBuildSizes is the kept sizes as the file holds them now: read on every scan and every walk, so an outside
// writer's change shows at the next one.
func readBuildSizes(env *Env) keptSizes {
	buildSizesMu.Lock()
	defer buildSizesMu.Unlock()
	return readKeptSizes(env)
}

// updateBuildSizes reads the file, lets change edit it, and writes it back only when its content changed.
func updateBuildSizes(env *Env, change func(keptSizes)) {
	if buildSizesPath(env) == "" {
		return
	}
	buildSizesMu.Lock()
	defer buildSizesMu.Unlock()
	kept := readKeptSizes(env)
	before := maps.Clone(kept)
	change(kept)
	if !maps.Equal(before, kept) {
		writeKeptSizes(env, kept)
	}
}

// dropUnlistedSizes drops the entries of folders a full scan no longer lists.
func dropUnlistedSizes(env *Env, listed []string) {
	keep := make(map[string]bool, len(listed))
	for _, id := range listed {
		keep[id] = true
	}
	updateBuildSizes(env, func(kept keptSizes) {
		maps.DeleteFunc(kept, func(id string, _ keptSize) bool { return !keep[id] })
	})
}

// dropBuildSizes drops the entries of folders a clean removed.
func dropBuildSizes(env *Env, ids ...string) {
	if len(ids) == 0 {
		return
	}
	updateBuildSizes(env, func(kept keptSizes) {
		for _, id := range ids {
			delete(kept, id)
		}
	})
}

// fillKeptSizes returns the category with each item's Bytes and SizedTs from the kept sizes (0 for a folder never
// sized) and its totals rebuilt. It copies: a report already published never changes.
func fillKeptSizes(c StorageCategoryReport, kept keptSizes) StorageCategoryReport {
	items := make([]StorageItem, len(c.Items))
	for i, it := range c.Items {
		k := kept[it.ID]
		it.Bytes, it.SizedTs = k.Bytes, k.Ts
		items[i] = it
	}
	var err error
	if c.Error != "" {
		err = errors.New(c.Error)
	}
	return report(c.Category, items, err)
}

// withKeptSizes refills the build output category of cats from the kept sizes. A scan reads the file at one moment and
// ends later: a walk that landed meanwhile must not be undone by the older read, so whatever stores a build output
// category reads the file again. The caller holds s.mu, which orders this read after every walk's write, since each
// walk lands through landed after writing.
func (s *Scanner) withKeptSizes(cats []StorageCategoryReport) []StorageCategoryReport {
	i := slices.IndexFunc(cats, func(c StorageCategoryReport) bool { return c.Category == CategoryBuildOutput })
	if i < 0 || buildSizesPath(s.env) == "" {
		return cats
	}
	out := slices.Clone(cats)
	out[i] = fillKeptSizes(out[i], readBuildSizes(s.env))
	return out
}

// keptFresh is whether a kept size is from the last day.
func keptFresh(k keptSize, now time.Time) bool {
	return k.Ts != 0 && now.Sub(time.UnixMilli(k.Ts)) < sizeFreshFor
}

// sizeAsk is a project waiting to be sized.
type sizeAsk struct {
	project string
	force   bool // walk its folders whatever their kept sizes' age
}

// sizingState is the build-output sizing queue. Its zero value is idle. The Scanner's mu guards it.
type sizingState struct {
	queue   []sizeAsk
	walking string // the project the worker holds now: its folders are being walked, or about to be skipped
	done    int
	total   int
	running bool // a worker goroutine owns the queue
}

// snapshot is the Sizing a report carries: nil when nothing is queued or walking. It copies, so a report that went
// out never changes.
func (z *sizingState) snapshot() *StorageSizing {
	if len(z.queue) == 0 && z.walking == "" {
		return nil
	}
	queued := make([]string, len(z.queue))
	for i, a := range z.queue {
		queued[i] = a.project
	}
	return &StorageSizing{Queued: queued, Walking: z.walking, Done: z.done, Total: z.total}
}

func sizingEqual(a, b *StorageSizing) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Walking == b.Walking && a.Done == b.Done && a.Total == b.Total && slices.Equal(a.Queued, b.Queued)
}

func indexAsk(queue []sizeAsk, project string) int {
	return slices.IndexFunc(queue, func(a sizeAsk) bool { return SamePath(a.project, project) })
}

// listedProject is a project the last scan listed build output for, and how old its sizes are.
type listedProject struct {
	path   string
	oldest int64 // the oldest SizedTs among its folders; 0 when one was never sized
}

// listedProjects is the projects of the report's build output items (an item's Detail is its project), in the
// report's order.
func listedProjects(rep StorageReport) []listedProject {
	cat, ok := findCategory(rep.Categories, CategoryBuildOutput)
	if !ok {
		return nil
	}
	var out []listedProject
	for _, it := range cat.Items {
		if it.Kind != KindBuild || it.Detail == "" {
			continue
		}
		i := len(out) - 1 // a project's folders are listed together
		if i < 0 || out[i].path != it.Detail {
			i = slices.IndexFunc(out, func(p listedProject) bool { return SamePath(p.path, it.Detail) })
		}
		if i < 0 {
			out = append(out, listedProject{path: it.Detail, oldest: it.SizedTs})
			continue
		}
		out[i].oldest = min(out[i].oldest, it.SizedTs)
	}
	return out
}

// foldersOf is the folders the report lists for a project: sizing walks what the scan decided is build output.
func foldersOf(rep StorageReport, project string) []string {
	cat, _ := findCategory(rep.Categories, CategoryBuildOutput)
	var out []string
	for _, it := range cat.Items {
		if it.Kind == KindBuild && SamePath(it.Detail, project) {
			out = append(out, it.ID)
		}
	}
	return out
}

// SizeBuildOutput queues the folders of projects to be sized in the background, one project at a time, and returns at
// once. Empty projects is every listed project, the oldest size first (never sized, oldest of all; ties in the
// report's order). A project the last report does not list is refused with an error naming it, and the rest is queued.
//
// Without force a project's folders sized in the last 24 h are not walked, and the ask goes to the front of the queue,
// behind the walk in progress, in its own order: a row open must jump a running Size all. With force every folder is
// walked and the ask goes to the back. A project already queued is not queued twice (a non-force ask moves it to the
// front, a force ask makes it force); one being walked is joined, so nothing is queued. ctx ends the sizing between
// projects.
func (s *Scanner) SizeBuildOutput(ctx context.Context, projects []string, force bool) error {
	s.mu.Lock()
	listed := listedProjects(s.report)
	var wanted, refused []string // wanted spells each project as the report does
	if len(projects) == 0 {
		oldestFirst := slices.Clone(listed)
		slices.SortStableFunc(oldestFirst, func(a, b listedProject) int { return cmp.Compare(a.oldest, b.oldest) })
		for _, p := range oldestFirst {
			wanted = append(wanted, p.path)
		}
	}
	for _, ask := range projects {
		i := slices.IndexFunc(listed, func(p listedProject) bool { return SamePath(p.path, ask) })
		switch {
		case i < 0:
			refused = append(refused, ask)
		case !slices.Contains(wanted, listed[i].path):
			wanted = append(wanted, listed[i].path)
		}
	}
	z := &s.sizing
	before := z.snapshot()
	if before == nil {
		z.done, z.total = 0, 0 // nothing queued: this batch counts from 0
	}
	joined := func(p string) bool { return z.walking != "" && SamePath(z.walking, p) }
	if force {
		for _, p := range wanted {
			if joined(p) {
				continue
			}
			if i := indexAsk(z.queue, p); i >= 0 {
				z.queue[i].force = true
				continue
			}
			z.queue = append(z.queue, sizeAsk{project: p, force: true})
			z.total++
		}
	} else {
		var front []sizeAsk
		for _, p := range wanted {
			if joined(p) {
				continue
			}
			ask := sizeAsk{project: p}
			if i := indexAsk(z.queue, p); i >= 0 {
				ask = z.queue[i]
				z.queue = slices.Delete(z.queue, i, i+1)
			} else {
				z.total++
			}
			front = append(front, ask)
		}
		z.queue = append(front, z.queue...)
	}
	start := !z.running && len(z.queue) > 0
	if start {
		z.running = true
	}
	// an idle queue says nothing yet: the worker publishes once it has walked something, so a row open that changes
	// nothing (every size fresh) never flashes Stop sizing
	announce := before != nil && !sizingEqual(before, z.snapshot())
	s.mu.Unlock()
	if start {
		go s.sizeLoop(ctx)
	}
	if announce {
		s.emit()
	}
	if len(refused) > 0 {
		return fmt.Errorf("not a project with build output in the last scan: %s", strings.Join(refused, ", "))
	}
	return nil
}

// StopSizing lets the walk in progress finish and drops the rest of the queue, row-open asks included.
func (s *Scanner) StopSizing() {
	s.mu.Lock()
	z := &s.sizing
	if len(z.queue) == 0 {
		s.mu.Unlock()
		return
	}
	z.queue = nil
	z.total = z.done
	if z.walking != "" {
		z.total++
	}
	s.mu.Unlock()
	s.emit()
}

// walk measures one folder: dirSize, unless a test gates it.
func (s *Scanner) walk(dir string) int64 {
	if s.sizeWalk != nil {
		return s.sizeWalk(dir)
	}
	return dirSize(dir)
}

// sizeLoop is the one worker of the queue: it sizes a project at a time until the queue is empty.
func (s *Scanner) sizeLoop(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil {
			s.mu.Lock()
			s.sizing = sizingState{}
			s.mu.Unlock()
			s.emit()
			panichandler.PanicHandler("storage.sizeLoop", r)
		}
	}()
	for {
		ask, folders, ok := s.nextToSize(ctx)
		if !ok {
			return
		}
		s.sizeProject(ask, folders)
	}
}

// nextToSize takes the front of the queue and marks its project walking, with the folders the last report lists for it.
// With the queue empty (or ctx ended, which drops the rest) the sizing goes idle and the worker ends; the queue's
// counts reset and, when the last report out still showed sizing, a report without it goes out.
func (s *Scanner) nextToSize(ctx context.Context) (sizeAsk, []string, bool) {
	s.mu.Lock()
	z := &s.sizing
	if ctx.Err() != nil {
		z.queue = nil
	}
	if len(z.queue) == 0 {
		*z = sizingState{}
		shown := s.sizingPub != nil
		s.mu.Unlock()
		if shown {
			s.emit()
		}
		return sizeAsk{}, nil, false
	}
	ask := z.queue[0]
	z.queue = z.queue[1:]
	z.walking = ask.project
	folders := foldersOf(s.report, ask.project)
	s.mu.Unlock()
	return ask, folders, true
}

// sizeProject walks the folders of one project that need it, keeps their sizes and publishes the report. A project with
// nothing to walk (every size fresh, and no force) leaves the queue at once, and counts as done.
func (s *Scanner) sizeProject(ask sizeAsk, folders []string) {
	var todo []string
	if buildSizesPath(s.env) != "" {
		kept, now := readBuildSizes(s.env), s.env.Now()
		for _, id := range folders {
			if ask.force || !keptFresh(kept[id], now) {
				todo = append(todo, id)
			}
		}
	}
	if len(todo) > 0 {
		s.emit() // the row's spinner: this project is being walked
		sizes := map[string]int64{}
		for _, id := range todo {
			n := s.walk(id)
			if isPlainDir(id) { // gone or replaced by a link meanwhile: nothing to keep
				sizes[id] = n
			}
		}
		stamp := s.env.Now().UnixMilli()
		updateBuildSizes(s.env, func(kept keptSizes) {
			for id, n := range sizes {
				kept[id] = keptSize{Bytes: n, Ts: stamp}
			}
		})
	}
	s.mu.Lock()
	s.sizing.walking = ""
	s.sizing.done++
	s.mu.Unlock()
	if len(todo) > 0 {
		s.landed(nil) // the report with the new sizes and this progress
		return
	}
	s.mu.Lock()
	changed := !sizingEqual(s.sizing.snapshot(), s.sizingPub)
	s.mu.Unlock()
	if changed {
		s.emit()
	}
}
