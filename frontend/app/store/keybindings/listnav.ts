// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The single home for the cockpit's "active list cursor". A plain master-detail list surface
// publishes its cursor list here while its list view is active; the registry's list-nav bindings
// (bindings.ts) read it on keypress. Only one surface is showing at a time (cockpitshell; the Agent
// surface stays mounted while hidden, so a surface publishes only while it is the one on screen), so at
// most one controller is active. The rich surfaces (cockpit/agent) own their own keys and MUST NOT
// register a controller, with one exception: the Agent surface's Conversation History (ConversationHistory,
// `surface: "agent"`), while the centre is on it and the Agent surface is showing. Every Agent key that
// would share j/k with it stands down there (agentNav in bindings.ts), so the list's keys never meet the
// agent's.

import { globalStore } from "@/app/store/jotaiStore";
import type { SurfaceKey } from "@/app/view/agents/agents";
import type { OpenTarget } from "@/app/view/jarvis/address";
import { atom, type PrimitiveAtom } from "jotai";
import { useEffect } from "react";

export interface ListNavController {
    surface: SurfaceKey;
    navigableIds: string[];
    cursorId: string | undefined;
    setCursor: (id: string) => void; // cursor == selection: moving IS selecting
    // Enter on the focused row: fire the row's PRIMARY action (beyond mere selection) — e.g. Jump/Resume
    // a session, investigate a finding. Optional; when absent Enter passes through (bindings.ts).
    activate?: () => void;
    // Space on the focused row: the target to peek in the avatar popup, or null when the row has none.
    // Optional; when absent or null Space passes through (bindings.ts list:peek).
    peekTarget?: () => OpenTarget | null;
    // Optional richer row model, for a surface whose keys need more than an id list — the Diff
    // surface's compare sides, where Tab must know which side a row belongs to. Typed as unknown[]
    // so this module stays free of any surface's row types; the consumer casts. Every other surface
    // leaves it undefined.
    rows?: unknown[];
}

export const listNavAtom = atom<ListNavController | null>(null) as PrimitiveAtom<ListNavController | null>;

// Register `controller` as the active list cursor for the caller's lifetime (or while its list view
// is active). Pass null when the list is not the active view (e.g. the memory graph) to
// withdraw. Memoize `controller` (useMemo) so registration only churns when the list/cursor changes.
export function useSurfaceListNav(controller: ListNavController | null): void {
    useEffect(() => {
        if (controller == null) {
            return;
        }
        globalStore.set(listNavAtom, controller);
        return () => {
            globalStore.set(listNavAtom, (prev) => (prev === controller ? null : prev));
        };
    }, [controller]);
}
