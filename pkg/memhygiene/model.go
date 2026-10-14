// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

// runModel makes one judge or sort call; tests replace it. The judge gets no tools: everything it
// needs is in the prompt, and Arc applies the result.
var runModel = func(ctx context.Context, prompt string) (string, error) {
	spec, ok := consult.HeadlessSpecForTier(consult.TierCapable)
	if !ok {
		return "", fmt.Errorf("memory hygiene: headless runtime %q has no spec", consult.HeadlessRuntime())
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	spec, guard, err := modelNoTools(spec, cancel)
	if err != nil {
		return "", err
	}
	reply, runErr := consult.Run(ctx, spec, wavebase.HeadlessAgentCwd(), prompt, func(string) {})
	if guard != nil && guard.failure != nil {
		return "", guard.failure
	}
	if runErr != nil {
		return "", fmt.Errorf("memory hygiene model run: %w", runErr)
	}
	if guard != nil && !guard.sawInit {
		// fail closed: with no init event the tool list was never checked
		return "", fmt.Errorf("memory hygiene: the claude session sent no init event, so its tools could not be checked")
	}
	return reply, nil
}

// modelGuard watches a claude session's stream for the init event and fails the session when it
// lists any tool, the radar audit's guard (pkg/reporadar/audit.go).
type modelGuard struct {
	cancel  context.CancelFunc
	sawInit bool
	failure error
}

// modelNoTools returns spec set to run with every tool off. An API runtime has no tools; claude runs
// with --tools "" and its init event is checked; a runtime this can't hold to no tools is refused.
func modelNoTools(spec consult.RuntimeSpec, cancel context.CancelFunc) (consult.RuntimeSpec, *modelGuard, error) {
	if spec.ApiBackend != nil {
		return spec, nil, nil
	}
	if spec.Bin != "claude" {
		return spec, nil, fmt.Errorf("memory hygiene can't run its judge on %s: it can't be held to no tools (set headless:runtime to openrouter or claude)", spec.Bin)
	}
	g := &modelGuard{cancel: cancel}
	// --strict-mcp-config: without it the account's connector tools load despite --tools
	spec.BaseArgs = append(append([]string{}, spec.BaseArgs...), "--tools", "", "--strict-mcp-config")
	parse := spec.ParseLine
	spec.ParseLine = func(line []byte) consult.ParsedEvent {
		if err := g.check(line); err != nil {
			return consult.ParsedEvent{Err: err}
		}
		return parse(line)
	}
	return spec, g, nil
}

func (g *modelGuard) check(line []byte) error {
	var ev struct {
		Type    string   `json:"type"`
		Subtype string   `json:"subtype"`
		Tools   []string `json:"tools"`
	}
	if json.Unmarshal(line, &ev) != nil || ev.Type != "system" || ev.Subtype != "init" {
		return nil
	}
	g.sawInit = true
	if len(ev.Tools) > 0 && g.failure == nil {
		g.failure = fmt.Errorf("memory hygiene: the judge session loaded tools (%s); it must run with none", strings.Join(ev.Tools, ", "))
		// stop at once: a session with tools must not keep running
		g.cancel()
	}
	return g.failure
}
