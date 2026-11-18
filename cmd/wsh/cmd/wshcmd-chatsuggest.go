// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// a reply and six short messages are a few KB; the cap only keeps a runaway stdin from filling memory
const chatSuggestMaxStdinBytes = 1 << 20

// begin reads the person's habits, which can take a while the first time wavesrv reads the transcripts
const chatSuggestBeginTimeoutMs = 20000

const chatSuggestEndTimeoutMs = 5000

var chatSuggestCmd = &cobra.Command{
	Use:    "chatsuggest",
	Short:  "Chat's suggested replies, worked out by the Claude agent in this block (the Claude mod)",
	Hidden: true,
}

var chatSuggestBeginCmd = &cobra.Command{
	Use:                   "begin",
	Short:                 `read {"reply","recent"} JSON from stdin, begin this block's turn and print the completion to run as JSON`,
	Args:                  cobra.NoArgs,
	PreRunE:               preRunSetupRpcClient,
	RunE:                  chatSuggestBeginRun,
	Hidden:                true,
	DisableFlagsInUseLine: true,
}

var chatSuggestEndCmd = &cobra.Command{
	Use:                   "end",
	Short:                 "read the model's answer from stdin and end the turn --key names",
	Args:                  cobra.NoArgs,
	PreRunE:               preRunSetupRpcClient,
	RunE:                  chatSuggestEndRun,
	Hidden:                true,
	DisableFlagsInUseLine: true,
}

var (
	chatSuggestEndKey    string
	chatSuggestEndFailed bool
)

func init() {
	chatSuggestEndCmd.Flags().StringVar(&chatSuggestEndKey, "key", "", "the key begin printed")
	chatSuggestEndCmd.Flags().BoolVar(&chatSuggestEndFailed, "failed", false, "the mod got no answer; stdin is not read")
	chatSuggestCmd.AddCommand(chatSuggestBeginCmd, chatSuggestEndCmd)
	rootCmd.AddCommand(chatSuggestCmd)
}

// chatSuggestBeginInput is what the mod writes to begin's stdin.
type chatSuggestBeginInput struct {
	Reply  string   `json:"reply"`
	Recent []string `json:"recent,omitempty"`
}

func chatSuggestBeginRun(cmd *cobra.Command, args []string) error {
	// the turn belongs to the agent's block; a wsh run outside a block has no Chat to answer
	if RpcContext.BlockId == "" {
		return errors.New("chatsuggest begin needs a block: run it from an arcterm terminal block")
	}
	raw, err := readChatSuggestStdin(os.Stdin)
	if err != nil {
		return err
	}
	var in chatSuggestBeginInput
	if err := json.Unmarshal(raw, &in); err != nil {
		return fmt.Errorf(`stdin is not {"reply","recent"} JSON: %w`, err)
	}
	rtn, err := wshclient.ChatSuggestHookBeginCommand(RpcClient, wshrpc.CommandChatSuggestHookBeginData{
		BlockId: RpcContext.BlockId,
		Reply:   in.Reply,
		Recent:  in.Recent,
	}, &wshrpc.RpcOpts{Timeout: chatSuggestBeginTimeoutMs})
	if err != nil {
		return err
	}
	out, err := json.Marshal(rtn)
	if err != nil {
		return err
	}
	fmt.Fprintln(cmd.OutOrStdout(), string(out))
	return nil
}

func chatSuggestEndRun(cmd *cobra.Command, args []string) error {
	if RpcContext.BlockId == "" {
		return errors.New("chatsuggest end needs a block: run it from an arcterm terminal block")
	}
	if chatSuggestEndKey == "" {
		return errors.New("chatsuggest end needs --key, as begin printed it")
	}
	text := ""
	if !chatSuggestEndFailed {
		raw, err := readChatSuggestStdin(os.Stdin)
		if err != nil {
			return err
		}
		text = string(raw)
	}
	return wshclient.ChatSuggestHookEndCommand(RpcClient, wshrpc.CommandChatSuggestHookEndData{
		BlockId: RpcContext.BlockId,
		Key:     chatSuggestEndKey,
		Text:    text,
		Failed:  chatSuggestEndFailed,
	}, &wshrpc.RpcOpts{Timeout: chatSuggestEndTimeoutMs})
}

// readChatSuggestStdin reads stdin whole, refusing more than chatSuggestMaxStdinBytes. The reply comes on stdin, not
// argv: a long reply runs past Windows' 32 K command line.
func readChatSuggestStdin(r io.Reader) ([]byte, error) {
	raw, err := io.ReadAll(io.LimitReader(r, chatSuggestMaxStdinBytes+1))
	if err != nil {
		return nil, fmt.Errorf("reading stdin: %w", err)
	}
	if len(raw) > chatSuggestMaxStdinBytes {
		return nil, fmt.Errorf("stdin is over %d bytes", chatSuggestMaxStdinBytes)
	}
	return raw, nil
}
