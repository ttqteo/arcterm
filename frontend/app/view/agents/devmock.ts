// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// DEV-ONLY runtime roster source. When public/cockpit-fixtures/active.json exists
// (written by scripts/gen-cockpit-fixtures.mjs, Vite's publicDir served at "/"), the cockpit uses it
// instead of the live roster. Reload the
// dev app to pick up a newly-written fixture. Never active in a production build: the only caller
// gates on import.meta.env.DEV, so this module tree-shakes out.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import type { AgentVM } from "./agentsviewmodel";
import { liveAgentsAtom } from "./liveagents";

const FIXTURE_URL = "/cockpit-fixtures/active.json";

// null = no fixture loaded -> fall through to the live roster. A non-null array (INCLUDING []) means
// a fixture is active and fully replaces the live roster, so the "empty" scenario renders the empty state.
// Cast to PrimitiveAtom matches the repo convention (see agents.tsx) so globalStore.set typechecks.
export const devMockAgentsAtom = atom<AgentVM[] | null>(null) as PrimitiveAtom<AgentVM[] | null>;

export function chooseRoster(devMock: AgentVM[] | null, live: AgentVM[]): AgentVM[] {
    return devMock != null ? devMock : live;
}

export const devRosterAtom: Atom<AgentVM[]> = atom((get) => chooseRoster(get(devMockAgentsAtom), get(liveAgentsAtom)));

// Fetch the active fixture once at boot. Absent file / parse error / SPA fallback -> leave the atom
// null (live path). Safe to call unconditionally in dev; it no-ops when no fixture is present.
export async function loadDevMockRoster(): Promise<void> {
    try {
        const res = await fetch(FIXTURE_URL, { cache: "no-store" });
        if (!res.ok) {
            return;
        }
        const data = await res.json();
        if (Array.isArray(data)) {
            globalStore.set(devMockAgentsAtom, data as AgentVM[]);
        }
    } catch {
        // no fixture served (or the dev server returned index.html) -> stay on the live roster
    }
}
