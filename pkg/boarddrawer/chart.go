// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package boarddrawer

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

// A chart is the one add entry that is not an Excalidraw skeleton: the drawer gives the numbers, and code lays them out
// as plain shapes (a frame, bars or a line with dots, the zero line, the values and the labels), so the bars are to scale
// however the model counts. The shapes share one group, so the chart moves as one, and stay plain shapes you can edit.

const (
	typeChart = "chart"
	chartBar  = "bar"
	chartLine = "line"

	maxChartPoints    = 24
	defaultChartW     = 480
	defaultChartH     = 280
	minChartW         = 160
	minChartH         = 140
	chartPad          = 16.0
	chartTitleH       = 32.0
	chartValueH       = 22.0
	chartLabelH       = 28.0
	chartFontSize     = 14.0
	chartTitleSize    = 18.0
	chartLabelRunes   = 14
	chartBarShare     = 0.6
	chartDot          = 8.0
	chartFrameStroke  = "#868e96"
	chartDefaultColor = "#1971c2"
	chartDefaultFill  = "#a5d8ff"
)

type chartSpec struct {
	Id     string            `json:"id"`
	Kind   string            `json:"kind"`
	X      *float64          `json:"x"`
	Y      *float64          `json:"y"`
	Width  float64           `json:"width"`
	Height float64           `json:"height"`
	Title  string            `json:"title"`
	Color  string            `json:"color"`
	Data   []json.RawMessage `json:"data"`
}

type chartPoint struct {
	label string
	value float64
}

// parseChart checks a chart entry (n is its place in add, for the reason).
func parseChart(raw json.RawMessage, n int) (chartSpec, []chartPoint, error) {
	var c chartSpec
	if json.Unmarshal(raw, &c) != nil {
		return c, nil, unusable("add entry %d is a chart whose fields have the wrong types", n)
	}
	if c.Kind != chartBar && c.Kind != chartLine {
		return c, nil, unusable("the chart %q has kind %q, not bar or line", c.Id, c.Kind)
	}
	if c.X == nil || c.Y == nil {
		return c, nil, unusable("the chart %q has no x and y", c.Id)
	}
	if len(c.Data) == 0 || len(c.Data) > maxChartPoints {
		return c, nil, unusable("the chart %q has %d data points, not 1 to %d", c.Id, len(c.Data), maxChartPoints)
	}
	points := make([]chartPoint, len(c.Data))
	for i, d := range c.Data {
		var pair []json.RawMessage
		if json.Unmarshal(d, &pair) != nil || len(pair) != 2 {
			return c, nil, unusable("the chart %q's data point %d is not a [label, number] pair", c.Id, i+1)
		}
		var label string
		var value float64
		if json.Unmarshal(pair[0], &label) != nil || json.Unmarshal(pair[1], &value) != nil {
			return c, nil, unusable("the chart %q's data point %d is not a [label, number] pair", c.Id, i+1)
		}
		points[i] = chartPoint{label: strings.TrimSpace(label), value: value}
	}
	if c.Width == 0 {
		c.Width = defaultChartW
	}
	if c.Height == 0 {
		c.Height = defaultChartH
	}
	c.Width = math.Max(c.Width, minChartW)
	c.Height = math.Max(c.Height, minChartH)
	return c, points, nil
}

// chartShapes lays a checked chart out as skeletons. group is the shapes' one group id; ids are "<chart id>-<part>",
// and the frame keeps the chart's own id, so an arrow in the same add can bind to the chart.
func chartShapes(c chartSpec, points []chartPoint, group string) []map[string]any {
	x, y, w, h := *c.X, *c.Y, c.Width, c.Height
	stroke, fill := chartDefaultColor, chartDefaultFill
	if c.Color != "" {
		stroke, fill = c.Color, c.Color
	}
	groups := []string{group}
	var out []map[string]any
	add := func(m map[string]any) {
		m["groupIds"] = groups
		out = append(out, m)
	}
	text := func(id string, cx, top float64, s string, size float64) {
		add(map[string]any{
			"type": typeText, "id": id, "x": round2(cx - textWidth(s, size)/2), "y": round2(top),
			"text": s, "fontSize": size, "strokeColor": "#1e1e1e",
		})
	}

	add(map[string]any{
		"type": "rectangle", "id": c.Id, "x": x, "y": y, "width": w, "height": h,
		"strokeColor": chartFrameStroke, "backgroundColor": fillTransparent, "strokeWidth": 1,
	})
	titleH := 0.0
	if t := strings.TrimSpace(c.Title); t != "" {
		titleH = chartTitleH
		add(map[string]any{
			"type": typeText, "id": c.Id + "-title", "x": x + chartPad, "y": y + chartPad,
			"text": t, "fontSize": chartTitleSize, "strokeColor": "#1e1e1e",
		})
	}

	left, right := x+chartPad, x+w-chartPad
	top, bottom := y+chartPad+titleH+chartValueH, y+h-chartPad-chartLabelH
	lo, hi := 0.0, 0.0
	for _, p := range points {
		lo, hi = math.Min(lo, p.value), math.Max(hi, p.value)
	}
	if hi == lo {
		hi = lo + 1
	}
	yOf := func(v float64) float64 { return top + (hi-v)/(hi-lo)*(bottom-top) }
	zeroY := yOf(0)
	slot := (right - left) / float64(len(points))
	center := func(i int) float64 { return left + slot*(float64(i)+0.5) }

	add(map[string]any{
		"type": "line", "id": c.Id + "-axis", "x": round2(left), "y": round2(zeroY),
		"points": [][2]float64{{0, 0}, {round2(right - left), 0}}, "strokeColor": chartFrameStroke, "strokeWidth": 1,
	})
	if c.Kind == chartBar {
		bw := slot * chartBarShare
		for i, p := range points {
			vy := yOf(p.value)
			add(map[string]any{
				"type": "rectangle", "id": c.Id + "-bar-" + strconv.Itoa(i),
				"x": round2(center(i) - bw/2), "y": round2(math.Min(vy, zeroY)),
				"width": round2(bw), "height": round2(math.Max(math.Abs(zeroY-vy), 1)),
				"strokeColor": stroke, "backgroundColor": fill, "fillStyle": "solid",
			})
		}
	} else {
		if len(points) > 1 {
			x0, y0 := center(0), yOf(points[0].value)
			pts := make([][2]float64, len(points))
			for i, p := range points {
				pts[i] = [2]float64{round2(center(i) - x0), round2(yOf(p.value) - y0)}
			}
			add(map[string]any{
				"type": "line", "id": c.Id + "-line", "x": round2(x0), "y": round2(y0), "points": pts,
				"strokeColor": stroke, "strokeWidth": 2,
			})
		}
		for i, p := range points {
			add(map[string]any{
				"type": "ellipse", "id": c.Id + "-dot-" + strconv.Itoa(i),
				"x": round2(center(i) - chartDot/2), "y": round2(yOf(p.value) - chartDot/2),
				"width": chartDot, "height": chartDot,
				"strokeColor": stroke, "backgroundColor": stroke, "fillStyle": "solid",
			})
		}
	}
	for i, p := range points {
		vy := yOf(p.value)
		valueTop := math.Min(vy, zeroY) - chartValueH + 2
		if p.value < 0 && c.Kind == chartBar {
			valueTop = vy + 4 // under a bar that hangs below zero
		}
		text(c.Id+"-value-"+strconv.Itoa(i), center(i), valueTop, formatValue(p.value), chartFontSize)
		if p.label != "" {
			text(c.Id+"-label-"+strconv.Itoa(i), center(i), bottom+6, shorten(p.label, chartLabelRunes), chartFontSize)
		}
	}
	return out
}

// expandCharts turns each chart entry of add into its shapes, in place, and checks that no id they make is one add
// already uses.
func expandCharts(add []json.RawMessage) ([]json.RawMessage, error) {
	ids := map[string]bool{}
	hasChart := false
	for _, r := range add {
		var e skeletonEntry
		_ = json.Unmarshal(r, &e)
		if e.Id != nil {
			ids[*e.Id] = true
		}
		hasChart = hasChart || e.Type == typeChart
	}
	if !hasChart {
		return add, nil
	}
	out := make([]json.RawMessage, 0, len(add))
	for i, r := range add {
		var e skeletonEntry
		_ = json.Unmarshal(r, &e)
		if e.Type != typeChart {
			out = append(out, r)
			continue
		}
		c, points, err := parseChart(r, i+1)
		if err != nil {
			return nil, err
		}
		for _, s := range chartShapes(c, points, c.Id+"-"+groupSuffix()) {
			id, _ := s["id"].(string)
			if id != c.Id && ids[id] {
				return nil, unusable("the chart %q makes the id %q, which add already uses", c.Id, id)
			}
			b, err := json.Marshal(s)
			if err != nil {
				return nil, unusable("%s", err)
			}
			out = append(out, b)
		}
	}
	return out, nil
}

// a chart's group outlives the answer's ids (the canvas gives its shapes new ones), so it is made unique here
func groupSuffix() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// textWidth guesses a text's width, to centre it under its bar: the canvas measures it for real
func textWidth(s string, size float64) float64 {
	return float64(utf8.RuneCountInString(s)) * size * 0.55
}

func shorten(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	r := []rune(s)
	return string(r[:n-1]) + "…"
}

// formatValue writes a value as a person reads it: 42, 0.61, -3.5 (two decimals at most)
func formatValue(v float64) string {
	return strconv.FormatFloat(math.Round(v*100)/100, 'f', -1, 64)
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}
