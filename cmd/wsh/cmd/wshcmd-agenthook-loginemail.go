// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import "strings"

// loginEmailStamp is the `agent:loginemail` a claude session's block gets at SessionStart, and whether
// this event writes one at all. A Default session runs on whatever /login stored when its process
// started, which the frontend cannot tell later (/login moves on, the session does not): the email read
// now is the account its usage belongs to. A token session runs on its arcterm account, which its usage
// already names, so a stale email is cleared (a block is reused when a session is resumed on another
// account). A nil value clears the key; an email that is not known leaves the frontend on the current
// /login one.
// `account` is ARC_CLAUDE_ACCOUNT, empty for Default.
func loginEmailStamp(ev ccHookEvent, agent, shadow, account string, readEmail func() string) (value any, ok bool) {
	if ev.HookEventName != "SessionStart" || agent != "claude" || shadow != "" {
		return nil, false
	}
	if account != "" {
		return nil, true
	}
	email := strings.ToLower(strings.TrimSpace(readEmail()))
	if email == "" {
		return nil, true
	}
	return email, true
}
