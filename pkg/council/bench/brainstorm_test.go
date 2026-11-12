// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package bench

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/brainstormcheck"
	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/skills"
)

// bsOpts name the agent's model, so a flag's value is seen to come from them; the limits are the real ones.
var bsOpts = brainstormOptions{Model: "agentm", Turns: 60, Limit: time.Minute}

// bsCase is a Brainstorm case over the small project of teamCase, with a two-line key.
func bsCase(t *testing.T) Case {
	c := teamCase(t)
	c.Mode = council.ModeBrainstorm
	c.KeyLines = []KeyLine{{Id: "K1", Text: "the first problem"}, {Id: "K2", Text: "the second problem"}}
	return c
}

// bsTurn is one turn of the scripted agent: what it leaves in its folder before it ends, given the line it was sent.
type bsTurn func(f *bsFake, line string)

// bsLaunch is one start of claude as the fake saw it. arc is the arc plugin folder's files at that moment (slash paths).
type bsLaunch struct {
	kind   string // agent, judge or check
	args   []string
	env    []string
	dir    string
	prompt string
	arc    map[string]string
}

// bsJudgeCall is one call of the bench's own judge.
type bsJudgeCall struct {
	cwd, prompt string
	opts        consult.CallOpts
}

// bsFake stands in for claude: startLead plays the agent's script, the skill's judge and the builder reviewer, and
// runClaude is the bench's judge.
type bsFake struct {
	t       *testing.T
	cfg     string // CLAUDE_CONFIG_DIR
	script  []bsTurn
	extra   []tUse // tool uses the agent's transcript holds besides the ones it makes
	session string

	// agent, when set, answers every agent turn instead of the script
	agent func(ctx context.Context, n int) ([]byte, error)
	// judgeReport and checkReport are what the skill's judge and the reviewer write to their report path; "" writes none
	judgeReport string
	checkReport string
	judgeErr    error // the skill's judge launch fails with it
	benchErr    error // the bench judge's call fails with it

	copyDir  string
	root     string
	turns    int
	launches []bsLaunch
	bench    []bsJudgeCall
}

const bsJudgeReport = `{"options":[{"label":"Owner first","detail":"The owner is paged.","pros":["fits"],"cons":["rota"],"pick":true},` +
	`{"label":"Platform first","detail":"Platform is paged."}],"read":"owner first wakes the fewest","multi":false,"added":[],"dropped":[]}`

const bsCheckReport = "1. Who owns retries? It changes the plan.\n"

// reportPathRe finds the report path in a judge's or reviewer's prompt: the runner puts them in its reports folder.
var reportPathRe = regexp.MustCompile(`[^\s,]*reports[^\s,]*\.(?:json|md)`)

// bsSetup replaces the two seams, points the config dir at a folder holding an installed superpowers 9.9.9, and returns
// the fake. Nothing is scripted yet.
func bsSetup(t *testing.T) *bsFake {
	t.Helper()
	cfg := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", cfg)
	super := t.TempDir()
	plugins := map[string]any{"version": 2, "plugins": map[string]any{
		"code-simplifier@official":       []any{map[string]any{"installPath": t.TempDir(), "version": "1.0.0"}},
		"superpowers@superpowers-market": []any{map[string]any{"scope": "user", "installPath": super, "version": "9.9.9"}},
	}}
	raw, err := json.Marshal(plugins)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(cfg, "plugins"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cfg, "plugins", "installed_plugins.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}

	f := &bsFake{t: t, cfg: cfg, judgeReport: bsJudgeReport, checkReport: bsCheckReport}
	oldLead, oldClaude := startLead, runClaude
	startLead, runClaude = f.start, f.judge
	t.Cleanup(func() { startLead, runClaude = oldLead, oldClaude })
	return f
}

// superDir is the installed superpowers' folder the fake config names.
func (f *bsFake) superDir() string {
	raw, err := os.ReadFile(filepath.Join(f.cfg, "plugins", "installed_plugins.json"))
	if err != nil {
		f.t.Fatal(err)
	}
	var doc struct {
		Plugins map[string][]struct{ InstallPath string }
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		f.t.Fatal(err)
	}
	return doc.Plugins["superpowers@superpowers-market"][0].InstallPath
}

func argValues(args []string, flag string) []string {
	var out []string
	for i, a := range args {
		if a == flag && i+1 < len(args) {
			out = append(out, args[i+1])
		}
	}
	return out
}

// readTree reads every file under dir into a map keyed by slash path, or nil when dir is not there.
func readTree(dir string) map[string]string {
	out := map[string]string{}
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, rerr := os.ReadFile(path)
		if rerr != nil {
			return rerr
		}
		rel, _ := filepath.Rel(dir, path)
		out[filepath.ToSlash(rel)] = string(b)
		return nil
	})
	if err != nil {
		return nil
	}
	return out
}

func (f *bsFake) start(ctx context.Context, l leadLaunch) ([]byte, error) {
	f.copyDir, f.root = l.Dir, filepath.Dir(l.Dir)
	rec := bsLaunch{kind: "agent", args: l.Args, env: l.Env, dir: l.Dir, prompt: l.Prompt}
	if dirs := argValues(l.Args, "--plugin-dir"); len(dirs) > 0 {
		rec.arc = readTree(dirs[0])
	}
	if slices.Contains(l.Args, "--disallowedTools") {
		return f.helper(&rec, l)
	}
	f.launches = append(f.launches, rec)
	n := f.turns
	f.turns++
	if n == 0 {
		ids := argValues(l.Args, "--session-id")
		if len(ids) != 1 {
			f.t.Fatalf("the first turn has no --session-id: %v", l.Args)
		}
		f.session = ids[0]
		writeTranscript(f.t, filepath.Join(f.cfg, "projects", "p", f.session+".jsonl"), tLine("agent-1", 10, 20, 30, 40, f.extra...))
	}
	if f.agent != nil {
		return f.agent(ctx, n)
	}
	if n >= len(f.script) {
		f.t.Errorf("the run started agent turn %d, past the script's %d", n+1, len(f.script))
		return nil, errors.New("the script is over")
	}
	f.script[n](f, l.Prompt)
	// A resumed claude -p reports the whole session's modelUsage so far, not the turn's: each turn adds 1000.
	return leadJSON(f.session, "ok", false, int64(n+1)*1000), nil
}

// helper plays the skill's judge or the builder reviewer: it writes its report where its prompt says.
func (f *bsFake) helper(rec *bsLaunch, l leadLaunch) ([]byte, error) {
	judge := strings.Contains(l.Prompt, "independent judge")
	rec.kind = "check"
	report, usage := f.checkReport, int64(300)
	if judge {
		rec.kind, report, usage = "judge", f.judgeReport, 200
	}
	f.launches = append(f.launches, *rec)
	if judge && f.judgeErr != nil {
		return nil, f.judgeErr
	}
	path := reportPathRe.FindString(l.Prompt)
	if path == "" {
		f.t.Errorf("no report path in the %s's prompt:\n%s", rec.kind, l.Prompt)
	} else if report != "" {
		if err := os.WriteFile(path, []byte(report), 0o644); err != nil {
			f.t.Errorf("writing the %s's report: %v", rec.kind, err)
		}
	}
	return leadJSON(fmt.Sprintf("helper-%s-%d", rec.kind, len(f.launches)), "done", false, usage), nil
}

// judge is the bench's own judge (runClaude): the design's first mark has 3 items, its last 4.
func (f *bsFake) judge(ctx context.Context, cwd, prompt string, o consult.CallOpts, onTool func(string)) (string, consult.Usage, error) {
	f.bench = append(f.bench, bsJudgeCall{cwd, prompt, o})
	if f.benchErr != nil {
		return "", consult.Usage{TotalTokens: 70}, f.benchErr
	}
	reply := `{"matches":{"K1":1,"K2":null},"items":[{"rank":1,"verdict":"key:K1"},{"rank":2,"verdict":"valid"},{"rank":3,"verdict":"valid"}]}`
	if strings.Contains(prompt, "judge all 4 items") {
		reply = `{"matches":{"K1":1,"K2":4},"items":[{"rank":1,"verdict":"key:K1"},{"rank":2,"verdict":"wrong"},{"rank":3,"verdict":"valid"},{"rank":4,"verdict":"key:K2"}]}`
	}
	return reply, consult.Usage{TotalTokens: 70}, nil
}

// briefPath is where the scripted agent keeps brainstorm.json.
func (f *bsFake) briefPath() string {
	return filepath.Join(f.copyDir, ".superpowers", "brainstorm", "topic", "brainstorm.json")
}

func (f *bsFake) writeDoc(doc map[string]any) {
	f.t.Helper()
	raw, err := json.Marshal(doc)
	if err != nil {
		f.t.Fatal(err)
	}
	f.writeRaw(raw)
}

func (f *bsFake) writeRaw(raw []byte) {
	f.t.Helper()
	if err := os.MkdirAll(filepath.Dir(f.briefPath()), 0o755); err != nil {
		f.t.Fatal(err)
	}
	if err := os.WriteFile(f.briefPath(), raw, 0o644); err != nil {
		f.t.Fatal(err)
	}
}

// request records a call of the agent's to the fake wsh, as the real script would.
func (f *bsFake) request(req wshRequest) {
	f.t.Helper()
	raw, err := json.Marshal(req)
	if err != nil {
		f.t.Fatal(err)
	}
	file, err := os.OpenFile(filepath.Join(f.root, "requests.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		f.t.Fatal(err)
	}
	defer file.Close()
	if _, err := file.Write(append(raw, '\n')); err != nil {
		f.t.Fatal(err)
	}
}

// sent is the lines the driver sent the agent: every agent prompt after the first.
func (f *bsFake) sent() []string {
	var out []string
	for _, l := range f.launches {
		if l.kind == "agent" {
			out = append(out, l.prompt)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out[1:]
}

func (f *bsFake) launchesOf(kind string) []bsLaunch {
	var out []bsLaunch
	for _, l := range f.launches {
		if l.kind == kind {
			out = append(out, l)
		}
	}
	return out
}

func bsPart(id, state, body string) map[string]any {
	return map[string]any{"id": id, "title": strings.ToUpper(id[:1]) + id[1:], "state": state, "body": body}
}

func bsOption(label string, pick bool) map[string]any {
	o := map[string]any{"label": label, "detail": "detail of " + label}
	if pick {
		o["pick"] = true
	}
	return o
}

func bsQuestion(n int, text string, options ...map[string]any) map[string]any {
	q := map[string]any{"n": n, "text": text}
	if len(options) > 0 {
		q["options"] = options
	}
	return q
}

func bsApproaches(n int) []any {
	var out []any
	for i := 1; i <= n; i++ {
		out = append(out, map[string]any{"name": fmt.Sprintf("Approach %d", i), "description": "does thing " + fmt.Sprint(i), "facts": []string{"a fact"}})
	}
	return out
}

// bsDoc is a valid brainstorm.json with answered finished questions in its history.
func bsDoc(answered int, question any, parts ...any) map[string]any {
	history := []any{}
	for i := 1; i <= answered; i++ {
		history = append(history, map[string]any{"kind": "question", "n": i, "q": fmt.Sprintf("Question %d?", i), "a": fmt.Sprintf("Answer %d", i)})
	}
	return map[string]any{"v": 1, "title": "Tally", "spec": "docs/spec.md", "question": question, "working": nil,
		"parts": parts, "history": history, "done": false, "check": nil}
}

// bsDoneParts are the design's parts once it is done: every decision is yours, the builder's part included.
func bsDoneParts() []any {
	return []any{bsPart("intent", "yours", "Page early."), bsPart("who", "yours", "The owner is paged."),
		bsPart("routing", "yours", "Route by owning team."), bsPart("builder", "yours", "Left to the builder: the page's wording.")}
}

// bsMainScript is the run the spec's test names: two questions (one with options, one without), one approach question
// through the judge, done, check, one builder question, finished.
func bsMainScript() []bsTurn {
	return []bsTurn{
		// 1: a question with options
		func(f *bsFake, line string) {
			f.writeDoc(bsDoc(0, bsQuestion(1, "What should this make possible?", bsOption("Know early", false), bsOption("Per group", true)),
				bsPart("intent", "asked", "")))
		},
		// 2: a question with none
		func(f *bsFake, line string) {
			f.writeDoc(bsDoc(1, bsQuestion(2, "Who is paged?"), bsPart("intent", "yours", "Page early."), bsPart("who", "asked", "")))
		},
		// 3: an approach question, put to the judge
		func(f *bsFake, line string) {
			q := bsQuestion(3, "How is the page routed?")
			q["approaches"] = bsApproaches(5)
			f.writeDoc(bsDoc(2, q, bsPart("intent", "yours", "Page early."), bsPart("who", "yours", "The owner is paged."), bsPart("routing", "asked", "")))
			f.request(wshRequest{Cmd: "judge", File: f.briefPath(), Line: "what about both?"})
		},
		// 4: the agent merges judge.json onto the question
		func(f *bsFake, line string) {
			if _, err := os.ReadFile(brainstormcheck.JudgeResultPath(f.briefPath())); err != nil {
				f.t.Errorf("judge.json was not delivered: %v", err)
			}
			f.writeDoc(bsDoc(2, bsQuestion(3, "How is the page routed?", bsOption("Platform first", false), bsOption("Owner first", true)),
				bsPart("intent", "yours", "Page early."), bsPart("who", "yours", "The owner is paged."), bsPart("routing", "asked", "")))
		},
		// 5: done, every decision yours
		func(f *bsFake, line string) {
			doc := bsDoc(3, nil, bsDoneParts()...)
			doc["done"] = true
			f.writeDoc(doc)
		},
		// 6: the spec written, the builder check asked for
		func(f *bsFake, line string) {
			if err := os.MkdirAll(filepath.Join(f.copyDir, "docs"), 0o755); err != nil {
				f.t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(f.copyDir, "docs", "spec.md"), []byte("# the spec\n"), 0o644); err != nil {
				f.t.Fatal(err)
			}
			doc := bsDoc(3, nil, bsDoneParts()...)
			doc["done"], doc["working"] = true, "check"
			f.writeDoc(doc)
			f.request(wshRequest{Cmd: "check", File: f.briefPath()})
		},
		// 7: the reviewer's report read; one question left for the person, and a part the check added
		func(f *bsFake, line string) {
			report, err := os.ReadFile(brainstormcheck.ReportPath(f.briefPath()))
			if err != nil || string(report) != bsCheckReport {
				f.t.Errorf("the reviewer's report was not delivered as written: %q, %v", report, err)
			}
			doc := bsDoc(3, nil, append(bsDoneParts(), bsPart("retry", "yours", "Retry three times."))...)
			doc["done"] = true
			doc["check"] = map[string]any{"yours": []any{map[string]any{"q": "Who owns retries?", "why": "the plan changes"}}}
			f.writeDoc(doc)
		},
		// 8: the builder question answered
		func(f *bsFake, line string) {
			doc := bsDoc(3, nil, append(bsDoneParts(), bsPart("retry", "yours", "Retry three times."))...)
			doc["done"] = true
			doc["check"] = map[string]any{"yours": []any{map[string]any{"q": "Who owns retries?", "a": "The owner."}}}
			f.writeDoc(doc)
		},
	}
}

func TestRunBrainstormDone(t *testing.T) {
	c := bsCase(t)
	t.Setenv("WAVETERM_BLOCKID", "block-1")
	t.Setenv("ARC_RUN_AGENT", "1")
	t.Setenv("CLAUDECODE", "1")
	t.Setenv("CLAUDE_CODE_ENTRYPOINT", "cli")
	t.Setenv("CLAUDE_CODE_SSE_PORT", "1234")
	t.Setenv("CLAUDE_CODE_PLUGIN_DIRS", "/arc-mod")
	t.Setenv("ANTHROPIC_API_KEY", "sk-kept")
	logs := captureLog(t)
	f := bsSetup(t)
	f.script = bsMainScript()

	out, err := runBrainstorm(context.Background(), c, bsOpts)
	if err != nil {
		t.Fatal(err)
	}
	if out.State != TeamDone {
		t.Fatalf("state = %q, want done; log: %s", out.State, logs)
	}

	// the lines the driver sent, in order
	file := f.briefPath()
	wantLines := []string{
		"Per group",
		"brainstorm: guess",
		brainstormcheck.JudgedLine(brainstormcheck.JudgeResultPath(file)),
		"Owner first",
		"brainstorm: check",
		brainstormcheck.Line(brainstormcheck.ReportPath(file)),
		"brainstorm: builder decide",
	}
	if got := f.sent(); !slices.Equal(got, wantLines) {
		t.Errorf("lines sent:\n got %q\nwant %q", got, wantLines)
	}

	// the outcome
	wantSkill := func() string {
		raw, err := skills.FS.ReadFile("brainstorm/SKILL.md")
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(raw)
		return hex.EncodeToString(sum[:])[:8] + " superpowers@9.9.9"
	}()
	if out.Skill != wantSkill {
		t.Errorf("skill = %q, want %q", out.Skill, wantSkill)
	}
	if out.Session != f.session || out.Session == "" {
		t.Errorf("session = %q, want the one the agent was given, %q", out.Session, f.session)
	}
	if out.Turns != 8 || out.Questions != 3 || out.Decisions != 4 {
		t.Errorf("turns %d (want 8), questions %d (want 3), decisions %d (want 4: the builder part is not one)", out.Turns, out.Questions, out.Decisions)
	}
	if out.Tokens != 8*1000+200+300 {
		t.Errorf("tokens = %d, want the 8 agent turns, the skill's judge and the reviewer: 8500", out.Tokens)
	}
	if out.JudgeTokens != 140 {
		t.Errorf("judge tokens = %d, want both bench judge calls: 140", out.JudgeTokens)
	}
	if out.Final.Recall() != 2 || out.Final.Wrong() != 1 || out.AtDone.Recall() != 1 || out.AtDone.Wrong() != 0 {
		t.Errorf("final recall %d wrong %d, done recall %d wrong %d; want 2, 1 and 1, 0", out.Final.Recall(), out.Final.Wrong(), out.AtDone.Recall(), out.AtDone.Wrong())
	}
	if out.Final.Judged != 4 || out.AtDone.Judged != 3 {
		t.Errorf("judged %d items at the final mark and %d at the done mark, want 4 and 3: every decision, the builder part left out", out.Final.Judged, out.AtDone.Judged)
	}
	// the items each mark was judged on come with a done outcome, in the design's part order
	if len(out.FinalItems) != 4 || len(out.DoneItems) != 3 {
		t.Errorf("final items %d, done items %d, want 4 and 3: what the two marks were judged on", len(out.FinalItems), len(out.DoneItems))
	} else {
		for i, it := range out.FinalItems {
			if it.Rank != i+1 || strings.TrimSpace(it.Title) == "" {
				t.Errorf("final item %d = %+v, want rank %d and a title", i, it, i+1)
			}
		}
		if out.DoneItems[0].Title != out.FinalItems[0].Title {
			t.Errorf("the done mark's first item %q is not the final mark's first %q", out.DoneItems[0].Title, out.FinalItems[0].Title)
		}
	}
	if out.Minutes < 0 || out.Minutes > 1 {
		t.Errorf("minutes = %v", out.Minutes)
	}

	// the bench judge: the done mark's three decisions, then the final mark's four; the builder part is in neither
	if len(f.bench) != 2 {
		t.Fatalf("the bench judge was called %d times, want 2", len(f.bench))
	}
	for i, want := range []string{"judge all 3 items", "judge all 4 items"} {
		call := f.bench[i]
		if !strings.Contains(call.prompt, want) || strings.Contains(call.prompt, "Left to the builder") {
			t.Errorf("bench judge call %d should %s and leave the builder part out:\n%s", i+1, want, call.prompt)
		}
		if call.opts.Model != "opus" || len(call.opts.Tools) != 0 {
			t.Errorf("bench judge call %d opts = %+v", i+1, call.opts)
		}
	}

	// the launches: the agent's, the skill's judge, the reviewer
	agents := f.launchesOf("agent")
	if len(agents) != 8 || len(f.launchesOf("judge")) != 1 || len(f.launchesOf("check")) != 1 {
		t.Fatalf("launches: %d agent, %d judge, %d check; want 8, 1, 1", len(agents), len(f.launchesOf("judge")), len(f.launchesOf("check")))
	}
	for i, l := range f.launches {
		if !slices.Contains(l.args, "-p") || !slices.Contains(l.args, "--strict-mcp-config") ||
			!hasArgPair(l.args, "--output-format", "json") || !hasArgPair(l.args, "--permission-mode", "bypassPermissions") ||
			!hasArgPair(l.args, "--setting-sources", "project,local") {
			t.Errorf("launch %d (%s) args = %v", i, l.kind, l.args)
		}
		dirs := argValues(l.args, "--plugin-dir")
		if len(dirs) != 2 || filepath.Base(dirs[0]) != "arc" || dirs[1] != f.superDir() {
			t.Errorf("launch %d (%s) plugin dirs = %v, want the temp arc plugin and %s", i, l.kind, dirs, f.superDir())
		}
		if l.dir != f.copyDir || l.dir == c.Project {
			t.Errorf("launch %d (%s) ran in %s, want the copy %s", i, l.kind, l.dir, f.copyDir)
		}
		if got := argValues(l.args, "--model"); l.kind == "agent" && !slices.Equal(got, []string{"agentm"}) || l.kind != "agent" && !slices.Equal(got, []string{"opus"}) {
			t.Errorf("launch %d (%s) models = %v", i, l.kind, got)
		}
	}
	if !hasArgPair(agents[0].args, "--session-id", f.session) || slices.Contains(agents[0].args, "--resume") {
		t.Errorf("the first turn's args = %v, want --session-id %s and no --resume", agents[0].args, f.session)
	}
	for i, l := range agents[1:] {
		if !hasArgPair(l.args, "--resume", f.session) || slices.Contains(l.args, "--session-id") {
			t.Errorf("agent turn %d args = %v, want --resume %s and no --session-id", i+2, l.args, f.session)
		}
	}
	for _, kind := range []string{"judge", "check"} {
		l := f.launchesOf(kind)[0]
		if slices.Contains(l.args, "--resume") || slices.Contains(l.args, "--session-id") {
			t.Errorf("the %s ran with session flags: %v", kind, l.args)
		}
		denied := argValues(l.args, "--disallowedTools")
		if len(denied) != 1 {
			t.Fatalf("the %s's args = %v", kind, l.args)
		}
		for tool := range strings.SplitSeq(denied[0], ",") {
			if slices.Contains([]string{"Read", "Grep", "Glob", "Write", "Bash"}, tool) {
				t.Errorf("the %s has %s turned off: %s", kind, tool, denied[0])
			}
		}
		for _, tool := range []string{"Edit", "WebFetch", "Agent"} {
			if !slices.Contains(strings.Split(denied[0], ","), tool) {
				t.Errorf("the %s still has %s: %s", kind, tool, denied[0])
			}
		}
	}
	if !strings.Contains(f.launchesOf("judge")[0].prompt, "what about both?") {
		t.Errorf("the judge's prompt lacks the person's --line:\n%s", f.launchesOf("judge")[0].prompt)
	}
	if !strings.Contains(f.launchesOf("check")[0].prompt, filepath.Join(f.copyDir, "docs", "spec.md")) {
		t.Errorf("the reviewer's prompt does not name the spec:\n%s", f.launchesOf("check")[0].prompt)
	}

	// the arc plugin: named arc, holding the embedded brainstorm skill
	arc := agents[0].arc
	var manifest struct{ Name string }
	if err := json.Unmarshal([]byte(arc[".claude-plugin/plugin.json"]), &manifest); err != nil || manifest.Name != "arc" {
		t.Errorf("the arc plugin's manifest = %q (%v)", arc[".claude-plugin/plugin.json"], err)
	}
	if embedded, _ := skills.FS.ReadFile("brainstorm/SKILL.md"); arc["skills/brainstorm/SKILL.md"] != string(embedded) || len(embedded) == 0 {
		t.Errorf("the arc plugin does not hold the embedded SKILL.md (%d bytes)", len(arc["skills/brainstorm/SKILL.md"]))
	}

	// the environment: Wave's, the run-agent and the Claude Code session variables are gone, auth stays, the fake wsh leads PATH
	bin := filepath.Join(f.root, "bin")
	for i, l := range f.launches {
		path, ok := "", false
		for _, kv := range l.env {
			name, value, _ := strings.Cut(kv, "=")
			switch strings.ToUpper(name) {
			case "ARC_RUN_AGENT", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT", "CLAUDE_CODE_PLUGIN_DIRS":
				t.Errorf("launch %d (%s) environment holds %s", i, l.kind, kv)
			case "PATH":
				path, ok = value, true
			}
			if strings.HasPrefix(strings.ToUpper(kv), "WAVETERM_") {
				t.Errorf("launch %d (%s) environment holds %s", i, l.kind, kv)
			}
		}
		if !slices.Contains(l.env, "ANTHROPIC_API_KEY=sk-kept") {
			t.Errorf("launch %d (%s) lost the auth variable", i, l.kind)
		}
		if !ok || !strings.HasPrefix(path, bin+string(os.PathListSeparator)) {
			t.Errorf("launch %d (%s) PATH = %q, want %s first", i, l.kind, path, bin)
		}
	}

	// the first prompt
	first := agents[0].prompt
	for _, want := range []string{c.Feature, c.Question, "superpowers:brainstorming", "a.go", "sub/b.go"} {
		if !strings.Contains(first, want) {
			t.Errorf("the first prompt lacks %q:\n%s", want, first)
		}
	}
	for _, banned := range []string{"bench", "key", "test"} {
		if strings.Contains(strings.ToLower(first), banned) {
			t.Errorf("the first prompt mentions %q:\n%s", banned, first)
		}
	}

	// the cell's folders are gone
	if _, err := os.Stat(f.root); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("the cell's folder %s was left behind (%v)", f.root, err)
	}
}

func TestRunBrainstormKeyReadFailsADoneRun(t *testing.T) {
	c := bsCase(t)
	logs := captureLog(t)
	f := bsSetup(t)
	f.script = bsMainScript()
	f.extra = []tUse{{"Read", "k1", `{"file_path":"C:\\data\\council-bench\\keys\\x.md"}`}}

	out, err := runBrainstorm(context.Background(), c, bsOpts)
	if err != nil {
		t.Fatal(err)
	}
	if out.State != TeamFailed {
		t.Fatalf("state = %q, want failed", out.State)
	}
	if !strings.Contains(logs.String(), "council-bench") || !strings.Contains(logs.String(), c.Id) {
		t.Errorf("the log does not name the key read and the case: %s", logs)
	}
	if out.Final.Recall() != 0 || len(out.Final.Items) != 0 || len(out.AtDone.Items) != 0 || out.Decisions != 0 {
		t.Errorf("a run that read the key was scored: %+v", out)
	}
	if len(out.FinalItems) != 0 || len(out.DoneItems) != 0 {
		t.Errorf("a run that read the key carries items to save: %+v", out)
	}
	if out.Tokens != 8500 || out.JudgeTokens != 140 || out.Turns != 8 {
		t.Errorf("the spend of a failed run still counts: tokens %d, judge tokens %d, turns %d", out.Tokens, out.JudgeTokens, out.Turns)
	}
}

func TestRunBrainstormBenchJudgeFailureFailsTheRun(t *testing.T) {
	c := bsCase(t)
	logs := captureLog(t)
	f := bsSetup(t)
	f.script = bsMainScript()
	f.benchErr = errors.New("judge down")

	out, err := runBrainstorm(context.Background(), c, bsOpts)
	if err != nil {
		t.Fatal(err)
	}
	if out.State != TeamFailed || out.Final.Recall() != 0 {
		t.Errorf("outcome = %+v, want failed and unscored", out)
	}
	if out.JudgeTokens != 70 {
		t.Errorf("judge tokens = %d, want the failed call's 70", out.JudgeTokens)
	}
	if !strings.Contains(logs.String(), "judge down") || !strings.Contains(logs.String(), "[council-bench]") || !strings.Contains(logs.String(), c.Id) {
		t.Errorf("the log lacks the reason, the tag or the case: %s", logs)
	}
}

func TestRunBrainstormStuckAgentFailsOnItsFourthStuckTurn(t *testing.T) {
	c := bsCase(t)
	logs := captureLog(t)
	f := bsSetup(t)
	stuck := func(f *bsFake, line string) { f.writeDoc(bsDoc(0, nil, bsPart("intent", "yours", "x"))) }
	f.script = []bsTurn{stuck, stuck, stuck, stuck, stuck}

	out, err := runBrainstorm(context.Background(), c, bsOpts)
	if err != nil {
		t.Fatal(err)
	}
	if out.State != TeamFailed || out.Turns != 4 {
		t.Fatalf("state %q after %d turns, want failed after 4: 3 reminders, then the 4th stuck turn ends it", out.State, out.Turns)
	}
	lines := f.sent()
	if len(lines) != 3 {
		t.Fatalf("sent %d lines, want the 3 reminders: %q", len(lines), lines)
	}
	for _, l := range lines {
		if !strings.Contains(l, "no open question and done is not true") || strings.Contains(strings.ToLower(l), "bench") {
			t.Errorf("reminder = %q", l)
		}
	}
	if !strings.Contains(logs.String(), "no question is open and done is not true") || !strings.Contains(logs.String(), c.Id) {
		t.Errorf("the log lacks the stuck reason or the case: %s", logs)
	}
}

func TestRunBrainstormTwoInvalidFilesInARowFail(t *testing.T) {
	cases := []struct {
		name string
		bad  func(f *bsFake, line string)
		why  string
	}{
		{"invalid", func(f *bsFake, line string) { f.writeRaw([]byte(`{"v": 2}`)) }, "v must be the number 1"},
		{"missing", func(f *bsFake, line string) {}, "no brainstorm.json"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := bsCase(t)
			logs := captureLog(t)
			f := bsSetup(t)
			f.script = []bsTurn{tc.bad, tc.bad, tc.bad}

			out, err := runBrainstorm(context.Background(), c, bsOpts)
			if err != nil {
				t.Fatal(err)
			}
			if out.State != TeamFailed || out.Turns != 2 {
				t.Fatalf("state %q after %d turns, want failed after 2", out.State, out.Turns)
			}
			lines := f.sent()
			if len(lines) != 1 || !strings.Contains(lines[0], tc.why) || !strings.Contains(lines[0], "arc:brainstorm") {
				t.Errorf("reminder = %q, want one that names %q under arc:brainstorm", lines, tc.why)
			}
			if !strings.Contains(logs.String(), tc.why) || !strings.Contains(logs.String(), c.Id) {
				t.Errorf("the log lacks the reason or the case: %s", logs)
			}
		})
	}
}

func TestRunBrainstormAValidTurnResetsTheInvalidCount(t *testing.T) {
	c := bsCase(t)
	captureLog(t)
	f := bsSetup(t)
	opts := bsOpts
	opts.Turns = 4
	bad := func(f *bsFake, line string) { f.writeRaw([]byte(`not json`)) }
	ask := func(f *bsFake, line string) {
		f.writeDoc(bsDoc(0, bsQuestion(1, "Which?", bsOption("A", true), bsOption("B", false)), bsPart("intent", "asked", "")))
	}
	f.script = []bsTurn{bad, ask, bad, ask, ask}

	out, err := runBrainstorm(context.Background(), c, opts)
	if err != nil {
		t.Fatal(err)
	}
	// two invalid files, a valid turn between them: only the turn limit ends it
	if out.State != TeamTimedOut || out.Turns != 4 {
		t.Fatalf("state %q after %d turns, want timed-out at the 4-turn limit", out.State, out.Turns)
	}
	lines := f.sent()
	if len(lines) != 3 || lines[1] != "A" || !strings.Contains(lines[0], "arc:brainstorm") || !strings.Contains(lines[2], "arc:brainstorm") {
		t.Errorf("lines = %q, want a reminder, A, a reminder", lines)
	}
}

func TestRunBrainstormFailedTurnsInARowFail(t *testing.T) {
	cases := []struct {
		name string
		out  func(f *bsFake) ([]byte, error)
		why  string
	}{
		{"the launch fails", func(f *bsFake) ([]byte, error) { return nil, errors.New("exit status 1") }, "did not end cleanly"},
		{"no result", func(f *bsFake) ([]byte, error) { return nil, nil }, "printed no result"},
		{"the result is not JSON", func(f *bsFake) ([]byte, error) { return []byte("oops"), nil }, "not JSON"},
		{"the result is an error", func(f *bsFake) ([]byte, error) { return leadJSON(f.session, "boom", true, 1000), nil }, "is an error"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := bsCase(t)
			logs := captureLog(t)
			f := bsSetup(t)
			f.agent = func(ctx context.Context, n int) ([]byte, error) { return tc.out(f) }

			out, err := runBrainstorm(context.Background(), c, bsOpts)
			if err != nil {
				t.Fatal(err)
			}
			if out.State != TeamFailed || out.Turns != 2 {
				t.Fatalf("state %q after %d turns, want failed after 2", out.State, out.Turns)
			}
			if lines := f.sent(); len(lines) != 1 || !strings.Contains(lines[0], "arc:brainstorm") {
				t.Errorf("lines = %q, want one reminder under arc:brainstorm", lines)
			}
			if !strings.Contains(logs.String(), tc.why) || !strings.Contains(logs.String(), c.Id) {
				t.Errorf("the log lacks %q or the case: %s", tc.why, logs)
			}
		})
	}
}

func TestRunBrainstormTurnLimitTimesOut(t *testing.T) {
	c := bsCase(t)
	logs := captureLog(t)
	f := bsSetup(t)
	opts := bsOpts
	opts.Turns = 3
	ask := func(f *bsFake, line string) {
		f.writeDoc(bsDoc(0, bsQuestion(1, "Which?", bsOption("A", false), bsOption("B", true)), bsPart("intent", "asked", "")))
	}
	f.script = []bsTurn{ask, ask, ask, ask}

	out, err := runBrainstorm(context.Background(), c, opts)
	if err != nil {
		t.Fatal(err)
	}
	if out.State != TeamTimedOut || out.Turns != 3 || len(f.launchesOf("agent")) != 3 {
		t.Errorf("state %q, %d turns, %d launches; want timed-out after 3", out.State, out.Turns, len(f.launchesOf("agent")))
	}
	if out.Tokens != 3000 {
		t.Errorf("tokens = %d, want the 3 turns' 3000", out.Tokens)
	}
	if !strings.Contains(logs.String(), "timed out") || !strings.Contains(logs.String(), c.Id) {
		t.Errorf("the log does not say the run timed out: %s", logs)
	}
}

func TestRunBrainstormTimeLimitTimesOut(t *testing.T) {
	c := bsCase(t)
	captureLog(t)
	f := bsSetup(t)
	opts := bsOpts
	opts.Limit = 50 * time.Millisecond
	f.agent = func(ctx context.Context, n int) ([]byte, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	}

	out, err := runBrainstorm(context.Background(), c, opts)
	if err != nil {
		t.Fatalf("a limit that fired is an outcome, not an error: %v", err)
	}
	if out.State != TeamTimedOut || out.Turns != 1 {
		t.Errorf("state %q after %d turns, want timed-out on the turn the limit cut", out.State, out.Turns)
	}
}

func TestRunBrainstormCancelledContextReturnsItsError(t *testing.T) {
	c := bsCase(t)
	captureLog(t)
	f := bsSetup(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	f.agent = func(ctx context.Context, n int) ([]byte, error) {
		cancel()
		return nil, ctx.Err()
	}

	out, err := runBrainstorm(ctx, c, bsOpts)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled (outcome %+v)", err, out)
	}
}

func TestRunBrainstormSkillsJudgeRefused(t *testing.T) {
	few := func(f *bsFake, line string) {
		q := bsQuestion(1, "How?")
		q["approaches"] = bsApproaches(2)
		f.writeDoc(bsDoc(0, q, bsPart("intent", "asked", "")))
		f.request(wshRequest{Cmd: "judge", File: f.briefPath()})
	}
	enough := func(f *bsFake, line string) {
		q := bsQuestion(1, "How?")
		q["approaches"] = bsApproaches(5)
		f.writeDoc(bsDoc(0, q, bsPart("intent", "asked", "")))
		f.request(wshRequest{Cmd: "judge", File: f.briefPath()})
	}
	cases := []struct {
		name  string
		turn  bsTurn
		setup func(f *bsFake)
		want  string
		runs  int // launches of the skill's judge
	}{
		{"too few approaches", few, func(f *bsFake) {}, "brainstorm: judge failed: question.approaches lists 2 named approaches", 0},
		{"a report that is not the object", enough, func(f *bsFake) { f.judgeReport = "Here you go:\n" + bsJudgeReport }, "brainstorm: judge failed: it is not the one JSON object", 1},
		{"a report with one option", enough, func(f *bsFake) {
			f.judgeReport = `{"options":[{"label":"A","detail":"d","pick":true}],"read":"r"}`
		}, "brainstorm: judge failed: it has 1 options, not 2 to 4", 1},
		{"no report", enough, func(f *bsFake) { f.judgeReport = "" }, "brainstorm: judge failed: ", 1},
		{"a launch that fails", enough, func(f *bsFake) { f.judgeErr = errors.New("exit status 1") }, "brainstorm: judge failed: ", 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := bsCase(t)
			logs := captureLog(t)
			f := bsSetup(t)
			tc.setup(f)
			opts := bsOpts
			opts.Turns = 2
			f.script = []bsTurn{tc.turn, func(f *bsFake, line string) {}}

			out, err := runBrainstorm(context.Background(), c, opts)
			if err != nil {
				t.Fatal(err)
			}
			if out.State != TeamTimedOut {
				t.Errorf("state = %q, want the run to go on to its turn limit", out.State)
			}
			lines := f.sent()
			if len(lines) < 1 || !strings.HasPrefix(lines[0], tc.want) {
				t.Fatalf("lines = %q, want the first to start %q", lines, tc.want)
			}
			if n := len(f.launchesOf("judge")); n != tc.runs {
				t.Errorf("the skill's judge was launched %d times, want %d", n, tc.runs)
			}
			if _, err := os.Stat(brainstormcheck.JudgeResultPath(f.briefPath())); err == nil {
				t.Error("judge.json was written for a judge that failed")
			}
			if !strings.Contains(logs.String(), c.Id) || !strings.Contains(logs.String(), "[council-bench]") {
				t.Errorf("a refused judge was not logged with the case: %s", logs)
			}
		})
	}
}

func TestRunBrainstormMissingSpecIsAReminder(t *testing.T) {
	c := bsCase(t)
	logs := captureLog(t)
	f := bsSetup(t)
	askCheck := func(f *bsFake, line string) {
		doc := bsDoc(3, nil, bsDoneParts()...)
		doc["done"] = true
		f.writeDoc(doc)
		f.request(wshRequest{Cmd: "check", File: f.briefPath()})
	}
	f.script = []bsTurn{
		// 1: done, and the check asked for before the spec exists
		askCheck,
		// 2: the spec written, the check asked for again
		func(f *bsFake, line string) {
			if err := os.MkdirAll(filepath.Join(f.copyDir, "docs"), 0o755); err != nil {
				f.t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(f.copyDir, "docs", "spec.md"), []byte("# the spec\n"), 0o644); err != nil {
				f.t.Fatal(err)
			}
			askCheck(f, line)
		},
		// 3: the check holds nothing for the person
		func(f *bsFake, line string) {
			doc := bsDoc(3, nil, bsDoneParts()...)
			doc["done"] = true
			doc["check"] = map[string]any{"yours": []any{}}
			f.writeDoc(doc)
		},
	}

	out, err := runBrainstorm(context.Background(), c, bsOpts)
	if err != nil {
		t.Fatal(err)
	}
	if out.State != TeamDone {
		t.Fatalf("state = %q, want done; log: %s", out.State, logs)
	}
	lines := f.sent()
	spec := filepath.Join(f.copyDir, "docs", "spec.md")
	if len(lines) != 2 || !strings.Contains(lines[0], spec) || !strings.Contains(lines[0], "arc:brainstorm") ||
		lines[1] != brainstormcheck.Line(brainstormcheck.ReportPath(f.briefPath())) {
		t.Fatalf("lines = %q, want a reminder naming %s, then the builder's line", lines, spec)
	}
	if n := len(f.launchesOf("check")); n != 1 {
		t.Errorf("the reviewer ran %d times, want once, for the second request only", n)
	}
	// the check came before any `brainstorm: check` line, so the done mark is the design as the check began
	if out.AtDone.Recall() != 1 || out.Final.Recall() != 1 || out.Decisions != 3 {
		t.Errorf("done recall %d, final recall %d, decisions %d; want 1, 1 and 3", out.AtDone.Recall(), out.Final.Recall(), out.Decisions)
	}
}

func TestRunBrainstormNeedsSuperpowers(t *testing.T) {
	cases := []struct {
		name  string
		write func(t *testing.T, cfg string)
	}{
		{"no installed_plugins.json", func(t *testing.T, cfg string) {}},
		{"no superpowers in it", func(t *testing.T, cfg string) {
			if err := os.MkdirAll(filepath.Join(cfg, "plugins"), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(cfg, "plugins", "installed_plugins.json"), []byte(`{"version":2,"plugins":{"other@m":[{"installPath":"x","version":"1"}]}}`), 0o644); err != nil {
				t.Fatal(err)
			}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := bsCase(t)
			logs := captureLog(t)
			f := bsSetup(t)
			cfg := t.TempDir()
			t.Setenv("CLAUDE_CONFIG_DIR", cfg)
			tc.write(t, cfg)

			out, err := runBrainstorm(context.Background(), c, bsOpts)
			if err != nil {
				t.Fatal(err)
			}
			if out.State != TeamFailed || len(f.launches) != 0 {
				t.Errorf("state %q with %d launches, want failed before any claude start", out.State, len(f.launches))
			}
			if !strings.Contains(logs.String(), "superpowers") || !strings.Contains(logs.String(), c.Id) {
				t.Errorf("the log does not name superpowers and the case: %s", logs)
			}
		})
	}
}
