// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// New Agent launch-flag state, lifted out of the New launcher so a "remembered" set survives the modal
// unmounting on close (the modal returns null while shut, which would reset component useState).

import { atomWithStorage } from "jotai/utils";

import type { Runtime } from "./launch";

// Enabled flags scoped per runtime, then keyed by flag id. Scoping by runtime keeps each TUI's flag
// set independent: some ids are shared across catalogs (e.g. "skip-permissions" maps to a different
// CLI token per runtime), so a flat id->bool map would bleed a Claude choice into Codex. Defaults to
// none enabled. Persisted (localStorage) so a "remembered" flag set survives app restarts, and so the
// Settings surface and the New launcher edit the same durable source of truth.
export const naFlagsAtom = atomWithStorage<Partial<Record<Runtime, Record<string, boolean>>>>(
    "agent.launch.flags",
    {}
);

// When on, the enabled flags carry over to the next New launcher open; when off, they clear after launch.
export const DEFAULT_REMEMBER_FLAGS = true;

export const naRememberFlagsAtom = atomWithStorage<boolean>("agent.launch.remember", DEFAULT_REMEMBER_FLAGS);
