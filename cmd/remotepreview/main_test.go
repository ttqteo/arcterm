// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/remotemode"
)

func TestFixtureMain(t *testing.T) {
	list, err := fixtureList(fixtureMain, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(list.Questions) != 3 {
		t.Fatalf("want 3 questions, got %d", len(list.Questions))
	}

	first := list.Questions[0].Questions
	if len(first) != 1 || first[0].MultiSelect {
		t.Fatalf("first ask: want one single-select question, got %+v", first)
	}
	var recommended, preview bool
	for _, o := range first[0].Options {
		recommended = recommended || strings.HasSuffix(o.Label, "(Recommended)")
		preview = preview || o.Preview != ""
	}
	if !recommended || !preview {
		t.Fatalf("first ask: want a (Recommended) option and a preview, got %+v", first[0].Options)
	}

	second := list.Questions[1].Questions
	if len(second) != 2 || second[0].MultiSelect || !second[1].MultiSelect {
		t.Fatalf("second ask: want two questions, only the second multi-select, got %+v", second)
	}

	if list.Questions[2].ORef != withdrawnORef {
		t.Fatalf("third ask: want the withdrawn one, got %q", list.Questions[2].ORef)
	}
	if len(list.Shown) != 2 {
		t.Fatalf("want 2 held runs, got %d", len(list.Shown))
	}
	for _, s := range list.Shown {
		if s.Kind != jarvis.AttentionRunLandHeld || strings.Count(s.Reason, "\n") < 3 {
			t.Fatalf("held run: want kind %s with a multi-line git message, got %+v", jarvis.AttentionRunLandHeld, s)
		}
	}

	empty, err := fixtureList(fixtureEmpty, time.Now())
	if err != nil || len(empty.Questions) != 0 || len(empty.Shown) != 0 {
		t.Fatalf("empty fixture: got %+v, %v", empty, err)
	}
	if _, err := fixtureList("nope", time.Now()); err == nil {
		t.Fatal("an unknown fixture must fail")
	}
}

func TestFixtureMainAnswer(t *testing.T) {
	list, _ := fixtureList(fixtureMain, time.Now())
	var out bytes.Buffer
	p := &preview{list: list, out: &out}
	ctx := context.Background()
	answers := []baseds.AgentAnswerItem{{SelectedIndexes: []int{0}}}

	withdrawn := list.Questions[2]
	if err := p.answer(ctx, withdrawn.ORef, withdrawn.AskId, answers); !errors.Is(err, remotemode.ErrAskGone) {
		t.Fatalf("withdrawn ask: want ErrAskGone, got %v", err)
	}
	first := list.Questions[0]
	if err := p.answer(ctx, first.ORef, first.AskId, answers); err != nil {
		t.Fatal(err)
	}
	if err := p.answer(ctx, first.ORef, first.AskId, answers); !errors.Is(err, remotemode.ErrAskGone) {
		t.Fatalf("a second answer to the same ask: want ErrAskGone, got %v", err)
	}
	got, _ := p.waiting(ctx)
	if len(got.Questions) != 2 || got.Questions[0].ORef == first.ORef {
		t.Fatalf("the answered question must leave the list, got %+v", got.Questions)
	}
	want := `REMOTEPREVIEW answer {"answers":[{"selectedindexes":[0]}],"askid":"` + first.AskId + `","oref":"` + first.ORef + `"}` + "\n"
	if out.String() != want {
		t.Fatalf("recorded:\n%s\nwant:\n%s", out.String(), want)
	}
}

func TestFixtureHanded(t *testing.T) {
	now := time.Now()
	type row struct{ Name, Runtime, State, Project, Line string }
	rows := func(fixture string) []row {
		var out []row
		for _, a := range fixtureHanded(fixture, now) {
			if a.Tab == "" || a.Since <= 0 || a.Since > now.UnixMilli() {
				t.Fatalf("%s: want a tab and a past since, got %+v", fixture, a)
			}
			out = append(out, row{a.Name, a.Runtime, a.State, a.Project, a.Line})
		}
		return out
	}
	wantMain := []row{
		{"siem-deploy", "claude", remotemode.PhonePermission, "siem", "Wants to run: ssh deploy@siem-236 'sudo systemctl restart ingest'"},
		{"phone-chat", "claude", remotemode.PhoneWorking, "waveterm", "Running node scripts/cdp/verify.mjs remote-phone"},
		{"vault-sync", "pi", remotemode.PhoneIdle, "arc_vault", "Moved the 3 stale notes to archive/ and pushed. Anything else?"},
	}
	if got := rows(fixtureMain); !slices.Equal(got, wantMain) {
		t.Fatalf("main hand-overs:\n%+v\nwant:\n%+v", got, wantMain)
	}
	input := rows(fixtureInput)
	if len(input) != 1 || input[0].Name != "docs-worker" || input[0].Runtime != "claude" || input[0].State != remotemode.PhoneInput {
		t.Fatalf("input fixture: want the one docs-worker hand-over needing input, got %+v", input)
	}
	if got := rows(fixtureEmpty); len(got) != 0 {
		t.Fatalf("empty fixture: want no hand-overs, got %+v", got)
	}
	if list, err := fixtureList(fixtureInput, now); err != nil || len(list.Questions) != 0 || len(list.Shown) != 0 {
		t.Fatalf("input fixture: want an empty waiting list, got %+v, %v", list, err)
	}
}

// previewSink records what a stream sent.
type previewSink struct {
	mu     sync.Mutex
	agents []remotemode.HandedAgent
	lines  []string
	chunks []remotemode.TranscriptChunk
}

func (s *previewSink) Agent(a remotemode.HandedAgent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.agents = append(s.agents, a)
	return nil
}

func (s *previewSink) Lines(c remotemode.TranscriptChunk) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lines = append(s.lines, c.Lines...)
	s.chunks = append(s.chunks, c)
	return nil
}

func TestPreviewStreamProjectsBoards(t *testing.T) {
	files, err := fs.Glob(testdata, "testdata/*.jsonl")
	if err != nil || len(files) != 5 {
		t.Fatalf("want 5 embedded transcripts, got %v, %v", files, err)
	}
	for _, f := range files {
		lines := previewLines(t, f)
		for i, line := range lines {
			var rec map[string]any
			if err := json.Unmarshal([]byte(line), &rec); err != nil {
				t.Fatalf("%s line %d: %v", f, i+1, err)
			}
		}
	}

	// siem-deploy waits on its permission menu: its last record is a Bash call nothing answered
	siem := previewLines(t, "testdata/siem-deploy.jsonl")
	var last struct {
		Message struct {
			Content []struct{ Type, Id, Name string }
		}
	}
	if err := json.Unmarshal([]byte(siem[len(siem)-1]), &last); err != nil {
		t.Fatal(err)
	}
	if c := last.Message.Content; len(c) != 1 || c[0].Type != "tool_use" || c[0].Name != "Bash" {
		t.Fatalf("siem-deploy: want a closing Bash tool_use, got %+v", last.Message.Content)
	}
	for _, line := range siem {
		if strings.Contains(line, `"tool_use_id":"`+last.Message.Content[0].Id+`"`) {
			t.Fatal("siem-deploy: the closing Bash call must have no tool_result")
		}
	}

	// a stream sends the agent, then its whole transcript; a cancelled ctx ends it without a reason
	for _, fixture := range []string{fixtureMain, fixtureInput} {
		p, err := newPreview(fixture, time.Now(), io.Discard)
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		for _, a := range p.handed {
			var sink previewSink
			if err := p.stream(ctx, a.Tab, -1, &sink); err != nil {
				t.Fatalf("stream %s: %v", a.Tab, err)
			}
			if len(sink.agents) != 1 || sink.agents[0] != a {
				t.Fatalf("stream %s: want the agent once, got %+v", a.Tab, sink.agents)
			}
			if want := previewLines(t, "testdata/"+a.Name+".jsonl"); !slices.Equal(sink.lines, want) {
				t.Fatalf("stream %s: want the %d transcript lines, got %d", a.Tab, len(want), len(sink.lines))
			}
		}
	}
}

func TestPreviewRecordsInputAndTakeBack(t *testing.T) {
	var out bytes.Buffer
	p, err := newPreview(fixtureMain, time.Now(), &out)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	siem, chat := p.handed[0].Tab, p.handed[1].Tab

	if err := p.act(ctx, siem, remotemode.AgentAction{Kind: remotemode.ActionDeny, Text: "restart it after 18:00"}); err != nil {
		t.Fatal(err)
	}
	if err := p.act(ctx, chat, remotemode.AgentAction{Kind: remotemode.ActionStop}); err != nil {
		t.Fatal(err)
	}
	if err := p.takeBack(ctx, chat); err != nil {
		t.Fatal(err)
	}
	want := `REMOTEPREVIEW input {"tab":"` + siem + `","action":"deny","text":"restart it after 18:00"}` + "\n" +
		`REMOTEPREVIEW input {"tab":"` + chat + `","action":"stop","text":""}` + "\n" +
		`REMOTEPREVIEW takeback {"tab":"` + chat + `"}` + "\n"
	if out.String() != want {
		t.Fatalf("recorded:\n%s\nwant:\n%s", out.String(), want)
	}

	handed, err := p.handedList(ctx)
	if err != nil || len(handed) != 2 || slices.ContainsFunc(handed, func(a remotemode.HandedAgent) bool { return a.Tab == chat }) {
		t.Fatalf("a taken-back tab must leave handed, got %+v, %v", handed, err)
	}
	if row := listedRow(t, p, chat); row.Handed {
		t.Fatalf("a taken-back agent is listed again, not as handed: %+v", row)
	}
	wantGone := func(what, reason string, err error) {
		t.Helper()
		var gone *remotemode.GoneError
		if !errors.As(err, &gone) || gone.Reason != reason {
			t.Fatalf("%s: want gone %s, got %v", what, reason, err)
		}
	}
	wantGone("stream after take-back", remotemode.EndTaken, p.stream(ctx, chat, -1, &previewSink{}))
	wantGone("act after take-back", remotemode.EndTaken, p.act(ctx, chat, remotemode.AgentAction{Kind: remotemode.ActionSend, Text: "hi"}))
	wantGone("take back twice", remotemode.EndTaken, p.takeBack(ctx, chat))
	wantGone("the exited tab", remotemode.EndExited, p.stream(ctx, exitedTab, -1, &previewSink{}))
	wantGone("a tab never handed over", remotemode.EndTaken, p.act(ctx, "fx-nope", remotemode.AgentAction{Kind: remotemode.ActionStop}))
	if strings.Count(out.String(), "\n") != 3 {
		t.Fatalf("a refused action must record nothing, got:\n%s", out.String())
	}
}

const (
	tabLabNotes  = "fx-lab-notes"
	tabBench     = "fx-bench-runner"
	tabCodex     = "fx-codex-scan"
	tabRefused   = "fx-refused"
	tabSiem      = "fx-siem-deploy"
	labNotesLine = "Rewrote the related-work paragraph and added the two missing citations."
)

func newTestPreview(t *testing.T, fixture string) (*preview, *bytes.Buffer) {
	t.Helper()
	var out bytes.Buffer
	p, err := newPreview(fixture, time.Now(), &out)
	if err != nil {
		t.Fatal(err)
	}
	return p, &out
}

// listedRow is the roster row for tab as the Agents list serves it now.
func listedRow(t *testing.T, p *preview, tab string) remotemode.ListedAgent {
	t.Helper()
	agents, _, err := p.agentsList(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	i := slices.IndexFunc(agents, func(a remotemode.ListedAgent) bool { return a.Tab == tab })
	if i < 0 {
		t.Fatalf("no roster row for %s in %+v", tab, agents)
	}
	return agents[i]
}

func handedTabs(t *testing.T, p *preview) []string {
	t.Helper()
	handed, err := p.handedList(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var tabs []string
	for _, a := range handed {
		tabs = append(tabs, a.Tab)
	}
	return tabs
}

func TestFixtureAgents(t *testing.T) {
	now := time.Now()
	type row struct {
		Tab, Name, Project, Runtime, State string
		Handed, Takeable                   bool
	}
	var got []row
	for _, a := range fixtureAgents(fixtureMain, now) {
		if a.Since < 0 || a.Since > now.UnixMilli() || (a.State == remotemode.PhoneWorking) != (a.Since == 0) {
			t.Fatalf("%s: want a past since, 0 only while working, got %+v", a.Tab, a)
		}
		got = append(got, row{a.Tab, a.Name, a.Project, a.Runtime, a.State, a.Handed, a.Takeable})
	}
	want := []row{
		{"fx-siem-deploy", "siem-deploy", "siem", "claude", remotemode.PhonePermission, true, true},
		{"fx-bench-runner", "bench-runner", "waveterm", "pi", remotemode.PhoneWorking, false, true},
		{"fx-phone-chat", "phone-chat", "waveterm", "claude", remotemode.PhoneWorking, true, true},
		{"fx-lab-notes", "lab-notes", "mit-thesis", "claude", remotemode.PhoneIdle, false, true},
		{"fx-codex-scan", "codex-scan", "waveterm", "codex", remotemode.PhoneIdle, false, false},
		{"fx-refused", "refused", "waveterm", "claude", remotemode.PhoneIdle, false, true},
		{"fx-vault-sync", "vault-sync", "arc_vault", "pi", remotemode.PhoneIdle, true, true},
	}
	if !slices.Equal(got, want) {
		t.Fatalf("main roster:\n%+v\nwant:\n%+v", got, want)
	}
	// the hand-overs are the roster rows with handed set, and the rows the page draws carry the same line
	handed := fixtureHanded(fixtureMain, now)
	for _, h := range handed {
		var listed remotemode.ListedAgent
		for _, a := range fixtureAgents(fixtureMain, now) {
			if a.Tab == h.Tab {
				listed = a
			}
		}
		if !listed.Handed || listed.Line != h.Line || listed.State != h.State || listed.Runtime != h.Runtime {
			t.Fatalf("%s: the roster row must match its hand-over, got %+v want %+v", h.Tab, listed, h)
		}
	}
	for _, fixture := range []string{fixtureEmpty, fixtureInput} {
		if a := fixtureAgents(fixture, now); len(a) != 0 {
			t.Fatalf("%s: want no roster, got %+v", fixture, a)
		}
		if r := fixtureRuns(fixture, now); len(r) != 0 {
			t.Fatalf("%s: want no runs, got %+v", fixture, r)
		}
	}
}

func TestFixtureRuns(t *testing.T) {
	runs := fixtureRuns(fixtureMain, time.Now())
	if len(runs) != 1 {
		t.Fatalf("want one run, got %+v", runs)
	}
	run := runs[0]
	if run.Key != "dag-fx1" || run.Name != "Phone agent list" || !run.NeedsYou || len(run.Workers) != 3 {
		t.Fatalf("run: want dag-fx1 \"Phone agent list\" needing you with 3 workers, got %+v", run)
	}
	states := map[string]int{}
	for _, w := range run.Workers {
		if w.Tab == "" || w.Label == "" || w.Line == "" {
			t.Fatalf("worker: want a tab, a label and a line, got %+v", w)
		}
		states[w.State]++
	}
	if states[remotemode.PhoneWorking] != 2 || states[remotemode.PhonePermission] != 1 || len(states) != 2 {
		t.Fatalf("workers: want two working and one permission, got %v", states)
	}
}

// the idle row's line is the first sentence of the transcript's last reply, as the real list reads it
func TestFixtureLabNotesLine(t *testing.T) {
	lines := previewLines(t, "testdata/lab-notes.jsonl")
	var last string
	for _, line := range lines {
		var rec struct {
			Type    string
			Message struct{ Content json.RawMessage }
		}
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatal(err)
		}
		var blocks []struct{ Type, Text string }
		if rec.Type == "assistant" && json.Unmarshal(rec.Message.Content, &blocks) == nil {
			for _, b := range blocks {
				if b.Type == "text" {
					last = b.Text
				}
			}
		}
	}
	if !strings.HasPrefix(last, labNotesLine+" ") {
		t.Fatalf("the last reply %q must open with the row's line %q and go on", last, labNotesLine)
	}
	if row := listedRow(t, mustPreview(t, fixtureMain), tabLabNotes); row.Line != labNotesLine {
		t.Fatalf("lab-notes line: want %q, got %q", labNotesLine, row.Line)
	}
	if len(lines) <= 200 {
		t.Fatalf("lab-notes must outrun the 200-line backlog, got %d lines", len(lines))
	}
}

func mustPreview(t *testing.T, fixture string) *preview {
	t.Helper()
	p, _ := newTestPreview(t, fixture)
	return p
}

func TestPreviewTakeAndRelease(t *testing.T) {
	p, out := newTestPreview(t, fixtureMain)
	ctx := context.Background()
	wantTabs := func(what string, want ...string) {
		t.Helper()
		if got := handedTabs(t, p); !slices.Equal(got, want) {
			t.Fatalf("%s: handed over %v, want %v", what, got, want)
		}
	}
	desk := []string{tabSiem, "fx-phone-chat", "fx-vault-sync"}

	// a take moves the agent into the hand-overs, with the roster row's state and line
	if err := p.take(ctx, tabLabNotes); err != nil {
		t.Fatal(err)
	}
	wantTabs("after take", append(slices.Clone(desk), tabLabNotes)...)
	handed, _ := p.handedList(ctx)
	if got := handed[3]; got.Name != "lab-notes" || got.Runtime != "claude" || got.State != remotemode.PhoneIdle || got.Line != labNotesLine || got.Since <= 0 {
		t.Fatalf("the taken agent: got %+v", got)
	}
	if !listedRow(t, p, tabLabNotes).Handed {
		t.Fatal("a taken agent's roster row must read handed")
	}
	// taking it again just opens it
	if err := p.take(ctx, tabLabNotes); err != nil {
		t.Fatal(err)
	}
	wantTabs("after a second take", append(slices.Clone(desk), tabLabNotes)...)

	// release gives back a take nothing was acted on
	if err := p.release(ctx, tabLabNotes); err != nil {
		t.Fatal(err)
	}
	wantTabs("after release", desk...)
	if listedRow(t, p, tabLabNotes).Handed {
		t.Fatal("a released agent is listed again")
	}
	// releasing what is not handed over is fine
	if err := p.release(ctx, tabLabNotes); err != nil {
		t.Fatalf("release of a tab not handed over: %v", err)
	}

	// an acted-on take stays, until Take back
	if err := p.take(ctx, tabBench); err != nil {
		t.Fatal(err)
	}
	if err := p.act(ctx, tabBench, remotemode.AgentAction{Kind: remotemode.ActionSend, Text: "go"}); err != nil {
		t.Fatal(err)
	}
	if err := p.release(ctx, tabBench); err != nil {
		t.Fatal(err)
	}
	wantTabs("after an acted take's release", append(slices.Clone(desk), tabBench)...)
	if err := p.takeBack(ctx, tabBench); err != nil {
		t.Fatal(err)
	}
	wantTabs("after take back", desk...)
	if listedRow(t, p, tabBench).Handed {
		t.Fatal("a taken-back agent is listed again")
	}
	// a hand-over made at the desk is never released from the phone
	if err := p.release(ctx, tabSiem); err != nil {
		t.Fatal(err)
	}
	wantTabs("after releasing a desk hand-over", desk...)

	want := `REMOTEPREVIEW take {"tab":"` + tabLabNotes + `"}` + "\n" +
		`REMOTEPREVIEW release {"tab":"` + tabLabNotes + `"}` + "\n" +
		`REMOTEPREVIEW take {"tab":"` + tabBench + `"}` + "\n" +
		`REMOTEPREVIEW input {"tab":"` + tabBench + `","action":"send","text":"go"}` + "\n" +
		`REMOTEPREVIEW takeback {"tab":"` + tabBench + `"}` + "\n"
	if out.String() != want {
		t.Fatalf("recorded:\n%s\nwant:\n%s", out.String(), want)
	}
}

func TestPreviewTakeRefusals(t *testing.T) {
	p, out := newTestPreview(t, fixtureMain)
	ctx := context.Background()
	for _, c := range []struct{ tab, reason string }{
		{tabRefused, "exited to its shell"},
		{tabCodex, "only claude and pi agents"},
		{"fx-nope", "its tab is gone"},
	} {
		err := p.take(ctx, c.tab)
		if !errors.Is(err, remotemode.ErrRefused) || !strings.Contains(err.Error(), c.reason) {
			t.Fatalf("take %s: want a refusal naming %q, got %v", c.tab, c.reason, err)
		}
	}
	if got := handedTabs(t, p); len(got) != 3 {
		t.Fatalf("a refused take hands nothing over, got %v", got)
	}
	if listedRow(t, p, tabRefused).Handed || !listedRow(t, p, tabRefused).Takeable {
		t.Fatalf("the refused row stays listed and takeable: %+v", listedRow(t, p, tabRefused))
	}
	if out.Len() != 0 {
		t.Fatalf("a refused take must record nothing, got:\n%s", out.String())
	}
	// the page reads the reason without the sentinel's own prefix
	if got := err2reason(p.take(ctx, tabRefused)); !strings.HasPrefix(got, `"refused" (tab fx-refused) has exited`) {
		t.Fatalf("reason: got %q", got)
	}
}

// err2reason is the text the handler sends as a refusal's reason.
func err2reason(err error) string {
	_, after, _ := strings.Cut(err.Error(), remotemode.ErrRefused.Error()+": ")
	return after
}

// offsetAt is the byte offset of line n when lines are joined by newlines, each ending in one.
func offsetAt(lines []string, n int) int64 {
	var off int64
	for _, l := range lines[:n] {
		off += int64(len(l)) + 1
	}
	return off
}

func TestPreviewTranscriptPaging(t *testing.T) {
	p, out := newTestPreview(t, fixtureMain)
	ctx := context.Background()
	all := p.transcripts[tabLabNotes]
	if len(all) != 260 {
		t.Fatalf("want the 260-line lab-notes transcript, got %d lines", len(all))
	}
	wantGone := func(what string, err error) {
		t.Helper()
		var gone *remotemode.GoneError
		if !errors.As(err, &gone) || gone.Reason != remotemode.EndTaken {
			t.Fatalf("%s: want gone %s, got %v", what, remotemode.EndTaken, err)
		}
	}
	// pages and the stream are for a handed-over agent
	_, err := p.transcript(ctx, tabLabNotes, offsetAt(all, 60))
	wantGone("a page of an agent never taken", err)
	if err := p.take(ctx, tabLabNotes); err != nil {
		t.Fatal(err)
	}
	out.Reset()

	streamFrom := func(from int64) []remotemode.TranscriptChunk {
		t.Helper()
		var sink previewSink
		cctx, cancel := context.WithCancel(ctx)
		cancel()
		if err := p.stream(cctx, tabLabNotes, from, &sink); err != nil {
			t.Fatal(err)
		}
		if len(sink.agents) != 1 || len(sink.chunks) != 1 {
			t.Fatalf("stream from %d: want the agent and one backlog chunk, got %d and %d", from, len(sink.agents), len(sink.chunks))
		}
		return sink.chunks
	}

	// the first connection's backlog is the last 200 lines: the first messages are out of it
	first := streamFrom(-1)[0]
	if !first.Backlog || len(first.Lines) != 200 || !slices.Equal(first.Lines, all[60:]) {
		t.Fatalf("backlog: want the last 200 lines, got %d (backlog %v)", len(first.Lines), first.Backlog)
	}
	if first.Cursor != offsetAt(all, 60) || first.End != offsetAt(all, 260) {
		t.Fatalf("backlog offsets: cursor %d end %d, want %d and %d", first.Cursor, first.End, offsetAt(all, 60), offsetAt(all, 260))
	}
	if slices.Contains(first.Lines, all[0]) {
		t.Fatal("the transcript's first message must be outside the backlog")
	}

	// the page before the backlog's cursor holds the rest and reaches cursor 0
	page, err := p.transcript(ctx, tabLabNotes, first.Cursor)
	if err != nil {
		t.Fatal(err)
	}
	if page.Cursor != 0 || !slices.Equal(page.Lines, all[:60]) {
		t.Fatalf("page before the backlog: cursor %d with %d lines, want cursor 0 and the first 60", page.Cursor, len(page.Lines))
	}
	// a page is at most 200 lines, ending at the offset asked for, and a mid-file one has a cursor past 0
	page, err = p.transcript(ctx, tabLabNotes, first.End)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Lines) != 200 || page.Cursor != first.Cursor {
		t.Fatalf("page before the end: %d lines, cursor %d, want 200 and %d", len(page.Lines), page.Cursor, first.Cursor)
	}
	page, err = p.transcript(ctx, tabLabNotes, offsetAt(all, 10))
	if err != nil || page.Cursor != 0 || len(page.Lines) != 10 {
		t.Fatalf("page before line 10: %+v, %v", page, err)
	}
	// nothing is before the start
	page, err = p.transcript(ctx, tabLabNotes, 0)
	if err != nil || page.Cursor != 0 || len(page.Lines) != 0 {
		t.Fatalf("page before 0: %+v, %v", page, err)
	}

	// a reconnect resumes at its last id: the lines from there on, none twice
	resumed := streamFrom(offsetAt(all, 255))[0]
	if !resumed.Backlog || !slices.Equal(resumed.Lines, all[255:]) || resumed.Cursor != offsetAt(all, 255) || resumed.End != first.End {
		t.Fatalf("resumed backlog: %+v", resumed)
	}
	caughtUp := streamFrom(first.End)[0]
	if len(caughtUp.Lines) != 0 || caughtUp.End != first.End || !caughtUp.Backlog {
		t.Fatalf("a reconnect with nothing new: want an empty backlog ending at %d, got %+v", first.End, caughtUp)
	}

	// the stream's fixtures that fit the backlog are sent whole, with their offsets
	short := mustPreview(t, fixtureMain)
	var sink previewSink
	cctx, cancel := context.WithCancel(ctx)
	cancel()
	if err := short.stream(cctx, "fx-phone-chat", -1, &sink); err != nil {
		t.Fatal(err)
	}
	chat := short.transcripts["fx-phone-chat"]
	if c := sink.chunks[0]; c.Cursor != 0 || c.End != offsetAt(chat, len(chat)) || len(c.Lines) != len(chat) {
		t.Fatalf("a short transcript: cursor %d end %d with %d lines, want 0, %d and %d", c.Cursor, c.End, len(c.Lines), offsetAt(chat, len(chat)), len(chat))
	}

	wantOut := `REMOTEPREVIEW transcript {"tab":"` + tabLabNotes + `","before":` + strconv.FormatInt(first.Cursor, 10) + `}` + "\n" +
		`REMOTEPREVIEW transcript {"tab":"` + tabLabNotes + `","before":` + strconv.FormatInt(first.End, 10) + `}` + "\n" +
		`REMOTEPREVIEW transcript {"tab":"` + tabLabNotes + `","before":` + strconv.FormatInt(offsetAt(all, 10), 10) + `}` + "\n" +
		`REMOTEPREVIEW transcript {"tab":"` + tabLabNotes + `","before":0}` + "\n"
	if out.String() != wantOut {
		t.Fatalf("recorded:\n%s\nwant:\n%s", out.String(), wantOut)
	}
}

func TestPreviewPCControls(t *testing.T) {
	p, out := newTestPreview(t, fixtureEmpty)
	ctx := context.Background()
	if err := p.pcLock(ctx); err != nil {
		t.Fatal(err)
	}
	for _, step := range []string{"down", "up"} {
		if err := p.pcVolume(ctx, step); err != nil {
			t.Fatalf("volume %s: %v", step, err)
		}
	}
	if err := p.pcVolume(ctx, "mute"); err == nil || err.Error() == "" {
		t.Fatalf("mute must be refused with a reason, got %v", err)
	}
	want := `REMOTEPREVIEW pclock {}` + "\n" +
		`REMOTEPREVIEW pcvolume {"step":"down"}` + "\n" +
		`REMOTEPREVIEW pcvolume {"step":"up"}` + "\n"
	if out.String() != want {
		t.Fatalf("recorded:\n%s\nwant:\n%s", out.String(), want)
	}
}

// servePreview serves a fixture on loopback and gives its base url.
func servePreview(t *testing.T, fixture string) (string, *preview, *bytes.Buffer) {
	t.Helper()
	vapid, err := vapidPublic()
	if err != nil {
		t.Fatal(err)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	base := "http://" + ln.Addr().String()
	p, out := newTestPreview(t, fixture)
	srv := &http.Server{Handler: p.handler(base, vapid)}
	go srv.Serve(ln)
	t.Cleanup(func() { srv.Close() })
	return base, p, out
}

func previewPost(t *testing.T, base, path, body string) (int, string) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, base+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", base)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	data, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return res.StatusCode, string(data)
}

func previewWaiting(t *testing.T, base string) remotemode.WaitingList {
	t.Helper()
	var list remotemode.WaitingList
	if err := json.Unmarshal([]byte(previewGet(t, base+"/api/waiting")), &list); err != nil {
		t.Fatal(err)
	}
	return list
}

func TestPreviewRoutes(t *testing.T) {
	// every fixture reaches the computer controls, so pc is true on the empty page too
	for _, fixture := range []string{fixtureMain, fixtureEmpty, fixtureInput} {
		base, _, _ := servePreview(t, fixture)
		list := previewWaiting(t, base)
		if !list.PC {
			t.Fatalf("%s: pc must be true", fixture)
		}
		if fixture != fixtureMain && (len(list.Agents) != 0 || len(list.Runs) != 0) {
			t.Fatalf("%s: want no agents and no runs, got %+v, %+v", fixture, list.Agents, list.Runs)
		}
	}

	base, _, out := servePreview(t, fixtureMain)
	list := previewWaiting(t, base)
	if len(list.Agents) != 7 || len(list.Runs) != 1 || len(list.Handed) != 3 {
		t.Fatalf("main: want 7 agents, 1 run and 3 hand-overs, got %d, %d, %d", len(list.Agents), len(list.Runs), len(list.Handed))
	}
	if list.Runs[0].Name != "Phone agent list" || len(list.Runs[0].Workers) != 3 {
		t.Fatalf("main run: %+v", list.Runs[0])
	}
	handedCount := func() (n int) {
		for _, a := range previewWaiting(t, base).Agents {
			if a.Handed {
				n++
			}
		}
		return n
	}

	// take, then release
	if code, body := previewPost(t, base, "/api/agents/"+tabLabNotes+"/hand", "{}"); code != http.StatusOK {
		t.Fatalf("take: %d %s", code, body)
	}
	if got := previewWaiting(t, base); len(got.Handed) != 4 || handedCount() != 4 {
		t.Fatalf("after the take: %d hand-overs, %d handed rows", len(got.Handed), handedCount())
	}
	if code, body := previewPost(t, base, "/api/agents/"+tabLabNotes+"/release", "{}"); code != http.StatusOK {
		t.Fatalf("release: %d %s", code, body)
	}
	if got := previewWaiting(t, base); len(got.Handed) != 3 || handedCount() != 3 {
		t.Fatalf("after the release: %d hand-overs, %d handed rows", len(got.Handed), handedCount())
	}

	// a refused take is a 409 with the reason
	code, body := previewPost(t, base, "/api/agents/"+tabRefused+"/hand", "{}")
	var refusal struct{ Error, Reason string }
	if err := json.Unmarshal([]byte(body), &refusal); err != nil || code != http.StatusConflict || refusal.Error != "refused" || !strings.Contains(refusal.Reason, "exited to its shell") {
		t.Fatalf("refused take: %d %s", code, body)
	}

	// a page of older lines, from the backlog's cursor
	if code, body := previewPost(t, base, "/api/agents/"+tabLabNotes+"/hand", "{}"); code != http.StatusOK {
		t.Fatalf("take: %d %s", code, body)
	}
	all := mustPreview(t, fixtureMain).transcripts[tabLabNotes]
	var page struct {
		Lines  []string
		Cursor int64
	}
	if err := json.Unmarshal([]byte(previewGet(t, base+"/api/agents/"+tabLabNotes+"/transcript?before="+strconv.FormatInt(offsetAt(all, 60), 10))), &page); err != nil {
		t.Fatal(err)
	}
	if page.Cursor != 0 || len(page.Lines) != 60 {
		t.Fatalf("transcript page: cursor %d with %d lines", page.Cursor, len(page.Lines))
	}

	// the computer controls: mute is refused with a reason the page can show
	if code, body := previewPost(t, base, "/api/pc/lock", "{}"); code != http.StatusOK {
		t.Fatalf("lock: %d %s", code, body)
	}
	if code, body := previewPost(t, base, "/api/pc/volume", `{"step":"up"}`); code != http.StatusOK {
		t.Fatalf("volume up: %d %s", code, body)
	}
	code, body = previewPost(t, base, "/api/pc/volume", `{"step":"mute"}`)
	var failure struct{ Error string }
	if err := json.Unmarshal([]byte(body), &failure); err != nil || code != http.StatusInternalServerError || failure.Error == "" {
		t.Fatalf("mute: %d %s", code, body)
	}
	for _, what := range []string{"take", "release", "transcript", "pclock", "pcvolume"} {
		if !strings.Contains(out.String(), linePrefix+" "+what+" ") {
			t.Fatalf("no %s record in:\n%s", what, out.String())
		}
	}
}

func previewLines(t *testing.T, name string) []string {
	t.Helper()
	data, err := testdata.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	lines := transcriptLines(data)
	if len(lines) == 0 {
		t.Fatalf("%s is empty", name)
	}
	return lines
}

func TestPreviewServes(t *testing.T) {
	vapid, err := vapidPublic()
	if err != nil {
		t.Fatal(err)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	if ip := ln.Addr().(*net.TCPAddr).IP; !ip.IsLoopback() {
		t.Fatalf("want a loopback listener, got %s", ip)
	}
	base := "http://" + ln.Addr().String()
	p, err := newPreview(fixtureMain, time.Now(), io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: p.handler(base, vapid)}
	go srv.Serve(ln)
	t.Cleanup(func() { srv.Close() })

	page := previewGet(t, base+"/")
	if !strings.Contains(page, "phone.js") {
		t.Fatalf("GET /: want the phone page, got %q", page)
	}
	var got remotemode.WaitingList
	if err := json.Unmarshal([]byte(previewGet(t, base+"/api/waiting")), &got); err != nil {
		t.Fatal(err)
	}
	if got.VapidPublic != vapid || len(got.Questions) != 3 || len(got.Shown) != 2 || len(got.Handed) != 3 {
		t.Fatalf("GET /api/waiting: got vapid %q, %d questions, %d shown, %d handed",
			got.VapidPublic, len(got.Questions), len(got.Shown), len(got.Handed))
	}
}

func previewGet(t *testing.T, url string) string {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET %s: %d %s", url, res.StatusCode, body)
	}
	return string(body)
}
