// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package boarddrawer is a board's drawer: the read-only claude session that takes each line asked on a board and
// either changes its drawing or, for the person's own ask, flags it as a question for the board's agent, never
// answering in words. The agent's own requests (wsh board draw) are always drawn, or fail. The session is resumed turn
// after turn so it remembers the talk, and is handed what the board's agent said since it last read it. It runs one
// turn at a time per board, from the ask until its drawing has landed on the board, checks and routes every answer in
// code, and reaches the board files, the talk, the agent's transcript and the forwarder only through Deps.
package boarddrawer
