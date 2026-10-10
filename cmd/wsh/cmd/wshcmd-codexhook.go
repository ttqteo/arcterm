// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"io"
	"os"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/codexhook"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const codexAgent = "codex"

// codexHookCmd is the command arcterm's handlers in ~/.codex/hooks.json call. The payload names its own event; the
// logic that does not need the cockpit lives in pkg/codexhook.
var codexHookCmd = &cobra.Command{
	Use:                   "codex-hook",
	Short:                 "Codex CLI hook: report agent status to the arcterm cockpit",
	Args:                  cobra.NoArgs,
	RunE:                  codexHookRun,
	Hidden:                true,
	DisableFlagsInUseLine: true,
	SilenceErrors:         true,
	SilenceUsage:          true,
}

func init() {
	rootCmd.AddCommand(codexHookCmd)
}

// codexHookRun always returns nil and prints nothing: a hook must never change or break Codex's turn.
func codexHookRun(cmd *cobra.Command, args []string) error {
	// outside an arcterm block (the Codex desktop app shares hooks.json, or a plain terminal) there is nothing to report to
	if os.Getenv("WAVETERM_BLOCKID") == "" {
		return nil
	}
	// stamped before any rpc: the per-tool hooks run in the background, and wavesrv orders reports by when the hook
	// started, not by when a slow one got through
	startedTs := time.Now().UnixMilli()
	raw, err := io.ReadAll(os.Stdin)
	if err != nil {
		hookDebugLine("codex: read stdin failed")
		return nil
	}
	var p codexhook.Payload
	if json.Unmarshal(raw, &p) != nil {
		hookDebugLine("codex: unmarshal hook payload failed")
		return nil
	}
	em := codexhook.Plan(p)
	if em.State == "" {
		return nil
	}
	jwt := os.Getenv(wshutil.WaveJwtTokenVarName)
	if jwt == "" || setupRpcClient(nil, jwt) != nil {
		hookDebugLine("codex: no rpc client event=" + p.HookEventName)
		return nil
	}
	oref, err := resolveBlockArg()
	if err != nil {
		hookDebugLine("codex: resolveBlockArg failed event=" + p.HookEventName)
		return nil
	}
	if !hookOwnsBlock(oref, codexAgent) {
		return nil
	}
	if p.TranscriptPath != "" {
		// best-effort, like every other hook write: a gone agent's exit reads its outcome from this
		_ = wshclient.SetMetaCommand(RpcClient, wshrpc.CommandSetMetaData{
			ORef: *oref,
			Meta: waveobj.MetaMapType{waveobj.MetaKey_AgentTranscriptPath: p.TranscriptPath},
		}, &wshrpc.RpcOpts{Timeout: hookMetaTimeoutMs})
	}
	data := baseds.AgentStatusData{
		ORef:           oref.String(),
		State:          em.State,
		Detail:         em.Detail,
		Agent:          codexAgent,
		Model:          p.Model,
		Cwd:            p.Cwd,
		SessionID:      p.SessionID,
		TranscriptPath: p.TranscriptPath,
		Ts:             startedTs,
	}
	if em.Title {
		data = enrichCodexStatus(data, "")
		// the first prompt is not in the rollout yet when its own UserPromptSubmit fires
		if data.Title == "" {
			data.Title = titleFromPrompt(p.Prompt)
		}
	}
	if err := publishAgentStatusData(oref, data, 1); err != nil {
		hookDebugLine("codex: publish failed event=" + p.HookEventName + " err=" + err.Error())
		return nil
	}
	hookDebugLine("codex: published event=" + p.HookEventName + " state=" + em.State + " oref=" + oref.String())
	return nil
}
