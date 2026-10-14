// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/sessiontrash"
)

const canvasIndex = `{"v":3,"boards":{"Main.dc.html":{},"Desk.dc.html":{}},"order":["Desk.dc.html","Main.dc.html"]}`

// canvasProject makes a project with one topic holding the named boards (no canvas.json) and returns the topic dir.
func canvasProject(t *testing.T, topic string, boards ...string) (project, topicDir string) {
	t.Helper()
	project = t.TempDir()
	topicDir = filepath.Join(project, ".superpowers", "design", topic)
	for _, b := range boards {
		writeFile(t, filepath.Join(topicDir, "project", b+".dc.html"), 10)
	}
	return project, topicDir
}

func canvasEnv(t *testing.T, projects ...string) *Env {
	t.Helper()
	return &Env{
		Now:          func() time.Time { return time.UnixMilli(1_700_000_000_000) },
		ProjectPaths: func() []string { return projects },
		TrashDir:     filepath.Join(t.TempDir(), "trash"),
	}
}

func TestListCanvases(t *testing.T) {
	a, topic := canvasProject(t, "run-office", "Main", "Desk")
	if err := os.WriteFile(filepath.Join(topic, "project", "canvas.json"), []byte(canvasIndex), 0o644); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(topic, "thumb.png"), 7)
	design := filepath.Join(a, ".superpowers", "design")
	writeFile(t, filepath.Join(design, "bad name", "project", "Main.dc.html"), 3)
	writeFile(t, filepath.Join(design, "notes.txt"), 3)
	b := t.TempDir() // no .superpowers at all

	main := filepath.Join(topic, "project", "Main.dc.html")
	desk := filepath.Join(topic, "project", "Desk.dc.html")
	newest := time.UnixMilli(1_700_000_500_000)
	// the thumb is newer than every board: modts must still be the newest board's
	for p, ts := range map[string]time.Time{main: time.UnixMilli(1_700_000_100_000), desk: newest, filepath.Join(topic, "thumb.png"): time.UnixMilli(1_700_000_900_000)} {
		if err := os.Chtimes(p, ts, ts); err != nil {
			t.Fatal(err)
		}
	}

	got := ListCanvases([]string{a, b})
	if len(got) != 1 {
		t.Fatalf("got %d canvases %+v, want only run-office", len(got), got)
	}
	c := got[0]
	if c.Topic != "run-office" || c.Project != a || c.ProjectName != filepath.Base(a) || c.Dir != topic || c.DesignDir != design {
		t.Fatalf("got %+v, want run-office in project A with its dirs", c)
	}
	if !reflect.DeepEqual(c.Boards, []string{"Desk", "Main"}) {
		t.Fatalf("boards = %v, want canvas.json's order with .dc.html stripped", c.Boards)
	}
	if c.ModTs != newest.UnixMilli() || c.ThumbTs != 1_700_000_900_000 {
		t.Fatalf("modts %d thumbts %d, want the newest board's and the thumb's mtime", c.ModTs, c.ThumbTs)
	}
	if want := dirSize(topic); c.Bytes != want || want == 0 {
		t.Fatalf("bytes = %d, want the topic dir's size %d", c.Bytes, want)
	}
}

func TestListCanvasesSortsBoardsByNameWithoutAnIndex(t *testing.T) {
	a, _ := canvasProject(t, "t", "Zed", "Main", "Alpha")
	got := ListCanvases([]string{a})
	if len(got) != 1 || !reflect.DeepEqual(got[0].Boards, []string{"Alpha", "Main", "Zed"}) {
		t.Fatalf("got %+v, want the boards by name", got)
	}
	if got[0].ThumbTs != 0 {
		t.Fatalf("thumbts = %d, want 0 with no thumb.png", got[0].ThumbTs)
	}
}

func TestListCanvasesKeepsABoardTheIndexDoesNotName(t *testing.T) {
	a, topic := canvasProject(t, "t", "Main", "Extra")
	if err := os.WriteFile(filepath.Join(topic, "project", "canvas.json"), []byte(`{"order":["Gone.dc.html","Main.dc.html"]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	got := ListCanvases([]string{a})
	if len(got) != 1 || !reflect.DeepEqual(got[0].Boards, []string{"Main", "Extra"}) {
		t.Fatalf("got %+v, want Main (indexed, present), then Extra (on disk, unindexed); Gone has no file", got)
	}
}

func TestListCanvasesIgnoresAMalformedIndex(t *testing.T) {
	a, topic := canvasProject(t, "t", "B", "A")
	if err := os.WriteFile(filepath.Join(topic, "project", "canvas.json"), []byte(`{not json`), 0o644); err != nil {
		t.Fatal(err)
	}
	got := ListCanvases([]string{a})
	if len(got) != 1 || !reflect.DeepEqual(got[0].Boards, []string{"A", "B"}) {
		t.Fatalf("got %+v, want the boards by name", got)
	}
}

func TestListCanvasesListsATopicWithNoBoards(t *testing.T) {
	a := t.TempDir()
	topic := filepath.Join(a, ".superpowers", "design", "empty")
	writeFile(t, filepath.Join(topic, "notes.md"), 4)
	got := ListCanvases([]string{a})
	if len(got) != 1 || got[0].Topic != "empty" || len(got[0].Boards) != 0 {
		t.Fatalf("got %+v, want the topic listed with no boards", got)
	}
}

func TestListCanvasesNewestFirstThenByTopic(t *testing.T) {
	a, old := canvasProject(t, "old", "Main")
	b, fresh := canvasProject(t, "fresh", "Main")
	design := filepath.Join(a, ".superpowers", "design")
	// two more topics in A with the same board mtime as each other, between the oldest and the newest
	same := time.UnixMilli(1_700_000_000_000)
	for _, topic := range []string{"b-twin", "a-twin"} {
		p := filepath.Join(design, topic, "project", "Main.dc.html")
		writeFile(t, p, 1)
		if err := os.Chtimes(p, same, same); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chtimes(filepath.Join(old, "project", "Main.dc.html"), same.Add(-time.Hour), same.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(filepath.Join(fresh, "project", "Main.dc.html"), same.Add(time.Hour), same.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	var topics []string
	for _, c := range ListCanvases([]string{a, b}) {
		topics = append(topics, c.Topic)
	}
	if want := []string{"fresh", "a-twin", "b-twin", "old"}; !reflect.DeepEqual(topics, want) {
		t.Fatalf("order = %v, want %v", topics, want)
	}
}

// linkDir makes link point at target: a symlink, or on Windows without the privilege a junction, which is how a
// project's folders are usually linked there
func linkDir(t *testing.T, target, link string) {
	t.Helper()
	err := os.Symlink(target, link)
	if err != nil && runtime.GOOS == "windows" {
		err = exec.Command("cmd", "/c", "mklink", "/J", link, target).Run()
	}
	if err != nil {
		t.Skip("links unavailable:", err)
	}
}

func TestListCanvasesSkipsALinkedTopic(t *testing.T) {
	a, real := canvasProject(t, "real", "Main")
	elsewhere := t.TempDir()
	writeFile(t, filepath.Join(elsewhere, "project", "Main.dc.html"), 5)
	linkDir(t, elsewhere, filepath.Join(filepath.Dir(real), "linked"))
	got := ListCanvases([]string{a})
	if len(got) != 1 || got[0].Topic != "real" {
		t.Fatalf("got %+v, want only the real topic: a link is never listed", got)
	}
}

func TestCanvasProviderCleanNeverMovesALink(t *testing.T) {
	a, real := canvasProject(t, "real", "Main")
	elsewhere := t.TempDir()
	writeFile(t, filepath.Join(elsewhere, "project", "Main.dc.html"), 5)
	link := filepath.Join(filepath.Dir(real), "linked")
	linkDir(t, elsewhere, link)
	res := canvases{}.clean(context.Background(), canvasEnv(t, a), []string{link}, CleanOpts{AllowGuarded: true})
	if len(res.Cleaned) != 0 || len(res.Skipped) != 1 || !fileExists(filepath.Join(elsewhere, "project", "Main.dc.html")) {
		t.Fatalf("got %+v, want the link refused and its target untouched", res)
	}
}

func TestListCanvasesIsNeverNullOnTheWire(t *testing.T) {
	// Go marshals a nil slice as null, which the gallery reads as still loading
	raw, err := json.Marshal(ListCanvases([]string{t.TempDir()}))
	if err != nil || string(raw) != "[]" {
		t.Fatalf("no canvases marshal to %s (%v), want []", raw, err)
	}
	if raw, _ = json.Marshal(ListCanvases(nil)); string(raw) != "[]" {
		t.Fatalf("no projects marshal to %s, want []", raw)
	}
	a := t.TempDir()
	writeFile(t, filepath.Join(a, ".superpowers", "design", "bare", "notes.md"), 1)
	raw, err = json.Marshal(ListCanvases([]string{a}))
	if err != nil || !strings.Contains(string(raw), `"boards":[]`) {
		t.Fatalf("a topic with no boards marshals to %s (%v), want \"boards\":[]", raw, err)
	}
}

func TestCanvasProviderMeasure(t *testing.T) {
	a, topic := canvasProject(t, "run-office", "Main", "Desk")
	rep := canvases{}.measure(context.Background(), canvasEnv(t, a))
	if rep.Category != CategoryCanvases || len(rep.Items) != 1 || rep.Error != "" {
		t.Fatalf("got %+v, want one item in the canvases category", rep)
	}
	it := rep.Items[0]
	want := fmt.Sprintf("%s · 2 boards", filepath.Base(a))
	if it.Kind != KindCanvas || !it.Guarded || !it.Cleanable || it.ID != topic || it.Path != topic || it.Label != "run-office" || it.Detail != want {
		t.Fatalf("got %+v, want a guarded cleanable canvas item with detail %q", it, want)
	}
	if rep.Bytes != it.Bytes || rep.CleanableBytes != 0 {
		t.Fatalf("bytes %d / cleanable %d, want the topic counted and none of it offered to a bulk clean", rep.Bytes, rep.CleanableBytes)
	}
	one, _ := canvasProject(t, "solo", "Main")
	if got := (canvases{}).measure(context.Background(), canvasEnv(t, one)).Items[0].Detail; got != filepath.Base(one)+" · 1 board" {
		t.Fatalf("detail = %q, want \"1 board\" for one board", got)
	}
}

func TestCanvasProviderClean(t *testing.T) {
	a, topic := canvasProject(t, "run-office", "Main")
	env := canvasEnv(t, a)
	design := filepath.Join(a, ".superpowers", "design")
	outside := t.TempDir()
	writeFile(t, filepath.Join(outside, "keep.txt"), 1)
	nested := filepath.Join(topic, "project")

	res := canvases{}.clean(context.Background(), env,
		[]string{outside, nested, filepath.Join(design, "gone"), design}, CleanOpts{AllowGuarded: true})
	if len(res.Cleaned) != 0 || len(res.Skipped) != 4 {
		t.Fatalf("got %+v, want all four refused", res)
	}
	for _, sk := range res.Skipped {
		if sk.Reason == "" {
			t.Fatalf("skipped %q without a reason", sk.ID)
		}
	}
	if !fileExists(filepath.Join(outside, "keep.txt")) || !fileExists(nested) {
		t.Fatal("a refused id must stay on disk")
	}

	if res := (canvases{}).clean(context.Background(), env, []string{topic}, CleanOpts{}); len(res.Cleaned) != 0 || len(res.Skipped) != 1 || !fileExists(topic) {
		t.Fatalf("got %+v, want a call without AllowGuarded to leave the canvas", res)
	}
	if res := (canvases{}).clean(context.Background(), env, []string{topic}, CleanOpts{AllowGuarded: true, Auto: true}); len(res.Cleaned) != 0 || len(res.Skipped) != 1 ||
		!strings.Contains(res.Skipped[0].Reason, "only when you ask") || !fileExists(topic) {
		t.Fatalf("got %+v, want auto-clean to leave canvases", res)
	}

	size := dirSize(topic)
	res = canvases{}.clean(context.Background(), env, []string{topic}, CleanOpts{AllowGuarded: true})
	if len(res.Cleaned) != 1 || res.Cleaned[0] != topic || len(res.Skipped) != 0 || res.Trashed != size || res.Reclaimed != 0 {
		t.Fatalf("got %+v, want the topic cleaned and %d bytes trashed", res, size)
	}
	if fileExists(topic) {
		t.Fatal("the topic must have left the project")
	}
	trashed := filepath.Join(env.TrashDir, fmt.Sprintf("%d-canvas-%s-run-office", env.Now().UnixMilli(), filepath.Base(a)))
	if !fileExists(filepath.Join(trashed, "project", "Main.dc.html")) {
		t.Fatalf("want the topic at %s", trashed)
	}

	// the name shape is what Purge expires
	if n, err := sessiontrash.Purge(env.TrashDir, 0, env.Now().Add(time.Minute)); err != nil || n != 1 || fileExists(trashed) {
		t.Fatalf("Purge removed %d (%v), want the trashed canvas gone", n, err)
	}
	// a second ask finds the topic gone
	if res := (canvases{}).clean(context.Background(), env, []string{topic}, CleanOpts{AllowGuarded: true}); len(res.Skipped) != 1 || len(res.Cleaned) != 0 {
		t.Fatalf("got %+v, want a vanished topic skipped", res)
	}
}

func TestCanvasProviderCleanRefusesAProjectThatIsNotRegistered(t *testing.T) {
	a, topic := canvasProject(t, "t", "Main")
	res := canvases{}.clean(context.Background(), canvasEnv(t, t.TempDir()), []string{topic}, CleanOpts{AllowGuarded: true})
	if len(res.Cleaned) != 0 || len(res.Skipped) != 1 || !fileExists(topic) {
		t.Fatalf("got %+v for %s, want a topic outside every registered project refused", res, a)
	}
}
