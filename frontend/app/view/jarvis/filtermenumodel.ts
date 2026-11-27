// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Brief's one-choice menu (filtermenu.tsx) shows: a short list stays the app's context menu, a long one opens
// a picker with a filter field, and the field keeps the options whose name holds what was typed.

// from this many options the menu opens the picker: a context menu of more is a wall to read through
export const SEARCH_FROM = 9;

export function searchable(count: number): boolean {
    return count >= SEARCH_FROM;
}

/** The options whose label or search text (a project's full path) holds every word of the query, without case, in
 *  their order; all of them for a blank one. */
export function matchingOptions<T extends { label: string; search?: string }>(
    options: readonly T[],
    query: string
): T[] {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
        return [...options];
    }
    return options.filter((o) => {
        const text = `${o.label} ${o.search ?? ""}`.toLowerCase();
        return words.every((w) => text.includes(w));
    });
}

/** Where the cursor starts: on the picked option when the list shows it, else on the first. */
export function startCursor<T>(shown: readonly { value: T }[], value: T): number {
    return Math.max(
        0,
        shown.findIndex((o) => o.value === value)
    );
}
