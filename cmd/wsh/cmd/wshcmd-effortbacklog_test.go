// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import "testing"

func TestEffortBackfillProposedRegistered(t *testing.T) {
	if !hasSub(effortCmd, "backfill-proposed") {
		t.Fatal("`effort backfill-proposed` subcommand is not registered")
	}
	if effortBackfillProposedCmd.Flags().Lookup("json") == nil {
		t.Fatal("`effort backfill-proposed --json` is not registered")
	}
	if err := effortBackfillProposedCmd.Args(effortBackfillProposedCmd, []string{"extra"}); err == nil {
		t.Fatal("`effort backfill-proposed` takes no arguments")
	}
}
