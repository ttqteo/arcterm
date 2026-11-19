// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package boarddrawer

import (
	"slices"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentobserve"
	"github.com/wavetermdev/waveterm/pkg/consult"
)

func TestRunnerToolGuardFailsClosedOnExtraTools(t *testing.T) {
	cancelled := false
	g := &toolGuard{cancel: func() { cancelled = true }}
	if err := g.check([]byte(`{"type":"system","subtype":"init","tools":["Read","Glob","Grep"]}`)); err != nil || !g.sawInit {
		t.Fatalf("read-only tools refused: %v", err)
	}
	g = &toolGuard{cancel: func() { cancelled = true }}
	err := g.check([]byte(`{"type":"system","subtype":"init","tools":["Read","Bash","Edit"]}`))
	if err == nil || !cancelled || !strings.Contains(err.Error(), "Bash, Edit") {
		t.Fatalf("extra tools not refused: err=%v cancelled=%v", err, cancelled)
	}
	if g.check([]byte(`{"type":"assistant"}`)) == nil {
		t.Errorf("a failed guard must keep failing later lines")
	}
}

// the context the next turn resumes is the last call's whole input plus what it wrote
func TestRunnerToolGuardRecordsContextTokens(t *testing.T) {
	g := &toolGuard{cancel: func() {}}
	lines := []string{
		`{"type":"system","subtype":"init","tools":["Read"]}`,
		`{"type":"assistant","message":{"usage":{"input_tokens":2,"cache_read_input_tokens":40000,"cache_creation_input_tokens":5000,"output_tokens":300}}}`,
		`{"type":"user","message":{"content":[{"type":"tool_result"}]}}`,
		`{"type":"assistant","message":{"usage":{"input_tokens":3,"cache_read_input_tokens":45300,"cache_creation_input_tokens":2000,"output_tokens":900}}}`,
		`{"type":"result","usage":{"input_tokens":5,"cache_read_input_tokens":85300,"cache_creation_input_tokens":7000,"output_tokens":1200}}`,
	}
	for _, l := range lines {
		if err := g.check([]byte(l)); err != nil {
			t.Fatal(err)
		}
	}
	if want := 3 + 45300 + 2000 + 900; g.contextTokens != want {
		t.Errorf("context tokens %d, want %d (the last assistant call, not the summed result)", g.contextTokens, want)
	}
}

func TestRunnerArgs(t *testing.T) {
	base, ok := consult.SpecFor("claude")
	if !ok {
		t.Fatal("no claude spec")
	}
	cases := []struct {
		name string
		call Call
		want []string
		not  []string
	}{
		{"first turn", Call{SessionId: "X"}, []string{"--session-id X"}, []string{"--resume", "--fork-session"}},
		{"follow-up", Call{SessionId: "X", Resume: true}, []string{"--resume X"}, []string{"--session-id", "--fork-session"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			spec, _ := drawerSpec(base, c.call, func() {})
			args := strings.Join(spec.BaseArgs, " ")
			for _, w := range append(c.want, "--model sonnet", "--tools Read,Grep,Glob", "--strict-mcp-config",
				"--setting-sources= ", "--disable-slash-commands") {
				if !strings.Contains(args, w) {
					t.Errorf("args %q lack %q", args, w)
				}
			}
			for _, n := range c.not {
				if strings.Contains(args, n) {
					t.Errorf("args %q must not carry %q", args, n)
				}
			}
			if !strings.HasPrefix(args, strings.Join(base.BaseArgs, " ")) {
				t.Errorf("args %q dropped the runtime's base args", args)
			}
			for _, e := range append([]string{persistSessionsEnv, entrypointEnv}, leanEnv...) {
				if !slices.Contains(spec.Env, e) {
					t.Errorf("env %v lacks %q", spec.Env, e)
				}
			}
			ttlPrefix := consult.PromptCacheTTLEnv + "="
			for _, e := range base.Env {
				if !strings.HasPrefix(e, ttlPrefix) && !slices.Contains(spec.Env, e) {
					t.Errorf("env %v dropped the runtime's %q", spec.Env, e)
				}
			}
			var ttls []string
			for _, e := range spec.Env {
				if strings.HasPrefix(e, ttlPrefix) {
					ttls = append(ttls, e)
				}
			}
			if want := []string{ttlPrefix + drawerCacheTTL}; !slices.Equal(ttls, want) {
				t.Errorf("cache ttl env %v, want only %v", ttls, want)
			}
		})
	}
	if slices.Contains(base.Env, persistSessionsEnv) || slices.Contains(base.Env, entrypointEnv) {
		t.Errorf("drawerSpec must not write into the shared runtime spec's env")
	}
}

// the drawer's turns count in Usage under the board's project: its runs carry the entrypoint the usage scan keeps,
// while every other print-mode run is dropped from the scan
func TestRunnerArgsEntrypointCountsInUsage(t *testing.T) {
	if want := "CLAUDE_CODE_ENTRYPOINT=" + agentobserve.BoardDrawerEntrypoint; entrypointEnv != want {
		t.Fatalf("the drawer runs under %q, want %q", entrypointEnv, want)
	}
	if !agentobserve.CountsInUsage(agentobserve.BoardDrawerEntrypoint) {
		t.Errorf("the drawer's entrypoint must count in Usage")
	}
	if agentobserve.CountsInUsage(agentobserve.HeadlessEntrypoint) {
		t.Errorf("a plain print-mode run must stay out of Usage")
	}
}
