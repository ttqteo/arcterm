// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/council"
)

var councilCitesCmd = &cobra.Command{
	Use:   "cites <report.md>",
	Short: "check every path:line a saved council report cites, with no model",
	Args:  cobra.ExactArgs(1),
	Long: `Read every path:line the report cites, in its directions and in the whole discussion, and print the same "Cite
check" a council saves into its side file: how many places hold (the file is there, the line is in it, and a keyword of
a sentence citing it is on or within 3 lines of it), how many have no such keyword near the line, how many are wrong
(no such file, or a line past the end), and how many lie outside the folders read, each with where the report cites it.
A saved report is two files, the report (<name>.md) and its side file (<name>.discussion.md, which holds the discussion
and the Cite check): give either one and the other is read with it when it is there, the two audited as one text.
A file named only by its bare name ("chat.go:3") is read through the full path the report cites elsewhere; one that no
full path names, or that two do, is counted as not checked, not as wrong. A line with nothing to look for (no keyword in
the sentences that cite it) is counted apart: it is there, but it does not count as holding.
It reads files only: no model is called and nothing is written. A report under <project>/docs/council/ is read against
<project>; --root names the folders instead (repeat it for more, the first one first).`,
	RunE: func(cmd *cobra.Command, args []string) error {
		roots, _ := cmd.Flags().GetStringArray("root")
		text, err := councilCitesText(args[0])
		if err != nil {
			return err
		}
		roots, err = councilCitesRoots(args[0], roots)
		if err != nil {
			return err
		}
		section := council.CiteCheckSection(text, roots)
		if section == "" {
			fmt.Printf("%s cites no path:line.\n", args[0])
			return nil
		}
		fmt.Print(section)
		return nil
	},
}

// councilCitesText is the text `wsh council cites` audits for a report: the file given and, when there is one, the file
// that goes with it, the main report first and its side file after (the council's two files are one report). A file with
// no sibling, such as a report saved before the split, is read alone; a sibling that cannot be read is an error.
func councilCitesText(report string) (string, error) {
	data, err := os.ReadFile(report)
	if err != nil {
		return "", err
	}
	sibling, isMain := council.SidePath(report), true
	if council.IsSidePath(report) {
		sibling, isMain = strings.TrimSuffix(report, council.DiscussionSuffix)+".md", false
	}
	other, err := os.ReadFile(sibling)
	if errors.Is(err, fs.ErrNotExist) {
		return string(data), nil
	}
	if err != nil {
		return "", err
	}
	if isMain {
		return string(data) + "\n" + string(other), nil
	}
	return string(other) + "\n" + string(data), nil
}

// councilCitesRoots are the folders `wsh council cites` reads a report against, absolute: the --root folders when given,
// else the project a report under <project>/docs/council/ was saved into, else the report's own folder.
func councilCitesRoots(doc string, given []string) ([]string, error) {
	var roots []string
	for _, r := range given {
		if r = strings.TrimSpace(r); r == "" {
			continue
		}
		abs, err := filepath.Abs(r)
		if err != nil {
			return nil, err
		}
		roots = append(roots, abs)
	}
	if len(roots) > 0 {
		return roots, nil
	}
	abs, err := filepath.Abs(doc)
	if err != nil {
		return nil, err
	}
	dir := filepath.Dir(abs)
	if filepath.Base(dir) == "council" && filepath.Base(filepath.Dir(dir)) == "docs" {
		return []string{filepath.Dir(filepath.Dir(dir))}, nil
	}
	return []string{dir}, nil
}

func init() {
	councilCitesCmd.Flags().StringArray("root", nil, "a folder the cites are read against (repeatable; default: the project the report was saved into)")
	councilCmd.AddCommand(councilCitesCmd)
}
