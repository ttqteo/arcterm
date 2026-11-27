// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The ghost text of the chat box's `/` menu and `@` list: the rest of the highlighted row's name, drawn faint after what
// was typed (`/co` over /context shows `ntext`), which Tab or → takes as a pick of that row (slashmenu.tsx,
// filemention.tsx). A row whose name the typed word does not start (an agent picked by its kind, `@a`) shows none.

/** Pure: the rest of the first of `names` that `typed` starts, case aside, or "" when none does or nothing is left. */
export function menuGhost(typed: string, names: readonly string[]): string {
    if (typed === "") {
        return "";
    }
    const t = typed.toLowerCase();
    for (const name of names) {
        if (name.length > typed.length && name.toLowerCase().startsWith(t)) {
            return name.slice(typed.length);
        }
    }
    return "";
}
