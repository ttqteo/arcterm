// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package brainstormcheck holds the pure half of the two brainstorm sessions Arc launches. For the builder check:
// the reviewer's prompt, where its report goes, the line that hands it to the brainstorming agent, and what each
// watcher tick decides (docs/superpowers/specs/2026-10-22-brainstorm-builder-check-reviewer-design.md). For the
// judge of an approach question: what of brainstorm.json it may see, its prompt, the check on its result and the
// judge.json that result becomes, and its two lines (docs/superpowers/specs/2026-10-23-unbiased-approach-questions-design.md).
package brainstormcheck
