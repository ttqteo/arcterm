// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !darwin && !windows

package machinestats

func systemRoot() string { return "/" }

func volumeName() string { return "System disk" }
