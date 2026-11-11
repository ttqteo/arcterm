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
	var heaviest Job
	for _, words := range steps(command) {
		if job, ok := classifyStep(words); ok && job.Bytes > heaviest.Bytes {
			heaviest = job
		}
	}
	return heaviest, heaviest.Bytes > 0
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

func classifyStep(words []string) (Job, bool) {
	words = program(words)
	if len(words) == 0 {
		return Job{}, false
	}
	name, args := strings.TrimSuffix(path.Base(words[0]), ".exe"), words[1:]
	switch name {
	case "task":
		return classifyTask(args)
	case "npm":
		return classifyNpm(args)
	case "pnpm":
		return classifyPnpm(args)
	case "uv":
		return classifyUv(args)
	case "python", "python3", "py":
		if i := index(args, "-m"); i >= 0 && i+1 < len(args) && args[i+1] == "pytest" {
			return pytest(args[i+2:])
		}
		return Job{}, false
	case "sh", "bash", "zsh":
		ops := operands(args)
		if len(ops) == 0 {
			return Job{}, false
		}
		// -c (alone or among short flags: -lc) makes the first operand a command line of its own
		for _, a := range args {
			if strings.HasPrefix(a, "-") && !strings.HasPrefix(a, "--") && strings.Contains(a[1:], "c") {
				return Classify(ops[0])
			}
		}
		// a script run by name
		return classifyTool(path.Base(ops[0]), nil)
	case "npx":
		if len(args) == 0 {
			return Job{}, false
		}
		return classifyTool(path.Base(args[0]), args[1:])
	case "node":
		return classifyNode(args)
	case "cargo":
		return classifyCargo(args)
	case "go":
		return classifyGo(args)
	}
	return classifyTool(name, args)
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
	switch name {
	case "vitest":
		return vitest(args)
	case "vite":
		if has(operands(args), "build") {
			return jobViteBuild, true
		}
	case "tsc":
		return jobTypecheck, true
	case "tauri":
		return tauriCLI(args)
	case "pytest", "py.test":
		return pytest(args)
	case "astro":
		if has(operands(args), "build") {
			return jobAstroBuild, true
		}
	case "playwright":
		if has(operands(args), "test") {
			return jobE2E, true
		}
	}
	// a shell script run by name: scripts/e2e.sh, run-smoke.sh
	if stem, ok := strings.CutSuffix(name, ".sh"); ok {
		return browserScript(stem)
	}
	return Job{}, false
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
	return classifyStep(skipValueFlags(ops[1:], uvRunValueFlags))
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
