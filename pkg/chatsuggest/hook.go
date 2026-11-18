// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chatsuggest

// Hooks: the replies a Claude agent's own claude works out at the end of its turn (the arc mod,
// claude/arc-mod/hooks/register.ts suggestReplies), so Chat's ask is answered without starting a claude of its own
// (RunClaude: 3-4 s and ~470 MB to start, where the mod's completion runs in a process already up).
//
// Begin gives the mod the call to make (this file's prompt and the person's habits, so the prompt stays in one place)
// and marks the block's turn as on its way; End brings back what the model answered, read by Parse; Await lets Chat's
// ask (ChatSuggestCommand) take that answer. An ask whose turn the mod did not begin, or whose answer did not come in
// time, runs the headless call as before: the mod is not loaded, its hook failed, or the agent is not claude.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	// how long an ask for a Claude agent waits for its mod to begin the turn: the mod's begin and Chat's ask both start
	// at the turn's end, and either can arrive first
	hookAppear = 2 * time.Second
	// how long after Begin an ask waits for End before it runs the headless call: the completion takes 1-4 s
	hookMax = 10 * time.Second
	// the end of a reply that names its turn: Chat's transcript entry and the mod's answer can differ in spacing only
	replyKeyRunes = 400
)

// HookCall is what Begin gives the mod: the completion to run, and the key End hands back.
type HookCall struct {
	Key      string
	System   string
	Prompt   string
	Question bool
}

type hookEntry struct {
	key      string
	question bool
	started  time.Time
	done     chan struct{}
	ended    bool
	out      []string
	ok       bool
}

// Hooks keeps each block's latest turn the mod began, and its answer once it ends.
type Hooks struct {
	appear time.Duration
	max    time.Duration

	mu      sync.Mutex
	byBlock map[string]*hookEntry
	// closed and replaced at each Begin, so an Await waiting for its turn to begin wakes
	changed chan struct{}
}

// NewHooks makes an empty Hooks.
func NewHooks() *Hooks {
	return &Hooks{appear: hookAppear, max: hookMax, byBlock: map[string]*hookEntry{}, changed: make(chan struct{})}
}

// Begin marks block's turn, the one that ended on req.Reply, as on its way, and answers the call the mod makes for it.
// The question is worked out here, as Chat works it out (EndsWithQuestion), so both ask the same.
func (h *Hooks) Begin(block string, req Request) HookCall {
	req.Question = EndsWithQuestion(req.Reply)
	prompt := BuildPrompt(req)
	// the reply's key first, which Await matches on; then the call's own, so an End for an older Begin of the same
	// reply (the person sent nothing new and the turn ran again) is told apart
	sum := sha256.Sum256([]byte(prompt + "\x00" + time.Now().String()))
	e := &hookEntry{
		key:      ReplyKey(req.Reply) + "\x00" + hex.EncodeToString(sum[:8]),
		question: req.Question,
		started:  time.Now(),
		done:     make(chan struct{}),
	}
	h.mu.Lock()
	h.byBlock[block] = e
	close(h.changed)
	h.changed = make(chan struct{})
	h.mu.Unlock()
	return HookCall{Key: e.key, System: systemPrompt, Prompt: prompt, Question: req.Question}
}

// End brings back the model's answer to the turn Begin keyed `key`; failed says the mod got none. An end for a turn a
// newer Begin replaced, or one already ended, is dropped.
func (h *Hooks) End(block, key, text string, failed bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	e := h.byBlock[block]
	if e == nil || e.key != key || e.ended {
		return
	}
	e.ended = true
	if !failed {
		e.out = Parse(text, e.question, false).Replies
		e.ok = true
	}
	close(e.done)
}

// Await answers the replies the mod worked out for block's turn that ended on reply, and whether it did: false when
// the mod did not begin that turn within the wait (expect: the agent is a Claude agent, which has a mod; otherwise no
// wait), began it for another kind of reply, failed, or did not end it in time. False means: run the headless call.
func (h *Hooks) Await(ctx context.Context, block, reply string, question, expect bool) ([]string, bool) {
	if block == "" {
		return nil, false
	}
	key := ReplyKey(reply)
	var appearBy time.Time
	if expect {
		appearBy = time.Now().Add(h.appear)
	}
	for {
		h.mu.Lock()
		e := h.byBlock[block]
		changed := h.changed
		h.mu.Unlock()
		if e != nil && strings.HasPrefix(e.key, key+"\x00") {
			if e.question != question {
				return nil, false
			}
			return h.wait(ctx, e)
		}
		left := time.Until(appearBy)
		if left <= 0 {
			return nil, false
		}
		timer := time.NewTimer(left)
		select {
		case <-changed:
			timer.Stop()
		case <-timer.C:
			return nil, false
		case <-ctx.Done():
			timer.Stop()
			return nil, false
		}
	}
}

func (h *Hooks) wait(ctx context.Context, e *hookEntry) ([]string, bool) {
	answer := func() ([]string, bool) {
		h.mu.Lock()
		defer h.mu.Unlock()
		return e.out, e.ok
	}
	select {
	case <-e.done:
		return answer()
	default:
	}
	left := time.Until(e.started.Add(h.max))
	if left <= 0 {
		return nil, false
	}
	timer := time.NewTimer(left)
	defer timer.Stop()
	select {
	case <-e.done:
		return answer()
	case <-timer.C:
		return nil, false
	case <-ctx.Done():
		return nil, false
	}
}

// ReplyKey is what names a turn by its reply: its last replyKeyRunes runes with the spacing folded, so Chat's
// transcript entry and the mod's answer of the same turn meet.
func ReplyKey(reply string) string {
	s := strings.Join(strings.Fields(reply), " ")
	if n := utf8.RuneCountInString(s); n > replyKeyRunes {
		s = string([]rune(s)[n-replyKeyRunes:])
	}
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:12])
}

var (
	fenceRe        = regexp.MustCompile("(?s)```.*?(```|$)")
	trailingMarkRe = regexp.MustCompile("[=*_`\"'”’)\\]\\s]+$")
)

// EndsWithQuestion reports whether the reply's last line of prose ends with a question mark: fenced code (a card block
// written after the question) is not prose, and the emphasis and highlight marks around a sentence do not count. Chat
// works it out the same way (frontend/app/view/agents/chatsuggest.ts endsWithQuestion); the two must agree, or the
// mod's answer is set aside for the headless call.
func EndsWithQuestion(reply string) bool {
	prose := fenceRe.ReplaceAllString(reply, "")
	lines := strings.Split(prose, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		bare := trailingMarkRe.ReplaceAllString(line, "")
		return strings.HasSuffix(bare, "?") || strings.HasSuffix(bare, "？")
	}
	return false
}
