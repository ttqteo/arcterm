// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package usageinsights

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

var fixedNow = func() time.Time { return time.Date(2026, 10, 8, 9, 30, 0, 0, time.UTC) }

// scriptRun swaps the model seam for the test and restores it afterwards.
func scriptRun(t *testing.T, fn func(ctx context.Context, prompt string) (string, error)) {
	t.Helper()
	prev := run
	run = fn
	t.Cleanup(func() { run = prev })
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
	for _, want := range []string{"four short markdown sections", "where the quota goes", "the most expensive tabs", "habits that waste quota", "what to change"} {
		if !strings.Contains(got, want) {
			t.Errorf("prompt must ask for %q, got:\n%s", want, got)
		}
	}
	if en := Prompt("x", ""); !strings.Contains(en, "English") || strings.Contains(en, "Vietnamese") {
		t.Errorf("prompt for an empty language must name English only, got:\n%s", en)
	}
}

func TestAnalyzeSavesAndLoads(t *testing.T) {
	dir := t.TempDir()
	reply := "## A\nx\n## What to change\n1. y"
	var gotPrompt string
	scriptRun(t, func(_ context.Context, prompt string) (string, error) {
		gotPrompt = prompt
		return reply, nil
	})
	want := Insights{Markdown: reply, AnalyzedTs: fixedNow().UnixMilli(), WindowDays: 7, Model: "sonnet"}

	got, err := Analyze(context.Background(), dir, 7, "d", "", fixedNow)
	if err != nil {
		t.Fatalf("Analyze: %v", err)
	}
	if got != want {
		t.Errorf("Analyze = %+v, want %+v", got, want)
	}
	if !strings.Contains(gotPrompt, "<digest>\nd\n</digest>") {
		t.Errorf("the model must be given the digest, got:\n%s", gotPrompt)
	}
	loaded, err := Load(dir)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if loaded != want {
		t.Errorf("Load = %+v, want %+v", loaded, want)
	}
}

func TestAnalyzeEmptyReplyKeepsSaved(t *testing.T) {
	dir := t.TempDir()
	saved := Insights{Markdown: "## old", AnalyzedTs: 1, WindowDays: 30, Model: "sonnet"}
	if err := Save(dir, saved); err != nil {
		t.Fatalf("Save: %v", err)
	}
	scriptRun(t, func(context.Context, string) (string, error) { return "   ", nil })

	if _, err := Analyze(context.Background(), dir, 7, "d", "", fixedNow); err == nil {
		t.Fatal("an empty reply must be an error")
	}
	loaded, err := Load(dir)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if loaded != saved {
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

	_, err := Analyze(context.Background(), dir, 7, "d", "", fixedNow)
	if !errors.Is(err, boom) {
		t.Fatalf("Analyze error = %v, want one wrapping %v", err, boom)
	}
	if loaded, _ := Load(dir); loaded != saved {
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
		return "## A", nil
	})

	done := make(chan error, 1)
	go func() {
		_, err := Analyze(context.Background(), dir, 7, "d", "", fixedNow)
		done <- err
	}()
	<-entered

	if _, err := Analyze(context.Background(), dir, 7, "d", "", fixedNow); !errors.Is(err, ErrBusy) {
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
	if got != (Insights{}) {
		t.Errorf("Load on an empty dir = %+v, want the zero value", got)
	}
}
