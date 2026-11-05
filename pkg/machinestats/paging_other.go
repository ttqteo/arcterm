// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package machinestats

import "context"

// RunPaging writes no paging log off Windows: macOS's pressure level already counts the compressor and swap.
func RunPaging(context.Context) {}
