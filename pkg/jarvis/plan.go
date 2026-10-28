// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvis

import (
	"fmt"
	"path"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/harness"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// PlanFormat states the plan shape ParsePlan accepts, for whoever writes the plan. Its example is
// parsed by TestPlanFormatParses, so the prose and the parser cannot drift apart.
const PlanFormat = "Plan format. Verify, Setup and Check are optional, go before the first task, and each hold one command in backticks. " +
	"Left out, Setup is the project's checked-in .arc/setup command, if it has one. With neither, each tree gets the main " +
	"checkout's installed node_modules linked in wherever its manifests match main's, so the project's tools run in a task's " +
	"tree as they are: no Setup, scratch worktree or install wrapper is needed for them. A task that changes a package.json " +
	"or lockfile then needs a Setup line that installs. " +
	"All three commands run in a POSIX shell (sh, or Git Bash on Windows). Verify runs after each task merges, with " +
	"ARC_VERIFY_CHANGED naming a file that lists the paths the merge changed, one per line: a Verify that reads it " +
	"should test only what those paths can break, so the merge queue waits on those tests, not the whole suite. The " +
	"final stage runs Verify once more with ARC_VERIFY_CHANGED unset, on the merged result, where it should run " +
	"everything; the last merge of the plan, alone in its batch, skips its own Verify for that one. Both times ARC_VERIFY_FLAKY names an empty file: a Verify that reruns a failing test and sees it pass " +
	"should exit 0 and append that test's name to the file, one per line, and the run then lists each as a flaky test " +
	"among what it could not verify instead of reading as a clean pass. " +
	"Check is a fast whole-project static check (for example typecheck plus go vet) that each worker runs " +
	"itself, instead of Verify, before it completes. " +
	"A task step names only the focused tests that prove it (for Go, `go test ./pkg/x -run '<names>'`), never a whole " +
	"package or the full suite: Verify runs those at each merge and in the final stage. " +
	"An optional Final line, also one command in backticks, runs once on the merged result after every task landed and Check " +
	"passed, with ARC_FINAL_OUT set to a directory for its screenshots and reports: exit 0 passes, exit 3 means it could not " +
	"verify and its last output line says why, and any other exit fails the run. It may write an optional ARC_FINAL_OUT/shots.json, " +
	"a JSON array of {name, files, steps: [{step, state: pass|fail|skip, detail?}]} with file paths relative to ARC_FINAL_OUT, " +
	"which the cockpit shows as the run's screenshots; without one it lists every PNG there. " +
	"Final is the only check of the running app, so every task that adds or changes a rendered view, a visual state (loading, " +
	"empty, error, gone) or an interaction names in its acceptance the scenario step that shows that view or performs that " +
	"interaction, adding the step if none does, and the Final line runs that scenario. A scenario that only opens the surface " +
	"or panel the view sits in does not count. With a Prototype line, each board in the canvas's folder needs such a step. " +
	"Never leave a check as manual: nobody in a run performs one. " +
	"An optional Prototype line names the design " +
	"canvas the result should match (a path, not in backticks; at most one), for the engine's final verifier. " +
	"An optional Spec line, also before the first task, names the spec the plan implements (a repo-relative or absolute path, " +
	"in backticks; prose may follow it): the engine commits it with the plan and points the plan reviewer, the task reviewers " +
	"and the final verifier at it, unless the submit names a spec itself. The line also reaches every worker as header text. " +
	"An optional Effort line, also before the first task, names the effort tracker (`effort:<oid>` or a bare oid, not in backticks; " +
	"at most one). A task may then list `**Chunk:** <exact chunk label>` lines, one per chunk, directly after its Depends on line " +
	"(or first under the heading when it has none): the engine marks those chunks done when the task's merge passes Verify. " +
	"A Chunk line anywhere else is task text, and a plan with a Chunk line but no Effort line is refused. " +
	"A task may also carry one **Model:** line in that same place (not in backticks): a model id (`sonnet`), a harness and model " +
	"(`codex:gpt-5.5`, `agy:<model>`), or a harness alone for its default model (`codex`, `agy`); it is the model its worker " +
	"runs on, used when the run's workers setting is Reviewer picks and ignored otherwise. Workers can be claude, pi, agy or codex. " +
	"A task should also carry a **Files:** line in that same place: every repo-relative path the task creates, edits or deletes, " +
	"generated files and every test or caller the change breaks included, each in backticks and separated by commas (files, not directories or globs; a second Files line " +
	"continues the list). Submit refuses a plan in which two tasks that can run at the same time list the same path. A task " +
	"without the line takes no part in that check, so list every task's files. " +
	"Number tasks 1, 2, 3... in order under `##` or `###` headings. A Depends on line must be the first line under its heading: " +
	"leave it out to run after the previous task, write `none` for no dependencies, or list earlier tasks (`Task 1, Task 3`). " +
	"A listed task whose Files line shares no path with this task's needs a reason in parentheses after it, saying what this " +
	"task uses from it (`Task 1 (uses the parser it adds), Task 3`): submit refuses it bare, since nothing else makes the two " +
	"wait for each other. A screenshot or scenario both tasks appear in is not a reason; each task names that scenario step " +
	"in its acceptance. An edge between tasks that share a file needs no reason, and neither does a task with no Files line " +
	"or the implicit edge of a task with no Depends line.\n" +
	"The engine runs tasks at the same time whenever nothing makes them wait, so the Depends on lines are what set a plan's width. " +
	"Split the work by what can proceed independently, and make a task wait only when it truly builds on another's output — a plan " +
	"with no Depends on lines is one serial chain and gets none of that. When several tasks build on one interface (a type, a " +
	"wire field, a table, a function's signature) whose implementation is long, land the interface first as its own small " +
	"task: the task that implements it and the tasks that use it then depend on that one and run beside each other, instead " +
	"of waiting for the whole implementation. Keep it for long implementations, since every task adds minutes of review and " +
	"merge. A file has one owner among the tasks that can run at " +
	"the same time: when two tasks edit the same file, generated files included, give it to one of them or put a Depends on " +
	"line between them, since two workers' edits to one file collide at merge. The Files lines are how submit checks this.\n\n" +
	"# <plan title>\n\n" +
	"**Effort:** effort:<oid>\n" +
	"**Spec:** `<path to the spec>`\n" +
	"**Verify:** `<command that runs the tests>`\n" +
	"**Setup:** `<command that prepares a fresh worktree>`\n" +
	"**Check:** `<fast static check each worker runs>`\n" +
	"**Final:** `<command that checks the merged result end to end>`\n" +
	"**Prototype:** <path to the design canvas>\n\n" +
	"### Task 1: <title>\n" +
	"**Depends on:** none\n" +
	"**Model:** <model-id-or-harness:model>\n" +
	"**Chunk:** <exact chunk label>\n" +
	"**Files:** `<path>`, `<another path>`\n" +
	"<what to do, and the tests that prove it>\n\n" +
	"### Task 2: <title>\n" +
	"**Files:** `<path>`\n" +
	"<no Depends line: runs after Task 1, so it may list a path Task 1 lists>\n\n" +
	"### Task 3: <title>\n" +
	"**Depends on:** Task 1 (<what it uses from Task 1>)\n" +
	"**Files:** `<a path Task 2 does not list>`\n" +
	"<runs beside Task 2>\n"

// Plan is a parsed implementation plan: its tasks as DAG nodes ("t-N"), plus the plan-level commands.
type Plan struct {
	Title  string
	Verify string
	Setup  string
	Check  string
	// Final is the command the engine's final stage runs on the merged result; Prototype is the design canvas
	// path the final verifier compares against. Both are empty when the plan names none.
	Final     string
	Prototype string
	// EffortOID is the effort tracker whose chunks tasks close through **Chunk:** lines; empty when the
	// plan names none.
	EffortOID string
	// Spec is the path a **Spec:** header line names, as written (repo-relative or absolute); empty when
	// the plan names none or the line holds no path. The line itself stays in Preamble.
	Spec string
	// Preamble is every header line other than the title and the plan-level lines above, verbatim and
	// in order, blank lines at each end trimmed. A worker's task prompt carries it so header prose — a
	// scope rule, a shared constraint — reaches every task, not just whichever worker opened the plan.
	Preamble string
	Tasks    []waveobj.TaskNode
}

var (
	planTaskHeadingRe = regexp.MustCompile(`^#{2,3} Task (\d+)(?::\s*(.*?))?\s*$`)
	planTitleRe       = regexp.MustCompile(`^# (.+?)\s*$`)
	planCommandRe     = regexp.MustCompile(`^\*\*(Verify|Setup|Check|Final):\*\*\s*(.*?)\s*$`)
	planBacktickRe    = regexp.MustCompile("^`([^`]+)`$")
	planEffortRe      = regexp.MustCompile(`^\*\*Effort:\*\*\s*(.*?)\s*$`)
	planPrototypeRe   = regexp.MustCompile(`^\*\*Prototype:\*\*\s*(.*?)\s*$`)
	planSpecRe        = regexp.MustCompile(`^\*\*Spec:\*\*\s*(.*?)\s*$`)
	planSpecQuotedRe  = regexp.MustCompile("`([^`]+)`")
	planDependsRe     = regexp.MustCompile(`^\*\*Depends on:\*\*\s*(.*?)\s*$`)
	planChunkRe       = regexp.MustCompile(`^\*\*Chunk:\*\*\s*(.*?)\s*$`)
	planModelRe       = regexp.MustCompile(`^\*\*Model:\*\*\s*(.*?)\s*$`)
	planFilesRe       = regexp.MustCompile(`^\*\*Files:\*\*\s*(.*?)\s*$`)
	planFileListRe    = regexp.MustCompile("^`[^`]+`(\\s*,\\s*`[^`]+`)*$")
	planTaskRefRe     = regexp.MustCompile(`^Task (\d+)(?:\s*\((.*)\))?$`)
)

func planTaskID(n int) string {
	return "t-" + strconv.Itoa(n)
}

func planFenceMarker(line string) string {
	trimmed := strings.TrimLeft(line, " \t")
	for _, marker := range []string{"```", "~~~"} {
		if strings.HasPrefix(trimmed, marker) {
			return marker
		}
	}
	return ""
}

// ParsePlan reads a plan in PlanFormat. Lines inside code fences are task text only, so a plan that
// quotes a sample plan does not grow the sample's tasks.
func ParsePlan(src string) (Plan, error) {
	var p Plan
	var body []string
	var preamble []string
	// files is each task's **Files:** paths by task index, and bare each task's written Depends edges that
	// give no reason, by dependency index; both live only for the checks below
	files := map[int][]string{}
	bare := map[int][]int{}
	fence := ""
	inTaskHead, dependsAllowed := false, false
	flush := func() {
		if len(p.Tasks) > 0 {
			p.Tasks[len(p.Tasks)-1].Description = strings.TrimSpace(strings.Join(body, "\n"))
		}
		body = nil
	}
	preambleLine := func(line string) {
		if len(p.Tasks) == 0 {
			preamble = append(preamble, line)
		} else {
			body = append(body, line)
		}
	}
	for _, line := range strings.Split(strings.ReplaceAll(src, "\r\n", "\n"), "\n") {
		if marker := planFenceMarker(line); marker != "" && (fence == "" || marker == fence) {
			if fence == "" {
				fence = marker
			} else {
				fence = ""
			}
			inTaskHead = false
			preambleLine(line)
			continue
		}
		if fence != "" {
			preambleLine(line)
			continue
		}
		if m := planTaskHeadingRe.FindStringSubmatch(line); m != nil {
			n, _ := strconv.Atoi(m[1])
			if n != len(p.Tasks)+1 {
				return Plan{}, fmt.Errorf("plan heading %q is out of order: tasks are numbered 1, 2, 3..., want Task %d", strings.TrimSpace(line), len(p.Tasks)+1)
			}
			flush()
			task := waveobj.TaskNode{ID: planTaskID(n), Label: m[2]}
			if task.Label == "" {
				task.Label = "Task " + m[1]
			}
			if n > 1 {
				task.Deps = []string{planTaskID(n - 1)}
			}
			p.Tasks = append(p.Tasks, task)
			inTaskHead, dependsAllowed = true, true
			continue
		}
		if len(p.Tasks) == 0 {
			consumed, err := readPlanPreamble(&p, line)
			if err != nil {
				return Plan{}, err
			}
			if !consumed {
				preamble = append(preamble, line)
			}
			continue
		}
		if inTaskHead {
			if strings.TrimSpace(line) == "" {
				continue
			}
			task := &p.Tasks[len(p.Tasks)-1]
			if m := planDependsRe.FindStringSubmatch(line); m != nil && dependsAllowed {
				deps, unexplained, err := parsePlanDepends(m[1], len(p.Tasks))
				if err != nil {
					return Plan{}, err
				}
				task.Deps, dependsAllowed = deps, false
				bare[len(p.Tasks)-1] = unexplained
				continue
			}
			if m := planChunkRe.FindStringSubmatch(line); m != nil {
				if m[1] == "" {
					return Plan{}, fmt.Errorf("task %d: **Chunk:** is empty; write the exact chunk label", len(p.Tasks))
				}
				if slices.Contains(task.Chunks, m[1]) {
					return Plan{}, fmt.Errorf("task %d lists chunk %q twice", len(p.Tasks), m[1])
				}
				task.Chunks, dependsAllowed = append(task.Chunks, m[1]), false
				continue
			}
			if m := planModelRe.FindStringSubmatch(line); m != nil {
				if m[1] == "" || strings.ContainsAny(m[1], "` \t") {
					return Plan{}, fmt.Errorf("task %d: **Model:** must be one model id, not in backticks, got %q", len(p.Tasks), m[1])
				}
				if task.ModelSource != "" {
					return Plan{}, fmt.Errorf("task %d: **Model:** appears twice; a task runs on one model", len(p.Tasks))
				}
				runtime, model, err := parsePlanModel(m[1], len(p.Tasks))
				if err != nil {
					return Plan{}, err
				}
				task.RunSpec.Runtime, task.RunSpec.Model = runtime, model
				task.ModelSource, dependsAllowed = waveobj.TaskModelSource_Plan, false
				continue
			}
			if m := planFilesRe.FindStringSubmatch(line); m != nil {
				paths, err := parsePlanFiles(m[1], len(p.Tasks))
				if err != nil {
					return Plan{}, err
				}
				i := len(p.Tasks) - 1
				files[i], dependsAllowed = append(files[i], paths...), false
				// stays in the task text too: the worker and its reviewer read which files the task owns
				body = append(body, line)
				continue
			}
			inTaskHead = false
		}
		body = append(body, line)
	}
	flush()
	if len(p.Tasks) == 0 {
		return Plan{}, fmt.Errorf("plan has no tasks: expected headings like \"### Task 1: <title>\"")
	}
	if p.EffortOID == "" {
		for i, t := range p.Tasks {
			if len(t.Chunks) > 0 {
				return Plan{}, fmt.Errorf("task %d (%s) names a chunk but the plan has no **Effort:** line to say which effort it belongs to", i+1, t.Label)
			}
		}
	}
	if err := checkPlanFileOwners(p.Tasks, files); err != nil {
		return Plan{}, err
	}
	if err := checkPlanDependsReasons(p.Tasks, files, bare); err != nil {
		return Plan{}, err
	}
	p.Preamble = strings.Join(trimBlankLines(preamble), "\n")
	return p, nil
}

// parsePlanFiles reads a **Files:** value: backticked repo-relative paths separated by commas, each
// returned slash-normalised so two spellings of one path compare equal.
func parsePlanFiles(value string, n int) ([]string, error) {
	if !planFileListRe.MatchString(value) {
		return nil, fmt.Errorf("task %d: **Files:** must list paths in backticks separated by commas, like \"`pkg/a.go`, `pkg/b.go`\", got %q", n, value)
	}
	var paths []string
	for _, m := range planSpecQuotedRe.FindAllStringSubmatch(value, -1) {
		clean := path.Clean(strings.ReplaceAll(strings.TrimSpace(m[1]), `\`, "/"))
		if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") || strings.Contains(clean, ":") {
			return nil, fmt.Errorf("task %d: **Files:** path %q must be relative to the repo root", n, m[1])
		}
		paths = append(paths, clean)
	}
	return paths, nil
}

// checkPlanFileOwners refuses two tasks that list the same path when neither waits on the other, directly
// or through other tasks: the engine runs them at the same time and their edits collide at merge. files
// is each task's listed paths by task index; a task absent from it is not checked.
func checkPlanFileOwners(tasks []waveobj.TaskNode, files map[int][]string) error {
	index := make(map[string]int, len(tasks))
	// a task depends only on earlier tasks, so each one's ancestors are complete before a later task reads them
	ancestors := make([]map[int]bool, len(tasks))
	owners := map[string][]int{}
	for i, t := range tasks {
		index[t.ID] = i
		ancestors[i] = map[int]bool{}
		for _, dep := range t.Deps {
			d := index[dep]
			ancestors[i][d] = true
			for a := range ancestors[d] {
				ancestors[i][a] = true
			}
		}
		for _, f := range files[i] {
			for _, o := range owners[f] {
				if o != i && !ancestors[i][o] {
					return fmt.Errorf("tasks %d (%s) and %d (%s) can run at the same time and both list %s in **Files:**; give the file to one task, or add a **Depends on:** line so one waits for the other",
						o+1, tasks[o].Label, i+1, t.Label, f)
				}
			}
			owners[f] = append(owners[f], i)
		}
	}
	return nil
}

// trimBlankLines drops leading and trailing blank lines, keeping any blank-line run in the middle.
func trimBlankLines(lines []string) []string {
	start := 0
	for start < len(lines) && strings.TrimSpace(lines[start]) == "" {
		start++
	}
	end := len(lines)
	for end > start && strings.TrimSpace(lines[end-1]) == "" {
		end--
	}
	return lines[start:end]
}

// readPlanPreamble reads the title and the Effort/Verify/Setup/Check/Final/Prototype lines into p, reporting
// whether line was one of those (and so must not also be kept in Plan.Preamble).
func readPlanPreamble(p *Plan, line string) (bool, error) {
	if m := planTitleRe.FindStringSubmatch(line); m != nil && p.Title == "" {
		p.Title = m[1]
		return true, nil
	}
	if m := planEffortRe.FindStringSubmatch(line); m != nil {
		oid := strings.TrimPrefix(m[1], "effort:")
		if oid == "" || strings.ContainsAny(oid, "` 	") {
			return false, fmt.Errorf("plan **Effort:** line must be effort:<oid> or a bare oid, not in backticks, got %q", m[1])
		}
		if p.EffortOID != "" {
			return false, fmt.Errorf("plan has more than one **Effort:** line")
		}
		p.EffortOID = oid
		return true, nil
	}
	if m := planPrototypeRe.FindStringSubmatch(line); m != nil {
		if m[1] == "" || strings.Contains(m[1], "`") {
			return false, fmt.Errorf("plan **Prototype:** line must be a path, not in backticks, got %q", m[1])
		}
		if p.Prototype != "" {
			return false, fmt.Errorf("plan has more than one **Prototype:** line")
		}
		p.Prototype = m[1]
		return true, nil
	}
	if m := planSpecRe.FindStringSubmatch(line); m != nil {
		// unlike the lines above it stays in the preamble: its prose ("read it before your task") is for
		// every worker, and plans have always written it freely, so a line with no path is not an error
		if p.Spec == "" {
			p.Spec = planSpecPath(m[1])
		}
		return false, nil
	}
	m := planCommandRe.FindStringSubmatch(line)
	if m == nil {
		return false, nil
	}
	cmd := planBacktickRe.FindStringSubmatch(m[2])
	if cmd == nil {
		return false, fmt.Errorf("plan **%s:** line must hold one command in backticks, got %q", m[1], m[2])
	}
	field := &p.Verify
	switch m[1] {
	case "Setup":
		field = &p.Setup
	case "Check":
		field = &p.Check
	case "Final":
		field = &p.Final
	}
	if *field != "" {
		return false, fmt.Errorf("plan has more than one **%s:** line", m[1])
	}
	*field = cmd[1]
	return true, nil
}

// planSpecPath is the path in a **Spec:** line's value: its first backticked span (which also covers a
// markdown link's text), else the whole value when it is one bare token.
func planSpecPath(value string) string {
	if m := planSpecQuotedRe.FindStringSubmatch(value); m != nil {
		return strings.TrimSpace(m[1])
	}
	if value != "" && !strings.ContainsAny(value, " \t") {
		return value
	}
	return ""
}

// parsePlanModel reads a **Model:** value into the task's runtime and model. The split is on the first ":" and only
// when what precedes it is a harness the catalog knows, so a pi model id that holds a colon still reads as a model;
// a catalog runtime alone is that runtime on its default model; anything else is a model on the run's runtime.
func parsePlanModel(value string, n int) (runtime, model string, err error) {
	if _, ok := harness.Lookup(value); ok {
		return value, "", nil
	}
	if head, tail, found := strings.Cut(value, ":"); found {
		if _, ok := harness.Lookup(head); ok {
			if tail == "" {
				return "", "", fmt.Errorf("task %d: **Model:** %q names harness %s but no model; write %s alone for its default model", n, value, head, head)
			}
			return head, tail, nil
		}
	}
	return "", value, nil
}

// parsePlanDepends reads a **Depends on:** value into dependency ids, plus the index of each dependency
// written without a reason in parentheses ("Task 2 (uses the rows it adds)"). The reason is only checked
// for presence: the plan reviewer judges whether it holds, reading it in the plan text.
func parsePlanDepends(value string, n int) ([]string, []int, error) {
	if strings.EqualFold(value, "none") {
		return nil, nil, nil
	}
	if value == "" {
		return nil, nil, fmt.Errorf("task %d: **Depends on:** is empty; write none, or list earlier tasks like \"Task 1, Task 2\"", n)
	}
	var deps []string
	var unexplained []int
	for _, ref := range splitPlanDepends(value) {
		ref = strings.TrimSpace(ref)
		m := planTaskRefRe.FindStringSubmatch(ref)
		if m == nil {
			return nil, nil, fmt.Errorf("task %d depends on %q; write references like \"Task 1\" or \"Task 1 (uses the parser it adds)\"", n, ref)
		}
		dep, _ := strconv.Atoi(m[1])
		if dep < 1 || dep >= n {
			return nil, nil, fmt.Errorf("task %d depends on Task %d, which is not an earlier task", n, dep)
		}
		if slices.Contains(deps, planTaskID(dep)) {
			return nil, nil, fmt.Errorf("task %d lists Task %d twice", n, dep)
		}
		if strings.Contains(ref, "(") && strings.TrimSpace(m[2]) == "" {
			return nil, nil, fmt.Errorf("task %d: the parentheses after Task %d are empty; say what task %d uses from it, or drop them", n, dep, n)
		}
		deps = append(deps, planTaskID(dep))
		if !strings.Contains(ref, "(") {
			unexplained = append(unexplained, dep-1)
		}
	}
	return deps, unexplained, nil
}

// splitPlanDepends splits a Depends value on the commas outside parentheses, so a reason may hold commas.
func splitPlanDepends(value string) []string {
	var refs []string
	depth, start := 0, 0
	for i, r := range value {
		switch {
		case r == '(':
			depth++
		case r == ')' && depth > 0:
			depth--
		case r == ',' && depth == 0:
			refs = append(refs, value[start:i])
			start = i + 1
		}
	}
	return append(refs, value[start:])
}

// checkPlanDependsReasons refuses a written Depends edge with no reason between two tasks whose Files lines
// share no path: nothing forces their order, so a needless edge only makes one wait for the other's review
// (run dfba1693). Edges between tasks that share a file are ordered anyway, the implicit edge of a task with
// no Depends line is the documented serial default and never reaches bare, and a task with no Files line
// gives nothing to compare.
func checkPlanDependsReasons(tasks []waveobj.TaskNode, files map[int][]string, bare map[int][]int) error {
	for i := range tasks {
		if len(files[i]) == 0 {
			continue
		}
		for _, d := range bare[i] {
			if len(files[d]) == 0 || slices.ContainsFunc(files[i], func(f string) bool { return slices.Contains(files[d], f) }) {
				continue
			}
			return fmt.Errorf("task %d (%s) depends on task %d (%s), but their **Files:** lines share no path; say what task %d uses from task %d in parentheses after the reference, like \"Task %d (uses the rows it adds)\", or drop the edge so the two run at the same time. A screenshot or scenario both tasks appear in is not a reason: each task names that scenario step in its acceptance",
				i+1, tasks[i].Label, d+1, tasks[d].Label, i+1, d+1, d+1)
		}
	}
	return nil
}

// Lanes groups tasks into maximal chains: a task continues its dependency's lane when it has exactly
// one dependency and is that dependency's only dependent. Lanes are ordered by their first task.
// Tasks must be acyclic.
func Lanes(tasks []waveobj.TaskNode) [][]string {
	byID := make(map[string]waveobj.TaskNode, len(tasks))
	dependents := map[string][]string{}
	for _, t := range tasks {
		byID[t.ID] = t
		for _, d := range t.Deps {
			dependents[d] = append(dependents[d], t.ID)
		}
	}
	var lanes [][]string
	for _, t := range tasks {
		if len(t.Deps) == 1 && len(dependents[t.Deps[0]]) == 1 {
			continue
		}
		lane := []string{t.ID}
		for cur := t.ID; len(dependents[cur]) == 1; {
			next := byID[dependents[cur][0]]
			if len(next.Deps) != 1 {
				break
			}
			lane = append(lane, next.ID)
			cur = next.ID
		}
		lanes = append(lanes, lane)
	}
	return lanes
}

// LongestChain is the number of tasks on the longest dependency path. Tasks must be acyclic.
func LongestChain(tasks []waveobj.TaskNode) int {
	deps := make(map[string][]string, len(tasks))
	for _, t := range tasks {
		deps[t.ID] = t.Deps
	}
	depth := map[string]int{}
	var walk func(id string) int
	walk = func(id string) int {
		if d, ok := depth[id]; ok {
			return d
		}
		best := 0
		for _, d := range deps[id] {
			best = max(best, walk(d))
		}
		depth[id] = best + 1
		return depth[id]
	}
	longest := 0
	for _, t := range tasks {
		longest = max(longest, walk(t.ID))
	}
	return longest
}
