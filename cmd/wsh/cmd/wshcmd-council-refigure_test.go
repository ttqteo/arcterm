// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestRefigureText(t *testing.T) {
	rtn := &wshrpc.CouncilRefigureRtnData{
		Tokens: 37779,
		Path:   "/p/docs/council/x.md",
		Figures: []council.CouncilFigure{
			{Value: "947", Cite: council.CiteOK, Group: "X.js"},
			{Value: "135", Cite: council.CiteOK, Group: "X.js", Of: "947"},
			{Value: "151", Cite: council.CiteOK, Was: "170", RelNote: "151 is also the earlier value of 170, so not a part of it"},
			{Value: "12", Cite: council.CiteWrong, Group: "never printed"},
			{Value: "464", Cite: council.CiteOK},
		},
	}
	got := refigureText("c1", rtn)
	for _, want := range []string{
		"947                  group X.js\n",
		"135                  group X.js, of 947\n",
		"dropped: 151 is also the earlier value of 170",
		"464                  —\n",
		"council c1: 2 figure(s) linked to another, 1 with a relation dropped, 37779 tokens",
		"rewrote /p/docs/council/x.md",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("output lacks %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "never printed") {
		t.Errorf("an unverified figure was printed:\n%s", got)
	}
	rtn.Path = ""
	if got := refigureText("c1", rtn); !strings.Contains(got, "no saved report") {
		t.Errorf("no report path, output lacks the hint:\n%s", got)
	}
}
