// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// One copy-to-clipboard feedback for every copy affordance: the write, its outcome, and how long the outcome
// shows before the control returns to idle. A failed write is reported, never shown as "Copied".

import { useCallback, useEffect, useRef, useState } from "react";

export type CopyState = "idle" | "copied" | "failed";

// long enough to read "Copied", short enough that a second copy is not blocked for long
export const COPY_HOLD_MS = 1400;

// plain text, or a rich copy: HTML for an app that pastes formatting, beside the text for one that takes only text
export type ClipboardContent = string | { text: string; html: string };

export async function writeClipboard(content: ClipboardContent): Promise<CopyState> {
    try {
        if (navigator.clipboard == null) {
            throw new Error("clipboard API unavailable");
        }
        if (typeof content === "string") {
            await navigator.clipboard.writeText(content);
        } else {
            await writeRich(content);
        }
        return "copied";
    } catch (e) {
        console.warn("copy to clipboard failed", e);
        return "failed";
    }
}

// a webview with no ClipboardItem, or one that refuses the HTML, still gets the text
async function writeRich(content: { text: string; html: string }): Promise<void> {
    if (typeof ClipboardItem === "undefined" || navigator.clipboard.write == null) {
        await navigator.clipboard.writeText(content.text);
        return;
    }
    try {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/html": new Blob([content.html], { type: "text/html" }),
                "text/plain": new Blob([content.text], { type: "text/plain" }),
            }),
        ]);
    } catch (e) {
        console.warn("rich copy failed, copying the text alone", e);
        await navigator.clipboard.writeText(content.text);
    }
}

// A click while a write is pending or its outcome is showing is ignored, so a double click cannot stack writes
// or restart the hold.
export function useCopyFeedback(): { state: CopyState; copy: (content: ClipboardContent) => void } {
    const [state, setState] = useState<CopyState>("idle");
    const busy = useRef(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            if (timer.current != null) clearTimeout(timer.current);
        };
    }, []);
    const copy = useCallback((content: ClipboardContent) => {
        if (busy.current) return;
        busy.current = true;
        void writeClipboard(content).then((next) => {
            if (!mounted.current) return;
            setState(next);
            timer.current = setTimeout(() => {
                busy.current = false;
                setState("idle");
            }, COPY_HOLD_MS);
        });
    }, []);
    return { state, copy };
}
