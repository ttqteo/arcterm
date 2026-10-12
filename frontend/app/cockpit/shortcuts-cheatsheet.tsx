// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Centered modal listing every registered binding, grouped by `group`, generated from bindingsAtom.
// Opens on `?` (navigate posture) or via the command palette "Keyboard shortcuts" entry.

import { ModalShell } from "@/app/modals/modalshell";
import { displayKeys } from "@/app/store/keybindings/matcher";
import { bindingsAtom } from "@/app/store/keybindings/store";
import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { REGION_LABEL } from "@/app/view/jarvis/briefstyle";
import { formatChord } from "@/util/keysym";
import { cn } from "@/util/util";
import { atom, useAtomValue } from "jotai";
import { useMemo, useState } from "react";

export const cheatsheetOpenAtom = atom(false);

function keyChips(keys: string) {
    return formatChord(displayKeys(keys)); // "Ctrl:Shift:Tab" -> ["ctrl","shift","tab"]; "g p" -> ["ctrl+g","p"]
}

function KeyCaps({ keys }: { keys: string }) {
    return (
        <>
            {keyChips(keys).map((k, i) => (
                <span
                    key={i}
                    className="rounded-[5px] border border-edge-mid px-[6px] py-0.5 font-mono text-[10.5px] text-primary"
                >
                    {k}
                </span>
            ))}
        </>
    );
}

export function ShortcutsCheatSheet({ model }: { model: AgentsViewModel }) {
    const open = useAtomValue(cheatsheetOpenAtom);
    const bindings = useAtomValue(bindingsAtom);
    const surface = useAtomValue(model.surfaceAtom);
    const [query, setQuery] = useState("");
    const close = () => globalStore.set(cheatsheetOpenAtom, false);

    const groups = useMemo(() => {
        const q = query.trim().toLowerCase();
        // an alias (Ctrl+P beside Ctrl+Shift+P off a Mac) is drawn on its action's row, not as a row of its own
        const rows = bindings.filter((b) => !b.alias);
        const filtered = q
            ? rows.filter((b) => b.label.toLowerCase().includes(q) || b.keys.toLowerCase().includes(q))
            : rows;
        const byGroup = new Map<string, typeof filtered>();
        for (const b of filtered) {
            const arr = byGroup.get(b.group) ?? [];
            arr.push(b);
            byGroup.set(b.group, arr);
        }
        return [...byGroup.entries()].sort(([a], [b]) => (a === surface ? -1 : b === surface ? 1 : a.localeCompare(b)));
    }, [bindings, query, surface]);
    const aliasOf = useMemo(
        () => new Map(bindings.filter((b) => b.alias).map((b) => [b.id.replace(/:ctrl$/, ""), b])),
        [bindings]
    );

    return (
        <ModalShell open={open} onClose={close} className="flex flex-col w-[min(680px,93vw)] max-h-[74vh]" topClass="pt-[10vh]">
            {open ? (
                <>
                <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-[13px]">
                    <input
                        autoFocus
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Filter shortcuts…"
                        className="flex-1 bg-transparent text-[14px] text-primary outline-none placeholder:text-muted"
                    />
                    <span className="ml-3 shrink-0 rounded-[5px] border border-edge-mid px-[7px] py-0.5 font-mono text-[10.5px] text-muted">
                        esc
                    </span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                    {groups.map(([group, items]) => (
                        <div key={group} className="mb-4">
                            <div className={cn(REGION_LABEL, "mb-1 text-muted")}>
                                {group}
                            </div>
                            {items.map((b) => (
                                <div key={b.id} className="flex items-center justify-between py-[5px] text-[13px]">
                                    <span className="text-secondary">{b.label}</span>
                                    <span className="flex items-center gap-1">
                                        <KeyCaps keys={b.keys} />
                                        {aliasOf.has(b.id) ? (
                                            <>
                                                <span className="ml-1.5 text-[11px] text-muted">or</span>
                                                <KeyCaps keys={aliasOf.get(b.id)!.keys} />
                                                <span className="text-[11px] text-muted">outside a terminal</span>
                                            </>
                                        ) : null}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
                </>
            ) : null}
        </ModalShell>
    );
}
