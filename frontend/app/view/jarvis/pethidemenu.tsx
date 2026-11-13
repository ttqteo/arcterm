// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The right-click on Jarvis (Sprout or the hologram, wherever PetView draws it, and the Office's boss): hide it for an
// hour, till the next 8:00, or for a typed time. The typed time is a small box where the menu was, since a menu row
// holds no field: it takes what the folded Sprout's "Don't fold for" takes (foldpause.ts parsePauseText) and says when
// the hide would end as you type.

import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { EyeOff } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { HIDE_FOR_LABEL, hideChoices, typedHide } from "./pethide";
import { hideJarvis } from "./pethidestore";

// where the Hide for… box opens (the right-click's point), or null while it is shut
const hideBoxAtAtom = atom<{ x: number; y: number } | null>(null) as PrimitiveAtom<{ x: number; y: number } | null>;

export function showHideMenu(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const at = { x: e.clientX, y: e.clientY };
    const items: ContextMenuItem[] = [
        ...hideChoices(Date.now()).map(
            (c): ContextMenuItem => ({
                label: c.label,
                // the time is read at the click, not when the menu opened
                click: () => hideJarvis(hideChoices(Date.now()).find((n) => n.key === c.key)!.until),
                attrs: { "data-pet-hide": c.key },
            })
        ),
        {
            label: HIDE_FOR_LABEL,
            click: () => globalStore.set(hideBoxAtAtom, at),
            attrs: { "data-pet-hide": "for" },
        },
    ];
    ContextMenuModel.getInstance().showContextMenu(items, e);
}

const BOX_W = 232;
const BOX_H = 76;
const EDGE = 8;

// Mounted once, beside the creature (PetView)
export function HideForBox() {
    const at = useAtomValue(hideBoxAtAtom);
    if (at == null) {
        return null;
    }
    return <HideForForm at={at} />;
}

function close(): void {
    globalStore.set(hideBoxAtAtom, null);
}

function HideForForm({ at }: { at: { x: number; y: number } }) {
    const [text, setText] = useState("");
    const rootRef = useRef<HTMLFormElement | null>(null);
    const typed = typedHide(text, Date.now());
    // a press anywhere else puts it away, as a menu goes
    useEffect(() => {
        const onDown = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) {
                close();
            }
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => document.removeEventListener("pointerdown", onDown, true);
    }, []);
    const left = Math.max(EDGE, Math.min(at.x, window.innerWidth - BOX_W - EDGE));
    const top = Math.max(EDGE, Math.min(at.y, window.innerHeight - BOX_H - EDGE));
    return (
        <form
            ref={rootRef}
            data-pet-hide-box
            className="fixed z-[200] flex flex-col gap-1.5 rounded-[8px] border border-edge-strong bg-surface-raised p-2 shadow-popover-md"
            style={{ left, top, width: BOX_W }}
            onSubmit={(e) => {
                e.preventDefault();
                if (typed != null) {
                    hideJarvis(typed.until);
                    close();
                }
            }}
        >
            <div className="flex h-7 items-center gap-1.5 rounded-[6px] border border-edge-mid bg-surface px-1.5 focus-within:border-accent">
                <EyeOff size={13} strokeWidth={2} className="flex-none text-muted" aria-hidden />
                <input
                    autoFocus
                    data-pet-hide-input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            e.preventDefault();
                            close();
                        }
                    }}
                    placeholder="2h, 30m, 14:30…"
                    aria-label="Hide Jarvis for a while, or until a time"
                    className="min-w-0 flex-1 bg-transparent text-[12px] text-primary outline-none placeholder:text-muted"
                />
            </div>
            <span data-pet-hide-until className="px-0.5 text-[11.5px] text-muted">
                {typed != null
                    ? `Hidden until ${typed.label} · Enter`
                    : text.trim() === ""
                      ? "A length or a time, up to 7 days"
                      : "Not a length or a time"}
            </span>
        </form>
    );
}
