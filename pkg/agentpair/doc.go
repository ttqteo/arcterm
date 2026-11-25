// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentpair is the pair of a working agent and the judge(s) that read its replies.
//
// A pair is one conversation arcterm relays: each reply of the working agent passes to its judges, each reply of a
// judge passes back, and the person watches and joins in. Both sides end a reply with a fenced block (the working
// agent's arc-pair list of agreed, open and asking items, a judge's arc-judge marks); the package parses them, builds
// the Decided view, decides when the exchange stops (no new points, settled, token cap, judges gone), writes the
// briefs, and, in its Manager, owns the pair files, the relay queues and the hold on the working agent's heavy
// commands. wshserver adapts it: the RPC handlers (wshrpctypes_pair.go) and a Link over the live roster.
//
// The design and the decisions made while planning it are in
// docs/superpowers/specs/2026-11-25-agent-pair-judge-design.md.
package agentpair
