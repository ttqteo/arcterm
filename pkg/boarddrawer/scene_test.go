// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package boarddrawer

import (
	"strings"
	"testing"
)

const sceneFile = `{"type":"excalidraw","version":2,"elements":[
{"id":"box","type":"rectangle","x":10.4,"y":20,"width":180,"height":60,"strokeColor":"#1e1e1e","backgroundColor":"transparent","boundElements":[{"id":"boxlabel","type":"text"}]},
{"id":"boxlabel","type":"text","x":20,"y":30,"width":60,"height":20,"text":"wave\nsrv","originalText":"wavesrv","containerId":"box"},
{"id":"note","type":"text","x":0,"y":200,"width":40,"height":20,"text":"a <note>","strokeColor":"#e03131"},
{"id":"db","type":"ellipse","x":300,"y":20,"width":100,"height":60,"backgroundColor":"#a5d8ff"},
{"id":"link","type":"arrow","x":190,"y":50,"width":110,"height":0,"startBinding":{"elementId":"box"},"endBinding":{"elementId":"db"}},
{"id":"gone","type":"rectangle","x":0,"y":0,"width":10,"height":10,"isDeleted":true},
{"id":"gonelabel","type":"text","x":0,"y":0,"text":"old","containerId":"gone","isDeleted":true}
]}`

func TestSceneSummary(t *testing.T) {
	scene, err := SceneSummary([]byte(sceneFile), []string{"db", "nothere"})
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(scene.Text, "\n")
	if len(lines) != 4 {
		t.Fatalf("want 4 lines (bound text folded, deleted left out), got %d:\n%s", len(lines), scene.Text)
	}
	want := []string{
		`{"id":"box","type":"rectangle","x":10,"y":20,"w":180,"h":60,"label":"wavesrv","stroke":"#1e1e1e"}`,
		`{"id":"note","type":"text","x":0,"y":200,"w":40,"h":20,"text":"a <note>","stroke":"#e03131"}`,
		`{"id":"db","type":"ellipse","x":300,"y":20,"w":100,"h":60,"fill":"#a5d8ff","selected":true}`,
		`{"id":"link","type":"arrow","x":190,"y":50,"w":110,"h":0,"start":"box","end":"db"}`,
	}
	for i, w := range want {
		if lines[i] != w {
			t.Errorf("line %d:\n got %s\nwant %s", i, lines[i], w)
		}
	}
	if scene.Shapes != 4 {
		t.Errorf("shapes: got %d, want 4 (bound text and deleted not counted)", scene.Shapes)
	}
	if scene.Types["box"] != "rectangle" || scene.Types["note"] != "text" || scene.Types["link"] != "arrow" {
		t.Errorf("types: %v", scene.Types)
	}
	if len(scene.Frames) != 0 || len(scene.FrameOf) != 0 {
		t.Errorf("a board with no frame has no drawing: %v %v", scene.Frames, scene.FrameOf)
	}
	for _, hidden := range []string{"boxlabel", "gone", "gonelabel"} {
		if _, ok := scene.Types[hidden]; ok {
			t.Errorf("%q is not shown to the drawer, so it must not be in Types", hidden)
		}
	}
}

// framedSceneFile has two drawings, a loose shape, and a shape whose frame was deleted. Excalidraw keeps a frame after
// its children.
const framedSceneFile = `{"type":"excalidraw","elements":[
{"id":"cache","type":"rectangle","x":0,"y":0,"width":100,"height":50,"frameId":"f1","backgroundColor":"transparent","boundElements":[{"id":"cachelabel","type":"text"}]},
{"id":"cachelabel","type":"text","x":10,"y":10,"width":40,"height":20,"text":"cache","containerId":"cache","frameId":"f1"},
{"id":"f1","type":"frame","x":-20,"y":-20,"width":160,"height":90,"name":"Cache path","backgroundColor":"transparent"},
{"id":"api","type":"ellipse","x":500,"y":0,"width":100,"height":50,"frameId":"f2","backgroundColor":"transparent"},
{"id":"f2","type":"frame","x":480,"y":-20,"width":140,"height":90,"name":"API","backgroundColor":"transparent"},
{"id":"loose","type":"text","x":0,"y":300,"width":40,"height":20,"text":"mine","backgroundColor":"transparent"},
{"id":"orphan","type":"text","x":0,"y":400,"width":40,"height":20,"text":"old","frameId":"gonef","backgroundColor":"transparent"},
{"id":"gonef","type":"frame","x":0,"y":380,"width":60,"height":60,"name":"Gone","isDeleted":true}
]}`

// a drawing is a live frame: its line shows the frame's title as its label, each shape names its frame, and a frame is
// no shape
func TestSceneSummaryFrames(t *testing.T) {
	scene := mustScene(t, framedSceneFile, nil)
	want := []string{
		`{"id":"cache","type":"rectangle","x":0,"y":0,"w":100,"h":50,"label":"cache","frame":"f1"}`,
		`{"id":"f1","type":"frame","x":-20,"y":-20,"w":160,"h":90,"label":"Cache path"}`,
		`{"id":"api","type":"ellipse","x":500,"y":0,"w":100,"h":50,"frame":"f2"}`,
		`{"id":"f2","type":"frame","x":480,"y":-20,"w":140,"h":90,"label":"API"}`,
		`{"id":"loose","type":"text","x":0,"y":300,"w":40,"h":20,"text":"mine"}`,
		`{"id":"orphan","type":"text","x":0,"y":400,"w":40,"h":20,"text":"old"}`,
	}
	if got := strings.Split(scene.Text, "\n"); strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("lines:\n got %s\nwant %s", scene.Text, strings.Join(want, "\n"))
	}
	if len(scene.Frames) != 2 || scene.Frames["f1"] != "Cache path" || scene.Frames["f2"] != "API" {
		t.Errorf("frames: %v (a deleted frame is not a drawing)", scene.Frames)
	}
	if len(scene.FrameOf) != 2 || scene.FrameOf["cache"] != "f1" || scene.FrameOf["api"] != "f2" {
		t.Errorf("frame of: got %v, want cache in f1 and api in f2 (a loose shape, and a shape of a deleted frame, are in none)", scene.FrameOf)
	}
	if scene.Types["f1"] != "frame" || scene.Types["cache"] != "rectangle" {
		t.Errorf("types: %v", scene.Types)
	}
	if scene.Shapes != 4 {
		t.Errorf("shapes: got %d, want 4 (cache, api, loose and orphan; a frame is not a shape)", scene.Shapes)
	}
}

func TestSceneSummaryEmptyAndBroken(t *testing.T) {
	scene, err := SceneSummary([]byte(`{"type":"excalidraw","elements":[]}`), nil)
	if err != nil || scene.Text != "" || scene.Shapes != 0 {
		t.Errorf("empty board: %+v %v", scene, err)
	}
	if _, err := SceneSummary([]byte(`{"elements":[`), nil); err == nil {
		t.Errorf("a file that won't parse must be an error")
	}
}
