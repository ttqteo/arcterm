// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentobserve

// HeadlessEntrypoint is the `entrypoint` value Claude Code records on every user and assistant record
// of a print-mode (`claude -p`) run; an interactive session records "cli". Wave's own backend model
// calls are all print-mode — the memory distiller and gardener, the recall answer,
// the continuity summary, the channel gatekeeper, the proactive and volunteer judges, and the
// channel consultation. So this one field identifies them all, no matter which package built the
// prompt or which working directory the run used.
//
// It is why the transcript scanners do not match prompt text: a prompt-prefix list has to be extended
// for every new backend call and rots silently when one is reworded, and it can only ever cover the
// calls someone remembered to add.
const HeadlessEntrypoint = "sdk-cli"

// BoardDrawerEntrypoint is the CLAUDE_CODE_ENTRYPOINT a board's drawer runs its print-mode claude under. It is a
// headless run like any other (IsHeadlessEntrypoint is true: no session history, no nested-session reports, the same
// archive sweep), but its tokens are the person's own spend on the board's project, so Usage counts them
// (CountsInUsage). The sdk- prefix keeps Claude Desktop's Import of CLI sessions hiding the drawer's transcripts, as it
// hides sdk-cli's.
const BoardDrawerEntrypoint = "sdk-arc-board"

// EngineEntrypoint is the CLAUDE_CODE_ENTRYPOINT an engine session (a run's task worker, reviewer or judge) runs under:
// jarvis.EngineEntrypoint, which says why it is "bench". It is not headless: the session runs in a tab and its hooks
// report, but no person types into it.
const EngineEntrypoint = "bench"

// IsHeadlessEntrypoint reports whether a transcript record's entrypoint marks a print-mode run, which
// is never a session a user typed into and never work they could usefully resume.
func IsHeadlessEntrypoint(entrypoint string) bool {
	return entrypoint == HeadlessEntrypoint || entrypoint == BoardDrawerEntrypoint
}

// CountsInUsage reports whether a print-mode run's tokens are the person's spend, so the Usage scan keeps its records
// where it drops every other headless run as arcterm's own maintenance.
func CountsInUsage(entrypoint string) bool {
	return entrypoint == BoardDrawerEntrypoint
}
