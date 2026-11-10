// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"math"
	"math/rand/v2"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/brainstormcheck"
	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/skills"
)

// The runner of the brainstorm variant: Arc's brainstorm skill run by `claude -p` in a copy of the case's project, with
// a driver that plays the person (nextStep, brainstormdriver.go) and the two helpers the skill calls through wavesrv in
// Arc (its judge and the builder reviewer, run here as claude launches of their own, the fake wsh, fakewsh.go, only
// recording that they were asked for). The cell lays out one folder:
//
//	<root>/project         the copy, where every launch runs
//	<root>/bin/wsh         the fake wsh, first on PATH
//	<root>/requests.jsonl  what the fake wsh recorded
//	<root>/reports/        where the judge's and the reviewer's reports are written
//	<root>/plugins/arc     the arc plugin: the embedded brainstorm skill alone

const (
	// brainstormHelperModel runs the skill's judge and the builder reviewer: opus, as in production.
	brainstormHelperModel = "opus"

	// maxStuckReminders is how many reminders a run gets for turns that end with nothing for the person to do; the next
	// such turn ends it. maxBadInARow is how many turns in a row may go wrong (a failed launch, a result that cannot be
	// read, a brainstorm.json missing or invalid) before the run ends: the first gets a reminder, the second ends it.
	maxStuckReminders = 3
	maxBadInARow      = 2

	// brainstormHelperDisallowed turns off every tool of Claude Code but Read, Grep, Glob, Write and Bash for the skill's
	// judge and the reviewer: they read the project and write one report.
	brainstormHelperDisallowed = "Edit,NotebookEdit,PowerShell,WebFetch,WebSearch,Agent,Task,TaskOutput,TaskStop,KillShell,BashOutput," +
		"TodoWrite,Skill,SlashCommand,AskUserQuestion,EnterPlanMode,ExitPlanMode,SendMessage"
)

// brainstormDroppedEnv are the variables a brainstorm launch does not inherit besides Wave's: ARC_RUN_AGENT (set, it
// would turn the skill off) and the Claude Code session variables a `go run` from a Claude shell carries, among them
// CLAUDE_CODE_PLUGIN_DIRS, which would load the installed arc mod's arc:brainstorm beside the bench's. Auth and provider
// variables stay.
var brainstormDroppedEnv = []string{"ARC_RUN_AGENT", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT", "CLAUDE_CODE_PLUGIN_DIRS"}

// brainstormOptions are the agent's model and the limits of a brainstorm cell.
type brainstormOptions struct {
	Model string        // the agent's model; the skill's judge and the reviewer run brainstormHelperModel
	Turns int           // the most agent turns: a run that needs more is timed-out
	Limit time.Duration // the most wall time, the skill's judge and the reviewer included
}

// defaultBrainstormOptions are what the bench runs the skill with.
var defaultBrainstormOptions = brainstormOptions{Model: "opus", Turns: 60, Limit: 60 * time.Minute}

// RunBrainstorm is the real BrainstormFunc: one Brainstorm case run through the skill, with the bench's own model and
// limits.
func RunBrainstorm(ctx context.Context, c Case) (BrainstormOutcome, error) {
	out, err := runBrainstorm(ctx, c, defaultBrainstormOptions)
	if err == nil {
		log.Printf("[council-bench] case %s brainstorm: %s, %d turns, %d tokens (+%d judging), %.1f min",
			c.Id, out.State, out.Turns, out.Tokens, out.JudgeTokens, out.Minutes)
	}
	return out, err
}

// brainstormEnd is how a run's loop ended when it did not go on: done (both marks judged), failed or timed-out, and why
// for the two that are not done.
type brainstormEnd struct {
	state  string
	reason string
}

// brainstormRun is one cell in flight: its folders, what its launches share, and what the loop has counted. A run lasts
// one call of runBrainstorm; its two contexts are that call's.
type brainstormRun struct {
	c    Case
	opts brainstormOptions

	root, project, reports, requests string
	env                              []string
	plugins                          []string // the two --plugin-dirs: the temp arc plugin, the installed superpowers
	skill                            string
	session                          string

	parent  context.Context // the caller's: its end stops the bench
	limited context.Context // parent with the cell's time limit: its end is a timed-out run

	turns       int
	tokens      int64            // every session's spend
	spent       map[string]int64 // each session's modelUsage as its last result reported it, a running total
	judgeTokens int64            // both bench judge calls
	helpers     int              // reports written so far, to name the next one

	consumed   int  // requests handled
	bad        int  // turns that went wrong in a row
	stuck      int  // reminders sent for turns that ended with nothing for the person to do
	doneScored bool // the done mark's items are taken
	doneItems  []council.CouncilDirection

	// the marks, set when the run is done
	final, atDone Verdict
	decisions     int
	questions     int
}

// runBrainstorm runs one Brainstorm case through the skill and says how it ended. Its error is the caller's context
// error only: every other failure is an outcome whose state is TeamFailed, logged with its reason. Whatever the state,
// the spend of every launch is counted and the agent's transcript is read for a look at the answer keys, which fails a
// run that was done.
func runBrainstorm(ctx context.Context, c Case, opts brainstormOptions) (BrainstormOutcome, error) {
	started := time.Now()
	out := BrainstormOutcome{State: TeamFailed}
	failed := func(format string, args ...any) (BrainstormOutcome, error) {
		log.Printf("[council-bench] case %s brainstorm failed: %s", c.Id, fmt.Sprintf(format, args...))
		out.State = TeamFailed
		return out, nil
	}

	r := &brainstormRun{c: c, opts: opts}
	defer r.cleanup()
	if err := r.setup(); err != nil {
		return failed("%v", err)
	}
	out.Skill = r.skill
	r.session = uuid.NewString() // chosen here, so a run that never prints a result still has a transcript to read
	out.Session = r.session

	end, err := r.drive(ctx)
	out.Tokens, out.JudgeTokens, out.Turns = r.tokens, r.judgeTokens, r.turns
	out.Minutes = math.Round(time.Since(started).Minutes()*10) / 10
	if err != nil {
		return BrainstormOutcome{}, err
	}

	// the key-read check runs whatever the state: a run that looked at the answers is not a result
	state, reason := end.state, end.reason
	st, terr := r.readAgentTranscript()
	switch {
	case terr != nil && state == TeamDone:
		state, reason = TeamFailed, fmt.Sprintf("its transcript could not be read to check that it never looked at the answer keys: %v", terr)
	case terr != nil:
		log.Printf("[council-bench] case %s brainstorm: its transcript was not read: %v", c.Id, terr)
	case st.KeyReads > 0 && state == TeamDone:
		state, reason = TeamFailed, fmt.Sprintf("%d tool calls named the council-bench folder, where the answer keys live", st.KeyReads)
	case st.KeyReads > 0:
		log.Printf("[council-bench] case %s brainstorm: %d tool calls named the council-bench folder, where the answer keys live", c.Id, st.KeyReads)
	}

	out.State = state
	switch state {
	case TeamDone:
		out.Final, out.AtDone, out.Decisions, out.Questions = r.final, r.atDone, r.decisions, r.questions
	case TeamTimedOut:
		log.Printf("[council-bench] case %s brainstorm timed out: %s", c.Id, reason)
	default:
		log.Printf("[council-bench] case %s brainstorm failed: %s", c.Id, reason)
	}
	return out, nil
}

// setup makes the cell's folders and everything the launches share. A failure leaves nothing to clean up that cleanup
// does not remove.
func (r *brainstormRun) setup() error {
	super, version, err := installedSuperpowers()
	if err != nil {
		return err
	}
	skillText, err := skills.FS.ReadFile("brainstorm/SKILL.md")
	if err != nil {
		return fmt.Errorf("the brainstorm skill is not embedded in this binary: %w", err)
	}
	sum := sha256.Sum256(skillText)
	r.skill = hex.EncodeToString(sum[:])[:8] + " superpowers@" + version

	if r.root, err = os.MkdirTemp("", "arc-brainstorm-cell-"); err != nil {
		return fmt.Errorf("no folder for the cell: %w", err)
	}
	r.project = filepath.Join(r.root, "project")
	bin := filepath.Join(r.root, "bin")
	r.reports = filepath.Join(r.root, "reports")
	r.requests = filepath.Join(r.root, "requests.jsonl")
	arc := filepath.Join(r.root, "plugins", "arc")
	for _, dir := range []string{r.project, bin, r.reports} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("making the cell's folders: %w", err)
		}
	}
	if err := copyProject(r.c.Project, r.project); err != nil {
		return fmt.Errorf("copying the project: %w", err)
	}
	if err := writeFakeWsh(bin, r.requests); err != nil {
		return err
	}
	if err := writeArcPlugin(arc); err != nil {
		return err
	}
	r.plugins = []string{arc, super}
	r.env = brainstormEnv(bin)
	return nil
}

// cleanup removes the cell's folder.
func (r *brainstormRun) cleanup() {
	if r.root == "" {
		return
	}
	if err := os.RemoveAll(r.root); err != nil {
		log.Printf("[council-bench] case %s brainstorm: the cell's folder %s was not removed: %v", r.c.Id, r.root, err)
	}
}

// installedEntry is one install of a plugin in installed_plugins.json.
type installedEntry struct {
	InstallPath string `json:"installPath"`
	Version     string `json:"version"`
}

// installedSuperpowers finds the installed superpowers plugin in <claude config dir>/plugins/installed_plugins.json: the
// entry of a key that starts with "superpowers@" (several: the last key in name order, and its last install), and the
// version it names. The file holds a list of installs per plugin, or in an older shape one install.
func installedSuperpowers() (dir, version string, err error) {
	cfg, err := claudeConfigDir()
	if err != nil {
		return "", "", fmt.Errorf("superpowers' install cannot be found: %w", err)
	}
	path := filepath.Join(cfg, "plugins", "installed_plugins.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return "", "", fmt.Errorf("superpowers is not installed: reading %s: %w", path, err)
	}
	var doc struct {
		Plugins map[string]json.RawMessage `json:"plugins"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		return "", "", fmt.Errorf("superpowers' install cannot be found: %s is not valid JSON: %w", path, err)
	}
	var names []string
	for name := range doc.Plugins {
		if strings.HasPrefix(name, "superpowers@") {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	var found installedEntry
	for _, name := range names {
		var list []installedEntry
		if json.Unmarshal(doc.Plugins[name], &list) != nil {
			var one installedEntry
			if json.Unmarshal(doc.Plugins[name], &one) != nil {
				continue
			}
			list = []installedEntry{one}
		}
		if len(list) > 0 {
			found = list[len(list)-1]
		}
	}
	if found.InstallPath == "" {
		return "", "", fmt.Errorf("superpowers is not installed: %s lists no superpowers@ plugin with an install path", path)
	}
	if info, err := os.Stat(found.InstallPath); err != nil || !info.IsDir() {
		return "", "", fmt.Errorf("superpowers is installed at %s, which is not a folder (%v)", found.InstallPath, err)
	}
	if found.Version == "" {
		found.Version = "unknown"
	}
	return found.InstallPath, found.Version, nil
}

// writeArcPlugin writes a plugin named arc into dir that holds the brainstorm skill the binary embeds, so the skill the
// agent loads is arc:brainstorm, the name its own text uses.
func writeArcPlugin(dir string) error {
	manifest := `{"name": "arc", "version": "0.0.0", "description": "The brainstorm skill the council bench runs, from the binary's own copy."}` + "\n"
	if err := os.MkdirAll(filepath.Join(dir, ".claude-plugin"), 0o755); err != nil {
		return fmt.Errorf("writing the arc plugin: %w", err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".claude-plugin", "plugin.json"), []byte(manifest), 0o644); err != nil {
		return fmt.Errorf("writing the arc plugin: %w", err)
	}
	err := fs.WalkDir(skills.FS, "brainstorm", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		target := filepath.Join(dir, "skills", filepath.FromSlash(path))
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := skills.FS.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
	if err != nil {
		return fmt.Errorf("writing the arc plugin's brainstorm skill: %w", err)
	}
	return nil
}

// brainstormEnv is the process environment of every launch: without Wave's variables (withoutWaveEnv) and the ones in
// brainstormDroppedEnv, with binDir first on PATH. The variable keeps the name it has, which on Windows is Path.
func brainstormEnv(binDir string) []string {
	env := withoutWaveEnv(os.Environ())
	out := make([]string, 0, len(env)+1)
	pathSet := false
	for _, kv := range env {
		name, value, _ := strings.Cut(kv, "=")
		upper := strings.ToUpper(name)
		if slices.Contains(brainstormDroppedEnv, upper) {
			continue
		}
		if upper == "PATH" {
			if pathSet {
				continue // a second spelling of PATH would shadow the first
			}
			pathSet = true
			if value != "" {
				kv = name + "=" + binDir + string(os.PathListSeparator) + value
			} else {
				kv = name + "=" + binDir
			}
		}
		out = append(out, kv)
	}
	if !pathSet {
		out = append(out, "PATH="+binDir)
	}
	return out
}

// brainstormPrompt is the agent's first message: the case's feature and question, the files to read first, and that the
// answers will come as the person's. It says nothing of what the run is for or who answers.
func brainstormPrompt(c Case) string {
	var b strings.Builder
	b.WriteString("Brainstorm a design with superpowers:brainstorming, here inside Arc (`wsh` is on your PATH).\n\n")
	b.WriteString("What we are designing: " + strings.TrimSpace(c.Feature) + "\n\n")
	b.WriteString("The question to settle: " + strings.TrimSpace(c.Question) + "\n")
	if files := c.FileList(); len(files) > 0 {
		b.WriteString("\nRead these files first: " + strings.Join(files, ", ") + "\n")
	}
	b.WriteString("\nYou work it out with the person one question at a time, and their answers reach you as their replies in this conversation. Go on until the design is done.\n")
	return b.String()
}

// failedTurnLine is the reminder after a turn that did not finish: the state is in brainstorm.json, so the agent goes on
// from there.
const failedTurnLine = "Your last turn did not finish. Pick up where you left off: under arc:brainstorm, brainstorm.json holds the state Arc reads after every turn, " +
	"so rewrite it if it is out of date, and end the turn on the question you wait on, or on `done` true with `question` null once nothing is left to ask."

// invalidFileLine is the reminder after a turn that left brainstorm.json missing or invalid.
func invalidFileLine(err error) string {
	return "Arc cannot use brainstorm.json: " + err.Error() + ". Under arc:brainstorm, write it again so it is valid (`v` 1, a string `title`, `parts` each with an `id` and a `state` of yours, guess, asked or open, " +
		"and `question` null or an object with `n` and `text`) at `.superpowers/brainstorm/<topic>/brainstorm.json`, then end the turn."
}

// launchArgs are the flags every launch carries, then the model and the flags of its kind: setting sources of the project
// and local only (so the user's settings, the installed arc mod and its hooks stay out), the temp arc plugin and the
// installed superpowers.
func (r *brainstormRun) launchArgs(model string, extra ...string) []string {
	args := []string{"-p", "--model", model, "--output-format", "json", "--permission-mode", "bypassPermissions",
		"--strict-mcp-config", "--setting-sources", "project,local"}
	for _, p := range r.plugins {
		args = append(args, "--plugin-dir", p)
	}
	return append(args, extra...)
}

// launch runs claude once through startLead in the copy and counts what it spent. It returns why the launch went wrong,
// "" when it did not: a failed exit, a result that is missing or not JSON, or one that says it is an error. The
// result's modelUsage counts whatever came of it.
func (r *brainstormRun) launch(model string, extra []string, prompt string) string {
	stdout, runErr := startLead(r.limited, leadLaunch{Args: r.launchArgs(model, extra...), Env: r.env, Dir: r.project, Prompt: prompt})
	var res leadResult
	var resErr error
	if len(bytes.TrimSpace(stdout)) == 0 {
		resErr = errors.New("it printed no result")
	} else if err := json.Unmarshal(stdout, &res); err != nil {
		resErr = fmt.Errorf("its result is not JSON: %w (%s)", err, abbreviate(string(stdout)))
	}
	// A resumed claude -p reports the session's whole modelUsage so far, so a turn spent what its total grew by.
	total := res.modelUsageTotal()
	if res.SessionID == "" {
		r.tokens += total
	} else {
		if r.spent == nil {
			r.spent = map[string]int64{}
		}
		r.tokens += total - r.spent[res.SessionID]
		r.spent[res.SessionID] = total
	}
	switch {
	case runErr != nil:
		return fmt.Sprintf("it did not end cleanly: %v", runErr)
	case resErr != nil:
		return resErr.Error()
	case res.IsError:
		return "its result is an error: " + abbreviate(res.Result)
	}
	return ""
}

// cut says whether the loop has to stop where it is: the caller's context ended (the error), or the cell's time limit did
// (a timed-out end).
func (r *brainstormRun) cut() (*brainstormEnd, error) {
	if err := r.parent.Err(); err != nil {
		return nil, err
	}
	if r.limited.Err() != nil {
		return &brainstormEnd{state: TeamTimedOut, reason: fmt.Sprintf("the %s limit passed", r.opts.Limit)}, nil
	}
	return nil, nil
}

// drive runs the agent's turns, answering each as the person, until the brainstorm is finished (both marks judged), a run
// is broken, or a limit passes. Its error is the caller's context error.
func (r *brainstormRun) drive(ctx context.Context) (*brainstormEnd, error) {
	r.parent = ctx
	limited, cancel := context.WithTimeout(ctx, r.opts.Limit)
	defer cancel()
	r.limited = limited

	prompt := brainstormPrompt(r.c)
	for {
		session := []string{"--resume", r.session}
		if r.turns == 0 {
			session = []string{"--session-id", r.session}
		}
		why := r.launch(r.opts.Model, session, prompt)
		r.turns++
		if end, err := r.cut(); end != nil || err != nil {
			return end, err
		}

		var line string
		var end *brainstormEnd
		var err error
		if why != "" {
			line, end = r.badTurn("the agent's turn went wrong: "+why, failedTurnLine)
		} else {
			line, end, err = r.afterTurn()
		}
		if end != nil || err != nil {
			return end, err
		}
		if r.turns >= r.opts.Turns {
			return &brainstormEnd{state: TeamTimedOut, reason: fmt.Sprintf("the agent used its %d turns", r.turns)}, nil
		}
		prompt = line
	}
}

// badTurn counts a turn that went wrong: the first gets line as a reminder, the second in a row ends the run.
func (r *brainstormRun) badTurn(reason, line string) (string, *brainstormEnd) {
	r.bad++
	log.Printf("[council-bench] case %s brainstorm: %s", r.c.Id, reason)
	if r.bad >= maxBadInARow {
		return "", &brainstormEnd{state: TeamFailed, reason: fmt.Sprintf("%d turns in a row went wrong, the last: %s", r.bad, reason)}
	}
	return line, nil
}

// stuckTurn counts a turn that ended with nothing for the person to do: the first three get line as a reminder, the
// fourth ends the run with reason.
func (r *brainstormRun) stuckTurn(reason, line string) (string, *brainstormEnd) {
	r.stuck++
	log.Printf("[council-bench] case %s brainstorm: stuck turn %d: %s", r.c.Id, r.stuck, reason)
	if r.stuck > maxStuckReminders {
		return "", &brainstormEnd{state: TeamFailed, reason: fmt.Sprintf("the agent ended %d turns with nothing for the person to do, the last: %s", r.stuck, reason)}
	}
	return line, nil
}

// failEnd is an end that is failed with a reason.
func failEnd(format string, args ...any) *brainstormEnd {
	return &brainstormEnd{state: TeamFailed, reason: fmt.Sprintf(format, args...)}
}

// afterTurn reads what a turn that finished left behind and does the first thing that applies (the driver loop of the
// spec): it returns the line to send next, or an end. Its error is the caller's context error.
func (r *brainstormRun) afterTurn() (string, *brainstormEnd, error) {
	file, raw, err := r.findFile()
	var s brainstormState
	if err == nil {
		s, err = parseBrainstormState(raw)
	}
	if err != nil {
		line, end := r.badTurn("brainstorm.json is not usable: "+err.Error(), invalidFileLine(err))
		return line, end, nil
	}
	r.bad = 0

	reqs, err := readRequests(r.requests)
	if err != nil {
		return "", failEnd("%v", err), nil
	}
	pending, req := "", wshRequest{}
	if r.consumed < len(reqs) {
		req = reqs[r.consumed]
		pending = req.Cmd
	}

	st := nextStep(s, pending)
	if (st.Kind == stepJudge || st.Kind == stepCheck) && r.turns >= r.opts.Turns {
		// the agent has no turn left to read the answer: do not spend a judge on it
		return "", &brainstormEnd{state: TeamTimedOut, reason: fmt.Sprintf("the agent used its %d turns", r.turns)}, nil
	}
	switch st.Kind {
	case stepJudge:
		r.consumed++
		return r.runJudge(file, raw, req)
	case stepCheck:
		r.consumed++
		return r.runCheck(file, s)
	case stepSend:
		if st.ScoreDone && !r.doneScored {
			r.takeDoneMark(s)
		}
		return st.Line, nil, nil
	case stepStuck:
		line, end := r.stuckTurn(st.Reason, st.Line)
		return line, end, nil
	case stepFinished:
		end, err := r.finish(s)
		return "", end, err
	}
	return "", failEnd("the driver has no step %q", st.Kind), nil
}

// findFile finds the agent's brainstorm.json under <copy>/.superpowers/brainstorm/<topic>/: the one there (several: the
// most recently written) and its bytes. The path a recorded request names is not used: the agent's shell may spell it in
// a form this process cannot open.
func (r *brainstormRun) findFile() (string, []byte, error) {
	base := filepath.Join(r.project, ".superpowers", "brainstorm")
	topics, err := os.ReadDir(base)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return "", nil, fmt.Errorf("reading %s: %w", base, err)
	}
	var best string
	var bestTime time.Time
	for _, t := range topics {
		path := filepath.Join(base, t.Name(), "brainstorm.json")
		info, err := os.Stat(path)
		if err != nil || info.IsDir() {
			continue
		}
		if best == "" || info.ModTime().After(bestTime) {
			best, bestTime = path, info.ModTime()
		}
	}
	if best == "" {
		return "", nil, errors.New("no brainstorm.json under .superpowers/brainstorm/<topic>/ in the project")
	}
	raw, err := os.ReadFile(best)
	if err != nil {
		return "", nil, fmt.Errorf("reading %s: %w", best, err)
	}
	return best, raw, nil
}

// takeDoneMark takes the design as it stands when the builder check starts: the items the done mark will judge.
func (r *brainstormRun) takeDoneMark(s brainstormState) {
	r.doneItems = decisionItems(s)
	r.doneScored = true
}

// helperReport is the path of a fresh report file in the cell's reports folder.
func (r *brainstormRun) helperReport(name, ext string) string {
	r.helpers++
	return filepath.Join(r.reports, fmt.Sprintf("%s-%d.%s", name, r.helpers, ext))
}

// runHelper runs the skill's judge or the builder reviewer: a launch of its own, no session, only Read, Grep, Glob, Write
// and Bash. It returns the report it wrote at reportPath, or why there is none.
func (r *brainstormRun) runHelper(what, prompt, reportPath string) ([]byte, error) {
	if why := r.launch(brainstormHelperModel, []string{"--disallowedTools", brainstormHelperDisallowed}, prompt); why != "" {
		return nil, fmt.Errorf("the %s did not finish: %s", what, why)
	}
	report, err := os.ReadFile(reportPath)
	if err != nil {
		return nil, fmt.Errorf("the %s wrote no report at %s: %w", what, reportPath, err)
	}
	return report, nil
}

// runJudge answers a judge request the way Arc does: the judge weighs the question the file holds, and the line sent is
// the delivery of judge.json beside brainstorm.json, or why the judge failed. A judge that is refused or fails is the
// agent's to handle: it is a line, not the end of the run. Its error is the caller's context error.
func (r *brainstormRun) runJudge(file string, raw []byte, req wshRequest) (string, *brainstormEnd, error) {
	judgeFailed := func(format string, args ...any) (string, *brainstormEnd, error) {
		reason := fmt.Sprintf(format, args...)
		log.Printf("[council-bench] case %s brainstorm: the skill's judge failed: %s", r.c.Id, reason)
		return brainstormcheck.JudgeFailedLine(reason), nil, nil
	}
	in, err := brainstormcheck.ReadJudgeInput(raw)
	if err != nil {
		return judgeFailed("%v", err)
	}
	reportPath := r.helperReport("judge", "json")
	report, err := r.runHelper("judge", brainstormcheck.JudgePrompt(in, req.Line, reportPath, rand.Shuffle), reportPath)
	if end, cerr := r.cut(); end != nil || cerr != nil {
		return "", end, cerr
	}
	if err != nil {
		return judgeFailed("%v", err)
	}
	result, err := brainstormcheck.JudgeFileBytes(string(report))
	if err != nil {
		return judgeFailed("%v", err)
	}
	path := brainstormcheck.JudgeResultPath(file)
	if err := os.WriteFile(path, result, 0o644); err != nil {
		return "", failEnd("writing the judge's result to %s: %v", path, err), nil
	}
	return brainstormcheck.JudgedLine(path), nil, nil
}

// runCheck answers a check request the way Arc does: the reviewer reads the spec, and the line sent hands its report,
// written beside brainstorm.json. A spec that is not there is a reminder (the real command refuses it) that counts with
// the stuck turns; a reviewer that fails has no report to hand over and ends the run. Its error is the caller's context
// error.
func (r *brainstormRun) runCheck(file string, s brainstormState) (string, *brainstormEnd, error) {
	if strings.TrimSpace(s.Spec) == "" {
		line, end := r.stuckTurn("brainstorm.json names no spec for the builder check",
			"brainstorm.json names no spec. Under arc:brainstorm, set `spec` to the spec's path and write the spec there before you run `wsh brainstorm check`, then run it again.")
		return line, end, nil
	}
	spec := s.Spec
	if !filepath.IsAbs(spec) {
		spec = filepath.Join(r.project, filepath.FromSlash(spec))
	}
	if info, err := os.Stat(spec); err != nil || info.IsDir() {
		line, end := r.stuckTurn(fmt.Sprintf("the builder check was asked for before the spec %s exists", spec),
			fmt.Sprintf("The spec %s does not exist. Under arc:brainstorm, write the spec at `spec` before you run `wsh brainstorm check`, then run it again.", spec))
		return line, end, nil
	}
	if !r.doneScored {
		// the agent asked for the check itself, before the driver sent `brainstorm: check`: the design as it is now is the done one
		log.Printf("[council-bench] case %s brainstorm: the builder check began before the driver asked for it; the done mark is the design as it stands", r.c.Id)
		r.takeDoneMark(s)
	}

	reportPath := r.helperReport("builder-check", "md")
	report, err := r.runHelper("builder reviewer", brainstormcheck.Prompt(spec, reportPath), reportPath)
	if end, cerr := r.cut(); end != nil || cerr != nil {
		return "", end, cerr
	}
	if err != nil {
		return "", failEnd("%v", err), nil
	}
	if len(bytes.TrimSpace(report)) == 0 {
		return "", failEnd("the builder reviewer's report at %s is empty", reportPath), nil
	}
	path := brainstormcheck.ReportPath(file)
	if err := os.WriteFile(path, report, 0o644); err != nil {
		return "", failEnd("writing the builder reviewer's report to %s: %v", path, err), nil
	}
	return brainstormcheck.Line(path), nil, nil
}

// finish scores the brainstorm once its builder check is sorted: the done mark's snapshot and the design as it now
// stands, two bench judge calls. Either failing leaves the run failed and unscored. Its error is the caller's context
// error.
func (r *brainstormRun) finish(s brainstormState) (*brainstormEnd, error) {
	if !r.doneScored {
		return failEnd("the builder check was sorted but the design was never marked done before it"), nil
	}
	items := decisionItems(s)

	atDone, err := JudgeDesign(r.parent, r.c, r.doneItems)
	r.judgeTokens += atDone.Tokens // spent whether or not the reply could be read
	if err != nil {
		if cerr := r.parent.Err(); cerr != nil {
			return nil, cerr
		}
		return failEnd("judging the design at its done mark failed: %v", err), nil
	}
	final, err := JudgeDesign(r.parent, r.c, items)
	r.judgeTokens += final.Tokens
	if err != nil {
		if cerr := r.parent.Err(); cerr != nil {
			return nil, cerr
		}
		return failEnd("judging the finished design failed: %v", err), nil
	}
	r.atDone, r.final = atDone, final
	r.decisions, r.questions = len(items), answeredQuestions(s)
	return &brainstormEnd{state: TeamDone}, nil
}

// readAgentTranscript counts the agent's transcript, and any subagent's, for a look at the answer keys.
func (r *brainstormRun) readAgentTranscript() (transcriptStats, error) {
	lead, err := leadTranscript(r.session)
	if err != nil {
		return transcriptStats{}, err
	}
	return readTranscripts(lead)
}
