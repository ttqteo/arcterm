// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usageinsights

import (
	"context"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

var fixedNow = func() time.Time { return time.Date(2026, 10, 8, 9, 30, 0, 0, time.UTC) }

// minimalReply is the smallest answer the card accepts: a headline and nothing else.
const minimalReply = `{"headline":"A","levers":[],"opusclear":[],"tips":[]}`

// scriptRun swaps the model seam for the test and restores it afterwards.
func scriptRun(t *testing.T, fn func(ctx context.Context, prompt string) (string, error)) {
	t.Helper()
	prev := run
	run = fn
	t.Cleanup(func() { run = prev })
}

// candidateLevers is a request's levers: S1/S2 under longctx, S3/S4 under opus.
func candidateLevers() []Lever {
	return []Lever{
		{Key: "longctx", Count: 2, Sessions: []LeverSession{
			{Ref: "S1", ID: "id-1", Title: "one", SaveUsd: 4.5},
			{Ref: "S2", ID: "id-2", Title: "two", SaveUsd: 1.25},
		}},
		{Key: "opus", Sessions: []LeverSession{
			{Ref: "S3", ID: "id-3", Title: "three", SaveUsd: 9},
			{Ref: "S4", ID: "id-4", Title: "four", SaveUsd: 3},
		}},
	}
}

func TestPromptCarriesDigestAndLanguage(t *testing.T) {
	got := Prompt("DIGEST-BODY", "vi")
	open := strings.Index(got, "<digest>")
	body := strings.Index(got, "DIGEST-BODY")
	closeTag := strings.Index(got, "</digest>")
	if open < 0 || body < open || closeTag < body {
		t.Fatalf("digest must sit inside <digest>…</digest>, got:\n%s", got)
	}
	if !strings.Contains(got, "Vietnamese") {
		t.Errorf("prompt for vi must name Vietnamese, got:\n%s", got)
	}
	for _, want := range []string{"one JSON object", `"headline"`, `"levers"`, `"opusclear"`, `"tips"`} {
		if !strings.Contains(got, want) {
			t.Errorf("prompt must ask for JSON with %q, got:\n%s", want, got)
		}
	}
	if strings.Contains(got, "markdown") {
		t.Errorf("prompt must no longer ask for markdown, got:\n%s", got)
	}
	for _, lever := range []string{"Oversized Read results", "Oversized Bash results", "/compact before stepping away", "/clear"} {
		if !strings.Contains(got, lever) {
			t.Errorf("prompt must offer the lever %q, got:\n%s", lever, got)
		}
	}
	if strings.Index(got, "Oversized Read results") > strings.Index(got, "\n<digest>\n") {
		t.Errorf("the levers are instructions and must sit before the digest, got:\n%s", got)
	}
	if en := Prompt("x", ""); !strings.Contains(en, "English") || strings.Contains(en, "Vietnamese") {
		t.Errorf("prompt for an empty language must name English only, got:\n%s", en)
	}
}

func TestParseReplyAcceptsBareFencedAndPrefacedJSON(t *testing.T) {
	const body = `{"headline":"Opus eats the quota","levers":[{"key":"longctx","fix":"Clear between tasks","tabs":["S1"]}],"opusclear":["S3"],"tips":["Trim CLAUDE.md"]}`
	want := replyJSON{
		Headline:  "Opus eats the quota",
		Levers:    []replyLever{{Key: "longctx", Fix: "Clear between tasks", Tabs: []string{"S1"}}},
		OpusClear: []string{"S3"},
		Tips:      []string{"Trim CLAUDE.md"},
	}
	for name, text := range map[string]string{
		"bare":      body,
		"fenced":    "```json\n" + body + "\n```",
		"preamble":  "Here is the analysis:\n" + body,
		"padded":    "\n\n  " + body + "  \n",
		"fenced+nl": "Sure.\n\n```json\n" + body + "\n```\nDone.",
	} {
		got, err := parseReply(text, candidateLevers())
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s: got %+v, want %+v", name, got, want)
		}
	}
}

func TestParseReplyDropsWhatTheRequestDoesNotHave(t *testing.T) {
	text := `{"headline":"H","levers":[
		{"key":"longctx","fix":"f","tabs":["S1","S9","S3"]},
		{"key":"nonsense","fix":"x","tabs":["S1"]},
		{"key":"longctx","fix":"a second answer for the same lever","tabs":["S2"]}
	],"opusclear":["S3","S1","S9","S4"],"tips":[]}`
	got, err := parseReply(text, candidateLevers())
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Levers) != 1 || got.Levers[0].Key != "longctx" || got.Levers[0].Fix != "f" {
		t.Fatalf("only the first answer for a known key survives, got %+v", got.Levers)
	}
	// S9 is not in the request; S3 is another lever's session, which the plan allows in tabs
	if want := []string{"S1", "S3"}; !reflect.DeepEqual(got.Levers[0].Tabs, want) {
		t.Errorf("tabs = %v, want %v", got.Levers[0].Tabs, want)
	}
	// opusclear takes only the opus lever's sessions: S1 is a longctx session, S9 is unknown
	if want := []string{"S3", "S4"}; !reflect.DeepEqual(got.OpusClear, want) {
		t.Errorf("opusclear = %v, want %v", got.OpusClear, want)
	}
}

func TestParseReplyWithoutAnOpusLeverClearsNothing(t *testing.T) {
	got, err := parseReply(`{"headline":"H","opusclear":["S1","S3"]}`, candidateLevers()[:1])
	if err != nil {
		t.Fatal(err)
	}
	if len(got.OpusClear) != 0 {
		t.Errorf("opusclear = %v, want none: the request had no opus lever", got.OpusClear)
	}
}

func TestParseReplyTips(t *testing.T) {
	got, err := parseReply(`{"headline":"H","tips":["  one ","", "   ","two","three","four","five"]}`, nil)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"one", "two", "three"}; !reflect.DeepEqual(got.Tips, want) {
		t.Errorf("tips = %q, want %q", got.Tips, want)
	}
}

func TestParseReplyTrimsAndDedupes(t *testing.T) {
	got, err := parseReply(`{"headline":"  H  ","levers":[{"key":"longctx","fix":"  f  ","tabs":[" S1 ","S1","S2"]}]}`, candidateLevers())
	if err != nil {
		t.Fatal(err)
	}
	if got.Headline != "H" || got.Levers[0].Fix != "f" {
		t.Errorf("headline and fix must be trimmed, got %+v", got)
	}
	if want := []string{"S1", "S2"}; !reflect.DeepEqual(got.Levers[0].Tabs, want) {
		t.Errorf("tabs = %v, want %v", got.Levers[0].Tabs, want)
	}
}

func TestParseReplyRejectsAnswersItCannotUse(t *testing.T) {
	for name, text := range map[string]string{
		"not json":       "not json",
		"markdown":       "## Where the quota goes\nx",
		"empty headline": `{"headline":"","levers":[],"opusclear":[],"tips":[]}`,
		"blank headline": `{"headline":"   "}`,
		"no headline":    `{"levers":[]}`,
		"broken json":    `{"headline":"H",`,
		"wrong shape":    `{"headline":"H","tips":"one"}`,
	} {
		_, err := parseReply(text, candidateLevers())
		if err == nil {
			t.Errorf("%s: want an error", name)
			continue
		}
		if err.Error() != "Claude's answer was not in the expected format" {
			t.Errorf("%s: error = %q", name, err.Error())
		}
		if !errors.Is(err, ErrFormat) {
			t.Errorf("%s: error must be ErrFormat, got %v", name, err)
		}
	}
}

func TestAnalyzeSavesAndLoads(t *testing.T) {
	dir := t.TempDir()
	var gotPrompt string
	scriptRun(t, func(_ context.Context, prompt string) (string, error) {
		gotPrompt = prompt
		return minimalReply, nil
	})
	want := Insights{Headline: "A", AnalyzedTs: fixedNow().UnixMilli(), WindowDays: 7, Model: "sonnet", Lang: "en"}

	got, err := Analyze(context.Background(), dir, Request{WindowDays: 7, Digest: "d"}, fixedNow)
	if err != nil {
		t.Fatalf("Analyze: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Analyze = %+v, want %+v", got, want)
	}
	if got.Markdown != "" {
		t.Errorf("a new result leaves Markdown empty, got %q", got.Markdown)
	}
	if !strings.Contains(gotPrompt, "<digest>\nd\n</digest>") {
		t.Errorf("the model must be given the digest, got:\n%s", gotPrompt)
	}
	loaded, err := Load(dir)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !reflect.DeepEqual(loaded, want) {
		t.Errorf("Load = %+v, want %+v", loaded, want)
	}
}

func TestAnalyzeSavesTheRequestsLeversWithClaudesWords(t *testing.T) {
	dir := t.TempDir()
	scriptRun(t, func(context.Context, string) (string, error) {
		return "```json\n" + `{"headline":"Long tabs dominate","levers":[{"key":"longctx","fix":"One task per tab","tabs":["S2","S1","S7"]}],"opusclear":["S4","S1"],"tips":["Keep CLAUDE.md short","/rewind past a wrong turn"]}` + "\n```", nil
	})
	req := Request{WindowDays: 30, Digest: "d", Lang: "vi", Levers: candidateLevers(), SpendUsd: 123.5}
	// a client that sent its own words must not get them saved: only Claude's answer counts
	req.Levers[1].Fix = "client-written"
	req.Levers[1].Tabs = []string{"S3"}

	got, err := Analyze(context.Background(), dir, req, fixedNow)
	if err != nil {
		t.Fatalf("Analyze: %v", err)
	}
	wantLevers := candidateLevers()
	wantLevers[0].Fix = "One task per tab"
	wantLevers[0].Tabs = []string{"S2", "S1"}
	want := Insights{
		Headline: "Long tabs dominate", Levers: wantLevers, OpusClear: []string{"S4"},
		Tips:       []string{"Keep CLAUDE.md short", "/rewind past a wrong turn"},
		SpendUsd:   123.5,
		AnalyzedTs: fixedNow().UnixMilli(), WindowDays: 30, Model: "sonnet", Lang: "vi",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Analyze = %+v\nwant      %+v", got, want)
	}
	if got.Markdown != "" {
		t.Errorf("Markdown = %q, want empty", got.Markdown)
	}
	if req.Levers[0].Fix != "" || req.Levers[0].Tabs != nil {
		t.Errorf("Analyze must not write into the request's levers, got %+v", req.Levers[0])
	}
	loaded, err := Load(dir)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !reflect.DeepEqual(loaded, want) {
		t.Errorf("Load = %+v\nwant   %+v", loaded, want)
	}
}

func TestAnalyzeBadFormatKeepsSaved(t *testing.T) {
	dir := t.TempDir()
	saved := Insights{Headline: "old", AnalyzedTs: 1, WindowDays: 30, Model: "sonnet"}
	if err := Save(dir, saved); err != nil {
		t.Fatalf("Save: %v", err)
	}
	for name, reply := range map[string]string{
		"prose":          "## Where the quota goes\nx",
		"empty headline": `{"headline":"","levers":[],"opusclear":[],"tips":[]}`,
	} {
		scriptRun(t, func(context.Context, string) (string, error) { return reply, nil })
		_, err := Analyze(context.Background(), dir, Request{WindowDays: 7, Digest: "d"}, fixedNow)
		if !errors.Is(err, ErrFormat) {
			t.Fatalf("%s: Analyze error = %v, want ErrFormat", name, err)
		}
		loaded, err := Load(dir)
		if err != nil {
			t.Fatalf("%s: Load: %v", name, err)
		}
		if !reflect.DeepEqual(loaded, saved) {
			t.Errorf("%s: a failed analysis must keep the saved result, got %+v want %+v", name, loaded, saved)
		}
	}
}

func TestAnalyzeEmptyReplyKeepsSaved(t *testing.T) {
	dir := t.TempDir()
	saved := Insights{Markdown: "## old", AnalyzedTs: 1, WindowDays: 30, Model: "sonnet"}
	if err := Save(dir, saved); err != nil {
		t.Fatalf("Save: %v", err)
	}
	scriptRun(t, func(context.Context, string) (string, error) { return "   ", nil })

	if _, err := Analyze(context.Background(), dir, Request{WindowDays: 7, Digest: "d"}, fixedNow); err == nil {
		t.Fatal("an empty reply must be an error")
	}
	loaded, err := Load(dir)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !reflect.DeepEqual(loaded, saved) {
		t.Errorf("a failed analysis must keep the saved result, got %+v want %+v", loaded, saved)
	}
}

func TestAnalyzeRunErrorKeepsSaved(t *testing.T) {
	dir := t.TempDir()
	saved := Insights{Markdown: "## old", AnalyzedTs: 1, WindowDays: 30, Model: "sonnet"}
	if err := Save(dir, saved); err != nil {
		t.Fatalf("Save: %v", err)
	}
	boom := errors.New("boom")
	scriptRun(t, func(context.Context, string) (string, error) { return "", boom })

	_, err := Analyze(context.Background(), dir, Request{WindowDays: 7, Digest: "d"}, fixedNow)
	if !errors.Is(err, boom) {
		t.Fatalf("Analyze error = %v, want one wrapping %v", err, boom)
	}
	if loaded, _ := Load(dir); !reflect.DeepEqual(loaded, saved) {
		t.Errorf("a failed analysis must keep the saved result, got %+v want %+v", loaded, saved)
	}
}

func TestAnalyzeBusy(t *testing.T) {
	dir := t.TempDir()
	entered := make(chan struct{})
	release := make(chan struct{})
	calls := 0
	scriptRun(t, func(context.Context, string) (string, error) {
		calls++
		close(entered)
		<-release
		return minimalReply, nil
	})

	done := make(chan error, 1)
	go func() {
		_, err := Analyze(context.Background(), dir, Request{WindowDays: 7, Digest: "d"}, fixedNow)
		done <- err
	}()
	<-entered

	if _, err := Analyze(context.Background(), dir, Request{WindowDays: 7, Digest: "d"}, fixedNow); !errors.Is(err, ErrBusy) {
		t.Errorf("a second Analyze = %v, want ErrBusy", err)
	}
	close(release)
	if err := <-done; err != nil {
		t.Errorf("the first Analyze: %v", err)
	}
	if calls != 1 {
		t.Errorf("run was called %d times, want 1", calls)
	}
}

func TestLoadMissing(t *testing.T) {
	got, err := Load(t.TempDir())
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !reflect.DeepEqual(got, Insights{}) {
		t.Errorf("Load on an empty dir = %+v, want the zero value", got)
	}
}

// TestLoadMarkdownOnlyResult: every result saved before the levers shipped holds markdown and no levers, and the
// card still draws it that way until the next Analyze.
func TestLoadMarkdownOnlyResult(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(dir+"/insights", 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path(dir), []byte(`{"markdown":"## x","analyzedts":1,"windowdays":7,"model":"sonnet"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := Load(dir)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	want := Insights{Markdown: "## x", AnalyzedTs: 1, WindowDays: 7, Model: "sonnet"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Load = %+v, want %+v", got, want)
	}
}

func TestAnalyzeRecordsItsLanguage(t *testing.T) {
	dir := t.TempDir()
	scriptRun(t, func(_ context.Context, prompt string) (string, error) {
		if !strings.Contains(prompt, "Vietnamese") {
			t.Errorf("a vi analysis must ask for Vietnamese, got:\n%s", prompt)
		}
		return minimalReply, nil
	})
	got, err := Analyze(context.Background(), dir, Request{WindowDays: 7, Digest: "d", Lang: "vi"}, fixedNow)
	if err != nil {
		t.Fatalf("Analyze: %v", err)
	}
	if got.Lang != "vi" {
		t.Errorf("Lang = %q, want vi", got.Lang)
	}
	if loaded, _ := Load(dir); loaded.Lang != "vi" {
		t.Errorf("saved Lang = %q, want vi", loaded.Lang)
	}
}
