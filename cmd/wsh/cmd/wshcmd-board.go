// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

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

  --context       the briefing: what the person asked, the facts and the files involved. It briefs the drawer, and it
                  makes the board when your project has none with that name, so a new board needs it.
  --context-file  the briefing read from a file (UTF-8, or UTF-16 with a byte order mark), "-" for stdin, in place of
                  --context. Use it for a briefing of several lines or with quotes from PowerShell, which splits such an
                  argument to a native command.
  --ask           the one line the drawer answers on the board ("add the retry path"). Alone, once the board exists.

A request is a new drawing, unless it asks to fix, change or delete a drawing already on the board: say which one by its
title ("in Part 1, drop the two long arrows", "delete the drawing Part 2, fixed"), and the drawer edits or deletes that
one. A fix changes one drawing; a delete can take several, empty frames too ("delete the empty frames").

A board whose agent ended (its tab is gone) goes to the agent that draws on it next, drawing and turns kept.

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
	Use:   "draw --board <name> [--context \"<briefing>\" | --context-file <path>] [--ask \"<question>\"]",
	Short: "ask the drawer of the named board in your project to draw; --context briefs it and makes the board when none has that name",
	Long:  boardDrawLong,
	Args:  cobra.NoArgs,
	// cobra checks required flags only after PreRunE, so a missing --board, --context and --ask is caught before the rpc setup
	PreRunE: func(cmd *cobra.Command, args []string) error {
		if err := cmd.ValidateRequiredFlags(); err != nil {
			return err
		}
		file, _ := cmd.Flags().GetString("context-file")
		if file != "" {
			if cmd.Flags().Changed("context") {
				return errors.New("pass --context or --context-file, not both")
			}
			brief, err := readBoardContext(file, os.Stdin, os.ReadFile)
			if err != nil {
				return err
			}
			// RunE reads the briefing from --context, so the file's text takes that flag's place
			if err := cmd.Flags().Set("context", brief); err != nil {
				return err
			}
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
	boardDrawCmd.Flags().String("board", "", "the board's name (any case), or board:<id> as Chat's @ picker writes it; a new board when no board has the name")
	boardDrawCmd.Flags().String("context", "", "the briefing: what the person asked, the facts and the files involved; needed when the board is new")
	boardDrawCmd.Flags().String("context-file", "", `the briefing read from this file ("-" for stdin), in place of --context`)
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

// maxBoardContextBytes bounds a --context-file: a briefing is a few paragraphs, and the drawer reads the conversation
// itself.
const maxBoardContextBytes = 256 << 10

// readBoardContext reads the briefing of --context-file: the file at path, or stdin for "-". A UTF-8 byte order mark is
// dropped and UTF-16 with one is decoded, since Windows PowerShell writes those (Out-File, and its > in UTF-16).
func readBoardContext(path string, stdin io.Reader, readFile func(string) ([]byte, error)) (string, error) {
	var data []byte
	var err error
	if path == "-" {
		data, err = io.ReadAll(io.LimitReader(stdin, maxBoardContextBytes+1))
	} else {
		data, err = readFile(path)
	}
	if err != nil {
		return "", fmt.Errorf("reading --context-file: %w", err)
	}
	if len(data) > maxBoardContextBytes {
		return "", fmt.Errorf("--context-file is over %d KB: keep the briefing short", maxBoardContextBytes>>10)
	}
	return decodeBoardContext(data)
}

func decodeBoardContext(data []byte) (string, error) {
	switch {
	case bytes.HasPrefix(data, []byte{0xEF, 0xBB, 0xBF}):
		data = data[3:]
	case bytes.HasPrefix(data, []byte{0xFF, 0xFE}), bytes.HasPrefix(data, []byte{0xFE, 0xFF}):
		body := data[2:]
		if len(body)%2 != 0 {
			return "", errors.New("--context-file is UTF-16 with an odd byte count")
		}
		units := make([]uint16, len(body)/2)
		for i := range units {
			if data[0] == 0xFF {
				units[i] = binary.LittleEndian.Uint16(body[2*i:])
			} else {
				units[i] = binary.BigEndian.Uint16(body[2*i:])
			}
		}
		return string(utf16.Decode(units)), nil
	}
	if !utf8.Valid(data) {
		return "", errors.New("--context-file is not UTF-8 (or UTF-16 with a byte order mark)")
	}
	return string(data), nil
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
