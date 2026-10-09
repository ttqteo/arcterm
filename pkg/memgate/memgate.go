// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package memgate tells the shell commands that take a lot of RAM (builds, the typecheck, whole test
// suites) from the rest, with a rough peak for each, so an agent's command can wait for the person's say
// when the machine is short. `wsh memgate` asks; the Claude mod and the pi extension call it before every
// shell command an agent runs.
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
)

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

// one step's words, past its env assignments and the wrappers that only run it
func program(words []string) []string {
	for len(words) > 0 {
		w := words[0]
		switch {
		case isAssignment(w), w == "env", w == "time", w == "nice", w == "command", w == "exec":
			words = words[1:]
		default:
			return words
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
	name, args := path.Base(words[0]), words[1:]
	switch name {
	case "task":
		return classifyTask(args)
	case "npm":
		return classifyNpm(args)
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

func classifyNpm(args []string) (Job, bool) {
	ops := operands(args)
	if len(ops) == 0 {
		return Job{}, false
	}
	switch ops[0] {
	case "install", "i", "ci":
		return jobInstall, true
	case "test", "t":
		return vitest(args[1:])
	case "run", "run-script":
		if len(ops) > 1 {
			switch ops[1] {
			case "build":
				return jobAppBuild, true
			case "test":
				return vitest(args[2:])
			}
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
	}
	return Job{}, false
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
	for _, a := range operands(args) {
		switch {
		case strings.HasSuffix(a, "typescript/lib/tsc.js"), strings.HasSuffix(a, "typescript/bin/tsc"):
			return jobTypecheck, true
		case a == "scripts/verify.mjs", strings.HasSuffix(a, "/scripts/verify.mjs"):
			return jobVerify, true
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
	if len(ops) == 0 || ops[0] != "test" {
		return Job{}, false
	}
	for _, op := range ops[1:] {
		if strings.Contains(op, "...") {
			return jobGoTestAll, true
		}
	}
	if has(args, "-run") {
		return Job{}, false
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
// so `echo "a && task check:ts"` is one echo. Subshell parens are dropped. It does not expand anything.
func steps(command string) [][]string {
	var (
		out    [][]string
		words  []string
		word   strings.Builder
		inWord bool
		quote  byte
	)
	endWord := func() {
		if inWord {
			words = append(words, word.String())
			word.Reset()
			inWord = false
		}
	}
	endStep := func() {
		endWord()
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
		case c == ';' || c == '|' || c == '&' || c == '\n' || c == '(' || c == ')':
			// a redirection's & (2>&1, &>) joins streams, it does not end the step
			if c == '&' && (i > 0 && command[i-1] == '>' || i+1 < len(command) && command[i+1] == '>') {
				word.WriteByte(c)
				inWord = true
				continue
			}
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
