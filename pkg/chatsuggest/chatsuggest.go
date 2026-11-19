// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package chatsuggest is the model half of Chat's suggested replies: one no-tools haiku call reads the end of an
// agent's last reply, with the person's own last messages for their words and language and the messages they send often
// (habits.go), and names the replies they would likely send next. Chat draws them as chips in the message box beside its own rule chips
// (frontend/app/view/agents/chatsuggest.ts has the rules and the merge).
//
// A Claude agent's arc mod makes the call itself, in its own claude, at the end of each turn (hook.go): the chips come
// about 2 s after the turn. The headless call below is for every other agent, and for a turn the mod did not answer.
//
// The headless call runs claude with no tools, no MCP servers and no settings (so no hooks and no plugins), its own
// short system prompt, and an empty working folder (no project CLAUDE.md, no auto memory): about 1.9k tokens before
// the reply, against 10-15k for a bare `claude -p`. It takes 5-7 s, 3-5 s of it claude starting, and holds ~470 MB
// while it runs (measured 2026-11-18). Haiku thinks before it answers, 150-500 tokens, which no flag of the CLI turns
// off.
package chatsuggest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/wavetermdev/waveterm/pkg/consult"
)

const (
	// Model is the alias the call runs on: picking a next reply from a few lines is a short classification
	Model = "haiku"
	// the end of the reply that is sent: the question or the next step is in its last lines
	replyTailRunes = 1500
	// a request for a summary sends the reply's start as well as its end, so the summary can say what the turn set out
	// to do and where it stopped: the whole reply when it is no longer than both together (under ~2,500 runes sent)
	summaryHeadRunes = 600
	summaryTailRunes = 1800
	// the summary, at most: one or two sentences, cut at a word past it
	summaryRunes = 240
	// the person's last messages that are sent, and the length each is cut to
	recentMax   = 6
	recentRunes = 160
	// one suggested reply, at most: a chip is a short line
	replyRunes = 60
	// how many replies come back: answers to a question, or the one next step. Chat draws the answers that fit on its
	// one line of chips (frontend chatsuggest.ts fitChips), so more short ones fill it
	maxAnswers = 5
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
	// the reply ends in a question: the replies answer it, and there can be up to five
	Question bool
	// the messages the person sends often (Habits), most used first: a reply that fits the turn is given as written
	Habits []string
	// the turn was a long one: the call also writes a one-or-two-sentence summary of it, as a first `SUMMARY:` line
	Summary bool
}

const systemPrompt = `You suggest what a person will send next to a coding agent, as one-tap replies in a chat app.

Write each reply the way this person writes: their language and their short, casual wording, as in their messages. At most 60 characters each.

When the agent's reply ends with a question, give up to 5 short replies that answer it. First the answer the agent recommends, spelled out in full when the question asks several things (for example "B, và ẩn thẻ Pin"), then the other options it named. Each reply must pick a different answer: never two that say the same thing in other words ("build đi" and "ok build đi" are one answer). Fewer replies are better than repeats. Never a bare "ok" or "yes" when the question offers options.

When it does not end with a question, give at most 1 reply, and only for a clear next step: one the agent offered, or a natural follow-up such as drawing a mockup of a layout it described in words, running the tests, or building. Never suggest commit or push: the app offers those itself. When no next step is clear, write NONE.

You may be given messages this person sends often. When one of them is the right reply, give it exactly as written; never pick one only because it is listed.

Output only the replies, one per line, with no numbering, quotes or commentary.`

// replyLabel heads the reply in the prompt, and summaryAsk is what a request for a summary adds after it. The rule is in
// the message, not in systemPrompt, so the system prompt (and the prompt, which is the cache key, of a chip-only call)
// stays what it was.
const (
	replyLabel   = "The end of the agent's last reply:"
	summaryAsk   = `First write one line that starts with "SUMMARY: ", then one or two sentences, at most %d characters, in the language of the person's messages above (the reply's own language when there are none): what the agent did in this turn and what it left undone. Never repeat the question the reply ends on. That line is the only one that is not a reply; after it, give the replies as described next.`
	summaryLabel = "The start and the end of the agent's last reply (the middle is left out):"
)

// BuildPrompt is the call's message: the person's last messages, the end of the reply, what kind of reply to give, and,
// for a Summary request, the ask for a summary line.
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
	label, body := replyLabel, tail(strings.TrimSpace(req.Reply), replyTailRunes)
	if req.Summary {
		label, body = summaryReply(strings.TrimSpace(req.Reply))
	}
	b.WriteString(label + "\n<reply>\n")
	b.WriteString(body)
	b.WriteString("\n</reply>\n\n")
	if req.Summary {
		fmt.Fprintf(&b, summaryAsk+"\n\n", summaryRunes)
	}
	if req.Question {
		b.WriteString("The reply ends with a question: give up to 5 replies that answer it.")
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
	cut, wasCut := tailCut(s, max)
	if wasCut {
		return "…" + cut
	}
	return cut
}

// tailCut is the last max runes of s, starting at a line when one begins in the cut, and whether s was cut at all (s
// itself when it was not).
func tailCut(s string, max int) (string, bool) {
	r := []rune(s)
	if len(r) <= max {
		return s, false
	}
	cut := string(r[len(r)-max:])
	if i := strings.IndexByte(cut, '\n'); i >= 0 && i < len(cut)-1 {
		cut = cut[i+1:]
	}
	return cut, true
}

// summaryReply is the reply a Summary request sends, with the label that heads it: all of it when it is no longer than
// its start and its end together, else its first summaryHeadRunes and its last summaryTailRunes (from a line) with a
// line of "…" between them.
func summaryReply(reply string) (label, body string) {
	r := []rune(reply)
	if len(r) <= summaryHeadRunes+summaryTailRunes {
		return replyLabel, reply
	}
	head := strings.TrimRight(string(r[:summaryHeadRunes]), " \t\r\n")
	cut, _ := tailCut(reply, summaryTailRunes)
	return summaryLabel, head + "\n…\n" + cut
}

var (
	bulletRe     = regexp.MustCompile(`^(?:[-*•]\s+|\d+[.)]\s+)`)
	commitPushRe = regexp.MustCompile(`(?i)\b(commit|push)\b`)
	// an HTML tag the model sometimes answers with or tacks on ("</br>", "<br/>", "<b>…</b>")
	tagRe = regexp.MustCompile(`</?[A-Za-z][A-Za-z0-9]*(?:\s[^<>]*)?/?>`)
)

// saysSomething reports whether a reply holds a letter or a digit: a line of dashes or an ellipsis is no reply.
func saysSomething(s string) bool {
	return strings.IndexFunc(s, func(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) }) >= 0
}

// Answer is what one call gives back: the replies, best first (never nil), and the summary of the turn, "" when none was
// asked for or the model wrote none.
type Answer struct {
	Replies []string
	Summary string
}

// summaryRe is the marker of the summary line: a line whose text starts with it. Nothing else is taken for the summary.
var summaryRe = regexp.MustCompile(`(?i)^SUMMARY:`)

// cutAtWord is s cut to at most max runes at a word, with an ellipsis, when it is longer than max; s itself otherwise.
// s has its words one space apart. Text with no space to cut at (one long run of a script written without them) is cut
// where it falls.
func cutAtWord(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	cut := r[:max-1]
	if r[max-1] != ' ' {
		for i := len(cut) - 1; i > 0; i-- {
			if cut[i] == ' ' {
				cut = cut[:i]
				break
			}
		}
	}
	return strings.TrimRight(string(cut), " ,;:-–—") + "…"
}

// Parse reads the model's answer: one reply per line, numbering, bullets, HTML tags and quotes taken off, NONE and
// lines with no letter or digit left skipped, a reply past replyRunes dropped (a cut reply would send half a sentence), the same reply kept once (sameReply:
// "build di", "ok build đi" and "Build đi!" are one), and at most five answers to a question or one next step. A next step never commits or pushes: the rules offer those.
//
// A line that starts with SUMMARY: (any case) is never a reply. When summary is set, the first such line's rest, folded
// to one line and cut at a word past summaryRunes, is the Answer's Summary; when it is not, the line is dropped. No other line is ever the summary.
func Parse(text string, question, summary bool) Answer {
	limit := maxNext
	if question {
		limit = maxAnswers
	}
	out := []string{}
	sum, seenSummary := "", false
	seen := map[string]bool{}
	for _, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)
		if loc := summaryRe.FindStringIndex(trimmed); loc != nil {
			if summary && !seenSummary {
				sum = cutAtWord(strings.Join(strings.Fields(trimmed[loc[1]:]), " "), summaryRunes)
			}
			seenSummary = true
			continue
		}
		if len(out) == limit {
			continue // the replies are full; a line after them can still be the summary
		}
		s := bulletRe.ReplaceAllString(trimmed, "")
		s = strings.TrimSpace(strings.Trim(strings.TrimSpace(tagRe.ReplaceAllString(s, "")), "\"'`“”‘’"))
		if !saysSomething(s) || strings.EqualFold(strings.TrimRight(s, "."), "NONE") || utf8.RuneCountInString(s) > replyRunes {
			continue
		}
		if !question && commitPushRe.MatchString(s) {
			continue
		}
		key := sameReply(s)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, s)
	}
	return Answer{Replies: out, Summary: sum}
}

// replyFiller is the words that change how a reply sounds, not what it answers: "ok build đi" says "build"
var replyFiller = map[string]bool{
	"ok": true, "oke": true, "okay": true, "okie": true, "yes": true, "uh": true, "um": true, "u": true, "vang": true,
	"di": true, "thoi": true, "nhe": true, "nha": true, "luon": true, "nao": true, "please": true, "pls": true,
}

// sameReply is what counts as one reply twice: its words with the marks, case and punctuation taken off (HabitKey), less
// the filler, in order. A reply of filler alone ("ok") is itself.
func sameReply(s string) string {
	words := strings.FieldsFunc(HabitKey(s), func(r rune) bool { return unicode.IsSpace(r) || unicode.IsPunct(r) })
	kept := words[:0]
	for _, w := range words {
		if !replyFiller[w] {
			kept = append(kept, w)
		}
	}
	if len(kept) == 0 {
		return HabitKey(s)
	}
	return strings.Join(kept, " ")
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
	cache    map[string]Answer
	order    []string
	inflight map[string]*call
}

type call struct {
	done chan struct{}
	out  Answer
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
		cache:    map[string]Answer{},
		inflight: map[string]*call{},
	}
}

// Suggest answers req's replies, and its summary when req asks for one. A reply with no text asks nothing. The prompt
// is the cache key, and a request for a summary has its own prompt, so a turn asked with and without one is two
// entries. The call runs on its own clock, not ctx's, so an ask that gives up does not end the answer another is
// waiting on; a failed call is not kept, so a later ask tries again.
func (s *Suggester) Suggest(ctx context.Context, req Request) (Answer, error) {
	if strings.TrimSpace(req.Reply) == "" {
		return Answer{Replies: []string{}}, nil
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
		go s.do(key, prompt, req.Question, req.Summary, c)
	}
	select {
	case <-c.done:
		return c.out, c.err
	case <-ctx.Done():
		return Answer{}, ctx.Err()
	}
}

func (s *Suggester) do(key, prompt string, question, summary bool, c *call) {
	runCtx, cancel := context.WithTimeout(context.Background(), callTimeout)
	defer cancel()
	select {
	case s.sem <- struct{}{}:
		text, err := s.run(runCtx, prompt)
		<-s.sem
		if err == nil {
			c.out = Parse(text, question, summary)
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
