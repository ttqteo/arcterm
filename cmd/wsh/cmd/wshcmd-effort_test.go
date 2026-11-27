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
		"Order of work: 2\n" + // and not in the order of work either
		"  1. [done] A\n" +
		"  2. [pending] B ← next\n" +
		"  3. [proposed] P\n" // but it still prints, so the plan can be read
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}

func TestFormatEffortShowLeavesSkippedOutOfProgress(t *testing.T) {
	e := &waveobj.Effort{Title: "T", Status: "active", Chunks: []waveobj.EffortChunk{
		{Label: "A", Status: "done"},
		{Label: "B", Status: "skipped"},
		{Label: "C", Status: "deferred"},
		{Label: "D", Status: "pending"},
	}}
	got := formatEffortShow(e)
	want := "# T (active) — 1/3\n" + // skipped has left the plan, as the band counts; deferred is still in it
		"Order of work: 4, 3\n" + // pending D opens before deferred C, though C comes first
		"  1. [done] A\n" +
		"  2. [skipped] B\n" +
		"  3. [deferred] C\n" +
		"  4. [pending] D ← next\n"
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}

func TestSummaryProgressTotalCountsLikeShow(t *testing.T) {
	s := wshrpc.EffortSummary{Done: 1, Total: 4, Chunks: []wshrpc.EffortChunkSummary{
		{Label: "A", Status: "done"},
		{Label: "B", Status: "skipped"},
		{Label: "C", Status: "pending"},
		{Label: "D", Status: "active"},
		{Label: "P", Status: "proposed"},
	}}
	if got := summaryProgressTotal(s); got != 3 {
		t.Fatalf("summaryProgressTotal = %d, want 3 (skipped and proposed left out)", got)
	}
	if got := summaryProgressTotal(wshrpc.EffortSummary{Total: 4}); got != 4 {
		t.Fatalf("summaryProgressTotal with no chunks = %d, want the summary's own 4", got)
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
		"Order of work: 2, 3, 4, 5\n" + // under the title, before any stage header
		"  -- Evidence --\n" +
		"  1. [done] a\n" +
		"  2. [active] b ← next\n" +
		"  -- Rollout --\n" +
		"  3. [pending] c\n" +
		"  4. [pending] d\n" + // unstaged: no header, and it does not inherit Rollout
		"  -- Evidence --\n" + // a stage that reappears prints again rather than gathering chunks
		"  5. [pending] e\n"
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}

func TestFormatEffortShowPrintsOpenChunksBase(t *testing.T) {
	const sha = "0123456789abcdef0123456789abcdef01234567"
	e := &waveobj.Effort{Title: "T", Status: "active", Chunks: []waveobj.EffortChunk{
		{Label: "A", Status: "done", BaseCommit: sha}, // settled: nothing left to go stale
		{Label: "B", Status: "pending", BaseCommit: sha},
		{Label: "C", Status: "pending", BaseCommit: sha},
		{Label: "D", Status: "blocked", BaseCommit: sha},
		{Label: "E", Status: "pending"}, // written before bases were kept, unplaceable
		{Label: "F", Status: "pending"}, // written before bases were kept, placed by its add event
	}}
	drifts := map[string]*wshrpc.CommandEffortChunkDriftRtnData{
		"B": {Known: true, Base: sha, Behind: 23, Files: []wshrpc.EffortStaleFile{
			{Mention: "IMAGE.md", Gone: true},
			{Mention: "old.ts", Gone: true, RenamedTo: "src/new.ts"},
			{Mention: "store.ts", Changes: 4},
			{Mention: "a.go", Changes: 1},
		}},
		"C": {Known: true, Base: sha},
		"F": {Known: true, Base: "fedcba9876543210", Inferred: true, Behind: 1},
	}
	drift := func(label string) *wshrpc.CommandEffortChunkDriftRtnData { return drifts[label] }
	got := formatEffortShowWith(e, drift)
	want := "# T (active) — 1/6\n" +
		"Order of work: 2, 3, 5, 6, 4\n" +
		"  1. [done] A\n" +
		"  2. [pending] B (written at 012345678, 23 commits ago; IMAGE.md deleted, old.ts renamed to src/new.ts, store.ts changed 4 times, a.go changed once) ← next\n" +
		"  3. [pending] C (written at 012345678, the code has not moved since)\n" +
		"  4. [blocked] D (written at 012345678)\n" + // drift unknown: the base alone
		"  5. [pending] E\n" +
		"  6. [pending] F (written around fedcba987, 1 commit ago)\n"
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

// show keeps position order and its stage runs; the Order of work line says which open chunk opens when, in numbers,
// and the next chunk carries the mark. The level prints after owner and due, and before the base.
func TestFormatEffortShowPrintsOrderOfWorkNextMarkAndLevel(t *testing.T) {
	const sha = "0123456789abcdef0123456789abcdef01234567"
	e := &waveobj.Effort{Title: "T", Status: "active", Chunks: []waveobj.EffortChunk{
		{Label: "A", Status: "done"},
		{Label: "B", Status: "pending", Priority: "low"},
		{Label: "C", Status: "pending", Priority: "critical", Owner: "x", Due: "2026-12-01", BaseCommit: sha},
		{Label: "D", Status: "blocked", Priority: "high"}, // parked work opens after every pending chunk
		{Label: "E", Status: "pending"},                   // unset ranks as medium
		{Label: "P", Status: "proposed", Priority: "critical"},
	}}
	got := formatEffortShow(e)
	want := "# T (active) — 1/5\n" +
		"Order of work: 3, 5, 2, 4\n" +
		"  1. [done] A\n" +
		"  2. [pending] B (priority low)\n" +
		"  3. [pending] C (owner: x) (due 2026-12-01) (priority critical) (written at 012345678) ← next\n" +
		"  4. [blocked] D (priority high)\n" +
		"  5. [pending] E\n" +
		"  6. [proposed] P (priority critical)\n"
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}

// the active chunk is first in the order of work whatever the others' levels, and it carries the next mark
func TestFormatEffortShowNextIsTheActiveChunk(t *testing.T) {
	e := &waveobj.Effort{Title: "T", Status: "active", Chunks: []waveobj.EffortChunk{
		{Label: "A", Status: "active", Priority: "information"},
		{Label: "B", Status: "pending", Priority: "critical"},
	}}
	got := formatEffortShow(e)
	want := "# T (active) — 0/2\n" +
		"Order of work: 1, 2\n" +
		"  1. [active] A (priority information) ← next\n" +
		"  2. [pending] B (priority critical)\n"
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}

// with no open chunk there is nothing to order and nothing to mark
func TestFormatEffortShowWithNoOpenChunkHasNoOrderOfWork(t *testing.T) {
	e := &waveobj.Effort{Title: "T", Status: "done", Chunks: []waveobj.EffortChunk{
		{Label: "A", Status: "done", Priority: "high"},
		{Label: "B", Status: "skipped"},
		{Label: "P", Status: "proposed", Priority: "critical"},
	}}
	got := formatEffortShow(e)
	want := "# T (done) — 1/1\n" + // the skipped and the proposed chunk are both out of the total
		"  1. [done] A (priority high)\n" +
		"  2. [skipped] B\n" +
		"  3. [proposed] P (priority critical)\n"
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
	if strings.Contains(got, "Order of work") || strings.Contains(got, "← next") {
		t.Fatalf("no chunk is open, yet show prints an order or a next mark:\n%s", got)
	}
}

func TestEffortChunkPriorityRegistered(t *testing.T) {
	if !hasSub(effortChunkCmd, "priority") {
		t.Fatal("`effort chunk priority` subcommand is not registered")
	}
}

// the command takes the effort, the chunk and the level (or "" to clear it): three arguments, so a forgotten level
// is an error rather than a silent clear
func TestEffortChunkPriorityTakesThreeArgs(t *testing.T) {
	if err := effortChunkPriorityCmd.Args(effortChunkPriorityCmd, []string{"e", "1"}); err == nil {
		t.Fatal("`effort chunk priority <effort> <chunk>` with no level should be refused")
	}
	if err := effortChunkPriorityCmd.Args(effortChunkPriorityCmd, []string{"e", "1", "high"}); err != nil {
		t.Fatalf("a full call was refused: %v", err)
	}
	if err := effortChunkPriorityCmd.Args(effortChunkPriorityCmd, []string{"e", "1", ""}); err != nil {
		t.Fatalf("an empty level clears the priority, and was refused: %v", err)
	}
}

// the usage line names every level the server accepts, so an agent reading --help knows the scale
func TestEffortChunkPriorityUseNamesEveryLevel(t *testing.T) {
	for _, use := range []string{effortChunkPriorityCmd.Use, effortChunkAddCmd.Use} {
		for _, level := range waveobj.ChunkPriorities {
			if !strings.Contains(use, level) {
				t.Fatalf("usage %q does not name the level %q", use, level)
			}
		}
	}
}

func TestEffortChunkPriorityFlagOnAdd(t *testing.T) {
	if effortChunkAddCmd.Flags().Lookup("priority") == nil {
		t.Fatal("`effort chunk add --priority` is not registered")
	}
}

// `chunk add --priority high` reaches the op; no flag leaves it unset
func TestEffortChunkPriorityReachesTheAddOp(t *testing.T) {
	now := time.Date(2026, 11, 27, 12, 0, 0, 0, time.Local)
	t.Cleanup(func() { _ = effortChunkAddCmd.Flags().Set("priority", "") })
	op, err := chunkAddOp(effortChunkAddCmd, []string{"e", "Re-measure"}, now)
	if err != nil || op.Op != "addChunk" || op.Label != "Re-measure" || op.Priority != "" {
		t.Fatalf("without the flag: %+v, %v", op, err)
	}
	if err := effortChunkAddCmd.Flags().Set("priority", "high"); err != nil {
		t.Fatal(err)
	}
	op, err = chunkAddOp(effortChunkAddCmd, []string{"e", "Re-measure"}, now)
	if err != nil || op.Priority != "high" {
		t.Fatalf("with --priority high: %+v, %v", op, err)
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

func TestFormatEffortStale(t *testing.T) {
	if got := formatEffortStale(nil); got != "No open chunk names a file that changed since it was written.\n" {
		t.Fatalf("empty: %q", got)
	}
	got := formatEffortStale([]wshrpc.EffortStaleEntry{
		{EffortOID: "e1", Title: "Quiet", Chunks: []wshrpc.EffortChunkStale{}},
		{EffortOID: "e2", Title: "Busy", Chunks: []wshrpc.EffortChunkStale{
			{Chunk: "fix store.ts", Index: 3, Base: "0123456789abcdef", Inferred: true, Landed: 12, Files: []wshrpc.EffortStaleFile{{Mention: "store.ts", Changes: 2}}},
		}},
	})
	want := "# Busy (effort:e2)\n" +
		"  3. fix store.ts\n" +
		"      written around 012345678, 12 landed since: store.ts changed 2 times\n" +
		"\n1 chunks to recheck: rename, note or skip each, or `wsh effort chunk recheck` when it still holds.\n"
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}
