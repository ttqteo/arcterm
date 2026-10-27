// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"testing"
)

// clearSessionDays empties the table: the package's tests share one store.
func clearSessionDays(t *testing.T) {
	t.Helper()
	err := WithTx(context.Background(), func(tx *TxWrap) error {
		tx.Exec(`DELETE FROM db_sessionday`)
		return tx.Err
	})
	if err != nil {
		t.Fatalf("clear: %v", err)
	}
}

func TestUpsertSessionDaysIsIdempotent(t *testing.T) {
	ctx := context.Background()
	clearSessionDays(t)
	row := SessionDay{Day: "2026-10-01", Harness: "claude", Session: "s1", Cwd: "/a/arc", Tokens: 100}
	if err := UpsertSessionDays(ctx, []SessionDay{row}); err != nil {
		t.Fatal(err)
	}
	row.Tokens = 250
	if err := UpsertSessionDays(ctx, []SessionDay{row}); err != nil {
		t.Fatal(err)
	}
	got, err := QuerySessionDays(ctx, "/a/arc", "2026-01-01")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Tokens != 250 {
		t.Fatalf("want one row with the second tokens, got %+v", got)
	}
}

func TestQuerySessionDaysProjectMatch(t *testing.T) {
	ctx := context.Background()
	clearSessionDays(t)
	rows := []SessionDay{
		{Day: "2026-10-01", Harness: "claude", Session: "exact", Cwd: "/a/arcterm", Tokens: 1},
		{Day: "2026-10-01", Harness: "claude", Session: "under", Cwd: "/a/arcterm/.worktrees/x", Tokens: 2},
		{Day: "2026-10-01", Harness: "claude", Session: "sibling", Cwd: "/a/arcterm-old", Tokens: 4},
		{Day: "2026-10-01", Harness: "claude", Session: "parent", Cwd: "/a", Tokens: 8},
		{Day: "2026-10-01", Harness: "claude", Session: "wild", Cwd: "/a/my_proj", Tokens: 16},
		{Day: "2026-10-01", Harness: "claude", Session: "wildmiss", Cwd: "/a/myxproj", Tokens: 32},
		{Day: "2026-09-01", Harness: "claude", Session: "early", Cwd: "/a/arcterm", Tokens: 64},
	}
	if err := UpsertSessionDays(ctx, rows); err != nil {
		t.Fatal(err)
	}
	sessions := func(project, from string) map[string]bool {
		got, err := QuerySessionDays(ctx, project, from)
		if err != nil {
			t.Fatal(err)
		}
		m := map[string]bool{}
		for _, r := range got {
			m[r.Session] = true
		}
		return m
	}
	got := sessions("/a/arcterm", "2026-10-01")
	if len(got) != 2 || !got["exact"] || !got["under"] {
		t.Fatalf("exact and under only (no sibling prefix, no parent, early day cut), got %v", got)
	}
	// case and backslash variants of the project path land on the same key
	for _, p := range []string{"/A/ArcTerm", `\a\arcterm`, "/a/arcterm/", `\A\ARCTERM\`} {
		if got := sessions(p, "2026-10-01"); len(got) != 2 || !got["exact"] || !got["under"] {
			t.Fatalf("variant %q: got %v", p, got)
		}
	}
	// _ is a literal here, not a one-character wildcard
	if got := sessions("/a/my_proj", "2026-10-01"); len(got) != 1 || !got["wild"] {
		t.Fatalf("underscore path: got %v", got)
	}
	if got := sessions("/a/arcterm", "2026-09-01"); !got["early"] {
		t.Fatalf("fromDay is inclusive, got %v", got)
	}
}

func TestSessionDayEdges(t *testing.T) {
	ctx := context.Background()
	clearSessionDays(t)
	first, err := FirstSessionDay(ctx)
	if err != nil || first != "" {
		t.Fatalf("empty table first = %q, %v", first, err)
	}
	last, err := LastSessionDay(ctx)
	if err != nil || last != "" {
		t.Fatalf("empty table last = %q, %v", last, err)
	}
	err = UpsertSessionDays(ctx, []SessionDay{
		{Day: "2026-10-05", Harness: "claude", Session: "a", Cwd: "/x", Tokens: 1},
		{Day: "2026-03-02", Harness: "pi", Session: "b", Cwd: "/y", Tokens: 1},
		{Day: "2026-10-27", Harness: "claude", Session: "c", Cwd: "/z", Tokens: 1},
	})
	if err != nil {
		t.Fatal(err)
	}
	if first, _ = FirstSessionDay(ctx); first != "2026-03-02" {
		t.Fatalf("first = %q", first)
	}
	if last, _ = LastSessionDay(ctx); last != "2026-10-27" {
		t.Fatalf("last = %q", last)
	}
}
