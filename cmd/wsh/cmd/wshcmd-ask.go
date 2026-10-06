// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

var askClear bool
var askWait bool
var askProse bool
var askQuestionsJson string

// askWaitTimeout is the RPC ceiling for a blocked ask; the pi tool's own abort path
// (signal -> killed child -> ctx cancel) covers the "user gave up" case before this.
const askWaitTimeout = 30 * time.Minute

var askCmd = &cobra.Command{
	Use:                   "ask",
	Short:                 "project an AskUserQuestion into the Wave Agents panel (non-blocking)",
	Args:                  cobra.NoArgs,
	RunE:                  askRun,
	PreRunE:               preRunSetupRpcClient,
	Hidden:                true,
	DisableFlagsInUseLine: true,
}

func init() {
	askCmd.Flags().BoolVar(&askClear, "clear", false, "clear the pending ask for this block (PostToolUse)")
	askCmd.Flags().BoolVar(&askWait, "wait", false, "block until answered and print the answers as JSON (pi ask bridge)")
	askCmd.Flags().BoolVar(&askProse, "prose", false, "mark the ask as a projected prose question (pi prose bridge)")
	askCmd.Flags().StringVar(&askQuestionsJson, "questions-json", "", "questions container as inline JSON instead of stdin (pi ask bridge; pi.exec stdin is ignored)")
	rootCmd.AddCommand(askCmd)
}

// any error returned here exits non-zero; the hooks treat non-zero / failure as
// "the native terminal prompt handles it" (graceful degradation).
func askRun(cmd *cobra.Command, args []string) (rtnErr error) {
	oref, err := resolveBlockArg()
	if err != nil {
		return fmt.Errorf("resolving block: %w", err)
	}
	// a daemon-hosted Claude session asks in the tab attached to it, where its status goes too
	// (wshcmd-agenthosted.go). With no tab attached there is no card to show, so the terminal prompt answers.
	if blockArg == "" {
		target, drop := statusTarget(oref)
		if drop {
			return fmt.Errorf("the session runs in the Claude daemon with no Arc tab attached")
		}
		oref = target
	}

	if askClear && askWait {
		return fmt.Errorf("--clear and --wait are mutually exclusive")
	}

	if askClear {
		return wshclient.AgentAskClearCommand(RpcClient, oref.String(), &wshrpc.RpcOpts{Timeout: 5000})
	}

	raw, err := io.ReadAll(os.Stdin)
	if err != nil {
		return fmt.Errorf("reading stdin: %w", err)
	}
	if askQuestionsJson != "" {
		raw = []byte(askQuestionsJson)
	}
	questions, err := parseAskQuestions(raw)
	if err != nil {
		return err
	}

	timeout := int64(5000)
	if askWait {
		timeout = int64(askWaitTimeout / time.Millisecond)
	}
	rtn, err := wshclient.AskCommand(RpcClient, wshrpc.CommandAskData{ORef: oref.String(), Questions: questions, Wait: askWait, Prose: askProse}, &wshrpc.RpcOpts{Timeout: timeout})
	if err != nil {
		return err
	}
	if askWait {
		out, merr := formatAskResult(rtn)
		if merr != nil {
			return merr
		}
		fmt.Println(string(out))
	}
	return nil
}

// formatAskResult renders the wait-mode reply as one JSON line. Cancelled is a legitimate
// outcome (dismissed/aborted), not an error: exit stays 0 either way.
func formatAskResult(rtn wshrpc.AskRtnData) ([]byte, error) {
	return json.Marshal(struct {
		Answers   []baseds.AgentAnswerItem `json:"answers"`
		Cancelled bool                     `json:"cancelled"`
	}{Answers: rtn.Answers, Cancelled: rtn.Cancelled})
}

func parseAskQuestions(raw []byte) ([]baseds.AgentAskQuestion, error) {
	// unwrap the Claude Code hook envelope if present; else treat raw as the questions container
	payload := raw
	var env struct {
		ToolInput json.RawMessage `json:"tool_input"`
	}
	if json.Unmarshal(raw, &env) == nil && len(env.ToolInput) > 0 {
		payload = env.ToolInput
	}

	var in struct {
		Questions []struct {
			Question    string `json:"question"`
			Header      string `json:"header"`
			MultiSelect bool   `json:"multiSelect"`
			Options     []struct {
				Label       string `json:"label"`
				Description string `json:"description"`
				Preview     string `json:"preview"`
			} `json:"options"`
		} `json:"questions"`
	}
	if err := json.Unmarshal(payload, &in); err != nil {
		return nil, fmt.Errorf("no questions on stdin: %w", err)
	}
	if len(in.Questions) == 0 {
		return nil, fmt.Errorf("no questions provided")
	}

	questions := make([]baseds.AgentAskQuestion, len(in.Questions))
	for i, q := range in.Questions {
		opts := make([]baseds.AgentAskOption, len(q.Options))
		for j, o := range q.Options {
			opts[j] = baseds.AgentAskOption{Label: o.Label, Description: o.Description, Preview: o.Preview}
		}
		questions[i] = baseds.AgentAskQuestion{
			Question:    q.Question,
			Header:      q.Header,
			MultiSelect: q.MultiSelect,
			Options:     opts,
		}
	}
	return questions, nil
}
