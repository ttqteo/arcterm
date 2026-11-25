// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package boarddrawer

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"strings"
)

const (
	typeText        = "text"
	typeArrow       = "arrow"
	typeFrame       = "frame"
	fillTransparent = "transparent"
)

// Scene is the board as the drawer is shown it: one JSON line per live element, and the types of the ids it shows.
// A drawing is a live frame.
type Scene struct {
	Text    string
	Types   map[string]string // id -> type, for every element the summary lists
	Frames  map[string]string // frame id -> its title
	FrameOf map[string]string // shape id -> the live frame it belongs to; a loose shape is absent
	Shapes  int               // live elements, bound text and frames not counted
}

type sceneElement struct {
	Id              string   `json:"id"`
	Type            string   `json:"type"`
	X               float64  `json:"x"`
	Y               float64  `json:"y"`
	Width           float64  `json:"width"`
	Height          float64  `json:"height"`
	Text            string   `json:"text"`
	OriginalText    string   `json:"originalText"`
	ContainerId     string   `json:"containerId"`
	FrameId         string   `json:"frameId"`
	Name            string   `json:"name"`
	StartBinding    *binding `json:"startBinding"`
	EndBinding      *binding `json:"endBinding"`
	StrokeColor     string   `json:"strokeColor"`
	BackgroundColor string   `json:"backgroundColor"`
	IsDeleted       bool     `json:"isDeleted"`
	GroupIds        []string `json:"groupIds"`
}

type binding struct {
	ElementId string `json:"elementId"`
}

// sceneLine is one element as the drawer reads it; field order is the line's key order.
type sceneLine struct {
	Id       string `json:"id"`
	Type     string `json:"type"`
	X        int    `json:"x"`
	Y        int    `json:"y"`
	W        int    `json:"w"`
	H        int    `json:"h"`
	Text     string `json:"text,omitempty"`
	Label    string `json:"label,omitempty"`
	Start    string `json:"start,omitempty"`
	End      string `json:"end,omitempty"`
	Stroke   string `json:"stroke,omitempty"`
	Fill     string `json:"fill,omitempty"`
	Group    string `json:"group,omitempty"` // the outermost group: a chart's shapes, or shapes grouped by hand
	Frame    string `json:"frame,omitempty"` // the drawing the shape is in
	Selected bool   `json:"selected,omitempty"`
}

// SceneSummary reads a board file into what the drawer is shown: bound text folded into its container's label,
// deleted elements left out, the selected ids marked, a frame's title as its label, and each shape's frame.
func SceneSummary(boardFile []byte, selected []string) (Scene, error) {
	var file struct {
		Elements []sceneElement `json:"elements"`
	}
	if err := json.Unmarshal(boardFile, &file); err != nil {
		return Scene{}, fmt.Errorf("the board file is not an Excalidraw scene: %w", err)
	}
	live := make([]sceneElement, 0, len(file.Elements))
	labels := map[string]string{}
	frames := map[string]string{}
	for _, e := range file.Elements {
		if e.IsDeleted || e.Id == "" {
			continue
		}
		if e.Type == typeText && e.ContainerId != "" {
			labels[e.ContainerId] = elementText(e)
			continue
		}
		if e.Type == typeFrame {
			frames[e.Id] = e.Name
			labels[e.Id] = e.Name
		}
		live = append(live, e)
	}
	scene := Scene{
		Types: make(map[string]string, len(live)), Frames: frames, FrameOf: map[string]string{}, Shapes: len(live) - len(frames),
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	for _, e := range live {
		scene.Types[e.Id] = e.Type
		line := sceneLine{
			Id: e.Id, Type: e.Type, X: round(e.X), Y: round(e.Y), W: round(e.Width), H: round(e.Height),
			Label: labels[e.Id], Stroke: e.StrokeColor, Selected: slices.Contains(selected, e.Id),
		}
		if e.Type == typeText {
			line.Text = elementText(e)
		}
		if len(e.GroupIds) > 0 {
			line.Group = e.GroupIds[len(e.GroupIds)-1]
		}
		if e.BackgroundColor != fillTransparent {
			line.Fill = e.BackgroundColor
		}
		if e.StartBinding != nil {
			line.Start = e.StartBinding.ElementId
		}
		if e.EndBinding != nil {
			line.End = e.EndBinding.ElementId
		}
		// a frame Excalidraw deleted can still be named by its former children
		if _, ok := frames[e.FrameId]; ok {
			line.Frame = e.FrameId
			scene.FrameOf[e.Id] = e.FrameId
		}
		if err := enc.Encode(line); err != nil {
			return Scene{}, err
		}
	}
	scene.Text = strings.TrimSuffix(buf.String(), "\n")
	return scene, nil
}

// elementText prefers the text as typed: Excalidraw's text carries the line breaks its wrapping added.
func elementText(e sceneElement) string {
	if e.OriginalText != "" {
		return e.OriginalText
	}
	return e.Text
}

func round(f float64) int {
	return int(math.Round(f))
}
