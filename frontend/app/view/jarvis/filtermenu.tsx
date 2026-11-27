// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Brief's one-choice menu: a small bordered face ("project mit-thesis ▾") that opens the app's context menu under
// itself with a radio item per option. The initiatives list uses it for its project filter, the session ideas offer for
// the project a scan reads; it lives on its own so both can import it without a cycle through briefsurface.tsx.

import { contextMenuAtom } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { useAtomValue } from "jotai";
import { ChevronDown } from "lucide-react";
import { useRef } from "react";

// A region's filter: which project the initiatives list shows. The first option is always all.
export type FilterSpec<T> = {
    label: string;
    // what the menu's face calls the choice: "project"
    noun: string;
    // the data attribute a CDP scenario finds the filter by
    tag: string;
    options: { value: T; label: string; count?: number }[];
    value: T;
    onChange: (v: T) => void;
};

export function FilterMenu<T>({ label, noun, tag, options, value, onChange }: FilterSpec<T>) {
    // the one context menu may be a row's, so open means it holds this filter's items
    const shown = useRef<ContextMenuItem[] | null>(null);
    const open = useAtomValue(contextMenuAtom)?.items === shown.current && shown.current != null;
    const picked = options.find((o) => o.value === value) ?? options[0];
    // opened at the face rather than the pointer, so Enter on the face drops it in the same place
    const show = (e: React.MouseEvent<HTMLButtonElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        shown.current = [
            { type: "header", label },
            ...options.map(
                (o): ContextMenuItem => ({
                    type: "radio",
                    label: o.label,
                    checked: o.value === value,
                    sublabel: o.count != null ? String(o.count) : undefined,
                    click: () => onChange(o.value),
                })
            ),
        ];
        globalStore.set(contextMenuAtom, { x: r.left, y: r.bottom, items: shown.current });
    };
    return (
        <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={label}
            title={`${label}: ${picked.label}`}
            {...{ [tag]: "" }}
            onClick={show}
            className="flex flex-none cursor-pointer items-center gap-1.5 rounded-[5px] border border-edge-strong px-[7px] py-px text-[10.5px] text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
            <span className="text-muted">{noun}</span>
            {/* a long project name ends in an ellipsis instead of pushing the row's other controls out */}
            <span className="max-w-[20ch] truncate">{picked.label}</span>
            <ChevronDown size={10} aria-hidden className="text-muted" />
        </button>
    );
}
