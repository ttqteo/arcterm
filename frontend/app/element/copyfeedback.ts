// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// One copy-to-clipboard feedback for every copy affordance: the write, its outcome, and how long the outcome
// shows before the control returns to idle. A failed write is reported, never shown as "Copied".

import { useCallback, useEffect, useRef, useState } from "react";

export type CopyState = "idle" | "copied" | "failed";

// long enough to read "Copied", short enough that a second copy is not blocked for long
export const COPY_HOLD_MS = 1400;

export async function writeClipboard(text: string): Promise<CopyState> {
    try {
        if (navigator.clipboard == null) {
            throw new Error("clipboard API unavailable");
        }
        await navigator.clipboard.writeText(text);
        return "copied";
    } catch (e) {
        console.warn("copy to clipboard failed", e);
        return "failed";
    }
}

// A click while a write is pending or its outcome is showing is ignored, so a double click cannot stack writes
// or restart the hold.
export function useCopyFeedback(): { state: CopyState; copy: (text: string) => void } {
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
    const copy = useCallback((text: string) => {
        if (busy.current) return;
        busy.current = true;
        void writeClipboard(text).then((next) => {
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
