// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/sessiontrash"
)

// canvases are the design-local mockups each project keeps in .superpowers/design/<topic>: Agent → Canvas gallery lists
// them and cleans them up, and Settings → Storage counts them. Nothing removes one unless the person asks.

const (
	canvasBoardExt = ".dc.html"
	canvasThumb    = "thumb.png"
	// canvas.json is written by an agent: one far past this is not read
	canvasIndexMax = 1 << 20
)

// canvasSegmentRe is the Go twin of the frontend's isCanvasSegment (view/jarvis/address.ts)
var canvasSegmentRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

func canvasSegment(s string) bool {
	return canvasSegmentRe.MatchString(s) && !strings.Contains(s, "..")
}

// StorageCanvas is one topic folder. Storage prefix: the generated TypeScript names a type by its bare Go name.
type StorageCanvas struct {
	Topic       string   `json:"topic"`
	Project     string   `json:"project"`     // the project's path
	ProjectName string   `json:"projectname"` // its folder name, for the card
	DesignDir   string   `json:"designdir"`   // what CanvasServeCommand serves; the preview is <designdir>/<topic>/thumb.png
	Dir         string   `json:"dir"`         // the topic folder: the clean id
	Boards      []string `json:"boards"`      // board names without .dc.html, in canvas.json order
	ModTs       int64    `json:"modts"`       // unix ms of the newest board (the topic folder's own when it has none)
	ThumbTs     int64    `json:"thumbts"`     // unix ms of thumb.png, 0 when there is none
	Bytes       int64    `json:"bytes"`
}

func designDirOf(project string) string {
	return filepath.Join(project, ".superpowers", "design")
}

// ListCanvases is every registered project's design topics, newest first. A topic whose name is not a plain
// segment, or that is a link, is not a canvas. The result is never nil, nor any topic's Boards: Go marshals a nil
// slice as null, which the gallery would read as still loading.
func ListCanvases(projects []string) []StorageCanvas {
	out := []StorageCanvas{}
	var seen []string
	for _, project := range projects {
		project = filepath.Clean(project)
		dup := false
		for _, s := range seen {
			dup = dup || SamePath(s, project)
		}
		if dup {
			continue
		}
		seen = append(seen, project)
		design := designDirOf(project)
		entries, err := os.ReadDir(design)
		if err != nil {
			continue
		}
		for _, e := range entries {
			dir := filepath.Join(design, e.Name())
			if !e.IsDir() || !canvasSegment(e.Name()) || !isPlainDir(dir) {
				continue
			}
			c := StorageCanvas{Topic: e.Name(), Project: project, ProjectName: filepath.Base(project), DesignDir: design, Dir: dir, Bytes: dirSize(dir)}
			c.Boards, c.ModTs = canvasBoards(dir)
			if c.ModTs == 0 {
				c.ModTs = modMs(dir)
			}
			c.ThumbTs = regularModMs(filepath.Join(dir, canvasThumb))
			out = append(out, c)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.ModTs != b.ModTs {
			return a.ModTs > b.ModTs
		}
		if a.Topic != b.Topic {
			return a.Topic < b.Topic
		}
		return a.Project < b.Project
	})
	return out
}

// canvasBoards is the topic's board names (project/*.dc.html, extension stripped) and the newest board's mtime in
// ms. canvas.json's order comes first, for the boards that exist; the rest follow by name.
func canvasBoards(topicDir string) ([]string, int64) {
	root := filepath.Join(topicDir, "project")
	entries, _ := os.ReadDir(root)
	found := map[string]bool{}
	var newest int64
	for _, e := range entries {
		name, ok := strings.CutSuffix(e.Name(), canvasBoardExt)
		if !ok || name == "" || !e.Type().IsRegular() {
			continue
		}
		found[name] = true
		if info, err := e.Info(); err == nil {
			newest = max(newest, info.ModTime().UnixMilli())
		}
	}
	boards := make([]string, 0, len(found))
	for _, file := range canvasOrder(filepath.Join(root, "canvas.json")) {
		if name, ok := strings.CutSuffix(file, canvasBoardExt); ok && found[name] {
			boards = append(boards, name)
			delete(found, name)
		}
	}
	rest := make([]string, 0, len(found))
	for name := range found {
		rest = append(rest, name)
	}
	sort.Strings(rest)
	return append(boards, rest...), newest
}

// canvasOrder is canvas.json's "order": nothing when the file is missing, large or malformed
func canvasOrder(path string) []string {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > canvasIndexMax {
		return nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var idx struct {
		Order []string `json:"order"`
	}
	if json.Unmarshal(raw, &idx) != nil {
		return nil
	}
	return idx.Order
}

func modMs(path string) int64 {
	if info, err := os.Lstat(path); err == nil {
		return info.ModTime().UnixMilli()
	}
	return 0
}

// regularModMs is a regular file's mtime in ms; a missing file or a link reads as 0
func regularModMs(path string) int64 {
	if info, err := os.Lstat(path); err == nil && info.Mode().IsRegular() {
		return info.ModTime().UnixMilli()
	}
	return 0
}

// canvases lists every topic as a guarded item and moves one to the trash when asked. Guarded keeps it out of the
// bulk cleans and the daily auto-clean, which never pick it.
type canvases struct{}

func (canvases) category() StorageCategory { return CategoryCanvases }

func boardCount(n int) string {
	if n == 1 {
		return "1 board"
	}
	return fmt.Sprintf("%d boards", n)
}

func (canvases) measure(ctx context.Context, env *Env) StorageCategoryReport {
	var items []StorageItem
	for _, c := range ListCanvases(env.ProjectPaths()) {
		items = append(items, StorageItem{ID: c.Dir, Kind: KindCanvas, Label: c.Topic, Detail: c.ProjectName + " · " + boardCount(len(c.Boards)),
			Path: c.Dir, Bytes: c.Bytes, ModTs: c.ModTs, Cleanable: true, Guarded: true})
	}
	return report(CategoryCanvases, items, nil)
}

// canvasOf is the registered project that holds id as a topic folder: id's parent is the project's design folder
// and its name is a plain segment. ok is false for anything else, which no clean may move.
func canvasOf(projects []string, id string) (project, topic string, ok bool) {
	topic = filepath.Base(id)
	if !canvasSegment(topic) {
		return "", "", false
	}
	for _, p := range projects {
		if SamePath(filepath.Dir(id), designDirOf(p)) {
			return p, topic, true
		}
	}
	return "", "", false
}

// freeTrashPath is want, or want with -2, -3… when another entry took the name in the same millisecond (two
// projects with one folder name and one topic): moving onto an existing entry would mix the two.
func freeTrashPath(want string) (string, bool) {
	for i := 1; i < 100; i++ {
		p := want
		if i > 1 {
			p = fmt.Sprintf("%s-%d", want, i)
		}
		if !fileExists(p) {
			return p, true
		}
	}
	return "", false
}

func (canvases) clean(ctx context.Context, env *Env, ids []string, opts CleanOpts) StorageCleanResult {
	var res StorageCleanResult
	for _, id := range ids {
		if opts.Auto {
			skip(&res, id, "canvases are cleaned only when you ask")
			continue
		}
		if !opts.AllowGuarded {
			skip(&res, id, "a canvas moves to the trash only from Clean up in Agent → Canvas gallery")
			continue
		}
		id = filepath.Clean(id)
		project, topic, ok := canvasOf(env.ProjectPaths(), id)
		if !ok {
			skip(&res, id, "not a design canvas of a project")
			continue
		}
		if _, err := os.Lstat(id); errors.Is(err, fs.ErrNotExist) {
			skip(&res, id, "already gone")
			continue
		}
		if !isPlainDir(id) {
			skip(&res, id, "not a folder (a link is never moved)")
			continue
		}
		if err := os.MkdirAll(env.TrashDir, 0o700); err != nil {
			skip(&res, id, "couldn't make the trash: "+err.Error())
			continue
		}
		// the name Purge expires after 7 days: <unix-ms>-<anything>
		name := filepath.Base(project)
		if name == "." || strings.ContainsAny(name, `/\`) {
			name = "project"
		}
		dst, free := freeTrashPath(filepath.Join(env.TrashDir, fmt.Sprintf("%d-canvas-%s-%s", env.Now().UnixMilli(), name, topic)))
		if !free {
			skip(&res, id, "couldn't find a free name in the trash")
			continue
		}
		size := dirSize(id)
		if err := sessiontrash.MoveEntry(id, dst); err != nil {
			skip(&res, id, "couldn't move to the trash: "+err.Error())
			continue
		}
		res.Trashed += size
		res.Cleaned = append(res.Cleaned, id)
	}
	return res
}
