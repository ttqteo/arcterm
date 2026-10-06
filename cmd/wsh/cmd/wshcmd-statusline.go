// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"runtime"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

// slPayload is the subset of the Claude Code statusLine stdin JSON we consume.
type slPayload struct {
	ContextWindow struct {
		UsedPct    *float64 `json:"used_percentage"`
		WindowSize int      `json:"context_window_size"`
	} `json:"context_window"`
	RateLimits struct {
		FiveHour *struct {
			UsedPct  float64 `json:"used_percentage"`
			ResetsAt int64   `json:"resets_at"`
		} `json:"five_hour"`
		SevenDay *struct {
			UsedPct  float64 `json:"used_percentage"`
			ResetsAt int64   `json:"resets_at"`
		} `json:"seven_day"`
	} `json:"rate_limits"`
	Cost struct {
		TotalCostUSD float64 `json:"total_cost_usd"`
	} `json:"cost"`
}

// parseStatusLineUsage extracts an AgentUsage from the statusLine JSON. Returns nil when
// context_window.used_percentage is absent — a session with no context data reports nothing
// rather than a misleading zero. Rate-limit fields stay nil when absent (subscriber-only).
func parseStatusLineUsage(raw []byte) *baseds.AgentUsage {
	var p slPayload
	if json.Unmarshal(raw, &p) != nil {
		return nil
	}
	if p.ContextWindow.UsedPct == nil {
		return nil
	}
	u := &baseds.AgentUsage{
		ContextPct: *p.ContextWindow.UsedPct,
		ContextMax: p.ContextWindow.WindowSize,
		CostUSD:    p.Cost.TotalCostUSD,
	}
	if p.RateLimits.FiveHour != nil {
		pct := p.RateLimits.FiveHour.UsedPct
		reset := p.RateLimits.FiveHour.ResetsAt
		u.FiveHourPct = &pct
		u.FiveHourReset = &reset
	}
	if p.RateLimits.SevenDay != nil {
		pct := p.RateLimits.SevenDay.UsedPct
		reset := p.RateLimits.SevenDay.ResetsAt
		u.WeekPct = &pct
		u.WeekReset = &reset
	}
	return u
}

var statusLineInner string

var statusLineCmd = &cobra.Command{
	Use:                   "statusline",
	Short:                 "Claude Code statusLine wrapper: publish usage to the arcterm cockpit, then delegate",
	Args:                  cobra.NoArgs,
	RunE:                  statusLineRun,
	Hidden:                true,
	DisableFlagsInUseLine: true,
	SilenceErrors:         true,
	SilenceUsage:          true,
}

func init() {
	rootCmd.AddCommand(statusLineCmd)
	statusLineCmd.Flags().StringVar(&statusLineInner, "inner", "", "base64 of the user's original statusLine command to delegate to")
}

// runInner runs the user's original statusLine command via the platform shell, feeding it the
// same stdin JSON, and returns its stdout. Empty inner => no output. Best-effort: errors yield
// whatever stdout was produced (possibly none).
func runInner(inner string, stdin []byte) []byte {
	if inner == "" {
		return nil
	}
	var c *exec.Cmd
	if runtime.GOOS == "windows" {
		c = exec.Command("cmd", "/c", inner)
	} else {
		c = exec.Command("sh", "-c", inner)
	}
	c.Stdin = bytes.NewReader(stdin)
	out, _ := c.Output()
	return out
}

// publishStatusLineUsage best-effort publishes the usage delta parsed from the statusLine JSON.
// Silent on every failure (no block env, no JWT, RPC down, no context data) — a dropped publish
// self-heals on the next statusLine render.
func publishStatusLineUsage(raw []byte) {
	if os.Getenv("WAVETERM_BLOCKID") == "" {
		return
	}
	usage := parseStatusLineUsage(raw)
	if usage == nil {
		return
	}
	jwt := os.Getenv(wshutil.WaveJwtTokenVarName)
	if jwt == "" {
		return
	}
	if setupRpcClient(nil, jwt) != nil {
		return
	}
	oref, err := resolveBlockArg()
	if err != nil {
		return
	}
	_ = publishUsage(oref, usage)
}

// statusLineRun always returns nil: a statusLine command must never break Claude Code's render.
func statusLineRun(cmd *cobra.Command, args []string) error {
	raw, err := io.ReadAll(os.Stdin)
	if err != nil {
		return nil
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		publishStatusLineUsage(raw)
	}()

	inner := decodeInner(statusLineInner)
	if out := runInner(inner, raw); len(out) > 0 {
		_, _ = os.Stdout.Write(out)
	}

	// let the publish finish (it overlaps the inner run, so this is usually already closed),
	// but never hang the render if the backend is unreachable.
	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
	}
	return nil
}
