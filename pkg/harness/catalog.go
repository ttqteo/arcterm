// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Package harness is the catalog of installed coding-agent harnesses (Pi, Claude Code, Antigravity, Codex, OpenCode).
// It owns identity, capabilities, executable lookup, and installation probing so that
// consult (pkg/consult) and Run workers (pkg/jarvis) share one source of truth and never silently
// fall back to another harness. OpenRouter is an API-backed utility runtime and intentionally lives
// outside this catalog.

package harness

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

type Operation string

const (
	OperationConsult   Operation = "consult"
	OperationRunWorker Operation = "run-worker"
	// OperationLead is a run's own runtime (lead and phases) and its reviewer: judgment roles that need
	// wake, the handoff /compact and re-orientation after compaction.
	OperationLead Operation = "lead"
)

type Spec struct {
	Runtime          string
	Bin              string
	Label            string
	ConsultCapable   bool
	RunWorkerCapable bool
	// LeadCapable harnesses may run as a run's lead, its phases, task reviewers and stage sessions.
	LeadCapable bool
	// AssignsOwnSession harnesses name their own session and take no --session-id; arcterm learns the id
	// from the harness's first status report.
	AssignsOwnSession bool
	// SteeringRel is the home-relative path of the harness's home-level steering file.
	SteeringRel []string
	// SkillsRel is the home-relative path of the harness's skills directory. nil when the harness
	// has no fixed one: pi reads an explicit list of paths from its settings instead.
	SkillsRel []string
	// NpmPackage is the package whose dist-tags say what the latest release is; "" when arcterm does not check it.
	NpmPackage string
	// UpdateArgs runs the harness's own updater (`<Bin> <UpdateArgs...>`); nil when arcterm cannot update it.
	UpdateArgs []string
}

var specs = []Spec{
	{Runtime: "pi", Bin: "pi", Label: "Pi", ConsultCapable: true, RunWorkerCapable: true, LeadCapable: true,
		SteeringRel: []string{".pi", "agent", "AGENTS.md"}},
	{Runtime: "claude", Bin: "claude", Label: "Claude Code", ConsultCapable: true, RunWorkerCapable: true, LeadCapable: true,
		SteeringRel: []string{".claude", "CLAUDE.md"}, SkillsRel: []string{".claude", "skills"},
		NpmPackage: "@anthropic-ai/claude-code", UpdateArgs: []string{"update"}},
	// agy is not on npm. It runs task workers only: a lead needs the handoff /compact and re-orientation after
	// compaction, and agy has neither. It names its own conversation id, so its worker's session is bound late.
	{Runtime: "agy", Bin: "agy", Label: "Antigravity", ConsultCapable: true, RunWorkerCapable: true, AssignsOwnSession: true,
		SteeringRel: []string{".gemini", "config", "AGENTS.md"}, SkillsRel: []string{".gemini", "config", "skills"},
		UpdateArgs: []string{"update"}},
	// codex runs task workers only, like agy: a lead needs the handoff /compact and re-orientation after
	// compaction, and codex has neither. It names its own session id, so its worker's session is bound late
	// from its first hook. opencode still only consults (docs/deferred.md, 2026-09-14).
	{Runtime: "codex", Bin: "codex", Label: "Codex", ConsultCapable: true, RunWorkerCapable: true, AssignsOwnSession: true,
		SteeringRel: []string{".codex", "AGENTS.md"}, SkillsRel: []string{".codex", "skills"}},
	{Runtime: "opencode", Bin: "opencode", Label: "OpenCode", ConsultCapable: true, RunWorkerCapable: false,
		SteeringRel: []string{".config", "opencode", "AGENTS.md"}, SkillsRel: []string{".config", "opencode", "skills"}},
}

// SteeringPath is the harness's home-level steering file under home.
func (s Spec) SteeringPath(home string) string {
	if len(s.SteeringRel) == 0 {
		return ""
	}
	return filepath.Join(append([]string{home}, s.SteeringRel...)...)
}

// SkillsPath is the harness's skills directory under home, or "" when it scans no fixed directory.
func (s Spec) SkillsPath(home string) string {
	if len(s.SkillsRel) == 0 {
		return ""
	}
	return filepath.Join(append([]string{home}, s.SkillsRel...)...)
}

// ConfigRoot must already exist for a harness to be synced; arcterm never creates one, so a harness the
// user has never run is skipped rather than provisioned.
func (s Spec) ConfigRoot(home string) string {
	if len(s.SteeringRel) == 0 {
		return ""
	}
	return filepath.Dir(s.SteeringPath(home))
}

func List() []Spec {
	return append([]Spec(nil), specs...)
}

func Lookup(runtime string) (Spec, bool) {
	for _, spec := range specs {
		if spec.Runtime == runtime {
			return spec, true
		}
	}
	return Spec{}, false
}

type ProbeResult struct {
	Spec      Spec
	Installed bool
	Version   string
}

// lookPath is a seam for tests; production behavior is exec.LookPath.
var lookPath = exec.LookPath

// versionCommand is a seam for tests; production behavior is `<bin> --version` under the caller ctx.
var versionCommand = func(ctx context.Context, bin string) ([]byte, error) {
	return exec.CommandContext(ctx, bin, "--version").CombinedOutput()
}

// ValidateCapable checks that the runtime is in the catalog and may do operation, without probing the
// machine. ValidateInstalled adds the install check after it.
func ValidateCapable(runtime string, operation Operation) (Spec, error) {
	spec, ok := Lookup(runtime)
	if !ok {
		return Spec{}, fmt.Errorf("unknown harness %q", runtime)
	}
	if operation == OperationConsult && !spec.ConsultCapable {
		return Spec{}, fmt.Errorf("harness %q does not support consults", runtime)
	}
	if operation == OperationRunWorker && !spec.RunWorkerCapable {
		return Spec{}, fmt.Errorf("harness %q does not support run workers", runtime)
	}
	if operation == OperationLead && !spec.LeadCapable {
		return Spec{}, fmt.Errorf("harness %q cannot lead a run", runtime)
	}
	return spec, nil
}

func ValidateInstalled(runtime string, operation Operation) (Spec, error) {
	spec, err := ValidateCapable(runtime, operation)
	if err != nil {
		return Spec{}, err
	}
	if _, err := lookPath(spec.Bin); err != nil {
		return Spec{}, fmt.Errorf("harness %q is not installed", runtime)
	}
	return spec, nil
}

func probe(ctx context.Context, spec Spec) ProbeResult {
	if _, err := lookPath(spec.Bin); err != nil {
		return ProbeResult{Spec: spec}
	}
	out, _ := versionCommand(ctx, spec.Bin)
	return ProbeResult{Spec: spec, Installed: true, Version: strings.TrimSpace(string(out))}
}

func ProbeAll(ctx context.Context) []ProbeResult {
	results := make([]ProbeResult, len(specs))
	var wg sync.WaitGroup
	for i, spec := range specs {
		wg.Add(1)
		go func(i int, spec Spec) {
			defer wg.Done()
			results[i] = probe(ctx, spec)
		}(i, spec)
	}
	wg.Wait()
	return results
}

// OwnsBlock reports whether a harness's status hook may report on a block with this meta controller and cmd. A
// nested run (`agy -p`, `codex exec`) inside another agent's block inherits its WAVETERM_BLOCKID, and reporting there
// would overwrite that agent's status and transcript path. A cmd block belongs to the harness only when its program
// is that harness; a shell block (a person typed the command) does.
func OwnsBlock(controller, cmd, program string) bool {
	if controller != "cmd" {
		return true
	}
	name := cmd
	if i := strings.LastIndexAny(name, `/\`); i >= 0 {
		name = name[i+1:]
	}
	return strings.TrimSuffix(strings.ToLower(name), ".exe") == program
}
