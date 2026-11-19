// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"errors"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const boardTestBlock = "cccccccc-3333-4333-8333-333333333333"

func TestBoardDrawNeedsABoardAndSomethingToSay(t *testing.T) {
	sent := 0
	send := func(wshrpc.CommandBoardAgentDrawData) (*wshrpc.BoardAgentDrawRtnData, error) {
		sent++
		return &wshrpc.BoardAgentDrawRtnData{}, nil
	}
	for _, board := range []string{"", "   "} {
		if _, _, err := boardDrawStart(boardTestBlock, board, "the briefing", "the steps", send); err == nil {
			t.Errorf("board %q: no error", board)
		}
	}
	for _, blank := range []string{"", "  "} {
		_, _, err := boardDrawStart(boardTestBlock, "Auth flow", blank, blank, send)
		if err == nil || !strings.Contains(err.Error(), "--ask") || !strings.Contains(err.Error(), "--context") {
			t.Errorf("blank %q: err = %v", blank, err)
		}
	}
	if sent != 0 {
		t.Errorf("sent %d requests with no board name, or neither --context nor --ask", sent)
	}
}

func TestBoardDrawSendsTheTrimmedRequest(t *testing.T) {
	cases := []struct {
		name, board, brief, ask string
		want                    wshrpc.CommandBoardAgentDrawData
	}{
		{"ask alone", "Auth flow", " ", " add the retry path ",
			wshrpc.CommandBoardAgentDrawData{BlockId: boardTestBlock, Board: "Auth flow", Ask: "add the retry path"}},
		{"context alone", " auth flow ", " the briefing ", "",
			wshrpc.CommandBoardAgentDrawData{BlockId: boardTestBlock, Board: "auth flow", Context: "the briefing"}},
		{"both", "Auth flow", " the briefing ", " the steps ",
			wshrpc.CommandBoardAgentDrawData{BlockId: boardTestBlock, Board: "Auth flow", Context: "the briefing", Ask: "the steps"}},
	}
	for _, c := range cases {
		var got []wshrpc.CommandBoardAgentDrawData
		send := func(d wshrpc.CommandBoardAgentDrawData) (*wshrpc.BoardAgentDrawRtnData, error) {
			got = append(got, d)
			return &wshrpc.BoardAgentDrawRtnData{BoardName: "Auth flow", State: "answered"}, nil
		}
		if _, _, err := boardDrawStart(boardTestBlock, c.board, c.brief, c.ask, send); err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if len(got) != 1 || got[0] != c.want {
			t.Errorf("%s: sent %+v, want %+v", c.name, got, c.want)
		}
	}
}

func TestBoardDrawCmdMissingBoardFailsBeforeRpcSetup(t *testing.T) {
	err := boardDrawCmd.PreRunE(boardDrawCmd, nil)
	if err == nil || !strings.Contains(err.Error(), `"board"`) {
		t.Errorf("err = %v, want the missing --board error", err)
	}
}

func TestBoardDrawCmdNeitherContextNorAskFailsBeforeRpcSetup(t *testing.T) {
	flag := boardDrawCmd.Flags().Lookup("board")
	t.Cleanup(func() { flag.Value.Set(""); flag.Changed = false })
	if err := boardDrawCmd.Flags().Set("board", "Auth flow"); err != nil {
		t.Fatal(err)
	}
	err := boardDrawCmd.PreRunE(boardDrawCmd, nil)
	if err == nil || !strings.Contains(err.Error(), "--context") || !strings.Contains(err.Error(), "--ask") {
		t.Errorf("err = %v, want the neither --context nor --ask error", err)
	}
}

// each line is the one the cockpit skill quotes, so a change here changes what an agent is told to expect
func TestBoardDrawPrintsTheLine(t *testing.T) {
	cases := []struct {
		name       string
		rtn        wshrpc.BoardAgentDrawRtnData
		wantLine   string
		wantFailed bool
	}{
		{"answered", wshrpc.BoardAgentDrawRtnData{BoardName: "Auth flow", State: "answered", Added: 7, Changed: 2, Removed: 1},
			`Drawn on board "Auth flow": +7 shapes, 2 changed, 1 removed.`, false},
		{"answered with nothing changed", wshrpc.BoardAgentDrawRtnData{BoardName: "Auth flow", State: "answered"},
			`Drawn on board "Auth flow": +0 shapes, 0 changed, 0 removed.`, false},
		{"still answering", wshrpc.BoardAgentDrawRtnData{BoardName: "Auth flow", State: "answering"},
			`Still drawing on board "Auth flow"; its card in Chat shows when it lands.`, false},
		{"failed", wshrpc.BoardAgentDrawRtnData{BoardName: "Auth flow", State: "failed", Reason: "the drawer timed out"},
			`Couldn't draw on board "Auth flow": the drawer timed out`, true},
		{"failed with no reason", wshrpc.BoardAgentDrawRtnData{BoardName: "Auth flow", State: "failed"},
			`Couldn't draw on board "Auth flow": no reason given`, true},
		{"a state wavesrv does not send", wshrpc.BoardAgentDrawRtnData{BoardName: "Auth flow", State: "stopped"},
			`Couldn't draw on board "Auth flow": the drawer answered with an unknown state "stopped"`, true},
		{"the name the board has wins over the one typed", wshrpc.BoardAgentDrawRtnData{BoardName: "Auth Flow", State: "answered"},
			`Drawn on board "Auth Flow": +0 shapes, 0 changed, 0 removed.`, false},
		{"no name back: the one typed", wshrpc.BoardAgentDrawRtnData{State: "failed", Reason: "x"},
			`Couldn't draw on board "auth flow": x`, true},
	}
	for _, c := range cases {
		send := func(wshrpc.CommandBoardAgentDrawData) (*wshrpc.BoardAgentDrawRtnData, error) {
			rtn := c.rtn
			return &rtn, nil
		}
		line, failed, err := boardDrawStart(boardTestBlock, " auth flow ", "the briefing", "", send)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if line != c.wantLine || failed != c.wantFailed {
			t.Errorf("%s: got (%q, failed=%v), want (%q, failed=%v)", c.name, line, failed, c.wantLine, c.wantFailed)
		}
	}
}

func TestBoardDrawRpcErrorIsReturned(t *testing.T) {
	boom := errors.New("boards are for Claude agents")
	send := func(wshrpc.CommandBoardAgentDrawData) (*wshrpc.BoardAgentDrawRtnData, error) { return nil, boom }
	line, failed, err := boardDrawStart(boardTestBlock, "Auth flow", "the briefing", "", send)
	if !errors.Is(err, boom) || line != "" || failed {
		t.Errorf("got (%q, failed=%v, %v), want the rpc error alone", line, failed, err)
	}
}
