// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package skills holds the skills arcterm ships. Each top-level directory is one skill tree; agentsync
// seeds them into the vault's skills root on every sync, so this directory is their only source.
package skills

import "embed"

//go:embed cockpit-runs cockpit-ui design-local doc-review effort-tracking
var FS embed.FS
