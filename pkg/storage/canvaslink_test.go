// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// linkProject makes one project holding a canvas (one Main board) per topic, and returns the project and a way to
// reach each topic's folder.
func linkProject(t *testing.T, topics ...string) (project string, dir func(topic string) string) {
	t.Helper()
	project = t.TempDir()
	design := designDirOf(project)
	for _, topic := range topics {
		writeFile(t, filepath.Join(design, topic, "project", "Main.dc.html"), 10)
	}
	return project, func(topic string) string { return filepath.Join(design, topic) }
}

func indexPath(topicDir string) string { return filepath.Join(topicDir, "project", "canvas.json") }

func writeIndex(t *testing.T, topicDir, content string) {
	t.Helper()
	if err := os.WriteFile(indexPath(topicDir), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func readIndex(t *testing.T, topicDir string) map[string]json.RawMessage {
	t.Helper()
	raw, err := os.ReadFile(indexPath(topicDir))
	if err != nil {
		t.Fatal(err)
	}
	var idx map[string]json.RawMessage
	if err := json.Unmarshal(raw, &idx); err != nil {
		t.Fatalf("canvas.json is not a JSON object (%v): %s", err, raw)
	}
	return idx
}

// asValue decodes one raw JSON value, so two spellings of the same value compare equal
func asValue(t *testing.T, raw json.RawMessage) any {
	t.Helper()
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("not JSON (%v): %s", err, raw)
	}
	return v
}

func stringsAt(t *testing.T, idx map[string]json.RawMessage, key string) []string {
	t.Helper()
	var out []string
	if err := json.Unmarshal(idx[key], &out); err != nil {
		t.Fatalf("%s is not a list of strings (%v): %s", key, err, idx[key])
	}
	return out
}

func stringAt(t *testing.T, idx map[string]json.RawMessage, key string) string {
	t.Helper()
	var out string
	if err := json.Unmarshal(idx[key], &out); err != nil {
		t.Fatalf("%s is not a string (%v): %s", key, err, idx[key])
	}
	return out
}

func noTempLeft(t *testing.T, topicDir string) {
	t.Helper()
	entries, _ := os.ReadDir(filepath.Join(topicDir, "project"))
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".tmp") {
			t.Fatalf("temp file %s left in %s", e.Name(), topicDir)
		}
	}
}

const fullIndex = `{"v":3,"createdOnFiles":{"v":1,"at":"2026-10-01T08:00:00Z"},"title":"Home","launch":{"view":"canvas"},` +
	`"pages":[],"boards":{"Main.dc.html":{"x":0,"y":0,"w":1440,"h":900,"title":"Main <&> screen","is_interactive":true}},` +
	`"order":["Main.dc.html"],"notes":{"Main.dc.html":["keep this"]},"designSystems":[],"somethingNew":{"n":12345678901234567890}}`

func TestSetCanvasLinkWritesBothFieldsAndKeepsEveryOtherKey(t *testing.T) {
	project, dir := linkProject(t, "home-fresh", "home")
	writeIndex(t, dir("home-fresh"), fullIndex)
	var before map[string]json.RawMessage
	if err := json.Unmarshal([]byte(fullIndex), &before); err != nil {
		t.Fatal(err)
	}

	if err := SetCanvasLink([]string{project}, dir("home-fresh"), "home", []string{"menu", "chat", "menu"}); err != nil {
		t.Fatal(err)
	}

	after := readIndex(t, dir("home-fresh"))
	if got := stringAt(t, after, "replaces"); got != "home" {
		t.Fatalf("replaces = %q, want home", got)
	}
	if got := stringsAt(t, after, "notreplaces"); !reflect.DeepEqual(got, []string{"chat", "menu"}) {
		t.Fatalf("notreplaces = %v, want the topics deduped and sorted", got)
	}
	for _, key := range []string{"v", "createdOnFiles", "title", "launch", "pages", "boards", "order", "notes", "designSystems", "somethingNew"} {
		if !reflect.DeepEqual(asValue(t, after[key]), asValue(t, before[key])) {
			t.Fatalf("key %q is %s, want %s kept", key, after[key], before[key])
		}
	}
	if len(after) != len(before)+2 {
		t.Fatalf("keys = %d, want the %d kept plus replaces and notreplaces", len(after), len(before))
	}
	// a big number in a key Arc does not read must survive the rewrite digit for digit
	if !bytes.Contains(after["somethingNew"], []byte("12345678901234567890")) {
		t.Fatalf("somethingNew = %s, want its number kept exactly", after["somethingNew"])
	}
	// and a title with <, > and & is not rewritten into < escapes
	raw, _ := os.ReadFile(indexPath(dir("home-fresh")))
	if !bytes.Contains(raw, []byte("Main <&> screen")) {
		t.Fatalf("canvas.json = %s, want the board title's characters left as they were", raw)
	}
	noTempLeft(t, dir("home-fresh"))

	got := ListCanvases([]string{project})
	var fresh StorageCanvas
	for _, c := range got {
		if c.Topic == "home-fresh" {
			fresh = c
		}
	}
	if fresh.Replaces != "home" || !reflect.DeepEqual(fresh.NotReplaces, []string{"chat", "menu"}) || fresh.Title != "Home" {
		t.Fatalf("ListCanvases reads %+v, want what SetCanvasLink wrote", fresh)
	}
}

func TestSetCanvasLinkEmptyValuesRemoveTheirKeys(t *testing.T) {
	project, dir := linkProject(t, "a", "b")
	writeIndex(t, dir("a"), `{"v":3,"title":"A","replaces":"b","notreplaces":["x"],"launch":{"view":"canvas"},"order":["Main.dc.html"]}`)

	if err := SetCanvasLink([]string{project}, dir("a"), "", nil); err != nil {
		t.Fatal(err)
	}
	idx := readIndex(t, dir("a"))
	if _, ok := idx["replaces"]; ok {
		t.Fatalf("replaces = %s, want the key removed", idx["replaces"])
	}
	if _, ok := idx["notreplaces"]; ok {
		t.Fatalf("notreplaces = %s, want the key removed", idx["notreplaces"])
	}
	if stringAt(t, idx, "title") != "A" || len(idx) != 4 {
		t.Fatalf("keys = %v, want v, title, launch and order kept", idx)
	}

	// an empty (not nil) list removes the key too
	if err := SetCanvasLink([]string{project}, dir("a"), "b", []string{"x"}); err != nil {
		t.Fatal(err)
	}
	if err := SetCanvasLink([]string{project}, dir("a"), "b", []string{}); err != nil {
		t.Fatal(err)
	}
	idx = readIndex(t, dir("a"))
	if _, ok := idx["notreplaces"]; ok || stringAt(t, idx, "replaces") != "b" {
		t.Fatalf("keys = %v, want replaces kept and notreplaces removed", idx)
	}
}

func TestSetCanvasLinkCanRelinkToAnotherCanvas(t *testing.T) {
	project, dir := linkProject(t, "new", "older-one", "older-two")
	if err := SetCanvasLink([]string{project}, dir("new"), "older-one", nil); err != nil {
		t.Fatal(err)
	}
	// the canvas that already replaces older-one is not a fork of itself
	if err := SetCanvasLink([]string{project}, dir("new"), "older-one", []string{"x"}); err != nil {
		t.Fatalf("setting the same replaces again: %v", err)
	}
	if err := SetCanvasLink([]string{project}, dir("new"), "older-two", nil); err != nil {
		t.Fatal(err)
	}
	if got := stringAt(t, readIndex(t, dir("new")), "replaces"); got != "older-two" {
		t.Fatalf("replaces = %q, want older-two", got)
	}
}

func TestSetCanvasLinkGivesAMissingIndexTheMinimalOne(t *testing.T) {
	project, dir := linkProject(t, "old")
	// three boards, no canvas.json: Main leads the order, the rest follow by name
	for _, b := range []string{"Zed", "Alpha"} {
		writeFile(t, filepath.Join(dir("fresh"), "project", b+".dc.html"), 10)
	}
	writeFile(t, filepath.Join(dir("fresh"), "project", "Main.dc.html"), 10)
	made := time.Date(2026, 9, 3, 12, 30, 0, 0, time.UTC)
	for _, b := range []string{"Zed", "Alpha", "Main"} {
		p := filepath.Join(dir("fresh"), "project", b+".dc.html")
		if err := os.Chtimes(p, made, made); err != nil {
			t.Fatal(err)
		}
	}
	before := ListCanvases([]string{project})
	var createdBefore int64
	for _, c := range before {
		if c.Topic == "fresh" {
			createdBefore = c.CreatedTs
		}
	}

	if err := SetCanvasLink([]string{project}, dir("fresh"), "old", []string{"nope"}); err != nil {
		t.Fatal(err)
	}
	idx := readIndex(t, dir("fresh"))
	if string(idx["v"]) != "3" || stringAt(t, idx, "title") != "fresh" || stringAt(t, idx, "replaces") != "old" {
		t.Fatalf("index = %v, want v 3, title = the topic and the link", idx)
	}
	if got := stringsAt(t, idx, "notreplaces"); !reflect.DeepEqual(got, []string{"nope"}) {
		t.Fatalf("notreplaces = %v", got)
	}
	if got := stringsAt(t, idx, "order"); !reflect.DeepEqual(got, []string{"Main.dc.html", "Alpha.dc.html", "Zed.dc.html"}) {
		t.Fatalf("order = %v, want Main first then by name", got)
	}
	var frames map[string]map[string]any
	if err := json.Unmarshal(idx["boards"], &frames); err != nil || len(frames) != 3 {
		t.Fatalf("boards = %s (%v), want one entry per .dc.html on disk", idx["boards"], err)
	}
	// laid out in a row in order: the first at 0, each next 80 px after the one before
	nextX := float64(0)
	for _, file := range stringsAt(t, idx, "order") {
		f, ok := frames[file]
		if !ok || f["w"] != float64(1440) || f["h"] != float64(900) || f["y"] != float64(0) || f["title"] == "" || f["x"] != nextX {
			t.Fatalf("board %s = %v, want a frame at x %v, 1440x900, with a title", file, f, nextX)
		}
		nextX += 1440 + 80
	}
	// the other keys the skill writes, so the canvas stays importable
	for _, key := range []string{"launch", "pages", "notes", "designSystems", "createdOnFiles"} {
		if _, ok := idx[key]; !ok {
			t.Fatalf("index has no %q, want the skill's whole shape", key)
		}
	}

	// writing the index must not move the canvas in time: createdts stays the boards' mtime, not "now"
	var after StorageCanvas
	for _, c := range ListCanvases([]string{project}) {
		if c.Topic == "fresh" {
			after = c
		}
	}
	if after.CreatedTs != createdBefore || after.CreatedTs != made.UnixMilli() {
		t.Fatalf("createdts %d -> %d, want it kept at the boards' time %d", createdBefore, after.CreatedTs, made.UnixMilli())
	}
	if after.Replaces != "old" || !reflect.DeepEqual(after.Boards, []string{"Main", "Alpha", "Zed"}) {
		t.Fatalf("ListCanvases reads %+v, want the link and the order back", after)
	}
	noTempLeft(t, dir("fresh"))
}

func TestSetCanvasLinkReplacesAMalformedIndex(t *testing.T) {
	for name, content := range map[string]string{
		"broken json":   `{not json`,
		"an array":      `[1,2,3]`,
		"null":          `null`,
		"a bare string": `"hello"`,
		"empty":         ``,
	} {
		t.Run(name, func(t *testing.T) {
			project, dir := linkProject(t, "new", "old")
			writeIndex(t, dir("new"), content)
			if err := SetCanvasLink([]string{project}, dir("new"), "old", nil); err != nil {
				t.Fatal(err)
			}
			idx := readIndex(t, dir("new"))
			if stringAt(t, idx, "replaces") != "old" || string(idx["v"]) != "3" || stringAt(t, idx, "title") != "new" {
				t.Fatalf("index = %v, want the minimal file with the link", idx)
			}
			if got := stringsAt(t, idx, "order"); !reflect.DeepEqual(got, []string{"Main.dc.html"}) {
				t.Fatalf("order = %v, want the board on disk", got)
			}
		})
	}
}

func TestSetCanvasLinkOnATopicWithNoBoardsMakesTheFolder(t *testing.T) {
	project := t.TempDir()
	topic := filepath.Join(designDirOf(project), "bare")
	writeFile(t, filepath.Join(topic, "notes.md"), 4)
	writeFile(t, filepath.Join(designDirOf(project), "old", "project", "Main.dc.html"), 4)
	if err := SetCanvasLink([]string{project}, topic, "old", nil); err != nil {
		t.Fatal(err)
	}
	idx := readIndex(t, topic)
	if stringAt(t, idx, "replaces") != "old" || string(idx["boards"]) != "{}" || string(idx["order"]) != "[]" {
		t.Fatalf("index = %v, want the link, no boards and an empty order", idx)
	}
}

func TestSetCanvasLinkRefusals(t *testing.T) {
	project, dir := linkProject(t, "new", "old", "taken", "other")
	// other already replaces taken
	if err := SetCanvasLink([]string{project}, dir("other"), "taken", nil); err != nil {
		t.Fatal(err)
	}
	stranger, strangerDir := linkProject(t, "elsewhere")
	trash := t.TempDir()

	cases := []struct {
		name        string
		projects    []string
		dir         string
		replaces    string
		notReplaces []string
		want        string // a word the reason must hold
	}{
		{"a dir that is not in a registered project", []string{project}, strangerDir("elsewhere"), "", nil, "not a design canvas"},
		{"a project that is not registered", []string{stranger}, dir("new"), "", nil, "not a design canvas"},
		{"a folder that is not a topic", []string{project}, filepath.Join(dir("new"), "project"), "", nil, "not a design canvas"},
		{"the design folder itself", []string{project}, designDirOf(project), "", nil, "not a design canvas"},
		{"an outside folder", []string{project}, trash, "", nil, "not a design canvas"},
		{"a topic that is gone", []string{project}, filepath.Join(designDirOf(project), "gone"), "", nil, "gone"},
		{"itself", []string{project}, dir("new"), "new", nil, "itself"},
		{"a topic that does not exist", []string{project}, dir("new"), "missing", nil, "missing"},
		{"a topic of another project", []string{project, stranger}, dir("new"), "elsewhere", nil, "elsewhere"},
		{"a path as the topic", []string{project}, dir("new"), "../old", nil, "../old"},
		{"a nested path as the topic", []string{project}, dir("new"), "old/project", nil, "old/project"},
		{"a hidden name", []string{project}, dir("new"), ".git", nil, ".git"},
		{"a name with a space", []string{project}, dir("new"), "old canvas", nil, "old canvas"},
		{"a topic with a different case", []string{project}, dir("new"), "OLD", nil, "OLD"},
		{"a topic another canvas already replaces", []string{project}, dir("new"), "taken", nil, "other"},
		{"a bad notreplaces entry", []string{project}, dir("new"), "old", []string{"fine", "../x"}, "../x"},
		{"an empty notreplaces entry", []string{project}, dir("new"), "", []string{""}, "notreplaces"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := SetCanvasLink(tc.projects, tc.dir, tc.replaces, tc.notReplaces)
			if err == nil {
				t.Fatalf("SetCanvasLink(%s, %q, %v) succeeded, want it refused", tc.dir, tc.replaces, tc.notReplaces)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %q, want it to say %q", err, tc.want)
			}
		})
	}
	// every refusal left the canvases as they were: no canvas.json came to be, no temp file stayed
	for _, topic := range []string{"new", "old", "taken"} {
		if fileExists(indexPath(dir(topic))) {
			t.Fatalf("%s got a canvas.json from a refused call", topic)
		}
	}
	if fileExists(filepath.Join(strangerDir("elsewhere"), "project", "canvas.json")) {
		t.Fatal("a canvas of an unregistered project was written")
	}
}

func TestSetCanvasLinkRefusalLeavesTheIndexUntouched(t *testing.T) {
	project, dir := linkProject(t, "new", "old")
	writeIndex(t, dir("new"), fullIndex)
	if err := SetCanvasLink([]string{project}, dir("new"), "missing", []string{"x"}); err == nil {
		t.Fatal("want a missing topic refused")
	}
	raw, err := os.ReadFile(indexPath(dir("new")))
	if err != nil || string(raw) != fullIndex {
		t.Fatalf("canvas.json = %s (%v), want it byte for byte as it was", raw, err)
	}
	noTempLeft(t, dir("new"))
}

func TestSetCanvasLinkForkCheckIgnoresTopicsWithoutAReadableIndex(t *testing.T) {
	// a topic with a malformed index, or none, names nothing: it must not block a link or crash the check
	project, dir := linkProject(t, "new", "old", "broken", "plain")
	writeIndex(t, dir("broken"), `{nope`)
	if err := SetCanvasLink([]string{project}, dir("new"), "old", nil); err != nil {
		t.Fatal(err)
	}
}

func TestSetCanvasLinkRefusesAnIndexItWillNotRewrite(t *testing.T) {
	project, dir := linkProject(t, "big", "old")
	// past 1 MB the gallery does not read it either: rewriting would drop what it holds
	writeIndex(t, dir("big"), `{"title":"big","pad":"`+strings.Repeat("x", canvasIndexMax)+`"}`)
	before, _ := os.ReadFile(indexPath(dir("big")))
	err := SetCanvasLink([]string{project}, dir("big"), "old", nil)
	if err == nil || !strings.Contains(err.Error(), "canvas.json") {
		t.Fatalf("error = %v, want an index past the size limit refused, naming canvas.json", err)
	}
	if after, _ := os.ReadFile(indexPath(dir("big"))); !bytes.Equal(before, after) {
		t.Fatal("a refused call changed canvas.json")
	}
}

func TestSetCanvasLinkRefusesAFolderNamedCanvasJson(t *testing.T) {
	// not a regular file: the same refusal as a linked canvas.json, without needing the privilege to make a link
	project, dir := linkProject(t, "new", "old")
	if err := os.Mkdir(indexPath(dir("new")), 0o755); err != nil {
		t.Fatal(err)
	}
	err := SetCanvasLink([]string{project}, dir("new"), "old", nil)
	if err == nil || !strings.Contains(err.Error(), "canvas.json") {
		t.Fatalf("error = %v, want a canvas.json that is not a file refused", err)
	}
	if info, statErr := os.Stat(indexPath(dir("new"))); statErr != nil || !info.IsDir() {
		t.Fatalf("canvas.json = %v (%v), want the folder left alone", info, statErr)
	}
	noTempLeft(t, dir("new"))
}

func TestSetCanvasLinkNeverFollowsALinkedTopic(t *testing.T) {
	project, _ := linkProject(t, "old")
	elsewhere := t.TempDir()
	writeFile(t, filepath.Join(elsewhere, "project", "Main.dc.html"), 5)
	link := filepath.Join(designDirOf(project), "linked")
	linkDir(t, elsewhere, link)
	if err := SetCanvasLink([]string{project}, link, "old", nil); err == nil {
		t.Fatal("want a linked topic refused")
	}
	if fileExists(filepath.Join(elsewhere, "project", "canvas.json")) {
		t.Fatal("the link's target was written")
	}
}

func TestSetCanvasLinkNeverWritesThroughALinkedIndex(t *testing.T) {
	project, dir := linkProject(t, "new", "old")
	outside := filepath.Join(t.TempDir(), "canvas.json")
	if err := os.WriteFile(outside, []byte(`{"title":"outside"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, indexPath(dir("new"))); err != nil {
		t.Skip("links unavailable:", err)
	}
	if err := SetCanvasLink([]string{project}, dir("new"), "old", nil); err == nil {
		t.Fatal("want a linked canvas.json refused")
	}
	if raw, _ := os.ReadFile(outside); string(raw) != `{"title":"outside"}` {
		t.Fatalf("the link's target is %s, want it untouched", raw)
	}
}
