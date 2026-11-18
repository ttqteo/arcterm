// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
)

type transcriptPageTestCall struct {
	path     string
	before   int64
	maxLines int
}

// transcriptPageTestHook scripts TranscriptPageHook, recording each call, and restores it when the test ends.
func transcriptPageTestHook(t *testing.T, result TranscriptChunk, err error) *[]transcriptPageTestCall {
	t.Helper()
	var calls []transcriptPageTestCall
	prev := TranscriptPageHook
	TranscriptPageHook = func(path string, before int64, maxLines int) (TranscriptChunk, error) {
		calls = append(calls, transcriptPageTestCall{path, before, maxLines})
		return result, err
	}
	t.Cleanup(func() { TranscriptPageHook = prev })
	return &calls
}

func TestRemoteTranscriptPageAsksTheHookForTwoHundredLinesOfTheHandedAgent(t *testing.T) {
	a := handTestClaude("tab-a")
	a.TranscriptPath = "C:/t/session.jsonl"
	handTestEnv(t, a)
	handTestHand(t, "tab-a")
	page := TranscriptChunk{Lines: []string{`{"n":1}`}, Cursor: 123}
	calls := transcriptPageTestHook(t, page, nil)

	got, err := remoteTranscriptPage(context.Background(), "tab-a", 4096)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(got.Lines, page.Lines) || got.Cursor != 123 {
		t.Errorf("page = %+v, want the hook's %+v", got, page)
	}
	want := []transcriptPageTestCall{{"C:/t/session.jsonl", 4096, 200}}
	if !slices.Equal(*calls, want) {
		t.Errorf("hook calls = %+v, want %+v", *calls, want)
	}
}

// a tab that is not handed over answers with the *GoneError, which the handler turns into a 410, and the hook is not asked
func TestRemoteTranscriptPageOfATabNotHandedOverIsGone(t *testing.T) {
	a := handTestClaude("tab-a")
	a.TranscriptPath = "C:/t/session.jsonl"
	handTestEnv(t, a)
	calls := transcriptPageTestHook(t, TranscriptChunk{}, nil)

	_, err := remoteTranscriptPage(context.Background(), "tab-a", 100)
	var gone *GoneError
	if !errors.As(err, &gone) {
		t.Fatalf("err = %v, want a *GoneError", err)
	}
	if len(*calls) != 0 {
		t.Errorf("hook called %d times for a tab that is not handed over", len(*calls))
	}
}

func TestRemoteTranscriptPageOfAnAgentWithNoTranscriptYetIsAnError(t *testing.T) {
	handTestEnv(t, handTestClaude("tab-a")) // no transcript path yet
	handTestHand(t, "tab-a")
	calls := transcriptPageTestHook(t, TranscriptChunk{}, nil)
	if _, err := remoteTranscriptPage(context.Background(), "tab-a", 100); err == nil || !strings.Contains(err.Error(), "no transcript") {
		t.Errorf("err = %v, want one saying the agent has no transcript yet", err)
	}
	if len(*calls) != 0 {
		t.Errorf("hook called %d times for an agent with no transcript path", len(*calls))
	}
}

func TestRemoteTranscriptPageWithNoHookFailsInsteadOfPanicking(t *testing.T) {
	a := handTestClaude("tab-a")
	a.TranscriptPath = "C:/t/session.jsonl"
	handTestEnv(t, a)
	handTestHand(t, "tab-a")
	prev := TranscriptPageHook
	TranscriptPageHook = nil
	t.Cleanup(func() { TranscriptPageHook = prev })
	if _, err := remoteTranscriptPage(context.Background(), "tab-a", 100); err == nil {
		t.Error("with no hook set the page must fail")
	}
}

// the hook's own error (a file not written yet) passes through for the handler to answer
func TestRemoteTranscriptPagePassesTheHooksErrorThrough(t *testing.T) {
	a := handTestClaude("tab-a")
	a.TranscriptPath = "C:/t/session.jsonl"
	handTestEnv(t, a)
	handTestHand(t, "tab-a")
	boom := errors.New("no transcript file yet")
	transcriptPageTestHook(t, TranscriptChunk{}, boom)
	if _, err := remoteTranscriptPage(context.Background(), "tab-a", 100); !errors.Is(err, boom) {
		t.Errorf("err = %v, want the hook's error", err)
	}
}
