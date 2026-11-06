// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"errors"
	"slices"
	"strings"
	"testing"
)

// modelTestRuntime pins the headless runtime and the OpenRouter key answer for one test.
func modelTestRuntime(t *testing.T, runtime string, hasKey bool, keyErr error) {
	t.Helper()
	oldRuntime, oldKey := headlessRuntimeFn, openRouterKeyFn
	headlessRuntimeFn = func() string { return runtime }
	openRouterKeyFn = func() (bool, error) { return hasKey, keyErr }
	t.Cleanup(func() { headlessRuntimeFn, openRouterKeyFn = oldRuntime, oldKey })
}

func TestModelSpec_openrouterWithoutKeyFallsBackToClaude(t *testing.T) {
	modelTestRuntime(t, "openrouter", false, nil)
	spec, runtime, judgedBy, err := modelSpec()
	if err != nil {
		t.Fatal(err)
	}
	if runtime != "claude" || judgedBy != "claude (OpenRouter has no key)" {
		t.Fatalf("runtime/judgedBy = %q/%q", runtime, judgedBy)
	}
	if spec.ApiBackend != nil || !strings.Contains(spec.Bin, "claude") {
		t.Fatalf("want the claude spec, got bin %q, api %v", spec.Bin, spec.ApiBackend)
	}
	// the fallback still runs with no tools
	held, guard, err := modelNoTools(spec, func() {})
	if err != nil || guard == nil || !slices.Contains(held.BaseArgs, "--strict-mcp-config") {
		t.Fatalf("fallback spec isn't held to no tools: %v %v %v", held.BaseArgs, guard, err)
	}
}

func TestModelSpec_openrouterWithKeyUnchanged(t *testing.T) {
	modelTestRuntime(t, "openrouter", true, nil)
	spec, runtime, judgedBy, err := modelSpec()
	if err != nil {
		t.Fatal(err)
	}
	if runtime != "openrouter" || judgedBy != "" {
		t.Fatalf("runtime/judgedBy = %q/%q", runtime, judgedBy)
	}
	if spec.ApiBackend == nil {
		t.Fatalf("want the openrouter spec, got bin %q", spec.Bin)
	}
}

func TestModelSpec_claudeRuntimeUnchanged(t *testing.T) {
	keyAsked := false
	modelTestRuntime(t, "claude", false, nil)
	openRouterKeyFn = func() (bool, error) { keyAsked = true; return false, nil }
	spec, runtime, judgedBy, err := modelSpec()
	if err != nil {
		t.Fatal(err)
	}
	if runtime != "claude" || judgedBy != "" || spec.ApiBackend != nil {
		t.Fatalf("runtime/judgedBy/api = %q/%q/%v", runtime, judgedBy, spec.ApiBackend)
	}
	if keyAsked {
		t.Fatal("the OpenRouter key was read for the claude runtime")
	}
}

func TestModelSpec_keyReadErrorReturned(t *testing.T) {
	modelTestRuntime(t, "openrouter", false, errors.New("keychain locked"))
	_, _, _, err := modelSpec()
	if err == nil || !strings.Contains(err.Error(), "keychain locked") {
		t.Fatalf("err = %v, want the key read error", err)
	}
	// the store sites read the headless runtime and no fallback note
	if runtime, judgedBy := modelRuntime(); runtime != "openrouter" || judgedBy != "" {
		t.Fatalf("modelRuntime = %q/%q", runtime, judgedBy)
	}
}

func TestModelSpec_checkStoresJudgedBy(t *testing.T) {
	env := checkTestSetup(t)
	checkTestSimple(t, env, "p")
	modelTestRuntime(t, "openrouter", false, nil)
	checkTestRun(t, env, "p")
	if st := checkTestLoad(t, "p"); st.JudgedBy != modelFallbackJudgedBy || st.LastError != "" {
		t.Fatalf("judgedby/lasterror after the fallback = %q/%q", st.JudgedBy, st.LastError)
	}
	// with a key the next check clears the note
	modelTestRuntime(t, "openrouter", true, nil)
	checkTestRun(t, env, "p")
	if st := checkTestLoad(t, "p"); st.JudgedBy != "" {
		t.Fatalf("judgedby with a key = %q", st.JudgedBy)
	}
}

func TestModelSpec_askStoresJudgedBy(t *testing.T) {
	env, _, review, _ := askTestSetup(t)
	env.setReply(func(string) (string, error) { return checkTestNoChanges, nil })
	modelTestRuntime(t, "openrouter", false, nil)
	if err := StartAsk("p", review.Id); err != nil {
		t.Fatal(err)
	}
	if st := askTestWait(t, "p"); st.JudgedBy != modelFallbackJudgedBy {
		t.Fatalf("judgedby after an ask on the fallback = %q", st.JudgedBy)
	}
}
