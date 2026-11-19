// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package boarddrawer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
	"github.com/wavetermdev/waveterm/pkg/consult"
)

// TurnTimeout bounds one drawer session run.
const TurnTimeout = 10 * time.Minute

// persistSessionsEnv: a wavesrv started from an agent terminal can inherit the child-session marker that stops
// claude from saving sessions, and then every --resume would fail.
const persistSessionsEnv = "CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1"

// entrypointEnv marks the drawer's runs as the board drawer's: a print-mode claude records sdk-cli, which Usage drops as
// arcterm's own maintenance, but the drawer's turns are the person's spend on the board's project, so they carry the
// entrypoint the Usage scan keeps (agentobserve.CountsInUsage). The session sits under the project's folder, where Usage
// reads its cwd.
const entrypointEnv = "CLAUDE_CODE_ENTRYPOINT=" + agentobserve.BoardDrawerEntrypoint

// drawerTools is everything the drawer may load: read and search, no edits and no shell.
var drawerTools = []string{"Read", "Grep", "Glob"}

// leanEnv drops CLAUDE.md files and auto-memory, which --bare would also skip; --bare itself can't be used
// because it never reads the claude.ai login and would need an API key. The prompt points the drawer at the
// project's AGENTS.md / CLAUDE.md for the turns that need them.
var leanEnv = []string{"CLAUDE_CODE_DISABLE_CLAUDE_MDS=1", "CLAUDE_CODE_DISABLE_AUTO_MEMORY=1"}

// drawerCacheTTL replaces consult's 5m: a person pauses between questions, and on a long talk 4 of 12 pauses ran past
// 5 minutes, each re-writing the whole context (76k-116k tokens, 82% of the talk's cache writes).
const drawerCacheTTL = "1h"

// Reply is a run's answer and the session's context size after it.
type Reply struct {
	Text          string
	ContextTokens int
}

// Call is one run of a board's drawer session.
type Call struct {
	SessionId string
	Resume    bool // --resume SessionId, else --session-id SessionId
	Prompt    string
}

// RunModel runs one headless, read-only claude session in cwd and returns its reply; tests replace it.
var RunModel = func(ctx context.Context, cwd string, c Call) (Reply, error) {
	spec, ok := consult.SpecFor("claude")
	if !ok {
		return Reply{}, errors.New("the drawer needs the claude runtime, which has no spec")
	}
	ctx, cancel := context.WithTimeout(ctx, TurnTimeout)
	defer cancel()
	spec, guard := drawerSpec(spec, c, cancel)
	reply, runErr := consult.Run(ctx, spec, cwd, c.Prompt, func(string) {})
	if guard.failure != nil {
		return Reply{}, guard.failure
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return Reply{}, errors.New("the drawer ran past its 10 minutes")
	}
	if runErr != nil {
		return Reply{}, fmt.Errorf("the drawer's session exited before it replied (%v)", runErr)
	}
	if !guard.sawInit {
		// fail closed: with no init event the tool list was never checked
		return Reply{}, errors.New("the drawer session sent no init event, so its tools could not be checked")
	}
	return Reply{Text: reply, ContextTokens: guard.contextTokens}, nil
}

// drawerSpec makes spec read-only and points it at c's session.
func drawerSpec(spec consult.RuntimeSpec, c Call, cancel context.CancelFunc) (consult.RuntimeSpec, *toolGuard) {
	g := &toolGuard{cancel: cancel}
	// --strict-mcp-config: without it the account's connector tools load despite --tools.
	// --setting-sources= (no sources) and --disable-slash-commands: the person's hooks, plugins and skills are
	// for their own sessions, and would run on every turn here. "=" keeps the empty value one arg through cmd.
	args := append(append([]string{}, spec.BaseArgs...),
		"--model", "sonnet", "--tools", strings.Join(drawerTools, ","), "--strict-mcp-config",
		"--setting-sources=", "--disable-slash-commands")
	if c.Resume {
		args = append(args, "--resume", c.SessionId)
	} else {
		args = append(args, "--session-id", c.SessionId)
	}
	spec.BaseArgs = args
	env := []string{persistSessionsEnv, entrypointEnv, consult.PromptCacheTTLEnv + "=" + drawerCacheTTL}
	for _, e := range spec.Env {
		if !strings.HasPrefix(e, consult.PromptCacheTTLEnv+"=") {
			env = append(env, e)
		}
	}
	spec.Env = append(env, leanEnv...)
	parse := spec.ParseLine
	spec.ParseLine = func(line []byte) consult.ParsedEvent {
		if err := g.check(line); err != nil {
			return consult.ParsedEvent{Err: err}
		}
		return parse(line)
	}
	return spec, g
}

// toolGuard watches the session's stream for the init event and stops the session when it loaded any tool
// beyond drawerTools. It also keeps the context size of the last model call.
type toolGuard struct {
	cancel        context.CancelFunc
	sawInit       bool
	failure       error
	contextTokens int
}

func (g *toolGuard) check(line []byte) error {
	var ev struct {
		Type    string   `json:"type"`
		Subtype string   `json:"subtype"`
		Tools   []string `json:"tools"`
		Message struct {
			Usage *struct {
				Input       int `json:"input_tokens"`
				CacheRead   int `json:"cache_read_input_tokens"`
				CacheCreate int `json:"cache_creation_input_tokens"`
				Output      int `json:"output_tokens"`
			} `json:"usage"`
		} `json:"message"`
	}
	if json.Unmarshal(line, &ev) != nil {
		return g.failure
	}
	// the result event's usage sums every call of the turn; the last assistant call is what the next turn resumes
	if u := ev.Message.Usage; ev.Type == "assistant" && u != nil {
		g.contextTokens = u.Input + u.CacheRead + u.CacheCreate + u.Output
	}
	if ev.Type != "system" || ev.Subtype != "init" {
		return g.failure
	}
	g.sawInit = true
	var extra []string
	for _, t := range ev.Tools {
		if !slices.Contains(drawerTools, t) {
			extra = append(extra, t)
		}
	}
	if len(extra) > 0 && g.failure == nil {
		g.failure = fmt.Errorf("the drawer session loaded tools beyond read and search (%s)", strings.Join(extra, ", "))
		// stop at once: a session that can write must not keep running
		g.cancel()
	}
	return g.failure
}
