// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"errors"
	"fmt"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// boardDrawTimeoutMs is the RPC ceiling. wavesrv waits 9 minutes for the drawer and then answers "answering", so its
// answer reaches wsh before this deadline does.
const boardDrawTimeoutMs = 10 * 60_000

const boardDrawLong = `Ask the drawer of a board in your project to draw. A board is an Excalidraw drawing the person sees beside your Chat.

The drawer only draws: it never edits files, runs commands or answers for you. It reads this conversation itself, so keep
what you pass short.

  --context  the briefing: what the person asked, the facts and the files involved. It briefs the drawer, and it makes
             the board when your project has none with that name, so a new board needs it.
  --ask      the one line the drawer answers on the board ("add the retry path"). Alone, once the board exists.

Pass --context, --ask or both. The command waits for the drawing (up to 9 minutes) and prints one line:

  Drawn on board "<name>": +A shapes, C changed, R removed.
  Still drawing on board "<name>"; its card in Chat shows when it lands.
  Couldn't draw on board "<name>": <reason>        (exit 1)

Run it with a Bash timeout of 600000 ms.`

var boardCmd = &cobra.Command{
	Use:   "board",
	Short: "Arc's boards: named drawings per project, each drawn by a separate read-only drawer",
	Args:  cobra.NoArgs,
	RunE:  func(cmd *cobra.Command, args []string) error { return cmd.Help() },
}

var boardDrawCmd = &cobra.Command{
	Use:   "draw --board <name> [--context \"<briefing>\"] [--ask \"<question>\"]",
	Short: "ask the drawer of the named board in your project to draw; --context briefs it and makes the board when none has that name",
	Long:  boardDrawLong,
	Args:  cobra.NoArgs,
	// cobra checks required flags only after PreRunE, so a missing --board, --context and --ask is caught before the rpc setup
	PreRunE: func(cmd *cobra.Command, args []string) error {
		if err := cmd.ValidateRequiredFlags(); err != nil {
			return err
		}
		brief, _ := cmd.Flags().GetString("context")
		ask, _ := cmd.Flags().GetString("ask")
		if err := checkBoardDrawText(brief, ask); err != nil {
			return err
		}
		return preRunSetupRpcClient(cmd, args)
	},
	RunE: boardDrawRun,
}

func init() {
	boardDrawCmd.Flags().String("board", "", "the board's name (any case); a new board when none has it")
	boardDrawCmd.Flags().String("context", "", "the briefing: what the person asked, the facts and the files involved; needed when the board is new")
	boardDrawCmd.Flags().String("ask", "", "the one line the drawer answers on the board; alone, once the board exists")
	boardDrawCmd.MarkFlagRequired("board")
	boardCmd.AddCommand(boardDrawCmd)
	rootCmd.AddCommand(boardCmd)
}

func boardDrawRun(cmd *cobra.Command, args []string) error {
	board, _ := cmd.Flags().GetString("board")
	brief, _ := cmd.Flags().GetString("context")
	ask, _ := cmd.Flags().GetString("ask")
	oref, err := resolveBlockArg()
	if err != nil {
		return err
	}
	// a daemon-hosted Claude session is shown in the tab attached to it, which is the agent's tab; the environment's
	// block is the tab that first started the daemon (wshcmd-agenthosted.go)
	if blockArg == "" {
		target, drop := statusTarget(oref)
		if drop {
			return errors.New("the session runs in the Claude daemon with no arcterm tab attached")
		}
		oref = target
	}
	send := func(data wshrpc.CommandBoardAgentDrawData) (*wshrpc.BoardAgentDrawRtnData, error) {
		return wshclient.BoardAgentDrawCommand(RpcClient, data, &wshrpc.RpcOpts{Timeout: boardDrawTimeoutMs})
	}
	line, failed, err := boardDrawStart(oref.OID, board, brief, ask, send)
	if err != nil {
		return err
	}
	if failed {
		// the line is the whole message: returning it as an error would put cobra's "Error: " in front of it
		WriteStderr("%s\n", line)
		WshExitCode = 1
		return nil
	}
	fmt.Println(line)
	return nil
}

// checkBoardDrawText refuses a draw with nothing to say. Whether --context is also needed depends on the board
// existing, which only wavesrv knows.
func checkBoardDrawText(brief, ask string) error {
	if strings.TrimSpace(brief) == "" && strings.TrimSpace(ask) == "" {
		return errors.New("pass --ask, or --context to brief a new board")
	}
	return nil
}

// boardDrawStart sends the request to the board's drawer and returns the line to print and whether it is a failure
// (exit 1). An error is the request not reaching an answer: bad input, or an rpc error such as "boards are for Claude
// agents".
func boardDrawStart(blockId, board, brief, ask string, send func(wshrpc.CommandBoardAgentDrawData) (*wshrpc.BoardAgentDrawRtnData, error)) (line string, failed bool, err error) {
	board = strings.TrimSpace(board)
	if board == "" {
		return "", false, errors.New("pass the board's name with --board")
	}
	if err := checkBoardDrawText(brief, ask); err != nil {
		return "", false, err
	}
	rtn, err := send(wshrpc.CommandBoardAgentDrawData{BlockId: blockId, Board: board, Context: strings.TrimSpace(brief), Ask: strings.TrimSpace(ask)})
	if err != nil {
		return "", false, err
	}
	line, failed = boardDrawLine(board, rtn)
	return line, failed, nil
}

// boardDrawLine is what became of the request, in the words the arc:cockpit skill quotes. asked is the name the agent
// typed, used when wavesrv's answer carries none.
func boardDrawLine(asked string, rtn *wshrpc.BoardAgentDrawRtnData) (line string, failed bool) {
	name := rtn.BoardName
	if name == "" {
		name = asked
	}
	switch rtn.State {
	case "answered":
		return fmt.Sprintf("Drawn on board \"%s\": +%d shapes, %d changed, %d removed.", name, rtn.Added, rtn.Changed, rtn.Removed), false
	case "answering":
		return fmt.Sprintf("Still drawing on board \"%s\"; its card in Chat shows when it lands.", name), false
	case "failed":
		reason := rtn.Reason
		if reason == "" {
			reason = "no reason given"
		}
		return fmt.Sprintf("Couldn't draw on board \"%s\": %s", name, reason), true
	}
	return fmt.Sprintf("Couldn't draw on board \"%s\": the drawer answered with an unknown state \"%s\"", name, rtn.State), true
}
