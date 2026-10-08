package orchestrate

import "strings"

const (
	FailureKindToolError     = "tool_call_error"
	FailureKindContextWindow = "context-window"
	FailureKindTimeout       = "timeout"
	FailureKindGateSendback  = "gate-sendback"
	FailureKindTestFailed    = "test-failed"
	FailureKindUnknown       = "unknown"
	// FailureKindStopped is a task the human stopped from the Consumers panel or `dag stop`: its worker was
	// stopped and nothing retries it until the human retries, escalates or skips it.
	FailureKindStopped = "stopped-by-human"
)

// Dispatch failure kinds. These never come from classifyFailure — the task died before it had a
// child run or a transcript to classify, so the engine names the step that failed instead.
const (
	FailureKindRoute      = "route-unresolved"
	FailureKindHarness    = "harness-missing"
	FailureKindWorktree   = "worktree-failed"
	FailureKindSetup      = "setup" // the plan's Setup command failed in a new worktree
	FailureKindSpawn      = "spawn-failed"
	FailureKindWorkerExit = "worker-exit-unreported"
	FailureKindUnrecorded = "dispatch-unrecorded"
)

// MaxFailureDetailLen bounds the failure message carried on a lifecycle event.
const MaxFailureDetailLen = 200

func classifyFailure(summary string, exitCode int) string {
	s := strings.ToLower(summary)
	switch {
	case strings.Contains(s, "context window"), strings.Contains(s, "context limit"), strings.Contains(s, "length of your submission exceeds"):
		return FailureKindContextWindow
	case strings.Contains(s, "timeout"), strings.Contains(s, "timed out"):
		return FailureKindTimeout
	case strings.Contains(s, "sendback"), strings.Contains(s, "too hard"), strings.Contains(s, "out of scope"):
		return FailureKindGateSendback
	// bare "tests:" dropped: it matched passing summaries like "tests: 12 passed"
	case strings.Contains(s, "test failed"), strings.Contains(s, "not passing"), strings.Contains(s, "check failed"):
		return FailureKindTestFailed
	case strings.Contains(s, "tool call"), strings.Contains(s, "function call"), strings.Contains(s, "tool errored"):
		return FailureKindToolError
	case strings.Contains(s, "mcp") && (strings.Contains(s, "error") || strings.Contains(s, "failed")):
		return FailureKindToolError
	default:
		_ = exitCode
		return FailureKindUnknown
	}
}

// MaxAutoDispatchRetries is how many times in a row the engine dispatches a task again itself after its worktree
// or its worker tab could not be made. Those fail on a deadline when the machine is busy, and each attempt has
// already waited out its own (jarvis.RunWorkerSpawnTimeout), so the retries are spread over minutes without a
// backoff. A fault that outlasts them is not transient: the task fails and the lead is woken.
const MaxAutoDispatchRetries = 3

// retryDecision reports whether the engine retries a failure of kind itself, given the consecutive failures of
// that kind the task already has.
func retryDecision(kind string, attempts int) bool {
	switch kind {
	case FailureKindToolError:
		return attempts == 0
	case FailureKindWorktree, FailureKindSpawn:
		return attempts < MaxAutoDispatchRetries
	}
	return false
}
