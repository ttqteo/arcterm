// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentperm is the per-agent queue of Claude Code permission prompts the chat view answers.
//
// Claude Code's PermissionRequest hook (reported through `wsh agent-hook`) raises one request per prompt
// the TUI shows. The queue holds them, one queue per agent block (oref), in wavesrv memory, and publishes the
// whole queue on every change as the baseds.AgentPermissionData of the Event_AgentPermission event, head
// first; an empty Requests means nothing is pending. Allow and Deny are one wshrpc command,
// AgentPermissionAnswerCommand, which refuses an id that is not the head of the queue (ErrNotPending), so a
// click on a card the TUI has already moved past types nothing.
//
// The hook payload carries no tool_use_id, so a request is matched to the PostToolUse of the tool it granted by
// a tool key: the tool name plus a hash of its tool_input, re-marshalled canonically. One function computes it,
// for both the raise and the PostToolUse report, so the two sides cannot drift.
//
// What clears the queue:
//
//	PermissionRequest hook            append (no dedupe: two identical parallel calls are two prompts)
//	Allow in chat                     refuse unless the id is the head and answerable; type `1`; drop the head,
//	                                  noting its key as answered
//	Deny in chat                      refuse unless the id is the head; type Esc; drop all (Esc on Claude's prompt
//	                                  rejects and ends the turn)
//	1-9 or Enter typed in the TUI     drop the head, noting its key as answered
//	Esc typed alone in the TUI        drop all
//	PostToolUse report with a key     if an answered key matches, consume that note and change nothing; else drop
//	                                  the first pending entry with that key
//	Stop, UserPromptSubmit,           drop all, and forget every answered key
//	SessionStart report
//
// The answered notes exist for two identical parallel calls (same tool, same input): Allow on the first drops
// the head, and the first call's PostToolUse must not then take the second, still-pending entry, whose prompt is
// still in the TUI.
package agentperm
