// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package skills holds the skills arcterm ships. Each top-level directory is one skill tree; agentsync
// seeds them into the vault's skills root on every sync, so this directory is their only source. Claude gets them in
// the installed arc mod, which lists them as arc:<skill>; other harnesses keep the plain names.
package skills

import "embed"

//go:embed cockpit council design detach doc-review ideas initiatives learn notes runs
var FS embed.FS
