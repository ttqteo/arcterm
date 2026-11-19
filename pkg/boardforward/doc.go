// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package boardforward is the line between a board and its agent: the marker that heads a question typed into the
// agent as the user's own message, which Chat recognizes (it draws the chip) and the reply search finds by its turn
// id. The frontend's boardforwardmarker.ts parses the format Marker writes.
package boardforward
