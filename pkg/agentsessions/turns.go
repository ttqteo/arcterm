// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

// TurnsSince is a claude session's digest turns stamped after sinceTs (UnixMilli), oldest first. Claude writes one
// record per text block, so the agent's consecutive replies read as one turn stamped with the last. Boards are
// for claude agents: another runtime, and a file that cannot be read, have none.
func TurnsSince(path, runtime string, sinceTs int64) []Turn {
	if runtime != "claude" {
		return nil
	}
	var out []Turn
	for _, t := range claudeTurns(parseClaudeLines(transcriptLines(path))) {
		if t.Ts <= sinceTs {
			continue
		}
		if n := len(out); n > 0 && t.Speaker == speakerAgent && out[n-1].Speaker == speakerAgent {
			out[n-1].Text += "\n" + t.Text
			out[n-1].Ts = t.Ts
			continue
		}
		out = append(out, t)
	}
	return out
}
