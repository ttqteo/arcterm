// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !darwin

package blockcontroller

// stopLeftovers is a no-op off macOS: on Windows the block's job object already takes its whole tree.
func stopLeftovers(blockId string) {}
