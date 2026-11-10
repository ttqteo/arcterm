// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// council-bench-brainstorm runs the council bench's brainstorm variant on the cases it is given, outside wavesrv:
//
//	go run ./cmd/council-bench-brainstorm --case run-pause
//
// It drives Arc's brainstorm skill through `claude -p` on each Brainstorm-mode case, judges the design against the
// case's key and appends a row to <data dir>/council-bench.jsonl, the file `wsh council bench results`
// reads. It needs a Claude Code install with the superpowers plugin. Progress and failures log to stderr; Ctrl+C
// stops it, the item in flight writes no row, and the rows already written stay.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/council/bench"
)

// caseFlags is the repeatable --case flag.
type caseFlags []string

func (c *caseFlags) String() string { return strings.Join(*c, ",") }

func (c *caseFlags) Set(v string) error {
	v = strings.TrimSpace(v)
	if v == "" {
		return errors.New("a case id cannot be empty")
	}
	*c = append(*c, v)
	return nil
}

// defaultDataDir is the packaged app's data dir, where its cases and results live (scripts/council-bench-cases.mjs
// documents the same two paths).
func defaultDataDir() (string, error) {
	switch runtime.GOOS {
	case "windows":
		local := os.Getenv("LOCALAPPDATA")
		if local == "" {
			return "", errors.New("LOCALAPPDATA is not set; pass --data-dir")
		}
		return filepath.Join(local, "dev.arc.app", "data"), nil
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("no home dir (%v); pass --data-dir", err)
		}
		return filepath.Join(home, "Library", "Application Support", "dev.arc.app"), nil
	}
	return "", fmt.Errorf("no packaged app's data dir on %s; pass --data-dir", runtime.GOOS)
}

func run() error {
	var cases caseFlags
	flag.Var(&cases, "case", "id of a Brainstorm case to run (required, repeatable)")
	runs := flag.Int("runs", 1, "how many runs of each case")
	dataDir := flag.String("data-dir", "", "the app's data dir, holding council-bench/ (default: the packaged app's)")
	flag.Parse()
	if flag.NArg() > 0 {
		return fmt.Errorf("unexpected argument %q: name a case with --case <id>", flag.Arg(0))
	}
	if len(cases) == 0 {
		return errors.New("--case <id> is required: name a Brainstorm case from <data dir>/council-bench/cases.json")
	}
	if *runs < 1 {
		return fmt.Errorf("--runs must be 1 or more, got %d", *runs)
	}
	dir := *dataDir
	if dir == "" {
		var err error
		if dir, err = defaultDataDir(); err != nil {
			return err
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	opts := bench.Options{Cases: cases, Variants: []string{bench.VariantBrainstorm}, Runs: *runs}
	funcs := bench.Funcs{Judge: bench.Judge, Brainstorm: bench.RunBrainstorm}
	log.SetOutput(os.Stderr)
	if err := bench.Run(ctx, dir, opts, funcs); err != nil {
		return err
	}
	if ctx.Err() != nil {
		return errors.New("stopped by Ctrl+C")
	}
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "council-bench-brainstorm: %v\n", err)
		os.Exit(1)
	}
}
