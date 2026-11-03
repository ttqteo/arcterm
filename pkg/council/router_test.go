// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
)

// routerCands are the seats the router tests choose among: two role seats and a seated chat with no brief of its own.
func routerCands() []CouncilExpert {
	return []CouncilExpert{
		{Id: "ux", Name: "UX", Brief: "Can someone use it without being told how?"},
		{Id: "ram", Name: "RAM", Brief: "What stays in memory?"},
		{Id: "tab-9", Name: "Idle timer chat", Agent: "tab-9", Harness: HarnessClaude},
	}
}

func TestParseRoute(t *testing.T) {
	cands := routerCands()
	long := strings.Repeat("é", 300)
	tests := []struct {
		name       string
		text       string
		wantSeats  []string
		wantTools  bool
		wantErr    bool
		wantWhy    string
		wantAnswer string
	}{
		{name: "the router answers itself", text: `{"seats":[],"answer":"  Hi! What next?\n","reason":"a greeting"}`,
			wantAnswer: "Hi! What next?", wantWhy: "a greeting"},
		{name: "an answer with no seats field", text: `{"answer":"Thanks!"}`, wantAnswer: "Thanks!"},
		{name: "an answer over 600 characters is cut", text: `{"seats":[],"answer":"` + strings.Repeat("a", 700) + `"}`,
			wantAnswer: strings.Repeat("a", 600)},
		{name: "a seat wins over an answer", text: `{"seats":["ux"],"answer":"Hi","reason":"r"}`,
			wantSeats: []string{"ux"}, wantWhy: "r"},
		{name: "an unknown seat and an answer is the answer", text: `{"seats":["ghost"],"answer":"Hi","reason":"r"}`,
			wantAnswer: "Hi", wantWhy: "r"},
		{name: "a blank answer and no seat", text: `{"seats":[],"answer":"   ","reason":"r"}`, wantErr: true},
		{name: "one seat", text: `{"seats":["ux"],"tools":false,"reason":"a layout question"}`,
			wantSeats: []string{"ux"}, wantWhy: "a layout question"},
		{name: "two seats", text: `{"seats":["ram","ux"],"tools":false,"reason":"memory and layout"}`,
			wantSeats: []string{"ram", "ux"}, wantWhy: "memory and layout"},
		{name: "three seats keep the first two", text: `{"seats":["ux","ram","tab-9"],"reason":"r"}`,
			wantSeats: []string{"ux", "ram"}, wantWhy: "r"},
		{name: "a seat by name in other case", text: `{"seats":["ram"," Idle Timer CHAT "],"reason":"r"}`,
			wantSeats: []string{"ram", "tab-9"}, wantWhy: "r"},
		{name: "an id in other case", text: `{"seats":["UX"],"reason":"r"}`, wantSeats: []string{"ux"}, wantWhy: "r"},
		{name: "an unknown seat is dropped", text: `{"seats":["ghost","ram"],"reason":"r"}`,
			wantSeats: []string{"ram"}, wantWhy: "r"},
		{name: "an unknown seat does not use up the two", text: `{"seats":["ghost","ux","ram","tab-9"],"reason":"r"}`,
			wantSeats: []string{"ux", "ram"}, wantWhy: "r"},
		{name: "a repeated seat once", text: `{"seats":["ux","UX","ux"],"reason":"r"}`,
			wantSeats: []string{"ux"}, wantWhy: "r"},
		{name: "a repeat by id and by name once", text: `{"seats":["ram","RAM","ux"],"reason":"r"}`,
			wantSeats: []string{"ram", "ux"}, wantWhy: "r"},
		{name: "a bare seat string", text: `{"seats":"ux","reason":"r"}`, wantSeats: []string{"ux"}, wantWhy: "r"},
		{name: "prose around the JSON", text: "Sure, here is my pick.\n\n```json\n{\"seats\":[\"ram\"],\"tools\":true,\"reason\":\"needs the file\"}\n```\nHope that helps.",
			wantSeats: []string{"ram"}, wantTools: true, wantWhy: "needs the file"},
		{name: "prose and a bare object", text: `I would say {"seats":["ux"],"tools":true,"reason":"v5.1 is new"} as the answer.`,
			wantSeats: []string{"ux"}, wantTools: true, wantWhy: "v5.1 is new"},
		{name: "tools true", text: `{"seats":["ux"],"tools":true,"reason":"r"}`, wantSeats: []string{"ux"}, wantTools: true, wantWhy: "r"},
		{name: "tools false", text: `{"seats":["ux"],"tools":false,"reason":"r"}`, wantSeats: []string{"ux"}, wantWhy: "r"},
		{name: "tools left out", text: `{"seats":["ux"],"reason":"r"}`, wantSeats: []string{"ux"}, wantWhy: "r"},
		{name: "reason with newlines is one line", text: `{"seats":["ux"],"reason":"  first line\n\nsecond\tline  "}`,
			wantSeats: []string{"ux"}, wantWhy: "first line second line"},
		{name: "reason left out", text: `{"seats":["ux"]}`, wantSeats: []string{"ux"}, wantWhy: ""},
		{name: "reason over 200 characters is cut", text: `{"seats":["ux"],"reason":"` + long + `"}`,
			wantSeats: []string{"ux"}, wantWhy: strings.Repeat("é", 199) + "…"},
		{name: "no known seat", text: `{"seats":["ghost","nobody"],"reason":"r"}`, wantErr: true},
		{name: "empty seats", text: `{"seats":[],"reason":"r"}`, wantErr: true},
		{name: "no seats field", text: `{"reason":"r"}`, wantErr: true},
		{name: "no JSON", text: "I would ask UX.", wantErr: true},
		{name: "an empty reply", text: "  \n", wantErr: true},
		{name: "seats of a wrong type", text: `{"seats":[1,2],"reason":"r"}`, wantErr: true},
		{name: "a malformed object", text: `{"seats":["ux"`, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseRoute(tt.text, cands)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("parseRoute = %+v, want an error", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseRoute: %v", err)
			}
			if fmt.Sprint(got.Seats) != fmt.Sprint(tt.wantSeats) {
				t.Errorf("seats = %v, want %v", got.Seats, tt.wantSeats)
			}
			if got.Tools != tt.wantTools {
				t.Errorf("tools = %v, want %v", got.Tools, tt.wantTools)
			}
			if got.Reason != tt.wantWhy {
				t.Errorf("reason = %q, want %q", got.Reason, tt.wantWhy)
			}
			if got.Answer != tt.wantAnswer {
				t.Errorf("answer = %q, want %q", got.Answer, tt.wantAnswer)
			}
		})
	}
}

func TestRouterShown(t *testing.T) {
	words := strings.Repeat("ab ", 100) // 300 characters, a space every third
	tests := []struct {
		name, in, want string
		limit          int
	}{
		{name: "a short line stays, folded", in: "  one\n two  ", limit: 20, want: "one two"},
		{name: "at the limit stays", in: "abcde", limit: 5, want: "abcde"},
		{name: "a long word is cut at the limit", in: "abcdefgh", limit: 5, want: "abcd…"},
		{name: "words are cut at the last space", in: "one two three four", limit: 12, want: "one two…"},
		{name: "an opening bracket before the cut goes", in: "kiểm chứng nhỏ được (contrarian) và", limit: 24,
			want: "kiểm chứng nhỏ được…"},
		{name: "a comma before the cut goes", in: "one, two, three, four", limit: 10, want: "one, two…"},
		{name: "at most limit characters", in: words, limit: 200, want: strings.TrimSpace(words[:198]) + "…"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := routerShown(tt.in, tt.limit)
			if got != tt.want {
				t.Fatalf("routerShown(%q, %d) = %q, want %q", tt.in, tt.limit, got, tt.want)
			}
			if n := len([]rune(got)); n > tt.limit {
				t.Fatalf("routerShown is %d characters, over its limit %d", n, tt.limit)
			}
		})
	}
}

func TestParseRouteMatchesOnlyCandidates(t *testing.T) {
	// the coordinator, a failed seat or any other expert the caller left out of candidates is no pick
	got, err := parseRoute(`{"seats":["ram"],"reason":"r"}`, routerCands()[:1])
	if err == nil {
		t.Fatalf("parseRoute = %+v, want an error for a seat that is not a candidate", got)
	}
	if _, err := parseRoute(`{"seats":["ux"],"reason":"r"}`, nil); err == nil {
		t.Error("parseRoute with no candidates: want an error")
	}
}

// routerHistory is a council whose Discussion holds seven sent messages (ideas and replies, out of order in the slices)
// and a person's reply, with one held draft, one empty answer and the person's own reply among them.
func routerHistory() (*Council, CouncilReply) {
	c := &Council{
		Id:      "c1",
		Project: `D:\proj`,
		Feature: "Idle sleep",
		Experts: append(routerCands(), CouncilExpert{Id: "lead", Name: "Lead", Brief: "Merge and rank.", Coordinator: true}),
		Proposals: []CouncilProposal{
			{Id: "P1", Author: "ux", Title: "Title-one", Argument: "Argument-one", Ts: 10},
			{Id: "P2", Author: "ram", Title: "Title-two", Argument: "Argument-two", Ts: 30},
			{Id: "P3", Author: "ram", Title: "Title-held", Argument: "Argument-held", Ts: 35, Draft: DraftHeld},
		},
		Replies: []CouncilReply{
			{Id: "r1", ProposalId: "P1", Author: "ram", Text: "Text-r1 first reply", Ts: 20},
			{Id: "r2", ProposalId: "P1", ParentId: "r1", Author: YouId, Text: "Text-r2 from the person", Ts: 40, To: []string{"ux"}},
			{Id: "r3", ProposalId: "P2", Author: "ux", Text: "Text-r3 third", Ts: 50},
			{Id: "r4", ProposalId: "P2", Author: "tab-9", Text: "Text-r4 fourth", Ts: 60},
			{Id: "r5", ProposalId: "P2", Author: "ux", Text: "", Ts: 65}, // agrees, says nothing
			{Id: "r6", ProposalId: "P2", Author: "ram", Text: "Text-r6 held back", Ts: 66, Draft: DraftHeld},
			{Id: "r7", ProposalId: "P2", Author: YouId, Text: "Text-r7 sixth", Ts: 70},
		},
	}
	pr := CouncilReply{
		Id: "r9", Author: YouId, Ts: 100, To: nil,
		Text:        "what about that one?",
		Attachments: []string{`C:\Users\me\.arc\attachments\secret-folder\shot-1.png`, "/home/me/.arc/attachments/hidden-dir/shot-2.png"},
	}
	c.Replies = append(c.Replies, pr)
	return c, pr
}

func TestRouterPromptHolds(t *testing.T) {
	c, pr := routerHistory()
	// the reply is stored after the messages; one posted later than it must not be read
	c.Replies = append(c.Replies, CouncilReply{Id: "r10", Author: "ux", Text: "Text-later after the router", Ts: 200})
	p := routerPrompt(c, pr, routerCands())

	mustContain(t, "router prompt", p,
		"what about that one?",
		"shot-1.png", "shot-2.png",
		"ux — UX: Can someone use it without being told how?",
		"ram — RAM: What stays in memory?",
		"tab-9 — Idle timer chat: a live chat: Idle timer chat",
		`"seats"`, `"tools"`, `"reason"`,
		"never more than two", "nothing else")
	mustNotContain(t, "router prompt", p,
		"secret-folder", "hidden-dir", `C:\Users`, "/home/me", // an attachment's folder is not the router's business
		"Lead", "Merge and rank.", // the coordinator is no candidate
		"Text-later", "Argument-held", "Text-r6", // a later message and held drafts are not in the room
		"Title-one") // P1 is the oldest of seven messages: the six most recent are read

	// the six most recent sent messages, oldest first, each as "Author: text"
	want := []string{
		"RAM: Text-r1 first reply",
		"RAM: Title-two — Argument-two", // P2 is an idea: its title and argument
		"the person: Text-r2 from the person",
		"UX: Text-r3 third",
		"Idle timer chat: Text-r4 fourth",
		"the person: Text-r7 sixth",
	}
	last := -1
	for _, s := range want {
		i := strings.Index(p, s)
		if i < 0 {
			t.Errorf("router prompt lacks %q\n---\n%s", s, p)
			continue
		}
		if i < last {
			t.Errorf("%q is out of order: the messages should run oldest first", s)
		}
		last = i
	}
	if strings.Contains(p, "UX: \n") || strings.Contains(p, "UX: Text-r5") {
		t.Error("an answer with no text was written into the history")
	}
	// the message being routed is the one in "the person's message", not repeated as history
	if n := strings.Count(p, "what about that one?"); n != 1 {
		t.Errorf("the message being routed appears %d times, want once", n)
	}
}

func TestRouterPromptSeventhMessageOut(t *testing.T) {
	c := &Council{Id: "c1", Project: `D:\p`, Experts: routerCands()}
	for i := 1; i <= 7; i++ {
		c.Replies = append(c.Replies, CouncilReply{Id: fmt.Sprintf("r%d", i), Author: "ux", Text: fmt.Sprintf("message number %d", i), Ts: int64(i)})
	}
	pr := CouncilReply{Id: "r8", Author: YouId, Text: "go", Ts: 8}
	p := routerPrompt(c, pr, routerCands())
	for i := 2; i <= 7; i++ {
		mustContain(t, "router prompt", p, fmt.Sprintf("message number %d", i))
	}
	// "message number 1" is a prefix of no other message here, so its absence is exact: the seventh most recent is out
	mustNotContain(t, "router prompt", p, "message number 1")
}

func TestRouterPromptCutsLongText(t *testing.T) {
	c := &Council{Id: "c1", Project: `D:\p`, Experts: routerCands()}
	c.Replies = []CouncilReply{{Id: "r1", Author: "ux", Text: strings.Repeat("é", 700) + "\nand a second line", Ts: 1}}
	pr := CouncilReply{Id: "r2", Author: YouId, Text: "go", Ts: 2}
	p := routerPrompt(c, pr, routerCands())
	mustContain(t, "router prompt", p, "UX: "+strings.Repeat("é", 500))
	mustNotContain(t, "router prompt", p, strings.Repeat("é", 501), "second line")
	if strings.Contains(p, "UX: "+strings.Repeat("é", 500)+"\n"+"and") {
		t.Error("a message's own line breaks should not split its line")
	}
}

func TestRouterPromptNoHistory(t *testing.T) {
	c := &Council{Id: "c1", Project: `D:\p`, Experts: routerCands()}
	pr := CouncilReply{Id: "r1", Author: YouId, Text: "which seat?", Ts: 1}
	p := routerPrompt(c, pr, routerCands())
	mustContain(t, "router prompt", p, "which seat?", "ux — UX:", `"seats"`)
	mustNotContain(t, "router prompt", p, "<nil>", "[]", "%!")
}

func TestRouterPromptDropsEvidenceRule(t *testing.T) {
	c := &Council{Id: "c1", Project: `D:\p`}
	cands := []CouncilExpert{{Id: "ux", Name: "UX", Brief: brief("You review as the UX expert.\nAsk whether it can be used.")}, routerCands()[1]}
	p := routerPrompt(c, CouncilReply{Id: "r1", Author: YouId, Text: "q", Ts: 1}, cands)
	mustContain(t, "router prompt", p, "ux — UX: You review as the UX expert. Ask whether it can be used.")
	mustNotContain(t, "router prompt", p, briefEvidenceRule)
}

// routerCaller is a Caller that records its requests and answers with one canned reply or error.
type routerCaller struct {
	mu   sync.Mutex
	reqs []CallReq
	text string
	res  CallRes
	err  error
}

func (f *routerCaller) Call(ctx context.Context, req CallReq) (CallRes, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reqs = append(f.reqs, req)
	if f.err != nil {
		return f.res, f.err
	}
	res := f.res
	if res.Text == "" {
		res.Text = f.text
	}
	return res, nil
}

func TestRouteCallNoTools(t *testing.T) {
	c, pr := routerHistory()
	f := &routerCaller{res: CallRes{Text: "```json\n" + `{"seats":["ram"],"tools":true,"reason":"it is about memory"}` + "\n```", Tokens: 321}}
	r := &Runner{Caller: f}
	route, res, err := r.routeCall(context.Background(), c, pr, routerCands())
	if err != nil {
		t.Fatalf("routeCall: %v", err)
	}
	if fmt.Sprint(route.Seats) != "[ram]" || !route.Tools || route.Reason != "it is about memory" {
		t.Errorf("route = %+v, want ram, tools, the reason", route)
	}
	if res.Tokens != 321 {
		t.Errorf("tokens = %d, want the call's 321", res.Tokens)
	}
	if len(f.reqs) != 1 {
		t.Fatalf("%d calls, want exactly 1", len(f.reqs))
	}
	req := f.reqs[0]
	if req.Tools || req.Expert.Model != "haiku" || req.Cwd != c.Project || req.Expert.Id != "router" || req.Expert.Name != "Router" {
		t.Errorf("request = tools %v model %q cwd %q expert %q/%q, want no tools on haiku in the project as the router",
			req.Tools, req.Expert.Model, req.Cwd, req.Expert.Id, req.Expert.Name)
	}
	if len(req.AddDirs) != 0 {
		t.Errorf("AddDirs = %v, want none: the router never reads a file", req.AddDirs)
	}
	if req.Prompt != routerPrompt(c, pr, routerCands()) {
		t.Error("the call's prompt is not routerPrompt's")
	}
}

func TestRouteCallErrors(t *testing.T) {
	c, pr := routerHistory()
	boom := errors.New("claude is not signed in")

	f := &routerCaller{err: boom}
	_, _, err := (&Runner{Caller: f}).routeCall(context.Background(), c, pr, routerCands())
	if !errors.Is(err, boom) {
		t.Errorf("err = %v, want the Caller's own error", err)
	}

	f = &routerCaller{res: CallRes{Tokens: 40}, text: "   \n"}
	_, res, err := (&Runner{Caller: f}).routeCall(context.Background(), c, pr, routerCands())
	if err == nil {
		t.Error("an empty reply: want an error")
	}
	if res.Tokens != 40 {
		t.Errorf("tokens = %d, want the empty call's 40 returned so the caller can book them", res.Tokens)
	}

	f = &routerCaller{res: CallRes{Text: "I would ask UX.", Tokens: 55}}
	_, res, err = (&Runner{Caller: f}).routeCall(context.Background(), c, pr, routerCands())
	if err == nil {
		t.Error("a reply with no JSON: want an error")
	}
	if res.Tokens != 55 {
		t.Errorf("tokens = %d, want the call's 55 returned on a parse error", res.Tokens)
	}

	f = &routerCaller{res: CallRes{Text: `{"seats":["ghost"],"reason":"r"}`, Tokens: 66}}
	_, res, err = (&Runner{Caller: f}).routeCall(context.Background(), c, pr, routerCands())
	if err == nil || res.Tokens != 66 {
		t.Errorf("a pick of no known seat: err = %v tokens = %d, want an error and the call's 66", err, res.Tokens)
	}

	if _, _, err := (&Runner{}).routeCall(context.Background(), c, pr, routerCands()); err == nil {
		t.Error("a runner with no caller: want an error")
	}
}
