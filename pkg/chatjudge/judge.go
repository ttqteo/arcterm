// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chatjudge

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/rand/v2"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	// Role names the deep judge's cost apart from the chips' haiku call in waveapp.log.
	Role = "chat-judge"
	// Model is the deep judge's model alias.
	Model = "sonnet"
	// Timeout is how long one deep judge may read.
	Timeout = 180 * time.Second

	newPick = "NEW"
)

//go:embed judge-prompt.md
var judgePromptTemplate string

// JudgePrompt is the deep judge's prompt for rec: the question sentence, the options in the order shuffle gives
// (rand.Shuffle) each with its description, and the person's recent messages. The options carry opaque ids o1, o2, …
// in that order, never letters: option texts often begin "A, …" and the question says "A hay B?". The prompt never holds
// the agent's reply or the light pick. letters maps each id to its option's text.
func JudgePrompt(rec wshrpc.ChatJudgeRecord, shuffle func(n int, swap func(i, j int))) (prompt string, letters map[string]string) {
	options := slices.Clone(rec.Options)
	shuffle(len(options), func(i, j int) { options[i], options[j] = options[j], options[i] })
	letters = make(map[string]string, len(options))
	var opts strings.Builder
	for i, o := range options {
		id := fmt.Sprintf("o%d", i+1)
		letters[id] = o.Text
		desc := strings.TrimSpace(o.Desc)
		if desc == "" {
			desc = "(no description)"
		}
		fmt.Fprintf(&opts, "- %s: %q\n  %s\n", id, o.Text, desc)
	}
	var recent strings.Builder
	for _, m := range rec.Recent {
		fmt.Fprintf(&recent, "- %s\n", strings.TrimSpace(m))
	}
	prompt = strings.NewReplacer(
		"[QUESTION]", rec.Question,
		"[OPTIONS]", strings.TrimSuffix(opts.String(), "\n"),
		"[RECENT]", orNone(strings.TrimSuffix(recent.String(), "\n")),
	).Replace(judgePromptTemplate)
	return prompt, letters
}

func orNone(s string) string {
	if s == "" {
		return "(none)"
	}
	return s
}

// ParseResult reads the deep judge's answer: the last JSON object in text (a code fence or prose around it is
// tolerated). pick is an option's text when the object names an id, or the added option's label for NEW. added is the
// option the judge added, whether or not it is the pick. A reply with no object, a pick that names no option, an
// empty reason, NEW without an added option, or an added option with no label is an error that says which.
func ParseResult(text string, letters map[string]string) (pick, reason string, added *wshrpc.ChatJudgeAdded, err error) {
	raw, ok := lastObject(text)
	if !ok {
		return "", "", nil, errors.New("the judge's reply holds no JSON object")
	}
	var res struct {
		Pick   string                 `json:"pick"`
		Reason string                 `json:"reason"`
		Added  *wshrpc.ChatJudgeAdded `json:"added"`
	}
	if err := json.Unmarshal(raw, &res); err != nil {
		return "", "", nil, fmt.Errorf("the judge's JSON object is malformed: %w", err)
	}
	reason = strings.TrimSpace(res.Reason)
	if reason == "" {
		return "", "", nil, errors.New("the judge's reason is empty")
	}
	if res.Added != nil && strings.TrimSpace(res.Added.Label) == "" {
		return "", "", nil, errors.New("the judge's added option has no label")
	}
	id := strings.TrimSpace(res.Pick)
	switch id {
	case "":
		return "", "", nil, errors.New("the judge's JSON object has no pick")
	case newPick:
		if res.Added == nil {
			return "", "", nil, errors.New("the judge picked NEW but gave no added option")
		}
		return res.Added.Label, reason, res.Added, nil
	}
	optionText, known := letters[id]
	if !known {
		return "", "", nil, fmt.Errorf("the judge's pick %q names no option", id)
	}
	return optionText, reason, res.Added, nil
}

// lastObject is the last JSON object in text that is not inside another: a '{' that starts a complete object is taken
// whole and the scan goes on past it; a '{' that does not (braces in prose) is skipped.
func lastObject(text string) (json.RawMessage, bool) {
	var last json.RawMessage
	for i := 0; i < len(text); {
		j := strings.IndexByte(text[i:], '{')
		if j < 0 {
			break
		}
		start := i + j
		dec := json.NewDecoder(strings.NewReader(text[start:]))
		var obj json.RawMessage
		if err := dec.Decode(&obj); err != nil {
			i = start + 1
			continue
		}
		last = bytes.Clone(obj)
		i = start + int(dec.InputOffset())
	}
	return last, last != nil
}

// Runner is one deep judge's run: the prompt in, the model's final text and the run's token total out. It calls onTool
// with a description of each tool call the model makes ("Read conn.go"), one at a time, before it returns, and stops
// when ctx ends.
type Runner func(ctx context.Context, cwd, prompt string, onTool func(string)) (text string, tokens int, err error)

// sonnetOpts is the deep judge's claude call: Read, Grep and Glob only (no Bash, Edit or Write), with no settings sources
// (so no hooks or plugins, the arc mod among them), no slash commands, and no session left in the project's history.
// "--setting-sources=" is one argument: an empty one is lost through cmd on Windows and the next flag would become its
// value.
var sonnetOpts = consult.CallOpts{
	Model:     Model,
	Tools:     []string{"Read", "Grep", "Glob"},
	ExtraArgs: []string{"--setting-sources=", "--no-session-persistence", "--disable-slash-commands"},
}

// RunSonnet is the production Runner: sonnetOpts in cwd.
func RunSonnet(ctx context.Context, cwd, prompt string, onTool func(string)) (string, int, error) {
	text, usage, err := consult.RunClaude(ctx, cwd, prompt, sonnetOpts, onTool)
	return text, usage.TotalTokens, err
}

// Judges runs the deep judges, at most one per record key.
type Judges struct {
	store   *Store
	run     Runner
	timeout time.Duration
	shuffle func(n int, swap func(i, j int))

	mu     sync.Mutex
	flight map[string]*flight
}

// flight is the deep judge reading one key. Its rec and err are set, then done closed, once the record is final
// (by the run's end, or by Stop). stopped is guarded by Judges.mu.
type flight struct {
	done    chan struct{}
	cancel  context.CancelFunc
	stopped bool
	rec     wshrpc.ChatJudgeRecord
	err     error
}

// NewJudges makes the judges over store. run is RunSonnet when nil and timeout is Timeout when not positive.
func NewJudges(store *Store, run Runner, timeout time.Duration) *Judges {
	if run == nil {
		run = RunSonnet
	}
	if timeout <= 0 {
		timeout = Timeout
	}
	return &Judges{store: store, run: run, timeout: timeout, shuffle: rand.Shuffle, flight: map[string]*flight{}}
}

// Judge runs the deep judge on the turn key names, in cwd (the agent's directory), and answers the record once it ends.
//   - no record under key, or no cwd: an error (a judge with no cwd would read wavesrv's own directory)
//   - a record whose deep result is done, or failed or stopped without retry: that record as it is, with no run
//   - a judge already reading key: wait on it, so a remounted pane or a second window gets the same answer. ctx ending
//     stops only this wait, never the judge
//   - otherwise a judge starts on its own clock (Timeout) and the call waits on it
//
// A judge that fails, times out or gives an answer that does not parse is not an error here: the record's deep result
// says failed, and why. An error that comes with a record is the store's write failing: the record is as it is in memory.
func (j *Judges) Judge(ctx context.Context, key, cwd string, retry bool) (wshrpc.ChatJudgeRecord, error) {
	j.mu.Lock()
	if f := j.flight[key]; f != nil {
		j.mu.Unlock()
		return f.wait(ctx)
	}
	rec, ok := j.store.Get(key)
	if !ok {
		j.mu.Unlock()
		return wshrpc.ChatJudgeRecord{}, fmt.Errorf("chatjudge: no record under %q", key)
	}
	if d := rec.Deep; d != nil {
		if d.State == wshrpc.ChatJudgeState_Done || (!retry && (d.State == wshrpc.ChatJudgeState_Failed || d.State == wshrpc.ChatJudgeState_Stopped)) {
			j.mu.Unlock()
			return rec, nil
		}
	}
	if strings.TrimSpace(cwd) == "" {
		j.mu.Unlock()
		return wshrpc.ChatJudgeRecord{}, errors.New("chatjudge: the judge needs the agent's working directory")
	}
	start := time.Now()
	// reading is set in memory at once so a list or a joining call sees it; a failed write is logged by the store and
	// the final write's error is the one returned
	_, _ = j.store.SetDeep(key, wshrpc.ChatJudgeDeep{State: wshrpc.ChatJudgeState_Reading, StartTs: start.UnixMilli(), Model: Model})
	runCtx, cancel := context.WithTimeout(context.Background(), j.timeout)
	f := &flight{done: make(chan struct{}), cancel: cancel}
	j.flight[key] = f
	j.mu.Unlock()

	go j.read(runCtx, f, key, cwd, rec, start)
	return f.wait(ctx)
}

func (f *flight) wait(ctx context.Context) (wshrpc.ChatJudgeRecord, error) {
	select {
	case <-f.done:
		return f.rec, f.err
	case <-ctx.Done():
		return wshrpc.ChatJudgeRecord{}, ctx.Err()
	}
}

// read is one judge's run and its end: the deep result is stored and the flight finished, unless Stop got there first.
func (j *Judges) read(ctx context.Context, f *flight, key, cwd string, rec wshrpc.ChatJudgeRecord, start time.Time) {
	defer f.cancel()
	prompt, letters := JudgePrompt(rec, j.shuffle)
	files := map[string]struct{}{}
	onTool := func(desc string) {
		if name, ok := strings.CutPrefix(desc, "Read "); ok {
			files[name] = struct{}{}
		}
	}
	text, tokens, err := j.run(ctx, cwd, prompt, onTool)

	deep := wshrpc.ChatJudgeDeep{StartTs: start.UnixMilli(), Model: Model, Tokens: tokens, Files: len(files)}
	switch {
	case err != nil && errors.Is(ctx.Err(), context.DeadlineExceeded):
		deep.State, deep.Error = wshrpc.ChatJudgeState_Failed, fmt.Sprintf("timed out after %s", j.timeout)
	case err != nil:
		deep.State, deep.Error = wshrpc.ChatJudgeState_Failed, err.Error()
	default:
		pick, reason, added, perr := ParseResult(text, letters)
		if perr != nil {
			deep.State, deep.Error = wshrpc.ChatJudgeState_Failed, perr.Error()
		} else {
			deep.State, deep.Pick, deep.Reason, deep.Added = wshrpc.ChatJudgeState_Done, pick, reason, added
		}
	}
	deep.EndTs = time.Now().UnixMilli()

	// the store write and the flight's removal are one step under mu, so a Stop sees the flight or sees it final
	j.mu.Lock()
	if f.stopped {
		deep.State, deep.Error = wshrpc.ChatJudgeState_Stopped, ""
	} else {
		f.rec, f.err = j.store.SetDeep(key, deep)
		delete(j.flight, key)
		close(f.done)
	}
	j.mu.Unlock()
	log.Println(judgeLogLine(key, deep, time.Since(start)))
}

// Stop cancels the judge reading key and sets its record's deep result to stopped; a call waiting on the judge gets that
// record. No judge reading key is a no-op. The flight is gone when Stop returns, so a Judge with retry right after
// starts a new one.
func (j *Judges) Stop(key string) error {
	j.mu.Lock()
	f := j.flight[key]
	if f == nil {
		j.mu.Unlock()
		return nil
	}
	f.stopped = true
	delete(j.flight, key)
	stopped := wshrpc.ChatJudgeDeep{State: wshrpc.ChatJudgeState_Stopped, Model: Model, EndTs: time.Now().UnixMilli()}
	if rec, ok := j.store.Get(key); ok && rec.Deep != nil {
		stopped.StartTs = rec.Deep.StartTs
	}
	f.rec, f.err = j.store.SetDeep(key, stopped)
	close(f.done)
	j.mu.Unlock()
	f.cancel()
	return f.err
}

// judgeLogLine is the one line waveapp.log gets for each judge: the run keeps no transcript for usagestats to read, and
// the role names its cost apart from the chips' haiku.
func judgeLogLine(key string, deep wshrpc.ChatJudgeDeep, took time.Duration) string {
	return fmt.Sprintf("chatjudge: key=%s role=%s state=%s model=%s tokens=%d files=%d took=%s",
		key[:min(len(key), 16)], Role, deep.State, Model, deep.Tokens, deep.Files, took.Round(100*time.Millisecond))
}
