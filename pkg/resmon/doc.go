// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package resmon samples the CPU and memory of Arc's own processes and of every process in a registered job
// object, groups them by the job's owner (an agent tab, a run worker, an engine run command), and kills within a
// job: only processes that are still members of that owner's job, and never the agent's own core.
package resmon
