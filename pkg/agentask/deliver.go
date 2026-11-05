// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentask

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
)

// ErrNoPendingAsk is DeliverAnswer's refusal when the oref has no pending ask: it was never asked, was
// already answered, or was cleared. A caller must hear that its answer went nowhere.
var ErrNoPendingAsk = errors.New("no pending question")

// sendInput is indirected so tests can capture keystrokes without a live block PTY.
var sendInput = func(blockId string, data []byte) error {
	return blockcontroller.SendInput(blockId, &blockcontroller.BlockInputUnion{InputData: data})
}

// SetSendInputForTest swaps the keystroke sink for a test outside this package, which has no PTY to
// type into, and returns the restore.
func SetSendInputForTest(fn func(blockId string, data []byte) error) func() {
	orig := sendInput
	sendInput = fn
	return func() { sendInput = orig }
}

// AnswerHook runs after a delivered answer, whichever path delivered it — the cockpit panel, the
// server-side Gatekeeper actuator, or the dag lead's `wsh jarvis dag answer`. All three claim through
// DeliverAnswer, so hooking here is what stops them recording the ask lifecycle three different ways
// (or, for two of them, not at all). Wired once at server startup; nil = no-op.
var AnswerHook func(oref, askId string)

// HoldAnswer reports whether the agent behind oref is suspended, so its answer is held rather than typed (jarvis sets
// it to "the block's run is paused"). nil = never held.
var HoldAnswer func(oref string) bool

// HeldAnswer is an answer kept for a suspended agent: one of the ask's questions and what the person answered, the
// option labels they picked or the text they typed.
type HeldAnswer struct {
	Question string
	Answers  []string
}

// TakeHeldAnswers returns the answers held for oref and forgets them, so each reaches the agent once: the resume
// nudge carries them.
func TakeHeldAnswers(oref string) []HeldAnswer {
	return GlobalRegistry.takeHeld(oref)
}

// DeliverAnswer atomically claims the pending ask for oref, then injects its answers into the native
// picker. It returns delivered=false with ErrNoPendingAsk when no ask is pending (already answered in the
// terminal or cleared), or when askid != "" and no longer matches the pending ask — a caller that claimed
// mid-inject sees the same idempotent refusal AnswerAgentCommand and the Gatekeeper actuator get. Claiming
// makes concurrent deliveries mutually exclusive: exactly one caller injects; the rest see delivered=false.
// It delivers one keystroke per PTY write with KeystrokeDelay between each (a single combined write races
// the picker's React state and confirms the wrong option).
//
// Error recovery mirrors what has already been sent: an EncodeAnswer failure sends no keystrokes, so the
// pending ask is restored and a retry is safe; a mid-inject sendInput failure has already put a partial
// keystroke prefix into the picker, so the entry stays claimed (dropped) — restoring would risk a
// double-send on retry.
func DeliverAnswer(oref, askid string, answers []baseds.AgentAnswerItem) (bool, error) {
	pending, ok := GlobalRegistry.claimToAnswer(oref, askid)
	if !ok {
		return false, fmt.Errorf("%w for %s", ErrNoPendingAsk, oref)
	}
	var delivered bool
	var err error
	if HoldAnswer != nil && HoldAnswer(oref) {
		delivered, err = holdAnswer(oref, pending, answers)
	} else {
		delivered, err = injectAnswer(oref, pending, answers)
	}
	if delivered && AnswerHook != nil {
		AnswerHook(oref, pending.AskId)
	}
	return delivered, err
}

// holdAnswer keeps a claimed ask's answers for the resume nudge instead of typing them: the agent's process is gone,
// and keystrokes into a dead TUI would vanish. It counts as delivered, since the person's answer is recorded and
// will reach the agent. An answer that fails the rules a typed one must pass is refused and the ask restored, so
// the person can answer again; nothing is in flight afterwards, because no clear will come.
func holdAnswer(oref string, pending PendingAsk, answers []baseds.AgentAnswerItem) (bool, error) {
	if err := ValidateAnswers(pending.Questions, answers, pending.Prose); err != nil {
		GlobalRegistry.endAnswer(oref, &pending)
		return false, err
	}
	held := make([]HeldAnswer, len(pending.Questions))
	for i, q := range pending.Questions {
		held[i] = HeldAnswer{Question: q.Question, Answers: answerTexts(q, answers[i])}
	}
	GlobalRegistry.hold(oref, held)
	GlobalRegistry.endAnswer(oref, nil)
	return true, nil
}

// answerTexts is what an answer says: its free text, or the labels of the options it picked. ValidateAnswers has
// already checked every index is in range.
func answerTexts(q baseds.AgentAskQuestion, a baseds.AgentAnswerItem) []string {
	if a.Text != "" {
		return []string{a.Text}
	}
	labels := make([]string, len(a.SelectedIndexes))
	for i, idx := range a.SelectedIndexes {
		labels[i] = q.Options[idx].Label
	}
	return labels
}

// injectAnswer delivers a claimed ask's answers, returning whether the agent actually received them.
func injectAnswer(oref string, pending PendingAsk, answers []baseds.AgentAnswerItem) (bool, error) {
	// waiter path (pi ask bridge): a --wait caller registered on this ask — resolve it
	// directly. pi has no native picker to drive, so keystrokes would type into the
	// session; the waiter is the delivery. No waiter -> CC path (keystroke injection).
	if GlobalRegistry.ResolveWaiter(pending.AskId, WaitResult{Answers: answers}) {
		GlobalRegistry.endAnswer(oref, nil)
		return true, nil
	}
	answers = foldAnswers(answers)
	var keys [][]byte
	var err error
	var typedText string
	if pending.Prose {
		typedText, err = proseAnswerText(pending, answers)
		keys = proseTextKeys(typedText)
	} else {
		keys, err = EncodeAnswer(pending.Questions, answers)
		typedText = promptTypedText(pending.Questions, answers)
	}
	if err != nil {
		GlobalRegistry.endAnswer(oref, &pending) // nothing sent yet — safe to restore for retry
		return false, err
	}
	// a dag child's transcript shows an answer typed as a prompt as the human's, so the engine is told before the first
	// key and can never read the prompt without knowing whose it is
	sentAt := time.Now().UnixMilli()
	typedForTask := typedText != "" && pending.DagOID != "" && pending.TaskId != ""
	if typedForTask {
		GlobalRegistry.noteTyped(pending, typedText, sentAt)
	}
	for i, k := range keys {
		if i > 0 {
			time.Sleep(KeystrokeDelay)
		}
		if err := sendInput(pending.BlockId, k); err != nil {
			if typedForTask {
				GlobalRegistry.forgetTyped(pending, sentAt) // enter goes last, so nothing was submitted
			}
			GlobalRegistry.endAnswer(oref, nil)
			return false, err // partial prefix already sent — do NOT restore
		}
	}
	// an answer is not delivered until the agent clears the ask (spec §5): keystrokes into a picker
	// that was not listening vanish, and nothing else would notice the agent still waiting — true for a
	// dag child as much as for a plain session, so every keystroke delivery awaits its clear.
	GlobalRegistry.awaitClear(oref, time.Now().UnixMilli())
	return true, nil
}

const foldedLineBreak = " | "

var lineBreakRun = regexp.MustCompile(`[ \t]*[\r\n][ \t\r\n]*`)

// foldAnswerLines puts a multi-line answer on the one line a terminal takes: a typed line break would submit
// the answer half written. Text with no break comes back untouched.
// ponytail: typed one rune per KeystrokeDelay, so a long folded answer is slow; a bracketed paste if this path matters
func foldAnswerLines(text string) string {
	if !strings.ContainsAny(text, "\r\n") {
		return text
	}
	folded := lineBreakRun.ReplaceAllString(text, foldedLineBreak)
	return strings.TrimSuffix(strings.TrimPrefix(folded, foldedLineBreak), foldedLineBreak)
}

// foldAnswers folds each answer's text into a copy: the caller's answers are also what a waiter would receive.
func foldAnswers(answers []baseds.AgentAnswerItem) []baseds.AgentAnswerItem {
	out := make([]baseds.AgentAnswerItem, len(answers))
	for i, a := range answers {
		a.Text = foldAnswerLines(a.Text)
		out[i] = a
	}
	return out
}

// proseAnswerText is the text a prose ask's answer is typed as. Prose asks have no native
// picker, so an index answer resolves to the option label and the text is typed verbatim
// (text + enter). Error semantics match EncodeAnswer: nothing is typed on failure, so the
// caller can restore the pending ask and retry safely.
func proseAnswerText(pending PendingAsk, answers []baseds.AgentAnswerItem) (string, error) {
	if err := ValidateAnswers(pending.Questions, answers, true); err != nil {
		return "", err
	}
	if answers[0].Text != "" {
		return answers[0].Text, nil
	}
	// the answer itself is valid, but the label it resolves to is typed too, so it must be typeable
	text := pending.Questions[0].Options[answers[0].SelectedIndexes[0]].Label
	if err := validateFreeText(text); err != nil {
		return "", err
	}
	return text, nil
}
