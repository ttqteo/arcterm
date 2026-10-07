// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Your prompt, pinned to the top of a transcript once it has scrolled away (pinnedprompt.ts decides which), so a long
// turn's reply still says what it answers. A click scrolls back to the prompt. Shared by the live feed
// (narrationtimeline.tsx) and the compact read (compacttranscript.tsx); each marks its prompts with data-user-prompt.
// The scroll back is smooth, so the reply visibly runs back up to the prompt it answers, unless motion is reduced.

import { cn } from "@/util/util";
import { ArrowUp } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useState, type RefObject } from "react";
import { pinnedPromptIndex, PROMPT_JUMP_EVENT } from "./pinnedprompt";

const PROMPT_SELECTOR = "[data-user-prompt]";

function scrollParent(el: HTMLElement | null): HTMLElement | null {
    for (let p = el?.parentElement; p != null; p = p.parentElement) {
        const oy = getComputedStyle(p).overflowY;
        if (oy === "auto" || oy === "scroll") {
            return p;
        }
    }
    return null;
}

/** The index (among root's data-user-prompt elements, in order) of the prompt to pin, or -1. Follows the scroller root
 *  sits in, and root's own size, which changes as the transcript grows or a fold opens. */
export function usePinnedPrompt(rootRef: RefObject<HTMLElement>): number {
    const [index, setIndex] = useState(-1);
    useEffect(() => {
        const root = rootRef.current;
        const scroller = scrollParent(root);
        if (root == null || scroller == null) {
            return;
        }
        let frame = 0;
        const measure = () => {
            frame = 0;
            const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
            const anchors = [...root.querySelectorAll<HTMLElement>(PROMPT_SELECTOR)].map((el) => {
                const r = el.getBoundingClientRect();
                return { top: r.top - base, bottom: r.bottom - base };
            });
            setIndex(pinnedPromptIndex(anchors, scroller.scrollTop));
        };
        const schedule = () => {
            if (frame === 0) {
                frame = requestAnimationFrame(measure);
            }
        };
        measure();
        scroller.addEventListener("scroll", schedule, { passive: true });
        const ro = new ResizeObserver(schedule);
        ro.observe(root);
        return () => {
            scroller.removeEventListener("scroll", schedule);
            ro.disconnect();
            if (frame !== 0) {
                cancelAnimationFrame(frame);
            }
        };
    }, [rootRef]);
    return index;
}

/** The pinned prompt: a zero-height sticky row, so showing it never moves the transcript under it. bg is the
 *  scroller's own background, which the row's band paints over what scrolls beneath it. */
export function PinnedPromptBar({
    rootRef,
    index,
    text,
    bg,
}: {
    rootRef: RefObject<HTMLElement>;
    index: number;
    text: string | undefined;
    bg: string;
}) {
    const reduce = useReducedMotion();
    if (index < 0 || text == null) {
        return null;
    }
    const jump = () => {
        const root = rootRef.current;
        const target = root?.querySelectorAll<HTMLElement>(PROMPT_SELECTOR)[index];
        if (target == null) {
            return;
        }
        root.dispatchEvent(new Event(PROMPT_JUMP_EVENT, { bubbles: true }));
        target.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    };
    return (
        <div data-pinned-prompt className="sticky top-0 z-10 h-0">
            <div className={cn("pb-1.5 pt-1", bg)}>
                <button
                    type="button"
                    onClick={jump}
                    title="Back to this prompt"
                    className="flex w-full cursor-pointer items-center gap-2 rounded-[8px] border border-edge-faint bg-surface-raised px-3 py-[5px] text-left hover:border-edge-mid"
                >
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-primary">{text}</span>
                    <ArrowUp size={12} strokeWidth={2.2} aria-hidden className="flex-none text-muted" />
                </button>
            </div>
        </div>
    );
}
