// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chatjudge

import (
	"context"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// reverse is a shuffle that reverses the list, so the order it gives is known.
func reverse(n int, swap func(i, j int)) {
	for i, j := 0, n-1; i < j; i, j = i+1, j-1 {
		swap(i, j)
	}
}

func noShuffle(int, func(i, j int)) {}

func threeOptions() wshrpc.ChatJudgeRecord {
	return NewRecord("a1:10:abc", "blk-1", "A hay B hay C?",
		[]string{"sửa đi", "ok, làm"},
		[]string{"A, sửa parseFrame", "B, gom byte ở readLoop", "hướng 3 đi"},
		[]string{"đổi ba nơi gọi parseFrame", "gom byte một lần ở readLoop", "tách conn thành hai"},
		"A, sửa parseFrame", "LIGHT-REASON-SENTINEL")
}

func TestJudgePromptBlind(t *testing.T) {
	rec := threeOptions()
	prompt, letters := JudgePrompt(rec, reverse)

	// every option and its description, the question and the person's messages
	for _, want := range []string{
		"A hay B hay C?",
		"A, sửa parseFrame", "đổi ba nơi gọi parseFrame",
		"B, gom byte ở readLoop", "gom byte một lần ở readLoop",
		"hướng 3 đi", "tách conn thành hai",
		"sửa đi", "ok, làm",
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("the prompt lacks %q", want)
		}
	}

	// a fixed shuffle gives the expected ids, opaque and in the order shown
	wantLetters := map[string]string{"o1": "hướng 3 đi", "o2": "B, gom byte ở readLoop", "o3": "A, sửa parseFrame"}
	if !reflect.DeepEqual(letters, wantLetters) {
		t.Errorf("ids %v, want %v", letters, wantLetters)
	}
	i1, i2, i3 := strings.Index(prompt, "o1:"), strings.Index(prompt, "o2:"), strings.Index(prompt, "o3:")
	if i1 < 0 || i1 >= i2 || i2 >= i3 {
		t.Errorf("the options are not listed o1, o2, o3 in order (at %d, %d, %d)", i1, i2, i3)
	}
	if strings.Index(prompt, "hướng 3 đi") > strings.Index(prompt, "B, gom byte ở readLoop") {
		t.Error("the shuffled order is not the one shown")
	}

	// the light pick and its reason are nowhere, and nothing marks the picked option: a record that differs only in the
	// light pick gives the same prompt
	if strings.Contains(prompt, "LIGHT-REASON-SENTINEL") || strings.Contains(prompt, rec.BlockId) {
		t.Error("the prompt carries the light reason or the block id")
	}
	other := rec
	other.Pick, other.Reason = "B, gom byte ở readLoop", "something else"
	if again, _ := JudgePrompt(other, reverse); again != prompt {
		t.Error("the prompt changes with the light pick")
	}

	// ids are never bare letters: option texts begin "A, …" and the question says "A hay B"
	if re := regexp.MustCompile(`(?m)^\s*[-*]?\s*\(?[A-Za-z][.):]\s`); re.MatchString(prompt) {
		t.Errorf("an option is labelled with a bare letter:\n%s", prompt)
	}
	if !strings.Contains(prompt, `"pick":"o2"`) {
		t.Error(`the example result does not show an opaque id ("pick":"o2")`)
	}
	for _, bad := range []string{`"pick":"A"`, `"pick":"B"`, `"pick":"C"`} {
		if strings.Contains(prompt, bad) {
			t.Errorf("the example result shows a letter: %s", bad)
		}
	}
	if !strings.Contains(prompt, "no order") {
		t.Error("the prompt does not say the ids carry no order")
	}
	if strings.Contains(prompt, "[QUESTION]") || strings.Contains(prompt, "[OPTIONS]") || strings.Contains(prompt, "[RECENT]") {
		t.Error("a placeholder was left in the prompt")
	}
	if !strings.Contains(prompt, ".superpowers/") {
		t.Error("the prompt does not forbid reading .superpowers/")
	}

	// no shuffle keeps the order; the person's messages may be none
	rec.Recent = nil
	p2, l2 := JudgePrompt(rec, noShuffle)
	if l2["o1"] != "A, sửa parseFrame" || l2["o3"] != "hướng 3 đi" {
		t.Errorf("ids without a shuffle: %v", l2)
	}
	if !strings.Contains(p2, "(none)") {
		t.Error("no recent messages should read (none)")
	}
}

func TestParseResult(t *testing.T) {
	letters := map[string]string{"o1": "hướng 3 đi", "o2": "B, gom byte ở readLoop", "o3": "A, sửa parseFrame"}

	t.Run("an id", func(t *testing.T) {
		pick, reason, added, err := ParseResult(`{"pick":"o2","reason":"readLoop đã gom đủ byte (conn.go:212).","added":null}`, letters)
		if err != nil || pick != "B, gom byte ở readLoop" || reason != "readLoop đã gom đủ byte (conn.go:212)." || added != nil {
			t.Errorf("got %q, %q, %v, %v", pick, reason, added, err)
		}
	})
	t.Run("NEW with an added option", func(t *testing.T) {
		text := `I read conn.go.
{"pick":"NEW","reason":"one place instead of three","added":{"label":"Gom ở readLoop","desc":"Gom đủ byte trước khi gọi parseFrame.","facts":["conn.go:212 readLoop gom đủ byte"]}}`
		pick, reason, added, err := ParseResult(text, letters)
		want := &wshrpc.ChatJudgeAdded{Label: "Gom ở readLoop", Desc: "Gom đủ byte trước khi gọi parseFrame.", Facts: []string{"conn.go:212 readLoop gom đủ byte"}}
		if err != nil || pick != "Gom ở readLoop" || reason != "one place instead of three" || !reflect.DeepEqual(added, want) {
			t.Errorf("got %q, %q, %+v, %v", pick, reason, added, err)
		}
	})
	t.Run("an added option while a listed one is picked", func(t *testing.T) {
		text := `{"pick":"o3","reason":"fine","added":{"label":"Gom","desc":"d","facts":[]}}`
		pick, _, added, err := ParseResult(text, letters)
		if err != nil || pick != "A, sửa parseFrame" || added == nil || added.Label != "Gom" {
			t.Errorf("got %q, %+v, %v", pick, added, err)
		}
	})
	t.Run("a code fence around it", func(t *testing.T) {
		text := "Here is my judgement:\n```json\n{\"pick\":\"o1\",\"reason\":\"ok\",\"added\":null}\n```\n"
		pick, reason, _, err := ParseResult(text, letters)
		if err != nil || pick != "hướng 3 đi" || reason != "ok" {
			t.Errorf("got %q, %q, %v", pick, reason, err)
		}
	})
	t.Run("the last object wins, and braces in prose are skipped", func(t *testing.T) {
		text := `First thought {"pick":"o1","reason":"early","added":null} then I looked at the {readLoop} again.
{"pick":"o3","reason":"final","added":null}`
		pick, reason, _, err := ParseResult(text, letters)
		if err != nil || pick != "A, sửa parseFrame" || reason != "final" {
			t.Errorf("got %q, %q, %v", pick, reason, err)
		}
	})
	t.Run("errors name what was wrong", func(t *testing.T) {
		cases := []struct{ name, text, want string }{
			{"an unknown id", `{"pick":"o9","reason":"x","added":null}`, "o9"},
			{"a letter", `{"pick":"B","reason":"x","added":null}`, `"B"`},
			{"NEW without added", `{"pick":"NEW","reason":"x","added":null}`, "added"},
			{"an added option with no label", `{"pick":"NEW","reason":"x","added":{"label":" ","desc":"d"}}`, "label"},
			{"an empty reason", `{"pick":"o1","reason":"  ","added":null}`, "reason"},
			{"no pick", `{"reason":"x","added":null}`, "pick"},
			{"no JSON", "I could not decide, sorry.", "JSON"},
			{"an empty reply", "", "JSON"},
			{"a pick that is not a string", `{"pick":3,"reason":"x"}`, "pick"},
		}
		for _, c := range cases {
			pick, reason, added, err := ParseResult(c.text, letters)
			if err == nil {
				t.Errorf("%s: no error (%q, %q, %v)", c.name, pick, reason, added)
				continue
			}
			if !strings.Contains(err.Error(), c.want) {
				t.Errorf("%s: error %q does not name %q", c.name, err, c.want)
			}
		}
	})
}

// scripted is a Runner whose answer to each call is the next step of a script.
type scripted struct {
	mu      sync.Mutex
	calls   int
	prompts []string
	started chan struct{}
	steps   []func(ctx context.Context, onTool func(string)) (string, int, error)
}

func newScripted(steps ...func(ctx context.Context, onTool func(string)) (string, int, error)) *scripted {
	return &scripted{started: make(chan struct{}, 16), steps: steps}
}

func (s *scripted) run(ctx context.Context, cwd, prompt string, onTool func(string)) (string, int, error) {
	s.mu.Lock()
	i := s.calls
	s.calls++
	s.prompts = append(s.prompts, cwd+"\n"+prompt)
	s.mu.Unlock()
	s.started <- struct{}{}
	return s.steps[min(i, len(s.steps)-1)](ctx, onTool)
}

func (s *scripted) callCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls
}

const pickO1 = `{"pick":"o1","reason":"conn.go:212 gom đủ byte.","added":null}`

func immediately(text string, tokens int) func(context.Context, func(string)) (string, int, error) {
	return func(ctx context.Context, onTool func(string)) (string, int, error) { return text, tokens, nil }
}

// blockUntilCancelled is a judge that reads until it is stopped or runs out of time.
func blockUntilCancelled(ctx context.Context, onTool func(string)) (string, int, error) {
	<-ctx.Done()
	return "", 0, ctx.Err()
}

// newJudges is a Judges over a fresh store holding one record under key, with no shuffle.
func newJudges(t *testing.T, key string, run Runner, timeout time.Duration) (*Judges, *Store) {
	t.Helper()
	store, err := OpenStore(filepath.Join(t.TempDir(), "chatjudge.json"))
	if err != nil {
		t.Fatal(err)
	}
	rec := threeOptions()
	rec.Key = key
	if err := store.Put(rec); err != nil {
		t.Fatal(err)
	}
	j := NewJudges(store, run, timeout)
	j.shuffle = noShuffle
	return j, store
}

func waitFor(t *testing.T, what string, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(5 * time.Second):
		t.Fatalf("timed out waiting for %s", what)
	}
}

func TestJudgesDone(t *testing.T) {
	key := "a1:10:abc"
	run := newScripted(func(ctx context.Context, onTool func(string)) (string, int, error) {
		onTool("Read conn.go")
		onTool(`Grep "readLoop" in pkg`)
		onTool("Read conn.go") // one name, counted once
		onTool("Read frame.go")
		onTool("Glob **/*.go")
		return "Done reading.\n" + pickO1, 4321, nil
	})
	j, store := newJudges(t, key, run.run, time.Minute)
	before := time.Now().UnixMilli()
	rec, err := j.Judge(context.Background(), key, `D:\proj`, false)
	if err != nil {
		t.Fatal(err)
	}
	d := rec.Deep
	if d == nil || d.State != wshrpc.ChatJudgeState_Done {
		t.Fatalf("deep = %+v", d)
	}
	if d.Pick != "A, sửa parseFrame" || d.Reason != "conn.go:212 gom đủ byte." || d.Added != nil {
		t.Errorf("result %+v", d)
	}
	if d.Model != "sonnet" || d.Tokens != 4321 || d.Files != 2 {
		t.Errorf("model %q tokens %d files %d, want sonnet 4321 2", d.Model, d.Tokens, d.Files)
	}
	if d.StartTs < before || d.EndTs < d.StartTs {
		t.Errorf("StartTs %d EndTs %d (before %d): want Unix milliseconds in order", d.StartTs, d.EndTs, before)
	}
	if stored, _ := store.Get(key); !reflect.DeepEqual(stored, rec) {
		t.Errorf("the store holds %+v, Judge answered %+v", stored, rec)
	}
	if !strings.HasPrefix(run.prompts[0], `D:\proj`+"\n") || !strings.Contains(run.prompts[0], "o1:") {
		t.Errorf("the run got cwd and prompt %q", run.prompts[0])
	}

	// a done record is answered as it is, with no new run, retry or not
	for _, retry := range []bool{false, true} {
		again, err := j.Judge(context.Background(), key, `D:\proj`, retry)
		if err != nil || !reflect.DeepEqual(again, rec) {
			t.Errorf("retry=%v: %+v, %v", retry, again, err)
		}
	}
	if n := run.callCount(); n != 1 {
		t.Errorf("%d runs, want 1", n)
	}
}

func TestJudgesAddedOption(t *testing.T) {
	key := "a1:10:abc"
	text := `{"pick":"NEW","reason":"một chỗ thay vì ba","added":{"label":"Gom ở readLoop","desc":"Gom đủ byte trước.","facts":["conn.go:212 readLoop gom đủ byte"]}}`
	j, _ := newJudges(t, key, newScripted(immediately(text, 10)).run, time.Minute)
	rec, err := j.Judge(context.Background(), key, `D:\proj`, false)
	if err != nil {
		t.Fatal(err)
	}
	d := rec.Deep
	if d.State != wshrpc.ChatJudgeState_Done || d.Pick != "Gom ở readLoop" || d.Added == nil || d.Added.Label != "Gom ở readLoop" || len(d.Added.Facts) != 1 {
		t.Errorf("deep = %+v", d)
	}
}

func TestJudgesFailures(t *testing.T) {
	key := "a1:10:abc"
	t.Run("a run that fails", func(t *testing.T) {
		failing := newScripted(func(ctx context.Context, onTool func(string)) (string, int, error) {
			return "", 7, errBoom
		})
		j, _ := newJudges(t, key, failing.run, time.Minute)
		rec, err := j.Judge(context.Background(), key, `D:\proj`, false)
		if err != nil {
			t.Fatalf("a failed judge is a record, not an error: %v", err)
		}
		if d := rec.Deep; d.State != wshrpc.ChatJudgeState_Failed || d.Error != errBoom.Error() || d.Tokens != 7 || d.EndTs < d.StartTs {
			t.Errorf("deep = %+v", d)
		}
	})
	t.Run("an answer that does not parse", func(t *testing.T) {
		j, _ := newJudges(t, key, newScripted(immediately("I read it and A looks fine.", 5)).run, time.Minute)
		rec, err := j.Judge(context.Background(), key, `D:\proj`, false)
		if err != nil {
			t.Fatal(err)
		}
		if d := rec.Deep; d.State != wshrpc.ChatJudgeState_Failed || !strings.Contains(d.Error, "JSON") {
			t.Errorf("deep = %+v", d)
		}
	})
	t.Run("no record, no directory", func(t *testing.T) {
		run := newScripted(immediately(pickO1, 1))
		j, _ := newJudges(t, key, run.run, time.Minute)
		if _, err := j.Judge(context.Background(), "a1:99:none", `D:\proj`, false); err == nil {
			t.Error("a key with no record ran a judge")
		}
		if _, err := j.Judge(context.Background(), key, "", false); err == nil {
			t.Error("a judge ran with no working directory: it would read wavesrv's own")
		}
		if n := run.callCount(); n != 0 {
			t.Errorf("%d runs, want 0", n)
		}
	})
}

type boom struct{}

func (boom) Error() string { return "claude exited with status 1" }

var errBoom error = boom{}

func TestJudgesJoinAndStop(t *testing.T) {
	key := "a1:10:abc"

	t.Run("a second call joins the one reading", func(t *testing.T) {
		release := make(chan struct{})
		run := newScripted(func(ctx context.Context, onTool func(string)) (string, int, error) {
			select {
			case <-release:
				return pickO1, 100, nil
			case <-ctx.Done():
				return "", 0, ctx.Err()
			}
		})
		j, store := newJudges(t, key, run.run, time.Minute)
		type out struct {
			rec wshrpc.ChatJudgeRecord
			err error
		}
		first, second := make(chan out, 1), make(chan out, 1)
		go func() {
			rec, err := j.Judge(context.Background(), key, `D:\proj`, false)
			first <- out{rec, err}
		}()
		waitFor(t, "the judge to start", run.started)
		if got, _ := store.Get(key); got.Deep == nil || got.Deep.State != wshrpc.ChatJudgeState_Reading || got.Deep.StartTs == 0 {
			t.Errorf("while the judge reads the record says %+v", got.Deep)
		}
		go func() {
			rec, err := j.Judge(context.Background(), key, `D:\proj`, false)
			second <- out{rec, err}
		}()
		select {
		case o := <-second:
			t.Fatalf("the second call answered before the judge ended: %+v, %v", o.rec.Deep, o.err)
		case <-time.After(50 * time.Millisecond):
		}
		close(release)
		a, b := <-first, <-second
		if a.err != nil || b.err != nil {
			t.Fatalf("errors %v, %v", a.err, b.err)
		}
		if a.rec.Deep == nil || a.rec.Deep.State != wshrpc.ChatJudgeState_Done || !reflect.DeepEqual(a.rec, b.rec) {
			t.Errorf("the two calls got different records:\n%+v\n%+v", a.rec.Deep, b.rec.Deep)
		}
		if n := run.callCount(); n != 1 {
			t.Errorf("%d runs, want 1: the second call started its own", n)
		}
	})

	t.Run("a caller giving up ends only its wait", func(t *testing.T) {
		release := make(chan struct{})
		run := newScripted(func(ctx context.Context, onTool func(string)) (string, int, error) {
			select {
			case <-release:
				return pickO1, 100, nil
			case <-ctx.Done():
				return "", 0, ctx.Err()
			}
		})
		j, store := newJudges(t, key, run.run, time.Minute)
		ctx, cancel := context.WithCancel(context.Background())
		gone := make(chan error, 1)
		go func() {
			_, err := j.Judge(ctx, key, `D:\proj`, false)
			gone <- err
		}()
		waitFor(t, "the judge to start", run.started)
		cancel()
		if err := <-gone; err == nil {
			t.Error("a cancelled wait returned no error")
		}
		if got, _ := store.Get(key); got.Deep == nil || got.Deep.State != wshrpc.ChatJudgeState_Reading {
			t.Fatalf("the judge stopped with its caller: %+v", got.Deep)
		}
		close(release)
		rec, err := j.Judge(context.Background(), key, `D:\proj`, false)
		if err != nil || rec.Deep.State != wshrpc.ChatJudgeState_Done {
			t.Errorf("joining the judge that kept reading: %+v, %v", rec.Deep, err)
		}
		if n := run.callCount(); n != 1 {
			t.Errorf("%d runs, want 1", n)
		}
	})

	t.Run("Stop ends it as stopped, and retry runs again", func(t *testing.T) {
		run := newScripted(blockUntilCancelled, immediately(pickO1, 50))
		j, store := newJudges(t, key, run.run, time.Minute)
		got := make(chan wshrpc.ChatJudgeRecord, 1)
		go func() {
			rec, err := j.Judge(context.Background(), key, `D:\proj`, false)
			if err != nil {
				t.Errorf("Judge: %v", err)
			}
			got <- rec
		}()
		waitFor(t, "the judge to start", run.started)
		if err := j.Stop(key); err != nil {
			t.Fatal(err)
		}
		rec := <-got
		if rec.Deep == nil || rec.Deep.State != wshrpc.ChatJudgeState_Stopped || rec.Deep.EndTs == 0 {
			t.Fatalf("the waiting call got %+v", rec.Deep)
		}
		if stored, _ := store.Get(key); stored.Deep.State != wshrpc.ChatJudgeState_Stopped {
			t.Errorf("the store says %+v", stored.Deep)
		}
		// no judge reading: a no-op
		if err := j.Stop(key); err != nil {
			t.Errorf("a second Stop: %v", err)
		}
		if err := j.Stop("a1:99:none"); err != nil {
			t.Errorf("Stop of a key nothing reads: %v", err)
		}
		// without retry the stopped record is answered as it is
		same, err := j.Judge(context.Background(), key, `D:\proj`, false)
		if err != nil || same.Deep.State != wshrpc.ChatJudgeState_Stopped || run.callCount() != 1 {
			t.Errorf("without retry: %+v, %v, %d runs", same.Deep, err, run.callCount())
		}
		// with retry it runs again: Stop then Judge is never a silent no-op
		again, err := j.Judge(context.Background(), key, `D:\proj`, true)
		if err != nil || again.Deep.State != wshrpc.ChatJudgeState_Done || run.callCount() != 2 {
			t.Errorf("with retry: %+v, %v, %d runs", again.Deep, err, run.callCount())
		}
	})

	t.Run("retry reruns a failed one, and only with retry", func(t *testing.T) {
		run := newScripted(immediately("no object here", 3), immediately(pickO1, 4))
		j, _ := newJudges(t, key, run.run, time.Minute)
		first, err := j.Judge(context.Background(), key, `D:\proj`, false)
		if err != nil || first.Deep.State != wshrpc.ChatJudgeState_Failed {
			t.Fatalf("first: %+v, %v", first.Deep, err)
		}
		same, err := j.Judge(context.Background(), key, `D:\proj`, false)
		if err != nil || !reflect.DeepEqual(same, first) || run.callCount() != 1 {
			t.Errorf("without retry: %+v, %v, %d runs", same.Deep, err, run.callCount())
		}
		again, err := j.Judge(context.Background(), key, `D:\proj`, true)
		if err != nil || again.Deep.State != wshrpc.ChatJudgeState_Done || again.Deep.Error != "" || run.callCount() != 2 {
			t.Errorf("with retry: %+v, %v, %d runs", again.Deep, err, run.callCount())
		}
	})
}

func TestJudgesTimeout(t *testing.T) {
	key := "a1:10:abc"
	run := newScripted(blockUntilCancelled)
	j, _ := newJudges(t, key, run.run, 50*time.Millisecond)
	rec, err := j.Judge(context.Background(), key, `D:\proj`, false)
	if err != nil {
		t.Fatal(err)
	}
	if d := rec.Deep; d.State != wshrpc.ChatJudgeState_Failed || d.Error != "timed out after 50ms" {
		t.Errorf("deep = %+v", d)
	}
}

// The deep judge's claude call reads and never writes, and loads no hooks, plugins or sessions.
func TestSonnetArgs(t *testing.T) {
	args := consult.ClaudeArgs(sonnetOpts)
	at := func(flag string) int { return slices.Index(args, flag) }
	if i := at("--model"); i < 0 || args[i+1] != "sonnet" {
		t.Errorf("no --model sonnet in %v", args)
	}
	i := at("--tools")
	if i < 0 || args[i+1] != "Read,Grep,Glob" {
		t.Fatalf("tools in %v, want Read,Grep,Glob", args)
	}
	for _, flag := range []string{"--setting-sources=", "--no-session-persistence", "--disable-slash-commands"} {
		if n := at(flag); n < 0 || n > i {
			t.Errorf("%q at %d, want one place before --tools (%d) in %v", flag, n, i, args)
		}
	}
	if slices.Contains(args, "--setting-sources") || slices.Contains(args, "") {
		t.Errorf("a separate or empty argument is lost through cmd on Windows: %v", args)
	}
}

func TestJudgeLogLine(t *testing.T) {
	deep := wshrpc.ChatJudgeDeep{State: wshrpc.ChatJudgeState_Done, Model: "sonnet", Tokens: 1234, Files: 14}
	got := judgeLogLine("a1234567:10:0123456789abcdef", deep, 41300*time.Millisecond)
	want := "chatjudge: key=a1234567:10:0123 role=chat-judge state=done model=sonnet tokens=1234 files=14 took=41.3s"
	if got != want {
		t.Errorf("got  %s\nwant %s", got, want)
	}
	if got := judgeLogLine("k", deep, 0); !strings.HasPrefix(got, "chatjudge: key=k role=chat-judge") {
		t.Errorf("a short key: %s", got)
	}
}
