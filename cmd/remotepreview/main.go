// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Command remotepreview serves the phone page on loopback with a fixture waiting list and an Access check
// that lets everything through, for the remote-phone CDP scenario and for looking at the page by hand.
// A dev tool only: neither wavesrv nor build:backend builds it.
//
// It prints "REMOTEPREVIEW <url>" once it listens, then one "REMOTEPREVIEW <what> <json>" line for each
// answer, subscribe, off, agent input and take-back the page sends, so a driver can check what reached it.
package main

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"embed"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"slices"
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

// preview is the fixture state behind the handler: the list shrinks as questions are answered, and a
// taken-back agent leaves the hand-overs.
type preview struct {
	mu     sync.Mutex
	list   remotemode.WaitingList
	handed []remotemode.HandedAgent
	// transcripts holds each handed-over tab's recorded lines
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
		Handed:   p.handedList,
		Stream:   p.stream,
		Act:      p.act,
		TakeBack: p.takeBack,
	})
}

func (p *preview) handedList(context.Context) ([]remotemode.HandedAgent, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return slices.Clone(p.handed), nil
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

// stream sends the agent and its whole transcript, then holds the stream open until the page leaves.
func (p *preview) stream(ctx context.Context, tab string, sink remotemode.StreamSink) error {
	a, err := p.lookup(tab)
	if err != nil {
		return err
	}
	if err := sink.Agent(a); err != nil {
		return err
	}
	if err := sink.Lines(p.transcripts[tab]); err != nil {
		return err
	}
	<-ctx.Done()
	return nil
}

// act records what would be typed into the agent; the state check is remotemode's, not the preview's.
func (p *preview) act(_ context.Context, tab string, act remotemode.AgentAction) error {
	if _, err := p.lookup(tab); err != nil {
		return err
	}
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
	// a new slice, so a list handedList gave out earlier is never changed under its encoder
	p.handed = slices.DeleteFunc(slices.Clone(p.handed), func(a remotemode.HandedAgent) bool { return a.Tab == tab })
	p.mu.Unlock()
	p.record("takeback", map[string]string{"tab": tab})
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
