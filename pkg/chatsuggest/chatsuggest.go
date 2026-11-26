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
// while it runs (measured 2026-11-18). Haiku thinks before it answers, 150-500 tokens; `--effort low` (Effort) cuts
// that to ~80 and the API time from ~2 s to ~1.3 s (measured 2026-11-19).
package chatsuggest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
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
	// how hard it thinks first: low, as the replies are a short pick, not a judgment
	Effort = "low"
	// the end of the reply that is sent: the question or the next step is in its last lines
	replyTailRunes = 1500
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
}

const systemPrompt = `You suggest what a person will send next to a coding agent, as one-tap replies in a chat app.

Write each reply the way this person writes: their language and their short, casual wording, as in their messages. Keep each under 40 characters when you can, never over 60.

A reply only chooses or asks; it never states a fact. Never write something only the person knows (whether a customer uses a product, what they tried, what they saw, a name, a number) as if you knew it: offer the choice and leave the fact out.

When the agent's reply ends with a question, give up to 5 short replies that answer it: the options it named, in the order you think reads best, each in a few words ("hướng 1 đi", "sửa code luôn"). Every option the question names gets a reply of its own, even when the agent recommends another: "A hay B?" gets one reply that picks A and one that picks B. When the question asks several things, the first reply answers all of them ("B, và ẩn thẻ Pin"), and the next ones change the main choice before the side questions: "A hay B, và có thêm X không?" gets "A, thêm X", "B đi", "A, bỏ X", never four replies that all pick A. Each reply must pick a different answer: never two that say the same thing in other words ("build đi" and "ok build đi" are one answer). Fewer replies are better than repeats. Never a bare "ok" or "yes" when the question offers options. When the question asks yes or no, the app shows yes and no itself: give only replies that say more (a condition, a part of it, something else to do), never the question's own action said back ("đổi luôn đi" to "Đổi luôn không?"), or NONE.

When the question offers options (it is not a yes-or-no question), also write, on the line right after each reply, one line in this form: = <what this option does, one neutral line: no praise or blame, no word on which one the agent prefers>, in the language of the question (as in "= sửa ở ba nơi gọi parseFrame"). Then, as the last line, write one line in this form: PICK <n>: <one sentence why>, where n is the number of the reply (count only the replies, from 1, not the "=" lines) that you judge the reasonable answer for what this person is doing. Choose it for yourself, on the merits: it may be the option the agent recommends or another one. Write these two kinds of line only for such a question.

When it does not end with a question, give at most 1 reply, and only when the agent has stopped and offers a next step the person must start: one it named ("I can also add tests"), or one its work plainly leads to, such as drawing a mockup of a layout it described in words. Write NONE when the agent says it is still working, will carry on, is waiting on something running, or will report back; when it only reports what it did; or when no next step is clear. Never tell it to go ahead with work it already said it will do. Never suggest commit or push: the app offers those itself.

You may be given messages this person sends often. They show how the person words things. Give one exactly as written only when it is exactly the reply this turn calls for, never because it is listed: "build đi" after a reply about a script that has nothing to build is wrong.

Output only the replies, one per line, with no numbering, quotes or commentary, and the "=" and PICK lines above where they apply.`

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
		b.WriteString("The reply ends with a question, perhaps with a sentence or two after it: give up to 5 replies that answer it.")
	} else {
		b.WriteString("The reply does not end with a question: give at most 1 reply, or NONE.")
	}
	return b.String()
}

// promptHabits is the habits the prompt lists: at most HabitMax, one line each, none that commits or pushes (the rules
// offer those, and ParseAnswer would drop the reply).
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
	// an HTML tag the model sometimes answers with or tacks on ("</br>", "<br/>", "<b>…</b>")
	tagRe = regexp.MustCompile(`</?[A-Za-z][A-Za-z0-9]*(?:\s[^<>]*)?/?>`)
)

// saysSomething reports whether a reply holds a letter or a digit: a line of dashes or an ellipsis is no reply.
func saysSomething(s string) bool {
	return strings.IndexFunc(s, func(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) }) >= 0
}

// pickRe is the model's pick line: "PICK 2: why", the number then ":", "-", "–" or "—".
var pickRe = regexp.MustCompile(`(?i)^PICK\s*(\d+)\s*[:\-–—]\s*(.*)$`)

// Answer is what the model said: the replies to offer, what each one does, and the one it picks.
type Answer struct {
	// the replies, best first as the model ordered them; never nil
	Replies []string
	// what each reply's option does, in one neutral line, parallel to Replies ("" where the model wrote none); nil when
	// it wrote none at all
	Descs []string
	// the text of the reply the model picked, and its one-sentence reason: both "" when it picked none, or picked a
	// reply ParseAnswer dropped or a number that names none, so a pick always names a chip
	Pick   string
	Reason string
}

// ParseAnswer reads the model's answer. The replies: one per line, numbering, bullets, HTML tags and quotes taken off,
// NONE and lines with no letter or digit left skipped, a reply past replyRunes dropped (a cut reply would send half a
// sentence), the same reply kept once (sameReply: "build di", "ok build đi" and "Build đi!" are one), and at most five
// answers to a question or one next step. A next step never commits or pushes: the rules offer those. They come best
// first, never nil.
//
// For a question only, a line that starts with "=" describes the reply line right before it (Descs), so it is read
// before the reply rules and never becomes a chip; it goes with its reply when that reply is dropped. A "PICK n: why"
// line picks the model's nth reply line, counting every line it wrote as a reply, dropped or not. Another turn reads
// neither line, and neither becomes a reply there either.
func ParseAnswer(text string, question bool) Answer {
	limit := maxNext
	if question {
		limit = maxAnswers
	}
	out := []string{}
	descs := []string{} // parallel to out
	seen := map[string]bool{}
	// where each reply line the model wrote went in out, -1 when it was dropped: a pick names a reply by that number
	var where []int
	last := -1 // the reply line just read, as an index of out; -1 when it was dropped
	pick, reason := 0, ""
	for _, line := range strings.Split(text, "\n") {
		s := bulletRe.ReplaceAllString(strings.TrimSpace(line), "")
		if strings.HasPrefix(s, "=") {
			if question && last >= 0 && descs[last] == "" {
				descs[last] = strings.TrimSpace(tagRe.ReplaceAllString(strings.TrimLeft(s, "="), ""))
			}
			continue
		}
		if m := pickRe.FindStringSubmatch(s); m != nil {
			if question {
				pick, _ = strconv.Atoi(m[1])
				reason = strings.TrimSpace(m[2])
			}
			continue
		}
		s = strings.TrimSpace(strings.Trim(strings.TrimSpace(tagRe.ReplaceAllString(s, "")), "\"'`“”‘’"))
		if !saysSomething(s) || strings.EqualFold(strings.TrimRight(s, "."), "NONE") {
			continue
		}
		key := sameReply(s)
		keep := utf8.RuneCountInString(s) <= replyRunes && len(out) < limit && !seen[key] &&
			(question || !commitPushRe.MatchString(s))
		if !keep {
			where = append(where, -1)
			last = -1
			continue
		}
		seen[key] = true
		out = append(out, s)
		descs = append(descs, "")
		last = len(out) - 1
		where = append(where, last)
	}
	ans := Answer{Replies: out}
	for _, d := range descs {
		if d != "" {
			ans.Descs = descs
			break
		}
	}
	if pick >= 1 && pick <= len(where) && where[pick-1] >= 0 {
		ans.Pick, ans.Reason = out[where[pick-1]], reason
	}
	return ans
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
		"--setting-sources", "", "--system-prompt", systemPrompt, "--no-session-persistence", "--disable-slash-commands",
		"--effort", Effort)
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

// Suggest answers req's replies, with their descriptions and the model's pick. A reply with no text asks nothing. The prompt is the cache key. The call runs on its own clock, not ctx's, so an ask that gives up does not end the answer another is
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
		go s.do(key, prompt, req.Question, c)
	}
	select {
	case <-c.done:
		return c.out, c.err
	case <-ctx.Done():
		return Answer{}, ctx.Err()
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
			c.out = ParseAnswer(text, question)
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
