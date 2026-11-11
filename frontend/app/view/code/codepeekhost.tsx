// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Hosts the Code peek in one terminal: present only where the Agent surface provides CodePeekContext (an agent's
// terminal, not a plain one), it gives the terminal a peek handler for a Ctrl+Shift+click on a path link
// (termpathlinks.ts) and pins the card to an xterm marker on the clicked line. The card is a sibling of xterm's DOM, not
// inside it, so xterm's cursor, selection and wheel handling never reach it. The card's code (Markdown, the editors) is
// loaded when the first one opens: a closed host is a handler and an atom read.

import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import type { TermWrap } from "@/app/view/term/termwrap";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { createContext, lazy, Suspense, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { peekPlacement, peekRow } from "./codepeekmodel";
import { closePeek, codePeekAtom, togglePeek, type CodePeek } from "./codepeekstore";

const CodePeekCard = lazy(() => import("./codepeekcard").then((m) => ({ default: m.CodePeekCard })));

// the view model a peek's Open in Code lands through; null (no provider, or the value null) means no peek in that terminal
export const CodePeekContext = createContext<AgentsViewModel | null>(null);

// the room between the line band and the card
const GAP_PX = 4;
const LEFT_INSET_CELLS = 4;
const RIGHT_INSET_PX = 24;

type Box = { top: number; left: number; width: number; height: number; side: "below" | "above"; visible: boolean };

function sameBox(a: Box | null, b: Box): boolean {
    return (
        a != null &&
        a.top === b.top &&
        a.left === b.left &&
        a.width === b.width &&
        a.height === b.height &&
        a.side === b.side &&
        a.visible === b.visible
    );
}

export function CodePeekHost({ termWrap, blockId }: { termWrap: TermWrap | null; blockId: string }) {
    const model = useContext(CodePeekContext);
    if (model == null || termWrap == null) {
        return null;
    }
    return <AttachedPeekHost model={model} termWrap={termWrap} blockId={blockId} />;
}

function AttachedPeekHost({
    model,
    termWrap,
    blockId,
}: {
    model: AgentsViewModel;
    termWrap: TermWrap;
    blockId: string;
}) {
    const peek = useAtomValue(codePeekAtom);
    const own = peek?.blockId === blockId ? peek : null;

    useEffect(() => {
        termWrap.setPeekHandler(({ ref, bufferLine, start }) =>
            fireAndForget(() =>
                togglePeek({ blockId, bufferLine, start, abs: ref.abs, root: ref.root, line: ref.line ?? null })
            )
        );
        return () => termWrap.setPeekHandler(null);
    }, [termWrap, blockId]);

    return own != null ? (
        <PeekAnchor
            key={`${own.bufferLine}:${own.start}`}
            peek={own}
            termWrap={termWrap}
            model={model}
            blockId={blockId}
        />
    ) : null;
}

function isAnchor(p: CodePeek | null, anchor: CodePeek): boolean {
    return p != null && p.blockId === anchor.blockId && p.bufferLine === anchor.bufferLine && p.start === anchor.start;
}

function PeekAnchor({
    peek,
    termWrap,
    model,
    blockId,
}: {
    peek: CodePeek;
    termWrap: TermWrap;
    model: AgentsViewModel;
    blockId: string;
}) {
    const [box, setBox] = useState<Box | null>(null);
    const peekRef = useRef(peek);
    peekRef.current = peek;

    useLayoutEffect(() => {
        const anchor = peekRef.current;
        const term = termWrap.terminal;
        const marker = termWrap.markLine(anchor.bufferLine);
        if (marker == null) {
            closePeek();
            return;
        }
        // false once this effect disposes the marker itself, so only a trim or clear closes the peek
        let live = true;
        marker.onDispose(() => {
            if (live && isAnchor(globalStore.get(codePeekAtom), anchor)) {
                closePeek();
            }
        });
        const band = term.registerDecoration({ marker, width: term.cols, layer: "top" });
        band?.onRender((el) => {
            el.setAttribute("data-peek-line", "");
            el.classList.add("bg-accentbg", "pointer-events-none");
        });

        // the side is chosen on open and on resize, never on scroll
        let placed: { side: "below" | "above"; height: number } | null = null;
        const place = (replace: boolean) => {
            const screen = term.element?.querySelector(".xterm-screen");
            const root = term.element?.closest("[data-term-view]");
            if (screen == null || root == null || marker.isDisposed) {
                return;
            }
            const s = screen.getBoundingClientRect();
            const r = root.getBoundingClientRect();
            // a pane the surface hides has no size: keep the last box, the next render of the shown pane places it
            if (s.height === 0 || r.width === 0) {
                return;
            }
            const lineHeight = s.height / term.rows;
            const row = peekRow(marker.line, term.buffer.active.viewportY, term.rows);
            if (row == null) {
                setBox((prev) => (prev == null || !prev.visible ? prev : { ...prev, visible: false }));
                return;
            }
            const lineTop = row * lineHeight;
            if (replace || placed == null) {
                placed = peekPlacement({ lineTop, lineHeight, viewportHeight: s.height });
            }
            const height = Math.max(0, placed.height - GAP_PX);
            const lineTopInRoot = s.top - r.top + lineTop;
            const top = placed.side === "below" ? lineTopInRoot + lineHeight + GAP_PX : lineTopInRoot - GAP_PX - height;
            const left = s.left - r.left + LEFT_INSET_CELLS * (s.width / term.cols);
            const next: Box = {
                top,
                left,
                width: Math.max(0, r.width - RIGHT_INSET_PX - left),
                height,
                side: placed.side,
                visible: true,
            };
            setBox((prev) => (sameBox(prev, next) ? prev : next));
        };
        place(true);
        const subs = [
            term.onRender(() => place(false)),
            term.onScroll(() => place(false)),
            term.onResize(() => place(true)),
        ];

        return () => {
            live = false;
            subs.forEach((d) => d.dispose());
            band?.dispose();
            marker.dispose();
            const now = globalStore.get(codePeekAtom);
            if (isAnchor(now, anchor)) {
                // the host is going away while it owns the card
                closePeek();
            }
            if (now == null || isAnchor(now, anchor)) {
                // closed, not moved: a moved card takes focus itself
                const textarea = term.textarea;
                if (textarea?.checkVisibility()) {
                    term.focus();
                }
            }
        };
    }, [termWrap]);

    if (box == null) {
        return null;
    }
    return (
        <div
            className="absolute z-10"
            style={{
                top: box.top,
                left: box.left,
                width: box.width,
                height: box.height,
                visibility: box.visible ? "visible" : "hidden",
            }}
        >
            <Suspense fallback={null}>
                <CodePeekCard peek={peek} model={model} blockId={blockId} side={box.side} />
            </Suspense>
        </div>
    );
}
