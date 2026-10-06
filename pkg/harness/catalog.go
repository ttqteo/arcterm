// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Package harness is the catalog of installed coding-agent harnesses (Pi, Claude Code, Codex, OpenCode).
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
)

type Spec struct {
	Runtime          string
	Bin              string
	Label            string
	ConsultCapable   bool
	RunWorkerCapable bool
	// SteeringRel is the home-relative path of the harness's home-level steering file.
	SteeringRel []string
	// SkillsRel is the home-relative path of the harness's skills directory. nil when the harness
	// has no fixed one: pi reads an explicit list of paths from its settings instead.
	SkillsRel []string
}

var specs = []Spec{
	{Runtime: "pi", Bin: "pi", Label: "Pi", ConsultCapable: true, RunWorkerCapable: true,
		SteeringRel: []string{".pi", "agent", "AGENTS.md"}},
	{Runtime: "claude", Bin: "claude", Label: "Claude Code", ConsultCapable: true, RunWorkerCapable: true,
		SteeringRel: []string{".claude", "CLAUDE.md"}, SkillsRel: []string{".claude", "skills"}},
	// run workers are claude and pi only (docs/deferred.md, 2026-09-14); codex and opencode still consult
	{Runtime: "codex", Bin: "codex", Label: "Codex", ConsultCapable: true, RunWorkerCapable: false,
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

func ValidateInstalled(runtime string, operation Operation) (Spec, error) {
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
