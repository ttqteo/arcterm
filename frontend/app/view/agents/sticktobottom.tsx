// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Shared stick-to-bottom behavior for streaming NarrationTimeline feeds. Extracted from agentrow.tsx
// so the subagent interior and runs worker cards get the same auto-follow + jump-to-latest pill.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isNearBottom } from "./agentsviewmodel";
import { PROMPT_JUMP_EVENT } from "./pinnedprompt";

// A scroll region that sticks to the tail while the user is at the bottom, releases when they scroll
// up to read history, and re-sticks on jumpToBottom. `entries` is the dependency that triggers the
// re-pin: pass the same array the feed renders. layout-effect (not effect) so the pin lands before
// paint — otherwise a taller feed paints at the old scrollTop then snaps down a frame later. A pinned prompt's scroll
// back (PROMPT_JUMP_EVENT) releases it as scrolling up does.
export function useStickToBottom(entries: unknown[]) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const stickRef = useRef(true);
    // a pinned prompt's jump released the tail and its smooth scroll has not yet left the bottom zone, where the first
    // frames still read as near the bottom and would re-stick
    const leavingRef = useRef(false);
    const [atBottom, setAtBottom] = useState(true);

    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (el && stickRef.current) {
            el.scrollTop = el.scrollHeight;
        }
    }, [entries]);

    // after every render, not once: a caller may mount its scroll region after its first render
    useEffect(() => {
        const el = scrollRef.current;
        if (el == null) {
            return;
        }
        const release = () => {
            stickRef.current = false;
            leavingRef.current = true;
            setAtBottom(false);
        };
        el.addEventListener(PROMPT_JUMP_EVENT, release);
        return () => el.removeEventListener(PROMPT_JUMP_EVENT, release);
    });

    const onScroll = () => {
        const el = scrollRef.current;
        if (!el) {
            return;
        }
        const near = isNearBottom(el);
        if (leavingRef.current) {
            if (near) {
                return;
            }
            leavingRef.current = false;
        }
        stickRef.current = near;
        setAtBottom(near);
    };

    const jumpToBottom = () => {
        const el = scrollRef.current;
        if (!el) {
            return;
        }
        el.scrollTop = el.scrollHeight;
        stickRef.current = true;
        leavingRef.current = false;
        setAtBottom(true);
    };

    return { scrollRef, onScroll, atBottom, jumpToBottom };
}

// The jump-to-latest pill. Render inside a `relative` parent of the scroll region so it anchors to the
// viewport bottom and does not scroll with the feed. Stops click propagation (callers are often inside
// a clickable card).
export function JumpToLatestPill({ onClick }: { onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            title="Jump to latest"
            className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-edge-strong bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-secondary shadow-popover-sm hover:border-accent hover:text-primary"
        >
            <span className="text-[12px] leading-none">↓</span> Latest
        </button>
    );
}
