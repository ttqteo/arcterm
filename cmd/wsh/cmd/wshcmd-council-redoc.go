// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

// redocSaveTimeoutMs bounds one rewrite: the save reads every file the report cites for its Cite check.
const redocSaveTimeoutMs = 60_000

var councilRedocCmd = &cobra.Command{
	Use:   "redoc",
	Short: "rewrite a project's saved council reports in the current layout, with no model",
	Args:  cobra.NoArgs,
	Long: `Save again every council report of a project, so a report written before a change to the layout (the short main
file and its .discussion.md side file) takes the new one. It renders from each council's saved record, so no model is
called and no tokens are spent; an old council has no figures table, since its seats never declared figures.
A council's report is the file under <project>/docs/council/ with the base name its record keeps as docpath: the stored
path's drive or prefix does not matter, so a report synced from another machine pairs. A report no council on this
machine names is left untouched and listed (its record is likely on the machine that ran it: run this there too), and no
report is ever deleted. A council that has not ended is skipped. A save that fails is printed with its error and the
rest go on; the command then exits nonzero.
The project is --project, else the git top level of the working directory, else the working directory. --dry-run prints
what would be rewritten and writes nothing.`,
	PreRunE: preRunSetupRpcClient,
	RunE:    councilRedocRun,
}

func councilRedocRun(cmd *cobra.Command, args []string) error {
	project, err := councilRedocProject(mustFlagString(cmd, "project"))
	if err != nil {
		return err
	}
	dryRun, _ := cmd.Flags().GetBool("dry-run")
	entries, err := redocEntries(filepath.Join(project, "docs", "council"))
	if errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("%s has no docs/council folder, so there is nothing to rewrite (--project names the project folder)", project)
	}
	if err != nil {
		return err
	}
	list, err := wshclient.CouncilListCommand(RpcClient, wshrpc.CommandCouncilListData{Project: project}, &wshrpc.RpcOpts{Timeout: runsReadTimeoutMs})
	if err != nil {
		return err
	}
	plan := redocPlan(project, list, entries)

	failed := 0
	for _, s := range plan.Saves {
		rel := path.Join("docs", "council", s.Report)
		if dryRun {
			fmt.Printf("would rewrite  %s  %s  %s\n", rel, s.Id, councilOneLine(s.Feature))
			continue
		}
		// A relative path is under the council's own project, so the server never reads the stored absolute one.
		if _, err := wshclient.CouncilSaveDocCommand(RpcClient, wshrpc.CommandCouncilSaveDocData{Id: s.Id, Path: rel}, &wshrpc.RpcOpts{Timeout: redocSaveTimeoutMs}); err != nil {
			failed++
			fmt.Fprintf(os.Stderr, "FAILED         %s  %s: %v\n", rel, s.Id, err)
			continue
		}
		fmt.Printf("rewrote        %s  %s  %s\n", rel, s.Id, councilOneLine(s.Feature))
	}
	for _, s := range plan.Skipped {
		fmt.Printf("skipped        %s  %s: %s\n", path.Join("docs", "council", s.Report), s.Id, s.Why)
	}
	for _, r := range plan.Untouched {
		fmt.Printf("untouched      %s  left untouched: no council record on this machine\n", path.Join("docs", "council", r))
	}

	verb := "rewritten"
	if dryRun {
		verb = "to rewrite"
	}
	fmt.Printf("%d %s, %d skipped, %d left untouched in %s\n", len(plan.Saves)-failed, verb, len(plan.Skipped), len(plan.Untouched), project)
	if failed > 0 {
		return fmt.Errorf("%d of %d reports could not be rewritten", failed, len(plan.Saves))
	}
	return nil
}

// councilRedocProject is the project redoc works on: --project, else the git top level of the working directory, else
// the working directory itself.
func councilRedocProject(flag string) (string, error) {
	if flag != "" {
		return filepath.Abs(flag)
	}
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	if top := councilGitTop(cwd); top != "" {
		return top, nil
	}
	return cwd, nil
}

// redocEntries is what a folder holds at its top level, by name: a directory's name ends in "/", which is how redocPlan
// leaves out briefs/ and the regions folders.
func redocEntries(dir string) ([]string, error) {
	des, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(des))
	for _, e := range des {
		name := e.Name()
		if e.IsDir() {
			name += "/"
		}
		names = append(names, name)
	}
	return names, nil
}

// redocSave is one report to save again: the council whose record it is and the report's file name in docs/council.
type redocSave struct {
	Id      string
	Feature string
	Report  string
}

// redocSkip is a report that has a record but is not saved again, and why.
type redocSkip struct {
	Id     string
	Report string
	Why    string
}

// redocResult is what redoc does: the reports to save again, the ones with a record that it leaves be, and the reports
// no council on this machine names.
type redocResult struct {
	Saves     []redocSave
	Skipped   []redocSkip
	Untouched []string
}

// redocPlan pairs the project's councils with the reports in its docs/council. entries are that folder's names (a
// directory's ends in "/", and a name with a "/" inside is not top-level); only a top-level .md that is not a side file
// is a report. A council pairs with the report whose file name its docpath ends in, as long as its docpath is a file of
// some docs/council folder: the stored path's drive and prefix (another machine's, the other slash) are not compared,
// since a synced report keeps its name and loses its prefix. A council of another project is not this project's to
// rewrite. The councils come newest first, and when several name one report the newest takes it. A council that has not
// ended is skipped, so its half-done state is never written over a finished report. Pure, so a test can set the whole
// case.
func redocPlan(project string, councils []*council.Council, entries []string) redocResult {
	var reports []string
	for _, name := range entries {
		if strings.HasSuffix(name, ".md") && !strings.Contains(name, "/") && !council.IsSidePath(name) {
			reports = append(reports, name)
		}
	}
	var res redocResult
	claimed := map[string]string{} // report -> the id of the council that took it
	for _, c := range councils {
		if !redocSameFolder(c.Project, project) {
			continue
		}
		doc := redocSlash(strings.TrimSpace(c.DocPath))
		dir := path.Dir(doc)
		if !strings.EqualFold(path.Base(dir), "council") || !strings.EqualFold(path.Base(path.Dir(dir)), "docs") {
			continue // not a report of the docs/council layout
		}
		report := ""
		for _, r := range reports {
			if strings.EqualFold(r, path.Base(doc)) {
				report = r
				break
			}
		}
		if report == "" {
			continue // its report is not in this project's folder
		}
		if by, ok := claimed[report]; ok {
			res.Skipped = append(res.Skipped, redocSkip{Id: c.Id, Report: report, Why: "council " + by + ", which is newer, names this report too"})
			continue
		}
		claimed[report] = c.Id
		switch c.State {
		case council.StateRunning, council.StateAwaiting, council.StateQueued:
			res.Skipped = append(res.Skipped, redocSkip{Id: c.Id, Report: report, Why: "the council is " + string(c.State) + ", not over"})
			continue
		}
		res.Saves = append(res.Saves, redocSave{Id: c.Id, Feature: c.Feature, Report: report})
	}
	for _, r := range reports {
		if _, ok := claimed[r]; !ok {
			res.Untouched = append(res.Untouched, r)
		}
	}
	return res
}

// redocSlash is a path with its backslashes as slashes, so a Windows path and a Mac one split alike on either machine.
func redocSlash(p string) string {
	return strings.ReplaceAll(p, `\`, "/")
}

// redocSameFolder says two folder paths name one folder as written, whatever the slash or the case; the project of a
// council and the --project of the command are the same string on the machine that saved the council.
func redocSameFolder(a, b string) bool {
	return strings.EqualFold(path.Clean(redocSlash(a)), path.Clean(redocSlash(b)))
}

func init() {
	councilRedocCmd.Flags().String("project", "", "the project folder (default: the git top level of the working directory, else the working directory)")
	councilRedocCmd.Flags().Bool("dry-run", false, "print what would be rewritten and write nothing")
	councilCmd.AddCommand(councilRedocCmd)
}
