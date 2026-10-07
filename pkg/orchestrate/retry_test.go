package orchestrate

import "testing"

func TestClassifyFailure(t *testing.T) {
	cases := []struct {
		summary string
		exit    int
		want    string
	}{
		{"context window exceeded", 1, FailureKindContextWindow},
		{"request timed out after 300s", 1, FailureKindTimeout},
		{"lead sendback: out of scope", 1, FailureKindGateSendback},
		{"test failed: TestFoo", 1, FailureKindTestFailed},
		{"2 of 5 checks not passing", 1, FailureKindTestFailed},
		// passing test output on a failed outcome must not read as a test failure
		{"ran tests: 12 passed", 1, FailureKindUnknown},
		{"tool call errored: invalid input schema", 2, FailureKindToolError},
		{"mcp tool returned an error", 2, FailureKindToolError},
		{"mcp server initialized before process exit", 1, FailureKindUnknown},
		{"assert calls=2, got calls=3", 1, FailureKindUnknown},
		{"", 1, FailureKindUnknown},
	}
	for _, tc := range cases {
		if got := classifyFailure(tc.summary, tc.exit); got != tc.want {
			t.Errorf("classifyFailure(%q, %d) = %q, want %q", tc.summary, tc.exit, got, tc.want)
		}
	}
}

func TestRetryDecision(t *testing.T) {
	if !retryDecision(FailureKindToolError, 0) {
		t.Fatal("first tool failure must retry")
	}
	if retryDecision(FailureKindToolError, 1) {
		t.Fatal("second consecutive tool failure must block")
	}
	for _, kind := range []string{FailureKindContextWindow, FailureKindTimeout, FailureKindGateSendback, FailureKindTestFailed, FailureKindUnknown} {
		if retryDecision(kind, 0) {
			t.Fatalf("%s must block on its first failure", kind)
		}
	}
}

func TestRetryDecisionRetriesOnlyTransientDispatchFailures(t *testing.T) {
	for _, kind := range []string{FailureKindWorktree, FailureKindSpawn} {
		if !retryDecision(kind, MaxAutoDispatchRetries-1) {
			t.Fatalf("%s must retry until its bound", kind)
		}
		if retryDecision(kind, MaxAutoDispatchRetries) {
			t.Fatalf("%s must fail once its retries are spent", kind)
		}
	}
	for _, kind := range []string{FailureKindRoute, FailureKindHarness, FailureKindSetup, FailureKindWorkerExit, FailureKindUnrecorded} {
		if retryDecision(kind, 0) {
			t.Fatalf("%s is not transient and must fail on its first failure", kind)
		}
	}
}
