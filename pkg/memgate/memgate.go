// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package memgate tells the shell commands that take a lot of RAM (builds, the typecheck, whole test
// suites) from the rest, with a rough peak for each, so the heavy-job queue (pkg/jobqueue) can start them
// one at a time and only when the RAM fits. `wsh jobslot` asks the queue; the Claude mod and the pi
// extension call it before every shell command an agent runs.
package memgate

import (
	"fmt"
	"path"
	"strings"
)

const (
	mib uint64 = 1 << 20
	gib uint64 = 1 << 30
)

// Headroom is what a job leaves free for everything else: below it the machine swaps hard.
const Headroom = 512 * mib

// Job is one kind of heavy command: the name the card shows and its rough peak RAM.
type Job struct {
	Name  string
	Bytes uint64
}

// DevBytes is a dev app's peak (task dev, tauri dev); the engine's Final, which starts one, claims it too.
const DevBytes = 3 * gib

// the peaks, rounded up, of each job on an 8 GB Apple silicon Mac. The Vite build is capped at a 4 GB
// heap (NODE_OPTIONS in AGENTS.md); tauri:build runs it, then a release cargo build.
var (
	jobAppBuild      = Job{"task tauri:build", 3584 * mib}
	jobCargoTauri    = Job{"cargo tauri build", 3 * gib}
	jobDev           = Job{"task dev", DevBytes}
	jobViteBuild     = Job{"vite build", 3 * gib}
	jobBackend       = Job{"task build:backend", 1536 * mib}
	jobCargoBuild    = Job{"cargo build", 2 * gib}
	jobCargoTest     = Job{"cargo test", 2 * gib}
	jobInstall       = Job{"npm install", 1 * gib}
	jobTypecheck     = Job{"task check:ts", 3 * gib}
	jobVitest        = Job{"vitest (all)", 2 * gib}
	jobGoTestAll     = Job{"go test ./...", 2560 * mib}
	jobVerify        = Job{"scripts/verify.mjs", 2560 * mib}
	jobGoOrchestrate = Job{"go test pkg/orchestrate", 2 * gib}
	// compiling every package, as task build:backend compiles two
	jobGoBuildAll = Job{"go build ./...", 1536 * mib}
	jobGoVetAll   = Job{"go vet ./...", 1536 * mib}
	// a Final run by hand: it starts its own dev app and drives a browser, the peak the engine's Final claims
	jobFinalVerify = Job{"scripts/cdp/final-verify.mjs", DevBytes}
	// any project's build script; in arcterm it is task tauri:build, so it claims that peak
	jobNpmBuild = Job{"npm run build", 3584 * mib}
	// other projects': an e2e script starts the app's servers, builds the frontend and drives Chromium
	jobE2E = Job{"e2e script", 4 * gib}
	// a browser check against an app already running: Chromium and its pages, not the servers
	jobSmoke      = Job{"smoke script", 1536 * mib}
	jobPytest     = Job{"pytest (all)", 1 * gib}
	jobAstroBuild = Job{"astro build", 2 * gib}
)

// Solo says a job of this name runs alone among its kind even where the RAM would fit another: an e2e or smoke run
// drives Chromium and often starts servers and builds too, so two at once saturate the CPU long before the RAM.
func Solo(name string) bool {
	return name == jobE2E.Name || name == jobSmoke.Name
}

// Classify names the heaviest step of a shell command line, and false when no step is heavy.
func Classify(command string) (Job, bool) {
	return ClassifyWith(command, nil)
}

// ClassifyWith is Classify, plus any step whose unknown-program pattern (see Pattern) is in learned reads heavy as
// Job{Name: pattern, Bytes: LearnedBytes}. A program memgate has a rule for keeps its verdict whatever learned holds,
// so `go test -run X` stays light. The heaviest step wins as in Classify; a nil learned is Classify.
func ClassifyWith(command string, learned map[string]bool) (Job, bool) {
	var heaviest Job
	for _, words := range steps(command) {
		if job, ok := classifyStep(words, learned); ok && job.Bytes > heaviest.Bytes {
			heaviest = job
		}
	}
	return heaviest, heaviest.Bytes > 0
}

// Pattern is the key a command's measured peak is kept under. known: its one working step is a heavy table job and
// name is that job's Name. Otherwise name is the unknown step's pattern, its program's name and its first word that is
// not a flag (`make build`, `gradle build`; a bare `make` is `make`). ok is false when no step works, when more than
// one does (the tree's peak cannot be split between them), or when the one that does is a program memgate has a rule
// for that it calls light (`go test -run X`): those keep the table's verdict and are never learned.
//
// Steps that do no work are dropped first (cd, echo, the pipeline tails: noWork), and a sh/bash/zsh -c step is not
// a program of its own: its command line is read in its place, exactly where classifyStep recurses.
func Pattern(command string) (name string, known bool, ok bool) {
	work := workSteps(command, nil)
	if len(work) != 1 {
		return "", false, false
	}
	step := work[0]
	if job, heavy, ruled := classifyProgram(step.name, step.args, nil); ruled {
		if heavy {
			return job.Name, true, true
		}
		return "", false, false
	}
	return unknownPattern(step.name, step.args), false, true
}

// a step that runs a program: its name (by any path, .exe trimmed) and args, past env assignments and wrappers
type workStep struct {
	name string
	args []string
}

// stepProgram is a step's program and its args, past the env assignments and wrappers that only run it; an empty
// name for a step that runs nothing (a bare assignment, `command -v x`).
func stepProgram(words []string) (name string, args []string) {
	words = program(words)
	if len(words) == 0 {
		return "", nil
	}
	return strings.TrimSuffix(path.Base(words[0]), ".exe"), words[1:]
}

// noWork are the programs a step runs without doing work a peak could be measured on: they change the shell's own
// state, print, or end a pipeline (`make build 2>&1 | tail -5`).
var noWork = map[string]bool{
	"cd": true, "pushd": true, "popd": true, "export": true, "set": true, "source": true, ".": true, "echo": true,
	"tail": true, "head": true, "grep": true, "tee": true, "wc": true, "sort": true, "less": true,
}

// workSteps appends to out the steps of command that do work, a sh/bash/zsh -c step replaced by the work steps of its
// command line.
func workSteps(command string, out []workStep) []workStep {
	for _, words := range steps(command) {
		name, args := stepProgram(words)
		if name == "" || noWork[name] {
			continue
		}
		if isShell(name) {
			if line, dashC := shellOperand(args); dashC {
				out = workSteps(line, out)
				continue
			}
		}
		out = append(out, workStep{name, args})
	}
	return out
}

// unknownPattern is the key of a step whose program memgate has no rule for: the program and its first word that is
// not a flag. Empty for a step that does no work.
func unknownPattern(name string, args []string) string {
	if name == "" || noWork[name] {
		return ""
	}
	if op, _ := firstOperand(args); op != "" {
		return name + " " + op
	}
	return name
}

// Fits says whether the job can start on the RAM free now and still leave the headroom.
func Fits(job Job, available uint64) bool {
	return available >= job.Bytes+Headroom
}

// LongRunning says the job is a dev server: it runs until stopped, so it never holds a queue slot.
func (j Job) LongRunning() bool {
	return j == jobDev
}

// FormatGB is a byte count as the card shows it: GB with one decimal, "3 GB" rather than "3.0 GB".
func FormatGB(bytes uint64) string {
	return strings.TrimSuffix(fmt.Sprintf("%.1f", float64(bytes)/float64(gib)), ".0") + " GB"
}

// the wrappers that only run the command after them, by name, with their flags that take a value: `nice -n 10`,
// `env -u FOO`, `/usr/bin/time -o mem.txt`, `caffeinate -t 3600`. timeout has a duration too (pastTimeout)
var wrappers = map[string][]string{
	"env":        {"-u", "--unset", "-C", "--chdir", "-S", "--split-string", "-P"},
	"time":       {"-f", "--format", "-o", "--output"},
	"nice":       {"-n", "--adjustment"},
	"nohup":      nil,
	"caffeinate": {"-t", "-w"},
	"command":    nil,
	"exec":       {"-a"},
}

// one step's words, past its env assignments and the wrappers that only run it, each by any path and with its
// own flags
func program(words []string) []string {
	for len(words) > 0 {
		w := words[0]
		if isAssignment(w) {
			words = words[1:]
			continue
		}
		name := path.Base(w)
		if name == "timeout" || name == "gtimeout" {
			words = pastTimeout(words[1:])
			continue
		}
		valued, ok := wrappers[name]
		if !ok {
			return words
		}
		var flags []string
		words, flags = pastFlags(words[1:], valued)
		// command -v / -V looks the program up, it does not run it
		if name == "command" && has(flags, "-v", "-V") {
			return nil
		}
	}
	return nil
}

// pastFlags splits a wrapper's args into its leading flags and the command after them: a flag in valued takes the
// next word as its value, and -- ends the flags.
func pastFlags(args []string, valued []string) (rest []string, flags []string) {
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "--":
			return args[i+1:], flags
		case !strings.HasPrefix(a, "-"):
			return args[i:], flags
		}
		flags = append(flags, a)
		if has(valued, a) {
			i++
		}
	}
	return nil, flags
}

// pastTimeout is timeout's command: past its flags (-s and -k take a value) and the duration
func pastTimeout(args []string) []string {
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "-s" || a == "-k" || a == "--signal" || a == "--kill-after":
			i++
		case strings.HasPrefix(a, "-"):
		default:
			return args[i+1:]
		}
	}
	return nil
}

func isAssignment(word string) bool {
	eq := strings.IndexByte(word, '=')
	if eq <= 0 {
		return false
	}
	for i, c := range word[:eq] {
		if !(c == '_' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || i > 0 && c >= '0' && c <= '9') {
			return false
		}
	}
	return true
}

// the words that are not flags, in order
func operands(words []string) []string {
	var out []string
	for _, w := range words {
		if !strings.HasPrefix(w, "-") {
			out = append(out, w)
		}
	}
	return out
}

func has(words []string, any ...string) bool {
	for _, w := range words {
		for _, a := range any {
			if w == a {
				return true
			}
		}
	}
	return false
}

func classifyStep(words []string, learned map[string]bool) (Job, bool) {
	name, args := stepProgram(words)
	if name == "" {
		return Job{}, false
	}
	if job, heavy, ruled := classifyProgram(name, args, learned); ruled {
		return job, heavy
	}
	// a program memgate has no rule for reads heavy only once a measured run has proved its pattern so
	if len(learned) > 0 {
		if pattern := unknownPattern(name, args); learned[pattern] {
			return Job{Name: pattern, Bytes: LearnedBytes}, true
		}
	}
	return Job{}, false
}

// classifyProgram is the one place that says which programs memgate has a rule for: ruled is false only for a
// program no case below reads, and then Pattern keys it by its name and first operand. A rule that calls a command
// light (go test -run X) is still a rule: ruled stays true, and the table's verdict is final.
func classifyProgram(name string, args []string, learned map[string]bool) (job Job, heavy, ruled bool) {
	switch name {
	case "task":
		job, heavy = classifyTask(args)
	case "npm":
		job, heavy = classifyNpm(args)
	case "pnpm":
		job, heavy = classifyPnpm(args)
	case "uv":
		job, heavy = classifyUv(args)
	case "python", "python3", "py":
		if i := index(args, "-m"); i >= 0 && i+1 < len(args) && args[i+1] == "pytest" {
			job, heavy = pytest(args[i+2:])
		}
	case "sh", "bash", "zsh":
		job, heavy = classifyShell(args, learned)
	case "npx":
		if len(args) > 0 {
			job, heavy = classifyTool(path.Base(args[0]), args[1:])
		}
	case "node":
		job, heavy = classifyNode(args)
	case "cargo":
		job, heavy = classifyCargo(args)
	case "go":
		job, heavy = classifyGo(args)
	default:
		return classifyToolRule(name, args)
	}
	return job, heavy, true
}

func isShell(name string) bool {
	return name == "sh" || name == "bash" || name == "zsh"
}

// the shells' options that take the next word as their value: bash -o pipefail -c '…'
var shellValueFlags = []string{"-o", "+o", "-O", "+O", "--rcfile", "--init-file"}

// shellOperand is what a shell step runs: its first word past the options, and whether -c (alone or among short
// options: -lc) makes that word a command line of its own rather than a script's name.
func shellOperand(args []string) (operand string, dashC bool) {
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case has(shellValueFlags, a):
			i++
		case strings.HasPrefix(a, "--"):
		case strings.HasPrefix(a, "-"):
			dashC = dashC || strings.Contains(a[1:], "c")
		case strings.HasPrefix(a, "+"):
		default:
			return a, dashC
		}
	}
	return "", false
}

func classifyShell(args []string, learned map[string]bool) (Job, bool) {
	operand, dashC := shellOperand(args)
	switch {
	case dashC:
		return ClassifyWith(operand, learned)
	case operand == "":
		return Job{}, false
	}
	// a script run by name
	return classifyTool(path.Base(operand), nil)
}

func classifyTask(args []string) (Job, bool) {
	// a dry run, a listing or a summary runs nothing
	if has(args, "--dry", "-n", "--list", "-l", "--list-all", "-a", "--summary") {
		return Job{}, false
	}
	var heaviest Job
	for _, t := range operands(args) {
		var job Job
		switch t {
		case "tauri:build", "build:app", "tauri:build:post-bump":
			job = jobAppBuild
		case "dev", "tauri:dev":
			job = jobDev
		case "check:ts":
			job = jobTypecheck
		case "build:backend":
			job = jobBackend
		case "init":
			job = jobInstall
		}
		if job.Bytes > heaviest.Bytes {
			heaviest = job
		}
	}
	return heaviest, heaviest.Bytes > 0
}

// npm's flags that take a value, wherever they sit: npm --prefix frontend test, npm test -w web
var npmValueFlags = []string{"--prefix", "-w", "--workspace"}

func classifyNpm(args []string) (Job, bool) {
	args = dropValueFlags(args, npmValueFlags)
	sub, rest := firstOperand(args)
	switch sub {
	case "install", "i", "ci":
		return jobInstall, true
	case "test", "t":
		return vitest(rest)
	case "run", "run-script":
		script, rest := firstOperand(rest)
		switch script {
		case "":
			return Job{}, false
		case "build":
			return jobNpmBuild, true
		case "test":
			return vitest(rest)
		}
		return browserScript(script)
	case "exec":
		if tool, rest := firstOperand(rest); tool != "" {
			return classifyTool(path.Base(tool), rest)
		}
	}
	return Job{}, false
}

// firstOperand is the first word that is not a flag, and the words after it
func firstOperand(args []string) (string, []string) {
	for i, a := range args {
		if !strings.HasPrefix(a, "-") {
			return a, args[i+1:]
		}
	}
	return "", nil
}

// dropValueFlags takes each flag in valued out of args, with the value after it, wherever it sits
func dropValueFlags(args []string, valued []string) []string {
	var out []string
	for i := 0; i < len(args); i++ {
		if has(valued, args[i]) {
			i++
			continue
		}
		out = append(out, args[i])
	}
	return out
}

// a package.json script by name: one named e2e or smoke (test:e2e, e2e:ui, smoke) drives a browser
func browserScript(name string) (Job, bool) {
	for _, part := range strings.FieldsFunc(name, func(r rune) bool { return r == ':' || r == '-' || r == '_' }) {
		switch part {
		case "e2e":
			return jobE2E, true
		case "smoke":
			return jobSmoke, true
		}
	}
	return Job{}, false
}

// a tool from node_modules/.bin, run bare or through npx
func classifyTool(name string, args []string) (Job, bool) {
	job, heavy, _ := classifyToolRule(name, args)
	return job, heavy
}

// classifyToolRule is classifyTool, and whether memgate has a rule for the name at all: ruled is false for any
// program that is none of the tools below and no *.sh script.
func classifyToolRule(name string, args []string) (job Job, heavy, ruled bool) {
	switch name {
	case "vitest":
		job, heavy = vitest(args)
	case "vite":
		if has(operands(args), "build") {
			job, heavy = jobViteBuild, true
		}
	case "tsc":
		job, heavy = jobTypecheck, true
	case "tauri":
		job, heavy = tauriCLI(args)
	case "pytest", "py.test":
		job, heavy = pytest(args)
	case "astro":
		if has(operands(args), "build") {
			job, heavy = jobAstroBuild, true
		}
	case "playwright":
		if has(operands(args), "test") {
			job, heavy = jobE2E, true
		}
	default:
		if startsServer(name, args) {
			// light, and ruled so it is never learned
			return Job{}, false, true
		}
		// a shell script run by name: scripts/e2e.sh, run-smoke.sh
		if stem, ok := strings.CutSuffix(name, ".sh"); ok {
			job, heavy = browserScript(stem)
			return job, heavy, true
		}
		return Job{}, false, false
	}
	return job, heavy, true
}

// servers are the programs memgate has no other rule for that start a server, by the operand that does (none: any
// run of the program). A server runs until stopped, so a slot would be held up to jobqueue.MaxHold (60 min) and every
// heavy job behind it would wait; its peak would also read heavy (a Spring Boot app passes 1 GB) and teach the queue to
// hold the next start. So a server start is light and never learned, like npm run dev; task dev is the one exception
// (LongRunning), as the engine's Final claims its RAM. A build by the same program (mvn package, gradle build) is
// still learned on its own peak.
var servers = map[string][]string{
	"mvn":       {"spring-boot:run", "quarkus:dev", "jetty:run", "tomcat7:run", "exec:java"},
	"mvnw":      {"spring-boot:run", "quarkus:dev", "jetty:run", "tomcat7:run", "exec:java"},
	"gradle":    {"bootRun", "quarkusDev", "appRun"},
	"gradlew":   {"bootRun", "quarkusDev", "appRun"},
	"next":      {"dev", "start"},
	"nuxt":      {"dev", "preview"},
	"nuxi":      {"dev", "preview"},
	"flask":     {"run"},
	"rails":     {"server", "s"},
	"hugo":      {"server", "serve"},
	"dotnet":    {"run", "watch"},
	"uvicorn":   nil,
	"gunicorn":  nil,
	"hypercorn": nil,
	"nodemon":   nil,
}

// startsServer says the step runs a server per servers. A Windows wrapper's .bat or .cmd is the program it wraps
// (gradlew.bat bootRun), and a Gradle task path is its task (:api:bootRun).
func startsServer(name string, args []string) bool {
	name = strings.TrimSuffix(strings.TrimSuffix(name, ".bat"), ".cmd")
	want, ok := servers[name]
	if !ok {
		return false
	}
	if want == nil {
		return true
	}
	for _, op := range operands(args) {
		if strings.HasPrefix(op, ":") {
			op = op[strings.LastIndex(op, ":")+1:]
		}
		if has(want, op) {
			return true
		}
	}
	return false
}

// pnpm's flags that take a value, so the script name is found past them
var pnpmValueFlags = []string{"-C", "--dir", "-F", "--filter"}

func classifyPnpm(args []string) (Job, bool) {
	ops := skipValueFlags(args, pnpmValueFlags)
	if len(ops) == 0 {
		return Job{}, false
	}
	rest := ops[1:]
	switch ops[0] {
	case "install", "i", "add":
		return jobInstall, true
	case "test", "t":
		return vitest(rest)
	case "build":
		return jobViteBuild, true
	case "run", "run-script":
		if len(rest) > 0 {
			switch rest[0] {
			case "test":
				return vitest(rest[1:])
			case "build":
				return jobViteBuild, true
			}
			return browserScript(rest[0])
		}
		return Job{}, false
	case "exec", "dlx":
		if len(rest) > 0 {
			return classifyTool(path.Base(rest[0]), rest[1:])
		}
		return Job{}, false
	}
	if job, ok := classifyTool(ops[0], rest); ok {
		return job, true
	}
	// pnpm runs a package.json script by its bare name: pnpm smoke
	return browserScript(ops[0])
}

// uv run's flags that take a value, so the command it runs is found past them
var uvRunValueFlags = []string{"--env-file", "--with", "--with-editable", "--with-requirements", "--python", "-p",
	"--project", "--directory", "--package", "--extra", "--group", "--index", "--config-file", "--cache-dir"}

func classifyUv(args []string) (Job, bool) {
	ops := skipValueFlags(args, uvRunValueFlags)
	if len(ops) < 2 || ops[0] != "run" {
		return Job{}, false
	}
	// uv is a program memgate has a rule for, so what it runs keeps the table's verdict: nothing learned applies
	return classifyStep(skipValueFlags(ops[1:], uvRunValueFlags), nil)
}

// skipValueFlags drops the leading flags, and the value after each one in valued; the rest is returned whole,
// so the program's own flags stay with it.
func skipValueFlags(args []string, valued []string) []string {
	for i := 0; i < len(args); i++ {
		a := args[i]
		if !strings.HasPrefix(a, "-") {
			return args[i:]
		}
		if has(valued, a) {
			i++
		}
	}
	return nil
}

// a whole pytest run; one naming a file, a test id or a -k expression is light
func pytest(args []string) (Job, bool) {
	if has(args, "-k") {
		return Job{}, false
	}
	for _, op := range operands(args) {
		if strings.HasSuffix(op, ".py") || strings.Contains(op, ".py::") {
			return Job{}, false
		}
	}
	return jobPytest, true
}

func index(words []string, w string) int {
	for i, x := range words {
		if x == w {
			return i
		}
	}
	return -1
}

// a whole vitest run; one naming a file or a test name is light
func vitest(args []string) (Job, bool) {
	if has(args, "-t", "--testNamePattern") {
		return Job{}, false
	}
	for _, op := range operands(args) {
		if op != "run" && op != "watch" {
			return Job{}, false
		}
	}
	return jobVitest, true
}

func classifyNode(args []string) (Job, bool) {
	for i, a := range args {
		if strings.HasPrefix(a, "-") {
			continue
		}
		switch {
		case strings.HasSuffix(a, "typescript/lib/tsc.js"), strings.HasSuffix(a, "typescript/bin/tsc"):
			return jobTypecheck, true
		case a == "scripts/verify.mjs", strings.HasSuffix(a, "/scripts/verify.mjs"):
			return jobVerify, true
		case a == "scripts/cdp/final-verify.mjs", strings.HasSuffix(a, "/scripts/cdp/final-verify.mjs"):
			return jobFinalVerify, true
		case a == "scripts/release-build.mjs", strings.HasSuffix(a, "/scripts/release-build.mjs"):
			return jobAppBuild, true
		case strings.HasSuffix(a, "vitest/vitest.mjs"):
			return vitest(args[i+1:])
		case strings.HasSuffix(a, "astro/bin/astro.mjs"):
			return classifyTool("astro", args[i+1:])
		}
		// the script node runs, and none after it: scripts/smoke.mjs, e2e.js drive a browser
		switch ext := path.Ext(a); ext {
		case ".mjs", ".js", ".cjs", ".ts", ".mts":
			return browserScript(strings.TrimSuffix(path.Base(a), ext))
		}
	}
	return Job{}, false
}

func classifyCargo(args []string) (Job, bool) {
	ops := operands(args)
	if len(ops) == 0 {
		return Job{}, false
	}
	switch ops[0] {
	case "tauri":
		return tauriCLI(args[1:])
	case "build":
		return jobCargoBuild, true
	case "test":
		return jobCargoTest, true
	}
	return Job{}, false
}

func tauriCLI(args []string) (Job, bool) {
	ops := operands(args)
	switch {
	case has(ops, "build"):
		return jobCargoTauri, true
	case has(ops, "dev"):
		return jobDev, true
	}
	return Job{}, false
}

func classifyGo(args []string) (Job, bool) {
	ops := operands(args)
	if len(ops) == 0 {
		return Job{}, false
	}
	all := false
	for _, op := range ops[1:] {
		all = all || strings.Contains(op, "...")
	}
	switch ops[0] {
	case "build":
		if all {
			return jobGoBuildAll, true
		}
		return Job{}, false
	case "vet":
		if all {
			return jobGoVetAll, true
		}
		return Job{}, false
	case "test":
	default:
		return Job{}, false
	}
	if all {
		return jobGoTestAll, true
	}
	for _, a := range args {
		if a == "-run" || strings.HasPrefix(a, "-run=") {
			return Job{}, false
		}
	}
	for _, op := range ops[1:] {
		if strings.TrimSuffix(strings.TrimPrefix(op, "./"), "/") == "pkg/orchestrate" {
			return jobGoOrchestrate, true
		}
	}
	return Job{}, false
}

// steps splits a shell command line into its simple commands' words: on the unquoted separators
// (&& || ; | & and newlines) and on unquoted whitespace, quotes removed. A quoted separator stays a word,
// so `echo "a && task check:ts"` is one echo. Subshell parens are dropped. A redirection (2>&1, > out.txt,
// &>> log, < in) is no word at all, its target included: `npx vitest run 2>&1` names no test file. It does
// not expand anything.
func steps(command string) [][]string {
	var (
		out    [][]string
		words  []string
		word   strings.Builder
		inWord bool
		quote  byte
		// the next word is a redirection's target
		target bool
	)
	endWord := func() {
		if inWord {
			if target {
				target = false
			} else {
				words = append(words, word.String())
			}
			word.Reset()
			inWord = false
		}
	}
	endStep := func() {
		endWord()
		target = false
		if len(words) > 0 {
			out = append(out, words)
			words = nil
		}
	}
	for i := 0; i < len(command); i++ {
		c := command[i]
		switch {
		case quote != 0:
			if c == quote {
				quote = 0
			} else if c == '\\' && quote == '"' && i+1 < len(command) {
				i++
				word.WriteByte(command[i])
			} else {
				word.WriteByte(c)
			}
		case c == '\'' || c == '"':
			quote = c
			inWord = true
		case c == '\\' && i+1 < len(command):
			i++
			word.WriteByte(command[i])
			inWord = true
		case c == '>' || c == '<' || c == '&' && i+1 < len(command) && command[i+1] == '>':
			// the stream number in front of it (the 2 of 2>&1) goes with it; a word up against it does not
			if inWord && !isStreamNumber(word.String()) {
				endWord()
			}
			word.Reset()
			inWord = false
			end, joined := redirection(command, i)
			// a stream joined to another (2>&1, >&2, <&-) names no file; any other is followed by its target
			target = !joined
			i = end - 1
		case c == ';' || c == '|' || c == '&' || c == '\n' || c == '(' || c == ')':
			if c == '(' || c == ')' {
				endWord()
				continue
			}
			endStep()
		case c == ' ' || c == '\t' || c == '\r':
			endWord()
		default:
			word.WriteByte(c)
			inWord = true
		}
	}
	endStep()
	return out
}

// redirection reads the operator at command[i] (> >> < << <<< <> >| &> &>>, or a join such as >&2 or <&-): end is
// just past it, and joined says it joins a stream to another rather than naming a file after it.
func redirection(command string, i int) (end int, joined bool) {
	if command[i] == '&' {
		i++
	}
	op := command[i]
	i++
	for i < len(command) && (command[i] == '>' || command[i] == '<') {
		i++
	}
	if op == '>' && i < len(command) && command[i] == '|' {
		return i + 1, false
	}
	if i < len(command) && command[i] == '&' {
		j := i + 1
		for j < len(command) && (command[j] >= '0' && command[j] <= '9' || command[j] == '-') {
			j++
		}
		if j > i+1 {
			return j, true
		}
		// >& file sends both streams to it
		return i + 1, false
	}
	return i, false
}

// isStreamNumber says a word is all digits: the stream a redirection right after it acts on (the 2 of 2>&1)
func isStreamNumber(word string) bool {
	if word == "" {
		return false
	}
	for i := 0; i < len(word); i++ {
		if word[i] < '0' || word[i] > '9' {
			return false
		}
	}
	return true
}
