// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/council"
)

// The states a team cell ends in. A team has no council to carry a state, so its outcome names one: done is a report
// that was parsed and can be judged, failed anything else that went wrong, timed-out a lead that outlived its limit.
const (
	TeamDone     = "done"
	TeamFailed   = "failed"
	TeamTimedOut = "timed-out"
)

// TeamOutcome is how one team cell ended: the lead's session, its state, the report it wrote parsed into a summary (set
// only for a done outcome), and the spend, wall time and SendMessage count that become the cell's row.
type TeamOutcome struct {
	Session  string
	State    string
	Summary  *council.CouncilSummary
	Tokens   int64
	Minutes  float64
	Messages int
}

// TeamOptions are the models and the wall-time limit of a team cell.
type TeamOptions struct {
	Lead  string
	Mate  string
	Limit time.Duration
}

// DefaultTeamOptions are what the bench runs a team with: the council's own seats, an opus lead and sonnet teammates.
var DefaultTeamOptions = TeamOptions{Lead: "opus", Mate: "sonnet", Limit: 45 * time.Minute}

// TeamFunc runs one case as a team and says how it ended. Its error is ctx's only, as runItem's is: any other failure
// is an outcome whose state is TeamFailed.
type TeamFunc func(ctx context.Context, c Case) (TeamOutcome, error)

// teamStats is what a team cell measured besides its outcome: the teammate transcripts it read, and the result's
// modelUsage summed over every model (the same four fields as the token count), which the transcripts' count is checked
// against.
type teamStats struct {
	Teammates  int
	ModelUsage int64
}

// teamDisallowed are the tools off for the lead, and so for its teammates: what is left is Read, Grep and Glob, the
// council's own experts' tools, and the team tools.
const teamDisallowed = "Bash,PowerShell,Edit,Write,NotebookEdit,WebFetch,WebSearch"

// teamSettings turns agent teams on in the cell's folder.
const teamSettings = `{"env": {"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"}}` + "\n"

// leadLaunch is one start of the lead: claude's arguments, its environment, its working folder, and the prompt it reads
// on stdin.
type leadLaunch struct {
	Args   []string
	Env    []string
	Dir    string
	Prompt string
}

// startLead runs the lead to its end and returns what it printed. Its error is a launch that failed or an exit that was
// not zero; ctx killing it is one too. It is the seam a test replaces, so no test starts claude.
var startLead = func(ctx context.Context, l leadLaunch) ([]byte, error) {
	bin := "claude"
	if spec, ok := consult.SpecFor("claude"); ok {
		bin = spec.Bin
	}
	cmd := exec.CommandContext(ctx, bin, l.Args...)
	cmd.Dir = l.Dir
	cmd.Env = l.Env
	cmd.Stdin = strings.NewReader(l.Prompt)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	// a killed lead's children can hold its pipes open: give up on them a little after the kill
	cmd.WaitDelay = 10 * time.Second
	if err := cmd.Run(); err != nil {
		if tail := strings.TrimSpace(stderr.String()); tail != "" {
			err = fmt.Errorf("%w: %s", err, abbreviate(tail))
		}
		return stdout.Bytes(), err
	}
	return stdout.Bytes(), nil
}

// RunTeam is the real TeamFunc: one case run by an agent team, with the bench's own models and limit.
func RunTeam(ctx context.Context, c Case) (TeamOutcome, error) {
	out, stats, err := runTeam(ctx, c, DefaultTeamOptions)
	if err == nil {
		log.Printf("[council-bench] case %s team: %s, %d tokens (modelUsage %d), %d teammate transcripts, %d messages, %.1f min",
			c.Id, out.State, out.Tokens, stats.ModelUsage, stats.Teammates, out.Messages, out.Minutes)
	}
	return out, err
}

// leadResult is the part of `claude -p --output-format json`'s result this file reads. modelUsage is the session's
// cumulative count per model, the teammates' included (the result's top-level usage covers only its last turn).
type leadResult struct {
	Result     string `json:"result"`
	SessionID  string `json:"session_id"`
	IsError    bool   `json:"is_error"`
	ModelUsage map[string]struct {
		Input         int64 `json:"inputTokens"`
		CacheRead     int64 `json:"cacheReadInputTokens"`
		CacheCreation int64 `json:"cacheCreationInputTokens"`
		Output        int64 `json:"outputTokens"`
	} `json:"modelUsage"`
}

func (r leadResult) modelUsageTotal() int64 {
	var n int64
	for _, u := range r.ModelUsage {
		n += u.Input + u.CacheRead + u.CacheCreation + u.Output
	}
	return n
}

// runTeam runs one case as a team and says how it ended. The lead runs in a copy of the case's project with agent teams
// on; a limit that fires ends it, and its spend is counted from the transcripts whatever the state. Its error is the
// caller's context error only.
func runTeam(ctx context.Context, c Case, opts TeamOptions) (TeamOutcome, teamStats, error) {
	var stats teamStats
	failed := func(format string, args ...any) (TeamOutcome, teamStats, error) {
		log.Printf("[council-bench] case %s team failed: %s", c.Id, fmt.Sprintf(format, args...))
		return TeamOutcome{State: TeamFailed}, stats, nil
	}

	roles, err := teamRoles(c)
	if err != nil {
		return failed("%v", err)
	}
	dir, err := os.MkdirTemp("", "arc-team-cell-")
	if err != nil {
		return failed("no folder for the cell: %v", err)
	}
	defer func() {
		if err := os.RemoveAll(dir); err != nil {
			log.Printf("[council-bench] case %s team: the cell's folder %s was not removed: %v", c.Id, dir, err)
		}
	}()
	if err := copyProject(c.Project, dir); err != nil {
		return failed("copying the project: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(dir, ".claude"), 0o755); err != nil {
		return failed("%v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".claude", "settings.json"), []byte(teamSettings), 0o644); err != nil {
		return failed("writing the cell's settings: %v", err)
	}

	// the session id is chosen here, so a lead that never prints a result (a timeout, a crash) still has a transcript to count
	session := uuid.NewString()
	limitCtx, cancel := context.WithTimeout(ctx, opts.Limit)
	defer cancel()
	started := time.Now()
	stdout, runErr := startLead(limitCtx, leadLaunch{
		Args: []string{"-p", "--model", opts.Lead, "--output-format", "json", "--permission-mode", "bypassPermissions",
			"--strict-mcp-config", "--session-id", session, "--disallowedTools", teamDisallowed},
		Env:    withoutWaveEnv(os.Environ()),
		Dir:    dir,
		Prompt: teamPrompt(c, opts, roles),
	})
	out := TeamOutcome{Session: session, State: TeamFailed, Minutes: math.Round(time.Since(started).Minutes()*10) / 10}
	if err := ctx.Err(); err != nil {
		return TeamOutcome{}, stats, err
	}

	var res leadResult
	var resErr error
	if len(bytes.TrimSpace(stdout)) > 0 {
		if resErr = json.Unmarshal(stdout, &res); resErr != nil {
			resErr = fmt.Errorf("the lead's result is not JSON: %w (%s)", resErr, abbreviate(string(stdout)))
		}
	} else {
		resErr = errors.New("the lead printed no result")
	}
	if res.SessionID != "" {
		out.Session = res.SessionID
	}
	stats.ModelUsage = res.modelUsageTotal()

	// the spend is counted whatever the state: a timed-out or failed cell used tokens too
	ts, tsErr := countTeam(out.Session)
	if tsErr != nil {
		log.Printf("[council-bench] case %s team: its tokens were not counted: %v", c.Id, tsErr)
	} else {
		out.Tokens, out.Messages, stats.Teammates = ts.Tokens, ts.Messages, ts.Teammates
		checkModelUsage(c.Id, ts.Tokens, stats.ModelUsage)
	}

	reason := ""
	switch {
	case limitCtx.Err() != nil:
		out.State = TeamTimedOut
		log.Printf("[council-bench] case %s team timed out after %s", c.Id, opts.Limit)
		return out, stats, nil
	case runErr != nil:
		reason = fmt.Sprintf("the lead did not end cleanly: %v", runErr)
	case resErr != nil:
		reason = resErr.Error()
	case res.IsError:
		reason = "the lead's result is an error: " + abbreviate(res.Result)
	case tsErr != nil:
		reason = "its tokens could not be counted"
	case ts.KeyReads > 0:
		reason = fmt.Sprintf("%d tool calls named the council-bench folder, where the answer keys live", ts.KeyReads)
	case ts.Teammates == 0:
		reason = "the lead worked alone: no teammate transcript was written"
	default:
		summary, perr := parseTeamReport(res.Result)
		if perr != nil {
			reason = fmt.Sprintf("%v: %s", perr, abbreviate(res.Result))
			break
		}
		out.State, out.Summary = TeamDone, summary
	}
	if reason != "" {
		log.Printf("[council-bench] case %s team failed: %s", c.Id, reason)
	}
	return out, stats, nil
}

// countTeam counts a session's lead and teammate transcripts.
func countTeam(session string) (transcriptStats, error) {
	lead, err := leadTranscript(session)
	if err != nil {
		return transcriptStats{}, err
	}
	return readTranscripts(lead)
}

// withoutWaveEnv is the environment minus every WAVETERM_* variable, so no spawn gate, Token burn card or stray
// `wsh agents send` reaches the lead (its hooks are no-ops without WAVETERM_BLOCKID).
func withoutWaveEnv(environ []string) []string {
	out := make([]string, 0, len(environ))
	for _, kv := range environ {
		if !strings.HasPrefix(strings.ToUpper(kv), "WAVETERM_") {
			out = append(out, kv)
		}
	}
	return out
}

// copyProject copies the files of the case's project folder into dst. Only files and folders are copied: a link or
// another special entry is left behind.
func copyProject(src, dst string) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		switch {
		case d.IsDir():
			return os.MkdirAll(target, 0o755)
		case d.Type().IsRegular():
			in, err := os.Open(path)
			if err != nil {
				return err
			}
			defer in.Close()
			out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, in); err != nil {
				out.Close()
				return err
			}
			return out.Close()
		}
		return nil
	})
}
