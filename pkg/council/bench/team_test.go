// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/council"
)

// teamOpts are options a test names models by, so a flag's value is seen to come from them.
var teamOpts = TeamOptions{Lead: "leadm", Mate: "matem", Limit: time.Minute}

// teamCase is a Review case over a small project: a file, and one in a folder.
func teamCase(t *testing.T) Case {
	t.Helper()
	project := t.TempDir()
	for name, text := range map[string]string{"a.go": "package a\n", filepath.Join("sub", "b.go"): "package sub\n"} {
		if err := os.MkdirAll(filepath.Dir(filepath.Join(project, name)), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(project, name), []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return Case{Id: "case-t", Mode: council.ModeReview, Project: project, Group: "ui-feature",
		Feature: "A feature of the tally", Question: "What is wrong with the tally?", Files: "a.go, sub/b.go"}
}

// launch is what the fake lead was started with.
type launch struct {
	calls    int
	args     []string
	env      []string
	dir      string
	prompt   string
	settings string   // .claude/settings.json as the lead found it
	files    []string // the project's files in its folder, slash paths
	session  string   // what --session-id gave it
}

// fakeLead replaces startLead for one test: it records the launch, then lets behave answer as the lead would.
func fakeLead(t *testing.T, behave func(ctx context.Context, rec *launch) ([]byte, error)) *launch {
	t.Helper()
	rec := &launch{}
	old := startLead
	t.Cleanup(func() { startLead = old })
	startLead = func(ctx context.Context, l leadLaunch) ([]byte, error) {
		rec.calls++
		rec.args, rec.env, rec.dir, rec.prompt = l.Args, l.Env, l.Dir, l.Prompt
		if i := slices.Index(l.Args, "--session-id"); i >= 0 {
			rec.session = l.Args[i+1]
		}
		if b, err := os.ReadFile(filepath.Join(l.Dir, ".claude", "settings.json")); err == nil {
			rec.settings = string(b)
		}
		filepath.WalkDir(l.Dir, func(path string, d os.DirEntry, err error) error {
			if err == nil && !d.IsDir() && !strings.Contains(path, ".claude") {
				rel, _ := filepath.Rel(l.Dir, path)
				rec.files = append(rec.files, filepath.ToSlash(rel))
			}
			return nil
		})
		return behave(ctx, rec)
	}
	return rec
}

// leadJSON is the lead's `--output-format json` result; its modelUsage is two models whose fields sum to usage.
func leadJSON(session, result string, isError bool, usage int64) []byte {
	b, err := json.Marshal(map[string]any{
		"type": "result", "result": result, "session_id": session, "is_error": isError,
		"modelUsage": map[string]any{
			"opus":   map[string]any{"inputTokens": 1, "cacheReadInputTokens": usage - 19, "cacheCreationInputTokens": 3, "outputTokens": 5},
			"sonnet": map[string]any{"inputTokens": 0, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0, "outputTokens": 10},
		},
	})
	if err != nil {
		panic(err)
	}
	return b
}

// teamTranscripts writes the lead's transcript (100 tokens, a SendMessage, and any extra tool uses) and one of 10 tokens
// per teammate under a fresh config dir. It returns the sum.
func teamTranscripts(t *testing.T, session string, teammates int, extra ...tUse) int64 {
	t.Helper()
	cfg := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", cfg)
	proj := filepath.Join(cfg, "projects", "p")
	writeTranscript(t, filepath.Join(proj, session+".jsonl"),
		tLine("lead-1", 10, 20, 30, 40, append([]tUse{{"SendMessage", "sm-1", `{"to":"UX","message":"hi"}`}}, extra...)...))
	for i := range teammates {
		writeTranscript(t, filepath.Join(proj, session, "subagents", "agent-"+string(rune('a'+i))+".jsonl"),
			tLine("mate-"+string(rune('a'+i)), 1, 1, 1, 7))
	}
	return 100 + int64(10*teammates)
}

func hasArgPair(args []string, flag, value string) bool {
	i := slices.Index(args, flag)
	return i >= 0 && i+1 < len(args) && args[i+1] == value
}

func TestTeamRunDone(t *testing.T) {
	c := teamCase(t)
	t.Setenv("WAVETERM_BLOCKID", "block-1")
	t.Setenv("waveterm_other", "x")
	logs := captureLog(t)
	var total int64
	rec := fakeLead(t, func(ctx context.Context, rec *launch) ([]byte, error) {
		total = teamTranscripts(t, rec.session, 2)
		return leadJSON(rec.session, wellFormedReport, false, total), nil
	})

	out, stats, err := runTeam(context.Background(), c, teamOpts)
	if err != nil {
		t.Fatal(err)
	}
	if out.State != TeamDone || out.Summary == nil || len(out.Summary.Directions) != 2 {
		t.Fatalf("outcome = %+v; log: %s", out, logs)
	}
	if out.Session != rec.session || out.Session == "" {
		t.Errorf("session = %q, want the one the lead was given, %q", out.Session, rec.session)
	}
	if out.Tokens != total || out.Messages != 1 || stats.Teammates != 2 || stats.ModelUsage != total {
		t.Errorf("tokens %d (want %d), messages %d (want 1), teammates %d (want 2), modelUsage %d (want %d)",
			out.Tokens, total, out.Messages, stats.Teammates, stats.ModelUsage, total)
	}
	if out.Minutes < 0 || out.Minutes > 1 {
		t.Errorf("minutes = %v", out.Minutes)
	}
	if strings.Contains(logs.String(), "modelUsage") {
		t.Errorf("tokens that match logged a gap: %s", logs)
	}

	// the launch
	if rec.calls != 1 {
		t.Fatalf("the lead was started %d times", rec.calls)
	}
	for _, p := range [][2]string{{"--model", "leadm"}, {"--output-format", "json"}, {"--permission-mode", "bypassPermissions"},
		{"--disallowedTools", "Bash,PowerShell,Edit,Write,NotebookEdit,WebFetch,WebSearch"}} {
		if !hasArgPair(rec.args, p[0], p[1]) {
			t.Errorf("args lack %s %s: %v", p[0], p[1], rec.args)
		}
	}
	for _, f := range []string{"-p", "--strict-mcp-config"} {
		if !slices.Contains(rec.args, f) {
			t.Errorf("args lack %s: %v", f, rec.args)
		}
	}
	for _, kv := range rec.env {
		if strings.HasPrefix(strings.ToUpper(kv), "WAVETERM_") {
			t.Errorf("the lead's environment holds %s", kv)
		}
	}
	if len(rec.env) == 0 {
		t.Error("the lead got an empty environment")
	}
	var settings struct{ Env map[string]string }
	if err := json.Unmarshal([]byte(rec.settings), &settings); err != nil || settings.Env["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] != "1" {
		t.Errorf("the cell's settings = %q (%v)", rec.settings, err)
	}
	if want := []string{"a.go", "sub/b.go"}; !slices.Equal(slices.Sorted(slices.Values(rec.files)), want) {
		t.Errorf("the lead's folder held %v, want a copy of the project %v", rec.files, want)
	}
	if rec.dir == c.Project {
		t.Error("the lead ran in the case's own project, not a copy")
	}
	if _, err := os.Stat(rec.dir); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("the cell's folder was not removed: %v", err)
	}
	for _, want := range []string{"A feature of the tally", "What is wrong with the tally?", "a.go, sub/b.go", "matem", "leadm"} {
		if !strings.Contains(rec.prompt, want) {
			t.Errorf("the prompt lacks %q", want)
		}
	}
}

func TestTeamRunStates(t *testing.T) {
	key := tUse{"Read", "kr-1", `{"file_path":"C:\\data\\council-bench\\keys\\x.md"}`}
	cases := []struct {
		name      string
		teammates int
		extra     []tUse
		out       func(session string, usage int64) ([]byte, error)
		want      string
		logged    string
	}{
		{"done", 1, nil, func(s string, u int64) ([]byte, error) { return leadJSON(s, wellFormedReport, false, u), nil }, TeamDone, ""},
		{"non-zero exit", 1, nil, func(s string, u int64) ([]byte, error) {
			return leadJSON(s, wellFormedReport, false, u), errors.New("exit status 1")
		}, TeamFailed, "did not end cleanly"},
		{"is_error", 1, nil, func(s string, u int64) ([]byte, error) { return leadJSON(s, wellFormedReport, true, u), nil }, TeamFailed, "is an error"},
		{"a key read", 1, []tUse{key}, func(s string, u int64) ([]byte, error) { return leadJSON(s, wellFormedReport, false, u), nil }, TeamFailed, "1 tool calls named the council-bench folder"},
		{"the lead alone", 0, nil, func(s string, u int64) ([]byte, error) { return leadJSON(s, wellFormedReport, false, u), nil }, TeamFailed, "worked alone"},
		{"a report with no item", 1, nil, func(s string, u int64) ([]byte, error) { return leadJSON(s, "I could not finish.", false, u), nil }, TeamFailed, "no numbered item"},
		{"no result", 1, nil, func(s string, u int64) ([]byte, error) { return nil, nil }, TeamFailed, "printed no result"},
		{"a result that is not JSON", 1, nil, func(s string, u int64) ([]byte, error) { return []byte("oops"), nil }, TeamFailed, "not JSON"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			logs := captureLog(t)
			var total int64
			fakeLead(t, func(ctx context.Context, rec *launch) ([]byte, error) {
				total = teamTranscripts(t, rec.session, tc.teammates, tc.extra...)
				return tc.out(rec.session, total)
			})
			out, _, err := runTeam(context.Background(), teamCase(t), teamOpts)
			if err != nil {
				t.Fatal(err)
			}
			if out.State != tc.want {
				t.Fatalf("state = %q, want %q; log: %s", out.State, tc.want, logs)
			}
			if tc.want == TeamDone && out.Summary == nil {
				t.Error("a done outcome has no summary")
			}
			if tc.want != TeamDone && out.Summary != nil {
				t.Errorf("a %s outcome carries a summary", out.State)
			}
			if out.Tokens != total {
				t.Errorf("tokens = %d, want the transcripts' %d whatever the state", out.Tokens, total)
			}
			if !strings.Contains(logs.String(), tc.logged) {
				t.Errorf("the log lacks %q: %s", tc.logged, logs)
			}
		})
	}
}

func TestTeamRunLimitFires(t *testing.T) {
	logs := captureLog(t)
	var total int64
	fakeLead(t, func(ctx context.Context, rec *launch) ([]byte, error) {
		total = teamTranscripts(t, rec.session, 1)
		<-ctx.Done() // the lead outlives its limit and is killed: no result
		return nil, ctx.Err()
	})
	opts := teamOpts
	opts.Limit = 30 * time.Millisecond
	out, _, err := runTeam(context.Background(), teamCase(t), opts)
	if err != nil {
		t.Fatalf("a limit that fires is an outcome, not an error: %v", err)
	}
	if out.State != TeamTimedOut || out.Summary != nil {
		t.Errorf("outcome = %+v; log: %s", out, logs)
	}
	if out.Tokens != total || out.Tokens == 0 {
		t.Errorf("a timed-out cell's tokens = %d, want its transcripts' %d (they were spent)", out.Tokens, total)
	}
}

func TestTeamRunCallerCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	fakeLead(t, func(ctx context.Context, rec *launch) ([]byte, error) {
		cancel() // the bench is stopped while the lead runs
		<-ctx.Done()
		return nil, ctx.Err()
	})
	out, _, err := runTeam(ctx, teamCase(t), teamOpts)
	if !errors.Is(err, context.Canceled) {
		t.Errorf("error = %v, want the caller's context error", err)
	}
	if out.State != "" {
		t.Errorf("a cancelled cell has no outcome, got %+v", out)
	}
}

func TestTeamRunFailsBeforeLaunch(t *testing.T) {
	logs := captureLog(t)
	rec := fakeLead(t, func(ctx context.Context, rec *launch) ([]byte, error) { return nil, errors.New("must not start") })

	noGroup := teamCase(t)
	noGroup.Group = "no-such-group"
	noProject := teamCase(t)
	noProject.Project = filepath.Join(t.TempDir(), "gone")
	for name, c := range map[string]Case{"unknown group": noGroup, "missing project": noProject} {
		out, _, err := runTeam(context.Background(), c, teamOpts)
		if err != nil || out.State != TeamFailed {
			t.Errorf("%s: outcome %+v, error %v; want a failed outcome", name, out, err)
		}
	}
	if rec.calls != 0 {
		t.Errorf("a lead was started %d times for a cell that could not be set up", rec.calls)
	}
	if !strings.Contains(logs.String(), "no-such-group") {
		t.Errorf("the log does not name the group: %s", logs)
	}
}

func TestTeamRunLogsUsageGap(t *testing.T) {
	logs := captureLog(t)
	fakeLead(t, func(ctx context.Context, rec *launch) ([]byte, error) {
		total := teamTranscripts(t, rec.session, 1)
		return leadJSON(rec.session, wellFormedReport, false, total*2), nil // the result says twice what the transcripts hold
	})
	out, stats, err := runTeam(context.Background(), teamCase(t), teamOpts)
	if err != nil || out.State != TeamDone {
		t.Fatalf("outcome %+v, error %v", out, err)
	}
	if out.Tokens != 110 || stats.ModelUsage != 220 {
		t.Errorf("tokens %d (the row keeps the transcripts' 110), modelUsage %d (want 220)", out.Tokens, stats.ModelUsage)
	}
	if !strings.Contains(logs.String(), "110") || !strings.Contains(logs.String(), "220") {
		t.Errorf("the gap was not logged with both figures: %s", logs)
	}
}

func TestTeamPrompt(t *testing.T) {
	roles, err := teamRoles(Case{Group: "ui-feature"})
	if err != nil {
		t.Fatal(err)
	}
	if len(roles) != 4 {
		t.Fatalf("ui-feature gave %d teammates, want its 4 roles without the coordinator", len(roles))
	}
	c := Case{Mode: council.ModeReview, Feature: "FEATURE-X", Question: "QUESTION-X?", Files: "f1.go, f2.go"}
	p := teamPrompt(c, TeamOptions{Lead: "leadm", Mate: "matem"}, roles)

	for _, want := range []string{
		"FEATURE-X", "QUESTION-X?", "f1.go, f2.go", "run on leadm", "each role teammate on matem",
		"This team needs 4: one for each of UX, RAM, Newuser, Skeptic.",
		"Spawn name: Newuser", roles[0].Brief, roles[3].Brief,
		"Answer: <one sentence", "## What to do, most important first", "Why: <why it matters, with path:line>", "Disagrees: <who disagrees",
		"keep at most 5", "you add no findings of your own",
	} {
		if !strings.Contains(p, want) {
			t.Errorf("the Review prompt lacks %q", want)
		}
	}
	for _, gone := range []string{"Scout", "notes.md", "council-report.md", "{{", "}}", "Write only", "Write tool: "} {
		if strings.Contains(p, gone) {
			t.Errorf("the Review prompt still holds %q", gone)
		}
	}

	c.Mode = council.ModeBrainstorm
	b := teamPrompt(c, TeamOptions{Lead: "leadm", Mate: "matem"}, roles)
	for _, want := range []string{"FEATURE-X", "Problem or goal: FEATURE-X", "This is a Brainstorm", "keep at most 3", "you add no ideas of your own", "## What to do, most important first"} {
		if !strings.Contains(b, want) {
			t.Errorf("the Brainstorm prompt lacks %q", want)
		}
	}
	for _, gone := range []string{"Scout", "notes.md", "{{", "keep at most 5"} {
		if strings.Contains(b, gone) {
			t.Errorf("the Brainstorm prompt still holds %q", gone)
		}
	}
}

// TestTeamSmoke runs the team variant once on haiku, on a tiny project, to see the runner work end to end before a real
// pass: the report parses, the lead spawned teammates, and the transcripts' tokens match the result's modelUsage. It
// judges nothing. It spends tokens, so it runs only when asked: ARC_BENCH_SMOKE=1.
func TestTeamSmoke(t *testing.T) {
	if os.Getenv("ARC_BENCH_SMOKE") != "1" {
		t.Skip("ARC_BENCH_SMOKE=1 runs the team variant once on haiku (it spends tokens)")
	}
	project, err := filepath.Abs(filepath.Join("testdata", "team-smoke"))
	if err != nil {
		t.Fatal(err)
	}
	c := Case{Id: "team-smoke", Mode: council.ModeReview, Project: project, Group: "ui-feature", Files: "counter.go",
		Feature: "A tally of scores", Question: "What is wrong in counter.go? List every bug you can show."}
	opts := TeamOptions{Lead: "haiku", Mate: "haiku", Limit: 15 * time.Minute}

	out, stats, err := runTeam(context.Background(), c, opts)
	if err != nil {
		t.Fatal(err)
	}
	items := 0
	if out.Summary != nil {
		items = len(out.Summary.Directions)
	}
	t.Logf("SMOKE state=%s items=%d teammates=%d messages=%d tokens=%d modelUsage=%d minutes=%.1f session=%s",
		out.State, items, stats.Teammates, out.Messages, out.Tokens, stats.ModelUsage, out.Minutes, out.Session)
	if out.Summary != nil {
		t.Logf("SMOKE answer: %s", out.Summary.Answer)
		for _, d := range out.Summary.Directions {
			t.Logf("SMOKE item %d: %s", d.Rank, d.Title)
		}
	}

	if out.State != TeamDone {
		t.Errorf("state = %q, want done", out.State)
	}
	if items < 1 {
		t.Error("the report parsed into no item")
	}
	if stats.Teammates < 1 {
		t.Error("no teammate transcript was read")
	}
	if out.Messages < 1 {
		t.Error("the lead and its teammates sent no SendMessage")
	}
	if stats.ModelUsage <= 0 {
		t.Error("the result holds no modelUsage to check the tokens against")
	} else if gap := math.Abs(float64(out.Tokens-stats.ModelUsage)) * 100 / float64(stats.ModelUsage); gap > usageGapPercent {
		t.Errorf("the transcripts' tokens %d are %.1f%% from modelUsage %d, more than %v%%", out.Tokens, gap, stats.ModelUsage, usageGapPercent)
	}
}
