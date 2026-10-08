// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/agyhook"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const (
	agyAgent = "agy"
	// the transcript's first user step sits at its head; a bounded read keeps a hook cheap on a long conversation
	agyTranscriptHeadBytes = 256 * 1024
	agyMetaTimeoutMs       = 2000
)

// agyHookCmd is the command agy's global hooks.json calls: `wsh agy-hook <PreInvocation|PreToolUse|PostToolUse|
// PostInvocation|Stop>`. agy's payload does not name its event, so the command line does. The logic that does not
// need the cockpit lives in pkg/agyhook.
var agyHookCmd = &cobra.Command{
	Use:                   "agy-hook <event>",
	Short:                 "Antigravity CLI hook: report agent status to the arcterm cockpit and answer its questions",
	Args:                  cobra.ExactArgs(1),
	RunE:                  agyHookRun,
	Hidden:                true,
	DisableFlagsInUseLine: true,
	SilenceErrors:         true,
	SilenceUsage:          true,
}

func init() {
	rootCmd.AddCommand(agyHookCmd)
}

// agyHookRun always returns nil: a hook must never break agy's turn.
func agyHookRun(cmd *cobra.Command, args []string) error {
	return runAgyHook(args[0], os.Stdin, os.Stdout)
}

// runAgyHook reads the payload from stdin and writes agy's decision to stdout. Every path ends in the event's
// neutral output (nothing for PreToolUse, `{}` for the rest) except the explicit denies, and nothing goes to stderr.
func runAgyHook(event string, stdin io.Reader, stdout io.Writer) error {
	raw, err := io.ReadAll(stdin)
	out := []byte(nil)
	if err == nil {
		out = decideAgyHook(event, raw)
	}
	if out == nil {
		out = agyhook.Neutral(event)
	}
	_, _ = stdout.Write(out)
	return nil
}

// decideAgyHook does the event's work and returns the bytes to print, nil meaning the event's neutral output.
func decideAgyHook(event string, raw []byte) []byte {
	// outside an arcterm block (the Antigravity desktop app, a plain terminal) there is nothing to report to
	if os.Getenv("WAVETERM_BLOCKID") == "" {
		return nil
	}
	// stamped before any rpc: wavesrv orders reports by when the hook started, not by when a slow one got through
	startedTs := time.Now().UnixMilli()
	var p agyhook.Payload
	if json.Unmarshal(raw, &p) != nil {
		return nil
	}
	em := agyhook.Plan(event, p)
	if em.State == "" {
		return nil
	}
	jwt := os.Getenv(wshutil.WaveJwtTokenVarName)
	if jwt == "" || setupRpcClient(nil, jwt) != nil {
		return nil
	}
	oref, err := resolveBlockArg()
	if err != nil {
		return nil
	}
	if !agyOwnsBlock(oref) {
		return nil
	}
	if p.TranscriptPath != "" {
		// best-effort, like every other hook write: a gone worker's exit reads its outcome from this
		_ = wshclient.SetMetaCommand(RpcClient, wshrpc.CommandSetMetaData{
			ORef: *oref,
			Meta: waveobj.MetaMapType{waveobj.MetaKey_AgentTranscriptPath: p.TranscriptPath},
		}, &wshrpc.RpcOpts{Timeout: agyMetaTimeoutMs})
	}

	title, titleRead := "", false
	report := func(state, detail string, ts int64) {
		if !titleRead {
			title, titleRead = agyTitle(p.TranscriptPath), true
		}
		_ = publishAgentStatusData(oref, baseds.AgentStatusData{
			ORef:           oref.String(),
			State:          state,
			Detail:         detail,
			Agent:          agyAgent,
			Model:          p.ModelName,
			Cwd:            p.Cwd(),
			SessionID:      p.ConversationID,
			Title:          title,
			TranscriptPath: p.TranscriptPath,
			Ts:             ts,
		}, 1)
	}
	report(em.State, em.Detail, startedTs)

	if event != "PreToolUse" {
		return nil
	}
	// the only event that blocks: on the ask card, or in memgate. When the bound hits the answer is neutral
	ctx, cancel := context.WithTimeout(context.Background(), agyhook.PreToolUseBound)
	defer cancel()
	switch {
	case em.Ask:
		rtn, err := rpcWithContext(ctx, func() (wshrpc.AskRtnData, error) {
			return wshclient.AskCommand(RpcClient, agyAskData(oref.String(), em.Questions),
				&wshrpc.RpcOpts{Timeout: int64(askWaitTimeout / time.Millisecond)})
		})
		if err != nil {
			return nil // no cockpit, a failed card or the bound: agy's own question UI asks in the terminal
		}
		// PostToolUse never fires for a tool this hook denies, so the return to work is reported here
		report(baseds.AgentState_Working, "", time.Now().UnixMilli())
		if rtn.Cancelled {
			return agyhook.Deny(agyhook.DismissedReason)
		}
		return agyhook.Deny(agyhook.AnswerReason(em.Questions, rtn.Answers))
	case em.Command != "":
		verdict, err := memgateDecide(ctx, em.Command, func(any) {})
		if err != nil || verdict.Run {
			return nil // a broken gate never blocks an agent
		}
		return agyhook.Deny(verdict.Reason)
	}
	return nil
}

// agyAskData is the ask request for an ask_question card. Hold keeps it up: a parallel tool's working report would
// otherwise retire it (retireAskOnResume) and tell agy the person dismissed it. If agy kills the hook, the wsh
// process dies and the server's waiter cancel takes the card down, so Hold leaves no stale card.
func agyAskData(oref string, questions []baseds.AgentAskQuestion) wshrpc.CommandAskData {
	return wshrpc.CommandAskData{ORef: oref, Questions: questions, Wait: true, Hold: true}
}

// agyOwnsBlock is false for a block another agent runs in: a nested `agy -p` inside a claude or pi worker inherits
// its WAVETERM_BLOCKID. An unreadable block counts as foreign.
func agyOwnsBlock(oref *waveobj.ORef) bool {
	meta, err := wshclient.GetMetaCommand(RpcClient, wshrpc.CommandGetMetaData{ORef: *oref},
		&wshrpc.RpcOpts{Timeout: agyMetaTimeoutMs})
	if err != nil {
		return false
	}
	return agyhook.OwnsBlock(meta.GetString(waveobj.MetaKey_Controller, ""), meta.GetString(waveobj.MetaKey_Cmd, ""))
}

// agyTitle is the conversation's first request, cut as `wsh agent-hook` cuts a prompt.
func agyTitle(transcriptPath string) string {
	if transcriptPath == "" {
		return ""
	}
	f, err := os.Open(transcriptPath)
	if err != nil {
		return ""
	}
	defer f.Close()
	head, _ := io.ReadAll(io.LimitReader(f, agyTranscriptHeadBytes))
	return titleFromPrompt(agyhook.FirstUserRequest(head))
}
