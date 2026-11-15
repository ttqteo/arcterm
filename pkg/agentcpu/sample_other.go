// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build !darwin

package agentcpu

// supported is false off macOS: Windows reads each agent's CPU from pkg/resmon (job objects), and no other platform
// has a sampler. Read answers Supported false and starts no goroutine.
const supported = false

// platformSources is never used: with supported false, Read never reaches the sampler.
func platformSources() sources {
	return sources{}
}
