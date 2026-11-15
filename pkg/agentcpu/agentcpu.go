// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package agentcpu samples the CPU each agent's process tree uses, for the strain band of the Sidecar window (spec
// 2026-11-13-sidecar-design.md, section 4). On Windows the same figures come from pkg/resmon; this package is the
// macOS sampler.
package agentcpu
