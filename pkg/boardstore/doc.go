// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package boardstore owns the board files. A project's boards live in <data>/boards/<project>/: each board is
// <id>.excalidraw (its "arc" record first), a <id>.talk.json sidecar that only wavesrv writes (the board's turns, the
// agent it is tied to and the drawer's session) and a <id>.answers/ inbox where a drawer answer waits until the
// frontend lands it. The frontend owns the drawing: it saves with the rev it read, and a save from a stale rev writes
// nothing, so a hand edit and a drawer answer never overwrite each other.
package boardstore
