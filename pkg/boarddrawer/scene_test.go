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
	for _, hidden := range []string{"boxlabel", "gone", "gonelabel"} {
		if _, ok := scene.Types[hidden]; ok {
			t.Errorf("%q is not shown to the drawer, so it must not be in Types", hidden)
		}
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
