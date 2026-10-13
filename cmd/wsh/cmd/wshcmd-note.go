// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"io"
	"os"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const noteBodyStdin = "-"

var noteCmd = &cobra.Command{
	Use:   "note",
	Short: "write and read the user's notes (markdown the user reads later from the palette)",
}

// noteBody is --body, or stdin when --body is "-": a body of several lines is easier to pipe than to quote.
func noteBody(cmd *cobra.Command) (string, error) {
	body := mustFlagString(cmd, "body")
	if body != noteBodyStdin {
		return body, nil
	}
	raw, err := io.ReadAll(os.Stdin)
	if err != nil {
		return "", fmt.Errorf("reading stdin: %w", err)
	}
	return string(raw), nil
}

var noteAddCmd = &cobra.Command{
	Use:     "add <title>",
	Short:   "add a note (--body <markdown>, or --body - to read it from stdin)",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		body, err := noteBody(cmd)
		if err != nil {
			return err
		}
		note, err := wshclient.NoteAddCommand(RpcClient, wshrpc.CommandNoteAddData{Title: args[0], Body: body}, nil)
		if err != nil {
			return err
		}
		if isJSON(cmd) {
			return jsonOut(note)
		}
		fmt.Printf("added note %s\n", note.ID)
		return nil
	},
}

var noteListCmd = &cobra.Command{
	Use:     "list",
	Short:   "list notes, newest day first: id and title",
	Args:    cobra.NoArgs,
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		notes, err := wshclient.NoteListCommand(RpcClient, nil)
		if err != nil {
			return err
		}
		if isJSON(cmd) {
			return jsonOut(notes)
		}
		for _, n := range notes {
			fmt.Printf("%s\t%s\n", n.ID, n.Title)
		}
		return nil
	},
}

func findNote(notes []*waveobj.UserNote, id string) (*waveobj.UserNote, error) {
	for _, n := range notes {
		if n.ID == id {
			return n, nil
		}
	}
	return nil, fmt.Errorf("note %s: not found", id)
}

var noteShowCmd = &cobra.Command{
	Use:     "show <id>",
	Short:   "print a note",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		notes, err := wshclient.NoteListCommand(RpcClient, nil)
		if err != nil {
			return err
		}
		note, err := findNote(notes, args[0])
		if err != nil {
			return err
		}
		if isJSON(cmd) {
			return jsonOut(note)
		}
		fmt.Printf("# %s\n", note.Title)
		if note.Body != "" {
			fmt.Printf("\n%s\n", note.Body)
		}
		return nil
	},
}

var noteDeleteCmd = &cobra.Command{
	Use:     "delete <id>",
	Short:   "delete a note",
	Args:    cobra.ExactArgs(1),
	PreRunE: preRunSetupRpcClient,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := wshclient.NoteDeleteCommand(RpcClient, wshrpc.CommandNoteDeleteData{ID: args[0]}, nil); err != nil {
			return err
		}
		fmt.Printf("deleted note %s\n", args[0])
		return nil
	},
}

func init() {
	noteAddCmd.Flags().String("body", "", "the note's markdown body, or - to read it from stdin")
	noteAddCmd.Flags().Bool("json", false, "JSON output")
	noteListCmd.Flags().Bool("json", false, "JSON output")
	noteShowCmd.Flags().Bool("json", false, "JSON output")
	noteCmd.AddCommand(noteAddCmd, noteListCmd, noteShowCmd, noteDeleteCmd)
	rootCmd.AddCommand(noteCmd)
}
