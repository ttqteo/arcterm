// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
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
check" a council saves into its document: how many places hold (the file is there, the line is in it, and a keyword of
a sentence citing it is on or within 3 lines of it), how many have no such keyword near the line, how many are wrong
(no such file, or a line past the end), and how many lie outside the folders read, each with where the report cites it.
It reads files only: no model is called and nothing is written. A report under <project>/docs/council/ is read against
<project>; --root names the folders instead (repeat it for more, the first one first).`,
	RunE: func(cmd *cobra.Command, args []string) error {
		roots, _ := cmd.Flags().GetStringArray("root")
		data, err := os.ReadFile(args[0])
		if err != nil {
			return err
		}
		roots, err = councilCitesRoots(args[0], roots)
		if err != nil {
			return err
		}
		section := council.CiteCheckSection(string(data), roots)
		if section == "" {
			fmt.Printf("%s cites no path:line.\n", args[0])
			return nil
		}
		fmt.Print(section)
		return nil
	},
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
