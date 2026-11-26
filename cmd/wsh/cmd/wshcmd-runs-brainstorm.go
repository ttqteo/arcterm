// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/brainstormcheck"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// A start linked to a brainstorm carries it as CreateRun's Brainstorm (a direct start) or the queue entry's Brainstorm (a
// queued one): the brainstorm's card then finds its run, and wavesrv tells the agent `brainstorm: run <id>` when the run
// exists, as it does for the launcher's Approve.

var (
	// runsFoldPaths is whether paths compare without case, as they do on Windows.
	runsFoldPaths = runtime.GOOS == "windows"
	// runsTabBrainstorm is the brainstorm.json a tab's session writes (its session:brainstorm meta), "" when none.
	runsTabBrainstorm = func(tabId string) (string, error) {
		meta, err := wshclient.GetMetaCommand(RpcClient, wshrpc.CommandGetMetaData{
			ORef: waveobj.MakeORef(waveobj.OType_Tab, tabId),
		}, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
		if err != nil {
			return "", err
		}
		return meta.GetString(waveobj.MetaKey_SessionBrainstorm, ""), nil
	}
)

// runsBrainstormDoc is what a start reads of a brainstorm.json.
type runsBrainstormDoc struct {
	Title string `json:"title"`
	Spec  string `json:"spec"`
	Run   any    `json:"run"` // the run id once a run started from it, else null
}

// runsLinkBrainstorm links the start in data to a brainstorm and returns the brainstorm's title, "" when it links none.
// With flagPath (--brainstorm) it links that file. Without it, it links the brainstorm of data's origin tab when the
// start names that brainstorm's spec (in the goal, as the plan file, or in the plan's text) and the brainstorm has no
// run yet; a default it cannot read is reported on stderr and links nothing. data.PlanPath must be absolute.
func runsLinkBrainstorm(data *wshrpc.CommandCreateRunData, flagPath string) (string, error) {
	if flagPath != "" {
		file, err := filepath.Abs(flagPath)
		if err != nil {
			return "", err
		}
		doc, err := runsReadBrainstorm(file)
		if err != nil {
			return "", fmt.Errorf("--brainstorm: %w", err)
		}
		data.Brainstorm = &wshrpc.RunQueueBrainstorm{Tab: data.OriginTabId, Path: file}
		return runsBrainstormTitle(doc, file), nil
	}
	if data.OriginTabId == "" {
		return "", nil
	}
	file, err := runsTabBrainstorm(data.OriginTabId)
	if err != nil {
		fmt.Fprintf(os.Stderr, "not linked to this tab's brainstorm: reading the tab: %v\n", err)
		return "", nil
	}
	if file == "" {
		return "", nil
	}
	doc, err := runsReadBrainstorm(file)
	if err != nil {
		fmt.Fprintf(os.Stderr, "not linked to this tab's brainstorm: %v\n", err)
		return "", nil
	}
	if doc.Run != nil && doc.Run != "" {
		return "", nil // a run is recorded on it already: this start is another one
	}
	project, _ := brainstormcheck.Project(file) // runsReadBrainstorm checked it
	planText := ""
	if data.PlanPath != "" {
		// a plan that cannot be read is the start's own error, which wavesrv reports; it names nothing here
		if raw, err := os.ReadFile(data.PlanPath); err == nil {
			planText = string(raw)
		}
	}
	if !runsSpecNamed(doc.Spec, project, data.Goal, data.PlanPath, planText) {
		return "", nil
	}
	data.Brainstorm = &wshrpc.RunQueueBrainstorm{Tab: data.OriginTabId, Path: file}
	return runsBrainstormTitle(doc, file), nil
}

// runsReadBrainstorm reads a brainstorm.json, which must sit under a project's .superpowers.
func runsReadBrainstorm(file string) (runsBrainstormDoc, error) {
	var doc runsBrainstormDoc
	if _, err := brainstormcheck.Project(file); err != nil {
		return doc, err
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		return doc, err
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return doc, fmt.Errorf("%s is not valid JSON: %w", file, err)
	}
	return doc, nil
}

func runsBrainstormTitle(doc runsBrainstormDoc, file string) string {
	if doc.Title != "" {
		return doc.Title
	}
	return filepath.Base(filepath.Dir(file))
}

// runsSpecNamed is whether a start names spec (a brainstorm's spec, relative to project or absolute): the goal or the
// plan's text holds its absolute or project-relative path, or it is the plan file. Either slash matches, and case is
// ignored where paths ignore it.
func runsSpecNamed(spec, project, goal, planPath, planText string) bool {
	if spec == "" {
		return false
	}
	abs := filepath.Clean(spec)
	if !filepath.IsAbs(abs) {
		abs = filepath.Join(project, spec)
	}
	forms := []string{runsPathKey(abs)}
	if rel, err := filepath.Rel(project, abs); err == nil && !strings.HasPrefix(rel, "..") {
		forms = append(forms, runsPathKey(rel))
	}
	if planPath != "" && runsPathKey(filepath.Clean(planPath)) == forms[0] {
		return true
	}
	for _, text := range []string{goal, planText} {
		key := runsPathKey(text)
		for _, form := range forms {
			if strings.Contains(key, form) {
				return true
			}
		}
	}
	return false
}

func runsPathKey(s string) string {
	s = strings.ReplaceAll(s, `\`, "/")
	if runsFoldPaths {
		s = strings.ToLower(s)
	}
	return s
}

// runsQueueAddData is the queue's request for a queued start: a linked brainstorm moves from the start's data to the
// entry, which tells the agent when it starts.
func runsQueueAddData(data wshrpc.CommandCreateRunData, after []string) wshrpc.CommandRunQueueAddData {
	b := data.Brainstorm
	data.Brainstorm = nil
	return wshrpc.CommandRunQueueAddData{Data: data, After: after, Brainstorm: b}
}
