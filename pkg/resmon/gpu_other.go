// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package resmon

// gpuReader reads nothing off Windows, where the Resource Manager is not supported at all.
type gpuReader struct{}

func (g *gpuReader) read() (machine float64, byPid map[int]float64, ok bool) { return 0, nil, false }

func (g *gpuReader) close() {}
