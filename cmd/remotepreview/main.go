// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Command remotepreview serves the phone page on loopback with a fixture waiting list and an Access check
// that lets everything through, for the remote-phone CDP scenario and for looking at the page by hand.
// A dev tool only: neither wavesrv nor build:backend builds it.
//
// It prints "REMOTEPREVIEW <url>" once it listens, then one "REMOTEPREVIEW <what> <json>" line for each
// answer, subscribe, off, agent input, take-back, take, release, transcript page, lock and volume press the
// page sends, so a driver can check what reached it. A request the preview refuses records nothing, and a
// release records only when it ended a take.
package main

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"slices"
	"sort"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/remotemode"
	"github.com/wavetermdev/waveterm/pkg/remotemode/web"
)

const (
	linePrefix   = "REMOTEPREVIEW"
	fixtureMain  = "main"
	fixtureEmpty = "empty"
	// one hand-over that needs input at the desk, and nothing else
	fixtureInput = "input"
	// the question whose Answer always reports gone, as if answered at the desk meanwhile
	withdrawnORef = "block:fx-remote-withdrawn"
	// the tab whose stream always reports the agent exited, so the page's exited case can be opened directly
	exitedTab = "fx-exited"
	// the listed agent the fake Take always refuses, as if it exited to its shell since the page last polled
	refusedTab    = "fx-refused"
	refusedReason = `"refused" (tab fx-refused) has exited to its shell: claude is no longer running there`
	// the volume button the fake PCVolume refuses, so the page's error line can be shown
	muteRefusal = "This computer has no mute key"
	// what a transcript's first connection sends as its backlog, and the most a page of older lines holds:
	// the real stream and page are the same size (pkg/wshrpc/wshserver, pkg/remotemode)
	previewBacklogLines = 200
	previewPageLines    = 200
)

// each hand-over's recorded transcript, testdata/<agent name>.jsonl
//
//go:embed testdata/*.jsonl
var testdata embed.FS

func main() {
	fixture := flag.String("fixture", fixtureMain, "fixture to serve: main, empty or input")
	// a restart must keep the port: the page's origin, its service worker and its last-reached time hang on it
	port := flag.Int("port", 0, "loopback port to listen on; 0 picks a free one")
	flag.Parse()
	p, err := newPreview(*fixture, time.Now(), os.Stdout)
	if err != nil {
		log.Fatal(err)
	}
	vapid, err := vapidPublic()
	if err != nil {
		log.Fatal(err)
	}
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		log.Fatal(err)
	}
	origin := "http://" + ln.Addr().String()
	fmt.Printf("%s %s/\n", linePrefix, origin)
	log.Fatal(http.Serve(ln, p.handler(origin, vapid)))
}

// preview is the fixture state behind the handler: the list shrinks as questions are answered, a taken
// agent moves into the hand-overs, and a taken-back or released one leaves them.
type preview struct {
	mu     sync.Mutex
	list   remotemode.WaitingList
	handed []remotemode.HandedAgent
	// agents is the roster the Agents list serves, hand-overs included (their handed flag follows handed)
	agents []remotemode.ListedAgent
	runs   []remotemode.ListedRun
	// taken holds the tabs the fake Take handed over, each with whether the owner acted on it since: a
	// release ends only a take nothing was done on, and never one of the fixture's own hand-overs, which
	// stand for ones made at the desk
	taken map[string]bool
	// transcripts holds each recorded tab's lines: every hand-over's, and a listed agent's when it has a file
	transcripts map[string][]string
	out         io.Writer
}

func newPreview(fixture string, now time.Time, out io.Writer) (*preview, error) {
	list, err := fixtureList(fixture, now)
	if err != nil {
		return nil, err
	}
	p := &preview{
		list:        list,
		handed:      fixtureHanded(fixture, now),
		agents:      fixtureAgents(fixture, now),
		runs:        fixtureRuns(fixture, now),
		taken:       map[string]bool{},
		transcripts: map[string][]string{},
		out:         out,
	}
	for _, a := range p.handed {
		data, err := testdata.ReadFile("testdata/" + a.Name + ".jsonl")
		if err != nil {
			return nil, fmt.Errorf("transcript of %s: %w", a.Name, err)
		}
		p.transcripts[a.Tab] = transcriptLines(data)
	}
	// an agent the phone can take shows its transcript once taken; one without a file opens empty
	for _, a := range p.agents {
		if _, ok := p.transcripts[a.Tab]; ok {
			continue
		}
		data, err := testdata.ReadFile("testdata/" + a.Name + ".jsonl")
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("transcript of %s: %w", a.Name, err)
		}
		p.transcripts[a.Tab] = transcriptLines(data)
	}
	return p, nil
}

func transcriptLines(data []byte) []string {
	var lines []string
	for line := range bytes.SplitSeq(data, []byte("\n")) {
		if line = bytes.TrimSpace(line); len(line) > 0 {
			lines = append(lines, string(line))
		}
	}
	return lines
}

func (p *preview) handler(origin, vapid string) http.Handler {
	return remotemode.NewHandler(remotemode.Deps{
		Static:      web.FS,
		Verify:      func(*http.Request) error { return nil },
		Origin:      origin,
		VapidPublic: vapid,
		Waiting:     p.waiting,
		Answer:      p.answer,
		Off: func(context.Context) error {
			p.record("off", struct{}{})
			return nil
		},
		Subscribe: func(_ context.Context, sub remotemode.PushSubscription) error {
			p.record("subscribe", sub)
			return nil
		},
		Handed:     p.handedList,
		Agents:     p.agentsList,
		Stream:     p.stream,
		Act:        p.act,
		TakeBack:   p.takeBack,
		Take:       p.take,
		Release:    p.release,
		Transcript: p.transcript,
		PCLock:     p.pcLock,
		PCVolume:   p.pcVolume,
	})
}

func (p *preview) handedList(context.Context) ([]remotemode.HandedAgent, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return slices.Clone(p.handed), nil
}

func (p *preview) agentsList(context.Context) ([]remotemode.ListedAgent, []remotemode.ListedRun, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return slices.Clone(p.agents), slices.Clone(p.runs), nil
}

// lookup gives the hand-over for tab, or why it is not one: a tab never handed over reads as taken, as
// remotemode's LookupHanded has it.
func (p *preview) lookup(tab string) (remotemode.HandedAgent, error) {
	if tab == exitedTab {
		return remotemode.HandedAgent{}, &remotemode.GoneError{Reason: remotemode.EndExited}
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, a := range p.handed {
		if a.Tab == tab {
			return a, nil
		}
	}
	return remotemode.HandedAgent{}, &remotemode.GoneError{Reason: remotemode.EndTaken}
}

// lineOffsets gives the byte offset each line starts at, and the offset after the last, when the lines are
// joined by newlines and each ends in one: the same cursor the real transcript reader hands the page, over the
// fixture's lines.
func lineOffsets(lines []string) []int64 {
	offs := make([]int64, len(lines)+1)
	for i, l := range lines {
		offs[i+1] = offs[i] + int64(len(l)) + 1
	}
	return offs
}

// stream sends the agent and its backlog, then holds the stream open until the page leaves. The backlog is
// the last 200 lines on a first connection (from below 0) and the lines from byte offset from on after a
// reconnect, as the real stream has it; either way it carries the offsets of its first line and its end, so
// the page's cursor and Last-Event-ID are real. Nothing is appended afterwards.
func (p *preview) stream(ctx context.Context, tab string, from int64, sink remotemode.StreamSink) error {
	a, err := p.lookup(tab)
	if err != nil {
		return err
	}
	if err := sink.Agent(a); err != nil {
		return err
	}
	lines := p.transcripts[tab]
	offs := lineOffsets(lines)
	first := max(0, len(lines)-previewBacklogLines)
	if from >= 0 {
		first = sort.Search(len(lines), func(i int) bool { return offs[i] >= from })
	}
	chunk := remotemode.TranscriptChunk{Lines: lines[first:], Cursor: offs[first], End: offs[len(lines)], Backlog: true}
	if err := sink.Lines(chunk); err != nil {
		return err
	}
	<-ctx.Done()
	return nil
}

// transcript is the page of up to 200 lines that ends at byte offset before, and records the request. Like
// the real one it serves only a handed-over agent.
func (p *preview) transcript(_ context.Context, tab string, before int64) (remotemode.TranscriptChunk, error) {
	if _, err := p.lookup(tab); err != nil {
		return remotemode.TranscriptChunk{}, err
	}
	lines := p.transcripts[tab]
	offs := lineOffsets(lines)
	// the first line that ends past before bounds the page: every line before it ends at or before before
	end := sort.Search(len(lines), func(i int) bool { return offs[i+1] > before })
	start := max(0, end-previewPageLines)
	p.record("transcript", struct {
		Tab    string `json:"tab"`
		Before int64  `json:"before"`
	}{tab, before})
	return remotemode.TranscriptChunk{Lines: lines[start:end], Cursor: offs[start]}, nil
}

// act records what would be typed into the agent; the state check is remotemode's, not the preview's. An
// action on a take the fake Take made marks it acted, so a release leaves it.
func (p *preview) act(_ context.Context, tab string, act remotemode.AgentAction) error {
	if _, err := p.lookup(tab); err != nil {
		return err
	}
	p.mu.Lock()
	if _, ok := p.taken[tab]; ok {
		p.taken[tab] = true
	}
	p.mu.Unlock()
	p.record("input", struct {
		Tab    string `json:"tab"`
		Action string `json:"action"`
		Text   string `json:"text"`
	}{tab, act.Kind, act.Text})
	return nil
}

func (p *preview) takeBack(_ context.Context, tab string) error {
	if _, err := p.lookup(tab); err != nil {
		return err
	}
	p.mu.Lock()
	p.unhandLocked(tab)
	p.mu.Unlock()
	p.record("takeback", map[string]string{"tab": tab})
	return nil
}

// unhandLocked takes tab out of the hand-overs and lists it again; p.mu is held.
func (p *preview) unhandLocked(tab string) {
	// a new slice, so a list handedList gave out earlier is never changed under its encoder
	p.handed = slices.DeleteFunc(slices.Clone(p.handed), func(a remotemode.HandedAgent) bool { return a.Tab == tab })
	if i := slices.IndexFunc(p.agents, func(a remotemode.ListedAgent) bool { return a.Tab == tab }); i >= 0 {
		p.agents[i].Handed = false
	}
	delete(p.taken, tab)
}

// take hands a listed agent to the phone: it joins the hand-overs with its roster row's state and line, and
// its row reads handed. A tab not in the roster, a row that is not takeable and fx-refused are refused with
// a reason, as the real Take refuses with Eligible's. An agent already handed over is just opened.
func (p *preview) take(_ context.Context, tab string) error {
	taken, err := p.takeLocked(tab)
	if taken {
		p.record("take", map[string]string{"tab": tab})
	}
	return err
}

func (p *preview) takeLocked(tab string) (bool, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	i := slices.IndexFunc(p.agents, func(a remotemode.ListedAgent) bool { return a.Tab == tab })
	if i < 0 {
		return false, fmt.Errorf("%w: its tab is gone", remotemode.ErrRefused)
	}
	a := p.agents[i]
	switch {
	case a.Handed:
		return false, nil
	case tab == refusedTab:
		return false, fmt.Errorf("%w: %s", remotemode.ErrRefused, refusedReason)
	case !a.Takeable:
		return false, fmt.Errorf("%w: %q (tab %s) runs %q: only claude and pi agents can be handed to the phone",
			remotemode.ErrRefused, a.Name, a.Tab, a.Runtime)
	}
	since := a.Since
	if since == 0 {
		// a working agent lists no since; the hand-over's is when it was first seen in its state
		since = time.Now().UnixMilli()
	}
	p.handed = append(p.handed, remotemode.HandedAgent{
		Tab: a.Tab, Name: a.Name, Project: a.Project, Runtime: a.Runtime, State: a.State, Since: since, Line: a.Line,
	})
	p.agents[i].Handed = true
	if p.taken == nil {
		p.taken = map[string]bool{}
	}
	p.taken[tab] = false
	return true, nil
}

// release gives back a take nothing was acted on. Every other case, a take acted on, a hand-over of the
// fixture (one made at the desk) and a tab not handed over, is a no-op that records nothing.
func (p *preview) release(_ context.Context, tab string) error {
	p.mu.Lock()
	acted, ok := p.taken[tab]
	released := ok && !acted
	if released {
		p.unhandLocked(tab)
	}
	p.mu.Unlock()
	if released {
		p.record("release", map[string]string{"tab": tab})
	}
	return nil
}

func (p *preview) pcLock(context.Context) error {
	p.record("pclock", struct{}{})
	return nil
}

// pcVolume refuses mute, so the page's error line under the Computer buttons can be shown.
func (p *preview) pcVolume(_ context.Context, step string) error {
	if step == "mute" {
		return errors.New(muteRefusal)
	}
	p.record("pcvolume", map[string]string{"step": step})
	return nil
}

func (p *preview) waiting(context.Context) (remotemode.WaitingList, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.list, nil
}

func (p *preview) answer(_ context.Context, oref, askID string, answers []baseds.AgentAnswerItem) error {
	if oref == withdrawnORef {
		return remotemode.ErrAskGone
	}
	p.mu.Lock()
	idx := -1
	for i, q := range p.list.Questions {
		if q.ORef == oref && q.AskId == askID {
			idx = i
			break
		}
	}
	if idx >= 0 {
		// a new array, so a list waiting handed out earlier is never changed under its encoder
		p.list.Questions = append(p.list.Questions[:idx:idx], p.list.Questions[idx+1:]...)
	}
	p.mu.Unlock()
	if idx < 0 {
		return remotemode.ErrAskGone
	}
	p.record("answer", map[string]any{"oref": oref, "askid": askID, "answers": answers})
	return nil
}

func (p *preview) record(what string, v any) {
	data, err := json.Marshal(v)
	if err != nil {
		log.Printf("remotepreview: encode %s: %v", what, err)
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	fmt.Fprintf(p.out, "%s %s %s\n", linePrefix, what, data)
}

// vapidPublic is a real P-256 public key, so the page hands pushManager.subscribe a well-formed one.
func vapidPublic() (string, error) {
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return "", fmt.Errorf("generate vapid key: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()), nil
}

func fixtureList(name string, now time.Time) (remotemode.WaitingList, error) {
	switch name {
	case fixtureEmpty, fixtureInput:
		return remotemode.WaitingList{}, nil
	case fixtureMain:
		return mainFixture(now), nil
	}
	return remotemode.WaitingList{}, fmt.Errorf("unknown fixture %q: want %s, %s or %s", name, fixtureMain, fixtureEmpty, fixtureInput)
}

// fixtureHanded is the boards' hand-overs; each one's Name names its transcript under testdata/.
func fixtureHanded(name string, now time.Time) []remotemode.HandedAgent {
	ago := func(d time.Duration) int64 { return now.Add(-d).UnixMilli() }
	switch name {
	case fixtureMain:
		return []remotemode.HandedAgent{
			{
				Tab: "fx-siem-deploy", Name: "siem-deploy", Project: "siem", Runtime: "claude",
				State: remotemode.PhonePermission, Since: ago(4 * time.Minute),
				Line: "Wants to run: ssh deploy@siem-236 'sudo systemctl restart ingest'",
			},
			{
				Tab: "fx-phone-chat", Name: "phone-chat", Project: "waveterm", Runtime: "claude",
				State: remotemode.PhoneWorking, Since: ago(time.Minute),
				Line: "Running node scripts/cdp/verify.mjs remote-phone",
			},
			{
				Tab: "fx-vault-sync", Name: "vault-sync", Project: "arc_vault", Runtime: "pi",
				State: remotemode.PhoneIdle, Since: ago(6 * time.Minute),
				Line: "Moved the 3 stale notes to archive/ and pushed. Anything else?",
			},
		}
	case fixtureInput:
		return []remotemode.HandedAgent{{
			Tab: "fx-docs-worker", Name: "docs-worker", Project: "waveterm", Runtime: "claude",
			State: remotemode.PhoneInput, Since: ago(3 * time.Minute),
			Line: "Drafted the Access policy section with the one-email rule:",
		}}
	}
	return nil
}

// fixtureAgents is the roster behind the Agents list, in the order the real list has: by state, then the
// longest waiting first, a working agent (which lists no since) after the waiting ones, then by name. It holds
// the main fixture's three hand-overs (handed, which the page leaves out of the list since they show under
// Handed over), and four agents at the desk:
//   - fx-bench-runner, a working pi agent, takeable;
//   - fx-lab-notes, an idle claude agent whose line is the first sentence of its last reply
//     (testdata/lab-notes.jsonl), takeable, its transcript longer than the stream's backlog;
//   - fx-codex-scan, an idle codex agent, which the phone cannot take;
//   - fx-refused, idle and listed as takeable, but the fake Take refuses it.
//
// fx-refused is idle so it adds nothing to the page's "N need you".
func fixtureAgents(name string, now time.Time) []remotemode.ListedAgent {
	if name != fixtureMain {
		return nil
	}
	ago := func(d time.Duration) int64 { return now.Add(-d).UnixMilli() }
	desk := func(a remotemode.HandedAgent) remotemode.ListedAgent {
		since := a.Since
		if a.State == remotemode.PhoneWorking {
			since = 0
		}
		return remotemode.ListedAgent{
			Tab: a.Tab, Name: a.Name, Project: a.Project, Runtime: a.Runtime, State: a.State, Since: since,
			Line: a.Line, Handed: true, Takeable: true,
		}
	}
	handed := fixtureHanded(name, now)
	siem, chat, vault := desk(handed[0]), desk(handed[1]), desk(handed[2])
	return []remotemode.ListedAgent{
		siem,
		{
			Tab: "fx-bench-runner", Name: "bench-runner", Project: "waveterm", Runtime: "pi",
			State: remotemode.PhoneWorking, Line: "Running go test ./pkg/orchestrate", Takeable: true,
		},
		chat,
		{
			Tab: "fx-lab-notes", Name: "lab-notes", Project: "mit-thesis", Runtime: "claude",
			State: remotemode.PhoneIdle, Since: ago(25 * time.Minute), Takeable: true,
			Line: "Rewrote the related-work paragraph and added the two missing citations.",
		},
		{
			Tab: "fx-codex-scan", Name: "codex-scan", Project: "waveterm", Runtime: "codex",
			State: remotemode.PhoneIdle, Since: ago(12 * time.Minute),
		},
		{
			Tab: refusedTab, Name: "refused", Project: "waveterm", Runtime: "claude",
			State: remotemode.PhoneIdle, Since: ago(8 * time.Minute), Takeable: true,
		},
		vault,
	}
}

// fixtureRuns is the run behind the Runs section: "Phone agent list", with two workers working and one
// waiting on a permission, which only the desk can answer, so the run needs you.
func fixtureRuns(name string, now time.Time) []remotemode.ListedRun {
	if name != fixtureMain {
		return nil
	}
	ago := func(d time.Duration) int64 { return now.Add(-d).UnixMilli() }
	return []remotemode.ListedRun{{
		Key: "dag-fx1", Name: "Phone agent list", NeedsYou: true,
		Workers: []remotemode.RunWorkerRow{
			{
				Tab: "fx-run-take", Label: "Take and release in the handler", State: remotemode.PhoneWorking,
				Line: "Editing pkg/remotemode/take.go",
			},
			{
				Tab: "fx-run-review", Label: "Review: Transcript pages", State: remotemode.PhoneWorking,
				Line: "Reading pkg/remotemode/transcriptpage.go",
			},
			{
				Tab: "fx-run-pc", Label: "Computer controls", State: remotemode.PhonePermission,
				Line: "Wants to run: go build ./pkg/remotemode/...", Since: ago(2 * time.Minute),
			},
		},
	}}
}

const portPreview = `## Default port

The phone listener binds 127.0.0.1:8765 while remote mode is on.
cloudflared points the public hostname at http://localhost:8765.

- free on most machines
- the guide's dashboard step already names it
- changeable later with wsh remote setup --port`

const heldConflict = `merge wave/5d24e7b8 into main: exit status 1
Auto-merging pkg/remotemode/handler.go
CONFLICT (content): Merge conflict in pkg/remotemode/handler.go
Auto-merging scripts/cdp/scenarios.mjs
CONFLICT (content): Merge conflict in scripts/cdp/scenarios.mjs
Automatic merge failed; fix conflicts and then commit the result.`

const heldDirty = `land run 9af211aa: git merge --no-ff wave/9af211aa: exit status 1
error: Your local changes to the following files would be overwritten by merge:
	frontend/app/view/agents/settingssurface.tsx
	scripts/cdp/scenarios.mjs
Please commit your changes or stash them before you merge.
Aborting`

func mainFixture(now time.Time) remotemode.WaitingList {
	ago := func(d time.Duration) int64 { return now.Add(-d).UnixMilli() }
	return remotemode.WaitingList{
		Questions: []remotemode.WaitingQuestion{
			{
				Key: "ask:block:fx-remote-port", ORef: "block:fx-remote-port", AskId: "fx-ask-port",
				Source: "remote-mode lead", Project: "waveterm", Runtime: "claude", WaitingSince: ago(14 * time.Minute),
				Questions: []baseds.AgentAskQuestion{{
					Header:   "Port",
					Question: "Which port should the phone listener use by default? cloudflared's public hostname has to point at the same one.",
					Options: []baseds.AgentAskOption{
						{Label: "8765 (Recommended)", Description: "Free on most machines and already named in the guide", Preview: portPreview},
						{Label: "8080", Description: "Common, but often taken by a local dev server"},
						{Label: "A free port each start", Description: "Never collides, but the tunnel's hostname must change each time"},
					},
				}},
			},
			{
				Key: "ask:block:fx-remote-checks", ORef: "block:fx-remote-checks", AskId: "fx-ask-checks",
				Source: "push worker", Project: "waveterm", Runtime: "pi", WaitingSince: ago(6 * time.Minute),
				Questions: []baseds.AgentAskQuestion{
					{
						Header:   "Retry",
						Question: "A push service answered 503. Should the pusher retry it?",
						Options: []baseds.AgentAskOption{
							{Label: "Retry on the next tick", Description: "The note goes out at most 5 s late"},
							{Label: "Drop it", Description: "The owner sees it on the next open instead"},
						},
					},
					{
						Header:      "Checks",
						Question:    "Which checks should the pusher's tests cover?",
						MultiSelect: true,
						Options: []baseds.AgentAskOption{
							{Label: "410 drops the subscription"},
							{Label: "404 drops the subscription"},
							{Label: "No question text in a payload"},
						},
					},
				},
			},
			{
				Key: "ask:" + withdrawnORef, ORef: withdrawnORef, AskId: "fx-ask-withdrawn",
				Source: "docs worker", Project: "waveterm", Runtime: "claude", WaitingSince: ago(2 * time.Minute),
				Questions: []baseds.AgentAskQuestion{{
					Header:   "Guide",
					Question: "Should the setup guide show the Access policy step with screenshots?",
					Options: []baseds.AgentAskOption{
						{Label: "Text only"},
						{Label: "Text and screenshots"},
					},
				}},
			},
		},
		Shown: []remotemode.WaitingShown{
			{
				Key: "run-land-held:fx-run-merge", Kind: jarvis.AttentionRunLandHeld, Title: "Answer Arc from the phone",
				Project: "waveterm", WaitingSince: ago(48 * time.Minute), Reason: heldConflict,
			},
			{
				Key: "run-land-held:fx-run-dirty", Kind: jarvis.AttentionRunLandHeld, Title: "Cockpit Remote on pill",
				Project: "waveterm", WaitingSince: ago(3*time.Hour + 5*time.Minute), Reason: heldDirty,
			},
		},
	}
}
