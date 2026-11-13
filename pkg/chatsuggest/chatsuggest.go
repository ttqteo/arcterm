// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package chatsuggest is the model half of Chat's suggested replies: one no-tools haiku call reads the end of an
// agent's last reply, with the person's own last messages for their words and language and the messages they send often
// (habits.go), and names the replies they would likely send next. Chat draws them as chips in the message box beside its own rule chips
// (frontend/app/view/agents/chatsuggest.ts has the rules and the merge).
//
// The call runs claude with no tools, no MCP servers and no settings (so no hooks and no plugins), its own short
// system prompt, and an empty working folder (no project CLAUDE.md, no auto memory): about 800 tokens before the
// reply, against 10-15k for a bare `claude -p`. It takes 8-11 s, almost all of it claude starting, so the chips it
// adds arrive a while after the turn ends.
package chatsuggest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/wavetermdev/waveterm/pkg/consult"
)

const (
	// Model is the alias the call runs on: picking a next reply from a few lines is a short classification
	Model = "haiku"
	// the end of the reply that is sent: the question or the next step is in its last lines
	replyTailRunes = 1500
	// the person's last messages that are sent, and the length each is cut to
	recentMax   = 6
	recentRunes = 160
	// one suggested reply, at most: a chip is a short line
	replyRunes = 60
	// how many replies come back: answers to a question, or the one next step
	maxAnswers = 3
	maxNext    = 1
	// a call that has not answered by then is dropped
	callTimeout = 60 * time.Second
	// the answers kept, and the calls let run at once
	cacheMax = 64
	parallel = 2
)

// Request is one turn's ask.
type Request struct {
	// the agent's last reply, whole: only its end is sent
	Reply string
	// the person's last messages in the conversation, oldest first
	Recent []string
	// the reply ends in a question: the replies answer it, and there can be three
	Question bool
	// the messages the person sends often (Habits), most used first: a reply that fits the turn is given as written
	Habits []string
}

const systemPrompt = `You suggest what a person will send next to a coding agent, as one-tap replies in a chat app.

Write each reply the way this person writes: their language and their short, casual wording, as in their messages. At most 60 characters each.

When the agent's reply ends with a question, give up to 3 replies that answer it. First the answer the agent recommends, spelled out in full when the question asks several things (for example "B, và ẩn thẻ Pin"), then the other options it named. Never a bare "ok" or "yes" when the question offers options.

When it does not end with a question, give at most 1 reply, and only for a clear next step: one the agent offered, or a natural follow-up such as drawing a mockup of a layout it described in words, running the tests, or building. Never suggest commit or push: the app offers those itself. When no next step is clear, write NONE.

You may be given messages this person sends often. When one of them is the right reply, give it exactly as written; never pick one only because it is listed.

Output only the replies, one per line, with no numbering, quotes or commentary.`

// BuildPrompt is the call's message: the person's last messages, the end of the reply, and what kind of reply to give.
func BuildPrompt(req Request) string {
	var b strings.Builder
	recent := req.Recent
	if len(recent) > recentMax {
		recent = recent[len(recent)-recentMax:]
	}
	lines := make([]string, 0, len(recent))
	for _, r := range recent {
		if line := oneLine(r, recentRunes); line != "" {
			lines = append(lines, line)
		}
	}
	if habits := promptHabits(req.Habits); len(habits) > 0 {
		b.WriteString("Messages this person sends often, most used first:\n")
		for _, h := range habits {
			b.WriteString("- " + h + "\n")
		}
		b.WriteString("\n")
	}
	if len(lines) > 0 {
		b.WriteString("The person's last messages to the agent, oldest first:\n")
		for _, line := range lines {
			b.WriteString("- " + line + "\n")
		}
		b.WriteString("\n")
	}
	b.WriteString("The end of the agent's last reply:\n<reply>\n")
	b.WriteString(tail(strings.TrimSpace(req.Reply), replyTailRunes))
	b.WriteString("\n</reply>\n\n")
	if req.Question {
		b.WriteString("The reply ends with a question: give up to 3 replies that answer it.")
	} else {
		b.WriteString("The reply does not end with a question: give at most 1 reply, or NONE.")
	}
	return b.String()
}

// promptHabits is the habits the prompt lists: at most HabitMax, one line each, none that commits or pushes (the rules
// offer those, and Parse would drop the reply).
func promptHabits(habits []string) []string {
	out := []string{}
	for _, h := range habits {
		line := oneLine(h, habitRunes)
		if line == "" || commitPushRe.MatchString(line) {
			continue
		}
		out = append(out, line)
		if len(out) == HabitMax {
			break
		}
	}
	return out
}

// oneLine folds s to one line cut to max runes, with an ellipsis when cut.
func oneLine(s string, max int) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	return string([]rune(s)[:max-1]) + "…"
}

// tail is the last max runes of s, starting at a line when one begins in the cut, with an ellipsis in front when cut.
func tail(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	cut := string(r[len(r)-max:])
	if i := strings.IndexByte(cut, '\n'); i >= 0 && i < len(cut)-1 {
		cut = cut[i+1:]
	}
	return "…" + cut
}

var (
	bulletRe     = regexp.MustCompile(`^(?:[-*•]\s+|\d+[.)]\s+)`)
	commitPushRe = regexp.MustCompile(`(?i)\b(commit|push)\b`)
)

// Parse reads the model's answer: one reply per line, numbering, bullets and quotes taken off, NONE and empty lines
// skipped, a reply past replyRunes dropped (a cut reply would send half a sentence), the same reply kept once, and at
// most three answers to a question or one next step. A next step never commits or pushes: the rules offer those.
func Parse(text string, question bool) []string {
	limit := maxNext
	if question {
		limit = maxAnswers
	}
	out := []string{}
	seen := map[string]bool{}
	for _, line := range strings.Split(text, "\n") {
		s := bulletRe.ReplaceAllString(strings.TrimSpace(line), "")
		s = strings.TrimSpace(strings.Trim(s, "\"'`“”‘’"))
		if s == "" || strings.EqualFold(strings.TrimRight(s, "."), "NONE") || utf8.RuneCountInString(s) > replyRunes {
			continue
		}
		if !question && commitPushRe.MatchString(s) {
			continue
		}
		key := strings.ToLower(s)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, s)
		if len(out) == limit {
			break
		}
	}
	return out
}

// Runner makes the one call: the prompt in, the model's whole answer out.
type Runner func(ctx context.Context, prompt string) (string, error)

// workDir is the call's working folder: empty, so claude finds no CLAUDE.md and no auto memory for it.
var workDir = sync.OnceValues(func() (string, error) {
	dir := filepath.Join(os.TempDir(), "arc-chatsuggest")
	return dir, os.MkdirAll(dir, 0o700)
})

// RunClaude is the production Runner: claude on haiku with no tools, no MCP servers, no settings and its own system
// prompt, nothing kept of the session.
func RunClaude(ctx context.Context, prompt string) (string, error) {
	spec, ok := consult.SpecFor("claude")
	if !ok {
		return "", errors.New("claude has no headless spec")
	}
	dir, err := workDir()
	if err != nil {
		return "", err
	}
	spec.BaseArgs = append(consult.ClaudeArgs(consult.CallOpts{Model: Model}),
		"--setting-sources", "", "--system-prompt", systemPrompt, "--no-session-persistence", "--disable-slash-commands")
	return consult.Run(ctx, spec, dir, prompt, func(string) {})
}

// Suggester runs the calls: one per distinct prompt, its answer kept, a second ask for the same prompt while the first
// runs waiting on it, and at most `parallel` calls at once.
type Suggester struct {
	run Runner
	sem chan struct{}

	mu       sync.Mutex
	cache    map[string][]string
	order    []string
	inflight map[string]*call
}

type call struct {
	done chan struct{}
	out  []string
	err  error
}

// New makes a Suggester over run (RunClaude when nil).
func New(run Runner) *Suggester {
	if run == nil {
		run = RunClaude
	}
	return &Suggester{
		run:      run,
		sem:      make(chan struct{}, parallel),
		cache:    map[string][]string{},
		inflight: map[string]*call{},
	}
}

// Suggest answers req's replies. A reply with no text asks nothing. The call runs on its own clock, not ctx's, so an
// ask that gives up does not end the answer another is waiting on; a failed call is not kept, so a later ask tries
// again.
func (s *Suggester) Suggest(ctx context.Context, req Request) ([]string, error) {
	if strings.TrimSpace(req.Reply) == "" {
		return []string{}, nil
	}
	prompt := BuildPrompt(req)
	sum := sha256.Sum256([]byte(prompt))
	key := hex.EncodeToString(sum[:])
	s.mu.Lock()
	if out, ok := s.cache[key]; ok {
		s.mu.Unlock()
		return out, nil
	}
	c, running := s.inflight[key]
	if !running {
		c = &call{done: make(chan struct{})}
		s.inflight[key] = c
	}
	s.mu.Unlock()
	if !running {
		go s.do(key, prompt, req.Question, c)
	}
	select {
	case <-c.done:
		return c.out, c.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (s *Suggester) do(key, prompt string, question bool, c *call) {
	runCtx, cancel := context.WithTimeout(context.Background(), callTimeout)
	defer cancel()
	select {
	case s.sem <- struct{}{}:
		text, err := s.run(runCtx, prompt)
		<-s.sem
		if err == nil {
			c.out = Parse(text, question)
		}
		c.err = err
	case <-runCtx.Done():
		c.err = runCtx.Err()
	}
	s.mu.Lock()
	delete(s.inflight, key)
	if c.err == nil {
		s.cache[key] = c.out
		s.order = append(s.order, key)
		if len(s.order) > cacheMax {
			delete(s.cache, s.order[0])
			s.order = s.order[1:]
		}
	}
	s.mu.Unlock()
	close(c.done)
}
