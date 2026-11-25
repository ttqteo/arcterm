// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package boarddrawer

import (
	"strings"
	"testing"
)

func mustScene(t *testing.T, file string, selected []string) Scene {
	t.Helper()
	s, err := SceneSummary([]byte(file), selected)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

const agentName = "claude · waveterm"

func TestPromptFirstTurn(t *testing.T) {
	scene := mustScene(t, sceneFile, nil)
	first := firstPrompt(firstInput{BoardName: "Board talk"}, turnInput{Scene: scene, Question: "How does wavesrv talk to the frontend? [BOARD] [TURN]"})
	for _, want := range []string{
		`"Board talk"`, "The project's code. Nothing else was handed to you.",
		`{"title":"...","add":[],"update":[],"remove":[]}`, `{"question":true}`,
		"## This turn", `"id":"box"`,
		"The question: How does wavesrv talk to the frontend? [BOARD] [TURN]", // material stays literal
	} {
		if !strings.Contains(first, want) {
			t.Errorf("first prompt lacks %q", want)
		}
	}
	for _, gone := range []string{"[ABOUT]", "[HANDOFF]", "[EARLIER]", "elsewhere", "handoff", "summary"} {
		if strings.Contains(first, gone) {
			t.Errorf("first prompt still carries %q", gone)
		}
	}
	if strings.Contains(first, "This is the agent's own request") || strings.Contains(first, "sent to be drawn") {
		t.Errorf("the person's ask the drawer may flag must not say it has to be drawn:\n%s", first)
	}
}

func TestPromptFollowUpIsTheTurnAlone(t *testing.T) {
	added := strings.Replace(sceneFile, `"elements":[`, `"elements":[{"id":"mine","type":"diamond","x":5,"y":500,"width":40,"height":40},`, 1)
	follow := turnPrompt(turnInput{Scene: mustScene(t, added, []string{"box", "mine"}), SelectedIds: []string{"box", "mine"}, On: "wavesrv and 1 more", Question: "Open this up."})
	for _, want := range []string{`"id":"mine"`, `"id":"box","type":"rectangle","x":10,"y":20,"w":180,"h":60,"label":"wavesrv","stroke":"#1e1e1e","selected":true`,
		"Selected: wavesrv and 1 more (ids box, mine", "The question: Open this up."} {
		if !strings.Contains(follow, want) {
			t.Errorf("follow-up lacks %q:\n%s", want, follow)
		}
	}
	for _, not := range []string{"## Your reply", "What this talk is about", agentName} {
		if strings.Contains(follow, not) {
			t.Errorf("a follow-up must carry only the turn section, found %q", not)
		}
	}
	if strings.Contains(turnPrompt(turnInput{Scene: mustScene(t, sceneFile, nil), Question: "q"}), "Selected:") {
		t.Errorf("no selection must list no selected shapes")
	}
}

// the board's briefing is the first request's context: the session's first prompt carries it once
func TestPromptBriefing(t *testing.T) {
	const briefing = "The store keeps talks in sidecars."
	scene := Scene{}

	// the first request is this very turn: the briefing is in the turn section and not repeated above it
	first := firstPrompt(firstInput{BoardName: "Store", Briefing: briefing},
		turnInput{Scene: scene, Request: true, Context: briefing, Question: "Draw the store.", AgentTitle: agentName})
	if strings.Count(first, briefing) != 1 || !strings.Contains(first, "The board is empty.") ||
		!strings.Contains(first, "Its ask: Draw the store.") || !strings.Contains(first, agentName+" sent a briefing") {
		t.Errorf("a first request carries its briefing once, an empty board and its ask:\n%s", first)
	}

	// a later turn starts the session again (a lost session): the briefing goes in the about section
	later := firstPrompt(firstInput{BoardName: "Store", Briefing: briefing}, turnInput{Scene: scene, Question: "And the cache?", AgentTitle: agentName})
	if strings.Count(later, briefing) != 1 || !strings.Contains(later, "<briefing>") || !strings.Contains(later, "The question: And the cache?") {
		t.Errorf("a session restarted on a later turn carries the board's briefing once:\n%s", later)
	}
	if strings.Contains(later, "The project's code. Nothing else") {
		t.Errorf("a board with a briefing must not say nothing was handed over:\n%s", later)
	}
}

func TestPromptRequestAndAsk(t *testing.T) {
	scene := mustScene(t, sceneFile, nil)

	// the agent's request must be drawn, never flagged
	req := turnPrompt(turnInput{Scene: scene, Request: true, Question: "Draw the retry loop.", AgentTitle: agentName})
	if !strings.Contains(req, agentName+" asks you to draw: Draw the retry loop.") || strings.Contains(req, "<briefing>") ||
		!strings.Contains(req, "This is the agent's own request: draw it as a new drawing. Never flag it as a question.") {
		t.Errorf("a one-line request carries its sender and ask, and no briefing block:\n%s", req)
	}
	noAsk := turnPrompt(turnInput{Scene: scene, Request: true, Context: "facts", AgentTitle: agentName})
	if !strings.Contains(noAsk, "none given: draw what the briefing explains.") || !strings.Contains(noAsk, "facts") {
		t.Errorf("a briefing with no ask says to draw what it explains:\n%s", noAsk)
	}

	// the person's ask may be flagged, unless it was sent to be drawn
	ask := turnPrompt(turnInput{Scene: scene, Question: "Why twice?"})
	if strings.Contains(ask, "Never flag") {
		t.Errorf("the person's ask may be flagged:\n%s", ask)
	}
	draw := turnPrompt(turnInput{Scene: scene, Question: "Why twice?", Draw: true})
	if !strings.Contains(draw, "The person sent this line to be drawn: draw it, even if it reads as a question. Never flag it.") {
		t.Errorf("a line sent to be drawn must say so:\n%s", draw)
	}
}

// the drawing in view is named only when the turn's drawing is a live frame; otherwise the turn says none is in view
func TestPromptDrawingInView(t *testing.T) {
	framed := mustScene(t, framedSceneFile, nil)
	inView := turnPrompt(turnInput{Scene: framed, DrawingId: "f1", Question: "Simpler."})
	if !strings.Contains(inView, drawingInViewHead+`"Cache path" (id f1)`) || !strings.Contains(inView, `"edit": true`) ||
		!strings.Contains(inView, `"frame":"f1"`) || strings.Contains(inView, noDrawingLine) {
		t.Errorf("the turn lacks the drawing in view and how an edit is marked:\n%s", inView)
	}
	for _, id := range []string{"", "gonef", "cache", "nothere"} {
		p := turnPrompt(turnInput{Scene: framed, DrawingId: id, Question: "Simpler."})
		if strings.Contains(p, drawingInViewHead) || !strings.Contains(p, "No drawing is in view: draw this turn's answer as a new drawing.") {
			t.Errorf("drawing %q is not a live frame, so none is in view:\n%s", id, p)
		}
	}
	// the agent's request has no drawing in view, even on a board with drawings
	req := turnPrompt(turnInput{Scene: framed, Request: true, Question: "Draw the retry loop."})
	if strings.Contains(req, drawingInViewHead) || !strings.Contains(req, noDrawingLine) || !strings.Contains(req, "as a new drawing") {
		t.Errorf("an agent's request is a new drawing:\n%s", req)
	}
}

// the drawer prompt asks for one short drawing: new or edit, the limits Arc enforces, and nothing the port dropped
func TestPromptOneDrawingAtATime(t *testing.T) {
	first := firstPrompt(firstInput{BoardName: "Board talk"}, turnInput{Scene: Scene{}, Question: "Draw it."})
	for _, want := range []string{
		"One drawing at a time", `"edit": true`, "At most 40 shapes in `add`", "at most 12 words", "An agent's request is always a new drawing",
		"chart", // main's vocabulary stays
	} {
		if !strings.Contains(first, want) {
			t.Errorf("the prompt lacks %q", want)
		}
	}
	for _, gone := range []string{"At most 200 entries", "The whole board is shared", "beside or under what is there", "[ABOUT]", "[TURN]", "elsewhere"} {
		if strings.Contains(first, gone) {
			t.Errorf("the prompt still says %q", gone)
		}
	}
}

// what the agent said since the drawer last read it: a section only when there is something to hand over
func TestPromptAgentTurns(t *testing.T) {
	scene := mustScene(t, sceneFile, nil)
	plain := turnInput{Scene: scene, Question: "Draw what we just discussed."}
	withAgent := plain
	withAgent.AgentTitle, withAgent.AgentTurns = agentName, "Agent: the retry loop backs off twice."
	if p := turnPrompt(withAgent); !strings.Contains(p, withAgent.AgentTurns) || !strings.Contains(p, withAgent.AgentTitle) {
		t.Errorf("the turn lacks the agent's turns:\n%s", p)
	}
	silent := plain
	silent.AgentTitle = agentName
	if turnPrompt(silent) != turnPrompt(plain) {
		t.Errorf("an agent with nothing new must add nothing:\n%s", turnPrompt(silent))
	}
}
