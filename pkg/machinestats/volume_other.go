// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !darwin && !windows

package machinestats

func listDisks() []Disk { return []Disk{{Name: "System disk", Root: "/"}} }
