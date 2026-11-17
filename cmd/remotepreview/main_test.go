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
}

func (s *previewSink) Agent(a remotemode.HandedAgent) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.agents = append(s.agents, a)
	return nil
}

func (s *previewSink) Lines(lines []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lines = append(s.lines, lines...)
	return nil
}

func TestPreviewStreamProjectsBoards(t *testing.T) {
	files, err := fs.Glob(testdata, "testdata/*.jsonl")
	if err != nil || len(files) != 4 {
		t.Fatalf("want 4 embedded transcripts, got %v, %v", files, err)
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
			if err := p.stream(ctx, a.Tab, &sink); err != nil {
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
	wantGone := func(what, reason string, err error) {
		t.Helper()
		var gone *remotemode.GoneError
		if !errors.As(err, &gone) || gone.Reason != reason {
			t.Fatalf("%s: want gone %s, got %v", what, reason, err)
		}
	}
	wantGone("stream after take-back", remotemode.EndTaken, p.stream(ctx, chat, &previewSink{}))
	wantGone("act after take-back", remotemode.EndTaken, p.act(ctx, chat, remotemode.AgentAction{Kind: remotemode.ActionSend, Text: "hi"}))
	wantGone("take back twice", remotemode.EndTaken, p.takeBack(ctx, chat))
	wantGone("the exited tab", remotemode.EndExited, p.stream(ctx, exitedTab, &previewSink{}))
	wantGone("a tab never handed over", remotemode.EndTaken, p.act(ctx, "fx-nope", remotemode.AgentAction{Kind: remotemode.ActionStop}))
	if strings.Count(out.String(), "\n") != 3 {
		t.Fatalf("a refused action must record nothing, got:\n%s", out.String())
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
