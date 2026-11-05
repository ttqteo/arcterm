// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The hook that keeps a council scroller where the reader left it (the chat's channel, an idea's thread, the Summary, the
// rail's Ideas and Memory tabs), over the pure places in councilscroll.ts. A file of its own so the Memory tab
// (councilmemory.tsx), which councilchat.tsx draws, can use it without importing councilchat.tsx back.

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { followsEnd, keepPlace, keptPlace, placeOf, sentSince, topFor, type ScrollPlace } from "./councilscroll";

/** Keeps a council scroller where the reader left it, under `key` (councilscroll.ts): back there after a remount (another
 *  council, the Summary, another agent, another tab of the rail) and after the surface comes back from display:none,
 *  which drops an element's offset. With `follow`, a reader at the bottom stays at the bottom as `count` grows. A scroller
 *  with nothing kept starts at `start`: the end by default when it follows, else the top. One more of the person's own
 *  posts (`sent`, councilscroll.ownPosts) brings the end into view wherever the reader was, so what they just sent shows.
 *  Returns the scroller's onScroll. */
export function useKeptScroll(
    ref: RefObject<HTMLElement | null>,
    key: string,
    {
        follow = false,
        count = 0,
        start,
        sent = 0,
    }: { follow?: boolean; count?: number; start?: "top" | "end"; sent?: number } = {}
): () => void {
    const startAtEnd = (start ?? (follow ? "end" : "top")) === "end";
    const place = useRef<ScrollPlace | undefined>(undefined);
    const restore = useCallback(() => {
        const el = ref.current;
        if (el != null && el.clientHeight > 0) {
            el.scrollTop = topFor(place.current, el, startAtEnd);
            // measured where it opened, so one that opens at the top follows new lines only once the reader is at the end
            place.current ??= placeOf(el);
        }
    }, [ref, startAtEnd]);
    useLayoutEffect(() => {
        place.current = keptPlace(key);
        restore();
    }, [key, restore]);
    useLayoutEffect(() => {
        if (followsEnd(place.current, follow)) {
            restore();
        }
    }, [count, follow, restore]);
    const sentWas = useRef({ key, n: sent });
    useLayoutEffect(() => {
        const was = sentWas.current;
        sentWas.current = { key, n: sent };
        const el = ref.current;
        if (sentSince(was, key, sent) && el != null && el.clientHeight > 0) {
            el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
            place.current = placeOf(el);
            keepPlace(key, place.current);
        }
    }, [ref, key, sent]);
    // shown again (its offset is gone), or resized while following (the thread opening rewraps the channel)
    useEffect(() => {
        const el = ref.current;
        if (el == null || typeof ResizeObserver === "undefined") {
            return;
        }
        let shown = el.clientHeight > 0;
        const ro = new ResizeObserver(() => {
            const now = el.clientHeight > 0;
            if (now && (!shown || followsEnd(place.current, follow))) {
                restore();
            }
            shown = now;
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [ref, follow, restore]);
    return useCallback(() => {
        const el = ref.current;
        // a hidden scroller has no height and clamps to the top: not the reader's place
        if (el != null && el.clientHeight > 0) {
            place.current = placeOf(el);
            keepPlace(key, place.current);
        }
    }, [ref, key]);
}
