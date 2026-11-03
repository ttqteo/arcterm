// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package translate

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"
)

// fakeEngine is an Engine on a clock the test moves, whose Google and Apple answer what the test sets and count calls
type fakeEngine struct {
	*Engine
	clock                   time.Time
	googleErr, appleErr     error
	googleCalls, appleCalls int
}

var googleSays = Answer{Translation: "vàng", Source: "en", Phonetics: "ɡōld"}
var appleSays = Answer{Translation: "vàng (Apple)", Source: "en"}

func newFakeEngine(withApple bool) *fakeEngine {
	f := &fakeEngine{clock: time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC)}
	f.Engine = &Engine{now: func() time.Time { return f.clock }}
	f.google = func(ctx context.Context, source, target, text string) (Answer, error) {
		f.googleCalls++
		if f.googleErr != nil {
			return Answer{}, f.googleErr
		}
		return googleSays, nil
	}
	if withApple {
		f.apple = func(ctx context.Context, source, target, text string) (Answer, error) {
			f.appleCalls++
			if f.appleErr != nil {
				return Answer{}, f.appleErr
			}
			return appleSays, nil
		}
	}
	return f
}

var tooMany = &StatusError{Status: "429 Too Many Requests", Code: http.StatusTooManyRequests}

func (f *fakeEngine) translate(t *testing.T) (Answer, error) {
	t.Helper()
	return f.Translate(context.Background(), "en", "vi", "gold")
}

func TestEngine_googleFirst(t *testing.T) {
	f := newFakeEngine(true)
	a, err := f.translate(t)
	if err != nil || a.Translation != googleSays.Translation {
		t.Fatalf("got %+v, %v", a, err)
	}
	if f.appleCalls != 0 {
		t.Errorf("Apple asked %d times while Google answered", f.appleCalls)
	}
}

func TestEngine_appleWhenGoogleFails(t *testing.T) {
	f := newFakeEngine(true)
	f.googleErr = errors.New("couldn't reach Google: no route to host")
	a, err := f.translate(t)
	if err != nil || a.Translation != appleSays.Translation {
		t.Fatalf("got %+v, %v", a, err)
	}
	// an error that is not a 429 leaves Google in the rotation
	f.googleErr = nil
	if a, _ := f.translate(t); a.Translation != googleSays.Translation || f.googleCalls != 2 {
		t.Errorf("after an error: %+v, %d Google calls", a, f.googleCalls)
	}
}

func TestEngine_restsGoogleAfter429(t *testing.T) {
	f := newFakeEngine(true)
	f.googleErr = tooMany
	if a, err := f.translate(t); err != nil || a.Translation != appleSays.Translation {
		t.Fatalf("the 429: %+v, %v", a, err)
	}
	// within the rest Google is not asked; Apple answers
	f.googleErr = nil
	f.clock = f.clock.Add(restDefault - time.Second)
	if a, err := f.translate(t); err != nil || a.Translation != appleSays.Translation {
		t.Fatalf("resting: %+v, %v", a, err)
	}
	if f.googleCalls != 1 {
		t.Errorf("%d Google calls while it rests", f.googleCalls)
	}
	// once it is over, Google goes first again
	f.clock = f.clock.Add(time.Second)
	if a, err := f.translate(t); err != nil || a.Translation != googleSays.Translation {
		t.Fatalf("after the rest: %+v, %v", a, err)
	}
}

func TestEngine_restLength(t *testing.T) {
	for name, c := range map[string]struct {
		retryAfter, rest time.Duration
	}{
		"none sent":      {0, restDefault},
		"30 s asked":     {30 * time.Second, 30 * time.Second},
		"over the bound": {3 * time.Hour, restMax},
	} {
		f := newFakeEngine(false)
		f.googleErr = &StatusError{Status: "429 Too Many Requests", Code: 429, RetryAfter: c.retryAfter}
		f.translate(t)
		f.clock = f.clock.Add(c.rest - time.Second)
		f.translate(t)
		f.clock = f.clock.Add(time.Second)
		f.translate(t)
		// the 429, nothing while resting, then asked again
		if f.googleCalls != 2 {
			t.Errorf("%s: %d Google calls, want 2", name, f.googleCalls)
		}
	}
}

func TestEngine_noAppleSaysWhen(t *testing.T) {
	f := newFakeEngine(false)
	f.googleErr = tooMany
	_, err := f.translate(t)
	if err == nil || !strings.Contains(err.Error(), "429 Too Many Requests") || !strings.Contains(err.Error(), "after 12:05") {
		t.Fatalf("the 429: %v", err)
	}
	f.clock = f.clock.Add(time.Minute)
	_, err = f.translate(t)
	if err == nil || !strings.Contains(err.Error(), "too many requests") || !strings.Contains(err.Error(), "after 12:05") {
		t.Fatalf("resting: %v", err)
	}
	if f.googleCalls != 1 {
		t.Errorf("%d Google calls", f.googleCalls)
	}
}

func TestEngine_bothFail(t *testing.T) {
	f := newFakeEngine(true)
	f.googleErr = errors.New("couldn't reach Google: offline")
	f.appleErr = errors.New("the English → Thai language pack isn't downloaded")
	_, err := f.translate(t)
	if err == nil || !strings.Contains(err.Error(), "offline") || !strings.Contains(err.Error(), "Apple Translation: the English → Thai") {
		t.Fatalf("err = %v", err)
	}
}

func TestEngine_cancelledSkipsApple(t *testing.T) {
	f := newFakeEngine(true)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	f.googleErr = context.Canceled
	if _, err := f.Translate(ctx, "en", "vi", "gold"); err == nil {
		t.Fatal("no error")
	}
	if f.appleCalls != 0 {
		t.Errorf("Apple asked for a request that was given up")
	}
}

func TestEngine_emptyAndTooLong(t *testing.T) {
	f := newFakeEngine(true)
	if a, err := f.Translate(context.Background(), "auto", "vi", " \n"); err != nil || !reflect.DeepEqual(a, Answer{}) {
		t.Errorf("empty: %+v, %v", a, err)
	}
	f.googleErr = tooMany
	f.translate(t) // resting now: the length is still checked
	if _, err := f.Translate(context.Background(), "en", "vi", strings.Repeat("a", MaxChars+1)); err == nil || !strings.Contains(err.Error(), "5000") {
		t.Errorf("too long: %v", err)
	}
	if f.googleCalls != 1 || f.appleCalls != 1 {
		t.Errorf("%d Google and %d Apple calls", f.googleCalls, f.appleCalls)
	}
}

func TestNewEngine_findsHelper(t *testing.T) {
	dir := t.TempDir()
	if NewEngine(dir).apple != nil {
		t.Error("Apple with no helper")
	}
	if err := os.WriteFile(filepath.Join(dir, AppleHelperName), []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := NewEngine(dir).apple != nil; got != (runtime.GOOS == "darwin") {
		t.Errorf("Apple on %s: %v", runtime.GOOS, got)
	}
	if NewEngine("").apple != nil {
		t.Error("Apple with no bin dir")
	}
}
