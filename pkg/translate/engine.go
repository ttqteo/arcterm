// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package translate

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// After a 429, Google is left alone for its Retry-After, or restDefault when it sent none, and never longer than
// restMax.
const (
	restDefault = 5 * time.Minute
	restMax     = time.Hour
)

type translateFunc func(ctx context.Context, source, target, text string) (Answer, error)

// Engine answers the rail's Quick translate. Google goes first: it answers in well under a second and adds the
// phonetics and word classes, where Apple Translation takes one to six seconds on the device. When Google cannot answer
// (offline, an error, a 429), Apple Translation does, on a Mac whose bin dir holds the helper, and then MyMemory's
// public API (mymemory.go), the one fallback on Windows. After a 429 the engine leaves Google alone for a while and goes
// straight to the fallbacks, so typing on does not keep the block going; when they fail too, the error says when Google
// is asked again.
type Engine struct {
	google   translateFunc
	apple    translateFunc // nil: no on-device translator
	mymemory translateFunc // nil: no online fallback
	now      func() time.Time

	mu        sync.Mutex
	restUntil time.Time // Google is not asked before this
}

// NewEngine translates through Google, then on a Mac through the Apple helper in binDir when it is there, then through
// MyMemory.
func NewEngine(binDir string) *Engine {
	e := &Engine{google: Google, mymemory: MyMemory, now: time.Now}
	if runtime.GOOS != "darwin" || binDir == "" {
		return e
	}
	helper := filepath.Join(binDir, AppleHelperName)
	if fi, err := os.Stat(helper); err == nil && !fi.IsDir() {
		e.apple = func(ctx context.Context, source, target, text string) (Answer, error) {
			return Apple(ctx, helper, source, target, text)
		}
	}
	return e
}

// Translate translates text from source (a language code, or "auto") into target. Empty text answers an empty Answer;
// text over MaxChars is refused.
func (e *Engine) Translate(ctx context.Context, source, target, text string) (Answer, error) {
	if strings.TrimSpace(text) == "" {
		return Answer{}, nil
	}
	if err := tooLong(text); err != nil {
		return Answer{}, err
	}
	googleErr := e.resting()
	if googleErr == nil {
		a, err := e.google(ctx, source, target, text)
		if err == nil {
			return a, nil
		}
		if ctx.Err() != nil {
			return Answer{}, err
		}
		googleErr = e.refused(err)
	}
	why := googleErr.Error()
	for _, fb := range []struct {
		name string
		fn   translateFunc
	}{{"Apple Translation", e.apple}, {"MyMemory", e.mymemory}} {
		if fb.fn == nil {
			continue
		}
		if ctx.Err() != nil {
			return Answer{}, ctx.Err()
		}
		a, err := fb.fn(ctx, source, target, text)
		if err == nil {
			return a, nil
		}
		why += "; " + fb.name + ": " + err.Error()
	}
	return Answer{}, errors.New(why)
}

// resting answers why Google is not asked now, or nil when it is.
func (e *Engine) resting() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if !e.now().Before(e.restUntil) {
		return nil
	}
	return fmt.Errorf("Google turned away too many requests; arcterm asks it again after %s", e.restUntil.Format("15:04"))
}

// refused starts Google's rest when err is a 429, and answers the error to report.
func (e *Engine) refused(err error) error {
	var se *StatusError
	if !errors.As(err, &se) || se.Code != http.StatusTooManyRequests {
		return err
	}
	wait := se.RetryAfter
	if wait <= 0 {
		wait = restDefault
	}
	e.mu.Lock()
	e.restUntil = e.now().Add(min(wait, restMax))
	until := e.restUntil
	e.mu.Unlock()
	return fmt.Errorf("%v; arcterm asks it again after %s", err, until.Format("15:04"))
}
