// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Open state of a rail's headed sections (collapsiblerail.tsx). A section with a header is a "Label  n  ›" row
// that opens and closes; a counted section with nothing in it stays listed, dimmed, so the rail keeps one shape.

import { atomWithStorage } from "jotai/utils";

export interface RailSectionHeader {
    count?: number; // shown beside the label; 0 makes the row inert unless emptyOpenable
    defaultOpen?: boolean; // open state before the user has toggled it; default true
    // a section whose empty state carries something to do (an Attach button, a "show more" toggle) stays openable at
    // count 0 instead of going inert
    emptyOpenable?: boolean;
}

// per section id; ids are unique across the rails that use headers
export const railSectionOpenAtom = atomWithStorage<Record<string, boolean>>("cockpit.rail.sections", {});

export function sectionExpandable(h: RailSectionHeader): boolean {
    return h.count !== 0 || h.emptyOpenable === true;
}

export function sectionOpen(stored: Record<string, boolean>, id: string, h: RailSectionHeader): boolean {
    if (!sectionExpandable(h)) {
        return false;
    }
    return stored[id] ?? h.defaultOpen ?? true;
}

export function toggleSection(
    stored: Record<string, boolean>,
    id: string,
    h: RailSectionHeader
): Record<string, boolean> {
    return { ...stored, [id]: !sectionOpen(stored, id, h) };
}
