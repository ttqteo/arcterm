package cmd

import (
	"strings"
	"testing"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func hasSub(cmd *cobra.Command, name string) bool {
	for _, c := range cmd.Commands() {
		if c.Name() == name {
			return true
		}
	}
	return false
}

func TestEffortSubcommandsRegistered(t *testing.T) {
	for _, want := range []string{"create", "list", "show", "rename", "project", "ticket", "status", "unarchive", "link", "unlink", "delete", "advance", "reopen", "chunk"} {
		if !hasSub(effortCmd, want) {
			t.Fatalf("`effort %s` subcommand is not registered", want)
		}
	}
	for _, want := range []string{"add", "rename", "move", "remove", "status", "note", "owner", "stage", "due"} {
		if !hasSub(effortChunkCmd, want) {
			t.Fatalf("`effort chunk %s` subcommand is not registered", want)
		}
	}
}

func TestEffortCreateFlags(t *testing.T) {
	f := effortCreateCmd.Flags()
	for _, want := range []string{"project", "ticket", "chunk", "parent", "json"} {
		if f.Lookup(want) == nil {
			t.Fatalf("missing --%s flag", want)
		}
	}
}

func TestEffortListFlags(t *testing.T) {
	f := effortListCmd.Flags()
	// without --archived there is no way to learn an archived effort's oid, and `effort unarchive`
	// needs one.
	for _, want := range []string{"project", "archived", "json"} {
		if f.Lookup(want) == nil {
			t.Fatalf("missing --%s flag", want)
		}
	}
}

func TestEffortChunkAttachDetachRegistered(t *testing.T) {
	for _, want := range []string{"attach", "detach"} {
		if !hasSub(effortChunkCmd, want) {
			t.Fatalf("`effort chunk %s` subcommand is not registered", want)
		}
	}
}

func TestEffortChunkAttachFlags(t *testing.T) {
	f := effortChunkAttachCmd.Flags()
	for _, want := range []string{"run", "agent"} {
		if f.Lookup(want) == nil {
			t.Fatalf("missing --%s flag", want)
		}
	}
}

func TestEffortChunkAddStageFlag(t *testing.T) {
	if effortChunkAddCmd.Flags().Lookup("stage") == nil {
		t.Fatal("missing --stage flag on `effort chunk add`")
	}
}

func TestEffortChunkAddProposedFlag(t *testing.T) {
	if effortChunkAddCmd.Flags().Lookup("proposed") == nil {
		t.Fatal("`effort chunk add` has no --proposed")
	}
}

func TestFormatEffortShowLeavesProposedOutOfProgress(t *testing.T) {
	e := &waveobj.Effort{Title: "T", Status: "active", Chunks: []waveobj.EffortChunk{
		{Label: "A", Status: "done"},
		{Label: "B", Status: "pending"},
		{Label: "P", Status: "proposed"},
	}}
	got := formatEffortShow(e)
	want := "# T (active) — 1/2\n" + // a proposed chunk is a suggestion: not in the total
		"  1. [done] A\n" +
		"  2. [pending] B\n" +
		"  3. [proposed] P\n" // but it still prints, so the plan can be read
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}

func TestFormatEffortShowGroupsConsecutiveStages(t *testing.T) {
	e := &waveobj.Effort{Title: "T", Status: "active", Chunks: []waveobj.EffortChunk{
		{Label: "a", Status: "done", Stage: "Evidence"},
		{Label: "b", Status: "active", Stage: "Evidence"},
		{Label: "c", Status: "pending", Stage: "Rollout"},
		{Label: "d", Status: "pending"},
		{Label: "e", Status: "pending", Stage: "Evidence"},
	}}
	got := formatEffortShow(e)
	want := "# T (active) — 1/5\n" +
		"  -- Evidence --\n" +
		"  1. [done] a\n" +
		"  2. [active] b\n" +
		"  -- Rollout --\n" +
		"  3. [pending] c\n" +
		"  4. [pending] d\n" + // unstaged: no header, and it does not inherit Rollout
		"  -- Evidence --\n" + // a stage that reappears prints again rather than gathering chunks
		"  5. [pending] e\n"
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}

func TestResolveDue(t *testing.T) {
	now := time.Date(2026, 10, 10, 23, 30, 0, 0, time.Local)
	cases := map[string]string{
		"":           "",
		"2026-10-20": "2026-10-20",
		" +0d ":      "2026-10-10",
		"+14d":       "2026-10-24",
		"+30d":       "2026-11-09",
	}
	for in, want := range cases {
		got, err := resolveDue(in, now)
		if err != nil || got != want {
			t.Fatalf("resolveDue(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, bad := range []string{"+d", "+2w", "+-3d", "+3"} {
		if _, err := resolveDue(bad, now); err == nil {
			t.Fatalf("resolveDue(%q) should fail", bad)
		}
	}
}

func TestEffortPinCommandsRegistered(t *testing.T) {
	for _, want := range []string{"pin", "unpin"} {
		if !hasSub(effortCmd, want) {
			t.Fatalf("`effort %s` subcommand is not registered", want)
		}
	}
	if effortPinCmd.Flags().Lookup("replace-oldest") == nil {
		t.Fatal("`effort pin --replace-oldest` is not registered")
	}
}

// at the cap the command must fail (exit nonzero) and name the pin --replace-oldest would drop
func TestEffortPinCapIsAnErrorNamingTheOldest(t *testing.T) {
	_, err := pinResultMessage("effort:t", &wshrpc.CommandEffortPinRtnData{
		CapReached: true, Oldest: &wshrpc.EffortPinRef{OID: "p1", Title: "Old plan"},
	})
	if err == nil {
		t.Fatal("a pin refused at the cap read as success")
	}
	for _, want := range []string{"6 initiatives are pinned", "Old plan", "--replace-oldest"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("cap error %q does not say %q", err, want)
		}
	}
}

func TestEffortPinResultMessages(t *testing.T) {
	msg, err := pinResultMessage("effort:t", &wshrpc.CommandEffortPinRtnData{Pinned: true})
	if err != nil || msg != "effort effort:t is pinned" {
		t.Fatalf("pin: %q, %v", msg, err)
	}
	msg, err = pinResultMessage("effort:t", &wshrpc.CommandEffortPinRtnData{})
	if err != nil || msg != "effort effort:t is not pinned" {
		t.Fatalf("unpin: %q, %v", msg, err)
	}
}

func TestEffortChunkAddDueFlag(t *testing.T) {
	if effortChunkAddCmd.Flags().Lookup("due") == nil {
		t.Fatal("`effort chunk add --due` is not registered")
	}
}

func TestTopicEffortsKeepsOnlyParents(t *testing.T) {
	list := []wshrpc.EffortSummary{
		{ORef: "effort:aaa", Title: "Chat"},
		{ORef: "effort:bbb", Title: "Pin messages in Chat", ParentOID: "aaa"},
		{ORef: "effort:ccc", Title: "Council"},
		{ORef: "effort:ddd", Title: "Council memory: follow-ups", ParentOID: "ccc"},
		{ORef: "effort:eee", Title: "Council memory v2", ParentOID: "ddd"},
		{ORef: "effort:fff", Title: "Loose effort"},
		{ORef: "effort:ggg", Title: "Child of an archived parent", ParentOID: "zzz"},
	}
	got := topicEfforts(list)
	var titles []string
	for _, s := range got {
		titles = append(titles, s.Title)
	}
	if want := "Chat|Council|Council memory: follow-ups"; strings.Join(titles, "|") != want {
		t.Fatalf("topicEfforts = %q, want %q", strings.Join(titles, "|"), want)
	}
}

func TestEffortListHasTopicsFlag(t *testing.T) {
	if effortListCmd.Flags().Lookup("topics") == nil {
		t.Fatal("`effort list` has no --topics flag")
	}
}
