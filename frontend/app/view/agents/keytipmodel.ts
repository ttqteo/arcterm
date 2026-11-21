// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What the Agent surface's keys are, as text: which bindings a typed character would collide with (a bare letter,
// Chat's to type, buildAgentBindings), and the badge a button shows for its ⌥ chord while Option is held (keytip.tsx).

const MODS = new Set(["Mod", "Cmd", "Ctrl", "Alt", "Option", "Meta", "Shift"]);

function parts(keys: string): { mods: string[]; key: string } | null {
    // a sequence ("g c") is a leader's, never typed
    if (keys === "" || keys.includes(" ")) {
        return null;
    }
    const all = keys.split(":");
    const key = all[all.length - 1];
    const mods = all.slice(0, -1);
    return mods.every((m) => MODS.has(m)) ? { mods, key } : null;
}

// A key that types a character: one character or Space, with no modifier but Shift ("d", "Shift:f", "/", "Space").
export function isTextKey(keys: string): boolean {
    const p = parts(keys);
    return p != null && p.mods.every((m) => m === "Shift") && (p.key.length === 1 || p.key === "Space");
}

// The badge for an ⌥ chord: its key, upper case, Shift as ⇧ ("Alt:k" → "K", "Alt:Shift:f" → "⇧F"); null for a key
// that is not an Alt chord of one character.
export function keyTipLabel(keys: string): string | null {
    const p = parts(keys);
    if (
        p == null ||
        !p.mods.includes("Alt") ||
        p.key.length !== 1 ||
        p.mods.some((m) => m !== "Alt" && m !== "Shift")
    ) {
        return null;
    }
    return (p.mods.includes("Shift") ? "⇧" : "") + p.key.toUpperCase();
}
