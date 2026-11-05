// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"time"

	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
)

// SetCanvasLink writes the version link of the canvas in dir to its canvas.json: replaces is the topic of the older
// canvas it replaces ("" removes the link) and notReplaces the topics the person said it does not replace (empty
// removes the key). Both are set whole; the caller computes them.
//
// Every guard is here, not in the handler: dir must be a topic folder of a registered project (never a link), replaces
// an existing topic of the same project that is not dir itself and that no other canvas already replaces (versions
// form a line, no forks), and every notReplaces entry a topic name. A refused call writes nothing. The rewrite keeps
// every other key of canvas.json as the JSON it was, and is atomic.
func SetCanvasLink(projects []string, dir, replaces string, notReplaces []string) error {
	dir = filepath.Clean(dir)
	project, topic, ok := canvasOf(projects, dir)
	if !ok {
		return fmt.Errorf("%s is not a design canvas of a project", dir)
	}
	if _, err := os.Lstat(dir); errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("canvas %s is already gone", topic)
	}
	if !isPlainDir(dir) {
		return fmt.Errorf("canvas %s is not a folder (a link is never changed)", topic)
	}
	notReplaces, err := cleanNotReplaces(notReplaces)
	if err != nil {
		return err
	}
	if replaces != "" {
		if err := checkReplaces(designDirOf(project), topic, replaces); err != nil {
			return err
		}
	}

	root := filepath.Join(dir, "project")
	if _, err := os.Lstat(root); err == nil && !isPlainDir(root) {
		return fmt.Errorf("canvas %s: its project folder is not a folder (a link is never written through)", topic)
	}
	path := canvasIndexPath(dir)
	idx, state := loadCanvasIndex(path)
	switch state {
	case indexUnusable:
		return fmt.Errorf("canvas %s: canvas.json is a link or a folder, unreadable, or past %d MB, so it is not rewritten", topic, canvasIndexMax>>20)
	case indexMissing, indexMalformed:
		idx = minimalCanvasIndex(dir)
	}
	if replaces == "" {
		delete(idx, "replaces")
	} else {
		idx["replaces"] = rawJSON(replaces)
	}
	if len(notReplaces) == 0 {
		delete(idx, "notreplaces")
	} else {
		idx["notreplaces"] = rawJSON(notReplaces)
	}
	data, err := encodeCanvasIndex(idx)
	if err != nil {
		return fmt.Errorf("canvas %s: couldn't write canvas.json: %w", topic, err)
	}
	if len(data) > canvasIndexMax {
		return fmt.Errorf("canvas %s: canvas.json would pass %d MB, which the gallery does not read", topic, canvasIndexMax>>20)
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return fmt.Errorf("canvas %s: couldn't make its project folder: %w", topic, err)
	}
	if err := fileutil.AtomicWriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("canvas %s: couldn't write canvas.json: %w", topic, err)
	}
	return nil
}

// cleanNotReplaces is the topics deduped and sorted, or an error naming the first that is not a topic name
func cleanNotReplaces(topics []string) ([]string, error) {
	out := make([]string, 0, len(topics))
	for _, t := range topics {
		if !canvasSegment(t) {
			return nil, fmt.Errorf("notreplaces names %q, which is not a canvas topic", t)
		}
		out = append(out, t)
	}
	slices.Sort(out)
	return slices.Compact(out), nil
}

// checkReplaces says why topic may not replace the canvas named replaces, or nil when it may. Another canvas that
// already names it is a fork; a canvas that is not a plain topic folder of this design dir is no target.
func checkReplaces(design, topic, replaces string) error {
	if !canvasSegment(replaces) {
		return fmt.Errorf("%q is not a canvas topic", replaces)
	}
	if replaces == topic {
		return fmt.Errorf("canvas %s can't replace itself", topic)
	}
	topics := canvasTopics(design)
	if !slices.Contains(topics, replaces) {
		return fmt.Errorf("there is no canvas %q in this project to replace", replaces)
	}
	for _, other := range topics {
		if other != topic && readCanvasMeta(canvasIndexPath(filepath.Join(design, other))).Replaces == replaces {
			return fmt.Errorf("canvas %s already replaces %s, and a canvas has at most one newer version", other, replaces)
		}
	}
	return nil
}

// canvasFrame is one board's frame in canvas.json's "boards", in CSS px
type canvasFrame struct {
	X     int    `json:"x"`
	Y     int    `json:"y"`
	W     int    `json:"w"`
	H     int    `json:"h"`
	Title string `json:"title"`
}

// minimalCanvasIndex is the index the arc:design skill writes (skills/design/SKILL.md "The files") for a canvas with
// none, or none that parses: one laid-out frame and one order slot per .dc.html on disk, Main first, then by name.
//
// createdOnFiles.at is the canvas's own time, the one ListCanvases already gave it (the newest board's mtime, else
// the folder's), not now: a canvas that gets its first canvas.json today must not turn into the newest of its project,
// which would flip its pair's older / newer direction.
func minimalCanvasIndex(dir string) map[string]json.RawMessage {
	boards, mod := canvasBoards(dir, []string{"Main" + canvasBoardExt})
	if mod == 0 {
		mod = modMs(dir)
	}
	created := time.Now()
	if mod != 0 {
		created = time.UnixMilli(mod)
	}
	order := make([]string, 0, len(boards))
	frames := make(map[string]canvasFrame, len(boards))
	for i, name := range boards {
		file := name + canvasBoardExt
		order = append(order, file)
		frames[file] = canvasFrame{X: i * (1440 + 80), W: 1440, H: 900, Title: name}
	}
	return map[string]json.RawMessage{
		"v":              rawJSON(3),
		"createdOnFiles": rawJSON(map[string]any{"v": 1, "at": created.UTC().Format(time.RFC3339Nano)}),
		"title":          rawJSON(filepath.Base(dir)),
		"launch":         rawJSON(map[string]string{"view": "canvas"}),
		"pages":          rawJSON([]string{}),
		"boards":         rawJSON(frames),
		"order":          rawJSON(order),
		"notes":          rawJSON(map[string]any{}),
		"designSystems":  rawJSON([]string{}),
	}
}

// rawJSON is v as JSON without Go's HTML escaping, which would turn a < or & in a title into <
func rawJSON(v any) json.RawMessage {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		panic(fmt.Sprintf("canvas.json value %v is not JSON: %v", v, err)) // only strings, numbers, lists and maps of them are passed
	}
	return bytes.TrimSpace(buf.Bytes())
}

// encodeCanvasIndex is the keys as indented JSON, sorted by key (every raw value is kept, only reindented)
func encodeCanvasIndex(idx map[string]json.RawMessage) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(idx); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
