package agentsessions

import (
	"strings"
	"testing"
)

// Claude Code names a session with ai-title records as it goes, the name a live agent's row already shows
// (wsh agent-hook reads the last one). An ended session takes the same name rather than its first prompt, which
// is often a /model switch or a pasted image.
func TestClaudeSessionTitledByItsLastAiTitle(t *testing.T) {
	s := extractClaudeSession("t1", []string{
		`{"type":"user","cwd":"/x","message":{"content":"<command-name>/model</command-name><command-args>fable</command-args>"}}`,
		`{"type":"ai-title","aiTitle":"Switch model","sessionId":"t1"}`,
		`{"type":"user","cwd":"/x","message":{"content":"make the sidebar collapsible"}}`,
		`{"type":"ai-title","aiTitle":"Collapsible sidebar sections","sessionId":"t1"}`,
		`{"type":"ai-title","aiTitle":"","sessionId":"t1"}`,
	})
	if s == nil || s.Task != "Collapsible sidebar sections" {
		t.Fatalf("want the last non-empty ai-title, got %+v", s)
	}
}

func TestClaudeSessionWithNoAiTitleKeepsItsFirstPrompt(t *testing.T) {
	s := extractClaudeSession("t2", []string{
		`{"type":"user","cwd":"/x","message":{"content":"harden the webhooks"}}`,
	})
	if s == nil || s.Task != "harden the webhooks" {
		t.Fatalf("want the first prompt, got %+v", s)
	}
}

// a title does not make a session of a file no person wrote in (a subagent's, a background task's)
func TestClaudeAiTitleWithoutAPromptIsNoSession(t *testing.T) {
	s := extractClaudeSession("t3", []string{
		`{"type":"ai-title","aiTitle":"Explore the repo","sessionId":"t3"}`,
		`{"type":"assistant","message":{"model":"claude-opus","content":[{"type":"text","text":"ok"}]}}`,
	})
	if s != nil {
		t.Fatalf("want no session, got %+v", s)
	}
}

func TestClaudeAiTitleIsTrimmedLikeAPrompt(t *testing.T) {
	long := strings.Repeat("x", maxTaskLen+40)
	s := extractClaudeSession("t4", []string{
		`{"type":"user","cwd":"/x","message":{"content":"go"}}`,
		`{"type":"ai-title","aiTitle":"` + long + `","sessionId":"t4"}`,
	})
	if s == nil || s.Task != trimTo(long, maxTaskLen) {
		t.Fatalf("want the title trimmed to %d, got %+v", maxTaskLen, s)
	}
}

// A prompt with a pasted image is recorded with array content (its text, then the image), and Claude Code adds an
// isMeta companion beside it ("[Image: original 1300×2400, displayed at …]"). The companion is no prompt; the prompt is.
func TestClaudeImagePromptTitlesTheSessionNotItsMetaCompanion(t *testing.T) {
	s := extractClaudeSession("t5", []string{
		`{"type":"user","cwd":"/x","isMeta":true,"message":{"content":"[Image: original 1300×2400, displayed at 1000×1846.]"}}`,
		`{"type":"user","cwd":"/x","imagePasteIds":[1],"message":{"content":[{"type":"text","text":"is this formula right [Image #1]"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"AA=="}}]}}`,
	})
	if s == nil || s.Task != "is this formula right [Image #1]" {
		t.Fatalf("want the typed prompt, got %+v", s)
	}
}

// an interruption is an array record too, and no more a prompt than a tool result
func TestClaudeInterruptionDoesNotTitleASession(t *testing.T) {
	s := extractClaudeSession("t6", []string{
		`{"type":"user","cwd":"/x","message":{"content":[{"type":"text","text":"[Request interrupted by user]"}]}}`,
		`{"type":"user","cwd":"/x","message":{"content":[{"type":"tool_result","tool_use_id":"a","content":"ok"}]}}`,
		`{"type":"user","cwd":"/x","message":{"content":"tighten section 3"}}`,
	})
	if s == nil || s.Task != "tighten section 3" {
		t.Fatalf("want the typed prompt, got %+v", s)
	}
}
