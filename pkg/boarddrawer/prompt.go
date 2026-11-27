// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package boarddrawer

import (
	_ "embed"
	"fmt"
	"strings"
)

const (
	agentRequestLine = "This is the agent's own request: draw it, as a new drawing or as an edit of the drawing it asks " +
		"to change. Never flag it as a question."
	drawLine  = "The person sent this line to be drawn: draw it, even if it reads as a question. Never flag it."
	noAskLine = "none given: draw what the briefing explains."
	// drawingInViewHead opens the line naming the drawing in view
	drawingInViewHead = "The drawing in view: "
	noDrawingLine     = "No drawing is in view: draw this turn's answer as a new drawing."
	// requestDrawingLine stands in for the drawing in view on the agent's request, which has none
	requestDrawingLine = "The agent's request is a new drawing, unless it asks to fix, change or delete a drawing " +
		"already on the board: then it edits that one. Set `\"edit\": true` and `\"drawing\"` to its frame's id, and " +
		"change only its shapes (marked `\"frame\":\"<that id>\"`)."
)

//go:embed drawer-prompt.md
var promptTemplate string

// firstInput is what only a session's first prompt carries.
type firstInput struct {
	BoardName string
	Briefing  string // the board's briefing: the context of its first request, "" when the agent gave none
}

// turnInput is what every turn's prompt carries.
type turnInput struct {
	Scene       Scene
	SelectedIds []string
	DrawingId   string // the frame of the drawing in view when the line was asked; none unless a live frame
	On          string
	Question    string
	Request     bool   // the agent's request: drawn, never flagged
	Context     string // a request's briefing
	Draw        bool   // the person sent this line to be drawn, so it may not be flagged
	AgentTitle  string
	AgentTurns  string // what the board's agent said since the drawer last read it
}

// firstPrompt fills the drawer prompt. One replacer pass, so a placeholder inside the material stays literal.
func firstPrompt(f firstInput, t turnInput) string {
	return strings.NewReplacer(
		"[BOARD]", f.BoardName,
		"[ABOUT]", aboutSection(f, t),
		"[TURN]", turnPrompt(t),
	).Replace(promptTemplate)
}

// agentLabel is how the prompt names the board's agent.
func agentLabel(t turnInput) string {
	if t.AgentTitle != "" {
		return t.AgentTitle
	}
	return "The agent"
}

func aboutSection(f firstInput, t turnInput) string {
	switch {
	case strings.TrimSpace(f.Briefing) == "":
		return "The project's code. Nothing else was handed to you.\n"
	case t.Request && t.Context == f.Briefing:
		return "The briefing the agent sent, in this turn below, and the project's code.\n"
	}
	return fmt.Sprintf("A briefing the agent sent, and the project's code:\n\n<briefing>\n%s\n</briefing>\n", f.Briefing)
}

// fixPrompt asks the drawer, in the same session, to answer the turn it just answered again: Arc refused that answer
// for reason, and nothing was drawn.
func fixPrompt(reason string) string {
	return "## Your answer was refused\n\nArc could not use your last answer, so nothing was drawn: " + reason +
		".\n\nAnswer the same turn again, fixing that and keeping to every rule above. Reply with the JSON object alone.\n"
}

// turnPrompt is a turn's own section: the board as it is now, the selection, and the question or the agent's request.
func turnPrompt(t turnInput) string {
	var b strings.Builder
	b.WriteString("## This turn\n\nThe board now, one shape per line (`update` and `remove` name these ids):\n\n")
	if t.Scene.Text == "" {
		b.WriteString("The board is empty.\n")
	} else {
		b.WriteString(t.Scene.Text + "\n")
	}
	if len(t.SelectedIds) > 0 {
		on := t.On
		if on == "" {
			on = "shapes"
		}
		fmt.Fprintf(&b, "\nSelected: %s (ids %s, marked \"selected\" above). The question is about these shapes.\n",
			on, strings.Join(t.SelectedIds, ", "))
	}
	if t.Request {
		b.WriteString("\n" + requestDrawingLine + "\n")
	} else if title, ok := t.Scene.Frames[t.DrawingId]; ok {
		fmt.Fprintf(&b, "\n%s%q (id %s). A follow-up that changes it sets `\"edit\": true` and changes only its shapes "+
			"(marked `\"frame\":\"%s\"`); a new question gets a new drawing.\n", drawingInViewHead, title, t.DrawingId, t.DrawingId)
	} else {
		b.WriteString("\n" + noDrawingLine + "\n")
	}
	if turns := strings.TrimSpace(t.AgentTurns); turns != "" {
		fmt.Fprintf(&b, "\n%s, the agent this board belongs to, said this since you last heard from it. Draw from it when "+
			"a line asks for what was discussed:\n\n<agent-turns>\n%s\n</agent-turns>\n", agentLabel(t), turns)
	}
	b.WriteString("\n")
	switch {
	case t.Request:
		requestSection(&b, t)
	default:
		b.WriteString("The question: " + strings.TrimSpace(t.Question) + "\n")
		if t.Draw {
			b.WriteString("\n" + drawLine + "\n")
		}
	}
	return b.String()
}

// requestSection is the agent's request: a briefing with its ask, or, on a board it already briefed, one line.
func requestSection(b *strings.Builder, t turnInput) {
	ask := strings.TrimSpace(t.Question)
	if ask == "" {
		ask = noAskLine
	}
	if strings.TrimSpace(t.Context) == "" {
		fmt.Fprintf(b, "%s asks you to draw: %s\n", agentLabel(t), ask)
	} else {
		fmt.Fprintf(b, "%s sent a briefing:\n\n<briefing>\n%s\n</briefing>\n\nIts ask: %s\n", agentLabel(t), t.Context, ask)
	}
	b.WriteString("\n" + agentRequestLine + "\n")
}
