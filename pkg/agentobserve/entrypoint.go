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

// IsHeadlessEntrypoint reports whether a transcript record's entrypoint marks a print-mode run, which
// is never a session a user typed into and never work they could usefully resume.
func IsHeadlessEntrypoint(entrypoint string) bool {
	return entrypoint == HeadlessEntrypoint
}
