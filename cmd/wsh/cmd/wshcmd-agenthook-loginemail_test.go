// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import "testing"

// a Default claude session is stamped with the /login email its process started on; a token session, and
// every other event, is not: see 2026-10-07-claude-account-switch-design.md decision 9
func TestLoginEmailStamp(t *testing.T) {
	read := func() string { return "  Mozox@Example.COM " }
	none := func() string { return "" }
	start := ccHookEvent{HookEventName: "SessionStart", Source: "startup"}
	tests := []struct {
		name    string
		ev      ccHookEvent
		agent   string
		shadow  string
		account string
		read    func() string
		wantOK  bool
		want    any
	}{
		{"default startup", start, "claude", "", "", read, true, "mozox@example.com"},
		{"default resume", ccHookEvent{HookEventName: "SessionStart", Source: "resume"}, "claude", "", "", read, true, "mozox@example.com"},
		{"default, email unknown clears", start, "claude", "", "", none, true, nil},
		{"token account clears", start, "claude", "", "a1234abcd", read, true, nil},
		{"token account never reads the config", start, "claude", "", "a1234abcd", func() string { t.Fatal("read the config for a token session"); return "" }, true, nil},
		{"other event", ccHookEvent{HookEventName: "UserPromptSubmit"}, "claude", "", "", read, false, nil},
		{"opencode", start, "opencode", "", "", read, false, nil},
		{"shadow path", start, "claude", "/tmp/shadow.jsonl", "", read, false, nil},
	}
	for _, tt := range tests {
		got, ok := loginEmailStamp(tt.ev, tt.agent, tt.shadow, tt.account, tt.read)
		if ok != tt.wantOK || got != tt.want {
			t.Errorf("%s: got (%v, %v), want (%v, %v)", tt.name, got, ok, tt.want, tt.wantOK)
		}
	}
}
