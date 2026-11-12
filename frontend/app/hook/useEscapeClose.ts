// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { useEffect, type RefObject } from "react";

// Count of open menus that close on Escape. The keybinding dispatcher runs on window capture and swallows the key
// when a binding runs, so a menu cannot win Escape by listening itself: surface:back-home reads this and yields.
export const escapeMenusOpenAtom = atom(0) as PrimitiveAtom<number>;

// Closes a hand-rolled dropdown on Escape and returns focus to the button that opened it. Listens only while open,
// so Escape keeps its meaning elsewhere.
export function useEscapeClose(open: boolean, close: () => void, trigger: RefObject<HTMLElement | null>) {
    useEffect(() => {
        if (!open) {
            return;
        }
        globalStore.set(escapeMenusOpenAtom, (n) => n + 1);
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") {
                return;
            }
            e.preventDefault();
            close();
            trigger.current?.focus();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            globalStore.set(escapeMenusOpenAtom, (n) => n - 1);
        };
    }, [open, close, trigger]);
}
