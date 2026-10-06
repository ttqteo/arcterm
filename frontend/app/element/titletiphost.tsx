// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The app's hover tooltip, for every element that carries a `title`. The browser's own title tooltip waits
// about a second and draws an OS chip; this one shows as the pointer arrives, in the app's colors, with a
// trailing shortcut split out (titletip.ts). Mounted once in the always-mounted shell, so no call site
// changes: a `title` is still how a control names itself.
//
// While an element is hovered its `title` is lifted into data-arc-title so the native tooltip cannot also
// fire, and it goes back when the pointer leaves. Putting it back matters: React only writes an attribute
// when its prop changes, so a title removed for good would never return. If React rewrites the title
// while it is lifted, the observer lifts the new text.
//
// Placement: below the element, beside it in the nav rail, or whatever the nearest data-tip-placement says.

import { autoUpdate, computePosition, flip, offset, shift, type Placement } from "@floating-ui/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { keyDismissesTip, splitTitle } from "./titletip";

const STASH = "data-arc-title";

interface Tip {
    anchor: HTMLElement;
    text: string;
    placement: Placement;
}

function placementFor(el: HTMLElement): Placement {
    const explicit = el.closest("[data-tip-placement]")?.getAttribute("data-tip-placement");
    if (explicit) {
        return explicit as Placement;
    }
    return el.closest("nav") != null ? "right" : "bottom";
}

export function TitleTipHost() {
    const [tip, setTip] = useState<Tip | null>(null);
    const tipRef = useRef<HTMLDivElement>(null);
    const currentRef = useRef<HTMLElement | null>(null);
    const observerRef = useRef<MutationObserver | null>(null);

    useEffect(() => {
        const release = () => {
            const el = currentRef.current;
            currentRef.current = null;
            observerRef.current?.disconnect();
            observerRef.current = null;
            if (el != null) {
                const text = el.getAttribute(STASH);
                el.removeAttribute(STASH);
                if (text != null && !el.hasAttribute("title")) {
                    el.setAttribute("title", text);
                }
            }
            setTip(null);
        };
        const lift = (el: HTMLElement) => {
            const text = el.getAttribute("title") ?? "";
            el.removeAttribute("title");
            el.setAttribute(STASH, text);
            return text;
        };
        const onOver = (e: PointerEvent) => {
            const target = e.target instanceof Element ? e.target : null;
            const el = target?.closest<HTMLElement>(`[title], [${STASH}]`) ?? null;
            if (el === currentRef.current) {
                return;
            }
            release();
            if (el == null || !(el instanceof HTMLElement)) {
                return;
            }
            const text = el.hasAttribute("title") ? lift(el) : (el.getAttribute(STASH) ?? "");
            if (text.trim() === "") {
                return;
            }
            currentRef.current = el;
            const observer = new MutationObserver(() => {
                if (el.hasAttribute("title")) {
                    const next = lift(el);
                    setTip((t) => (t?.anchor === el ? { ...t, text: next } : t));
                }
            });
            observer.observe(el, { attributes: true, attributeFilter: ["title"] });
            observerRef.current = observer;
            setTip({ anchor: el, text, placement: placementFor(el) });
        };
        const onOut = (e: PointerEvent) => {
            const el = currentRef.current;
            const to = e.relatedTarget instanceof Node ? e.relatedTarget : null;
            if (el != null && (to == null || !el.contains(to))) {
                release();
            }
        };
        // a press, a real key or a scroll means the hint has done its job. A modifier alone does not (titletip.ts),
        // and neither does the window losing focus: a screenshot tool (⌘⇧5, CleanShot) takes focus to capture the
        // screen, so a tip dropped on blur was never in the shot. Back in the window, the next pointer move
        // releases a tip the pointer has left.
        const dismiss = () => setTip(null);
        const onKey = (e: KeyboardEvent) => {
            if (keyDismissesTip(e.key)) {
                dismiss();
            }
        };
        document.addEventListener("pointerover", onOver, true);
        document.addEventListener("pointerout", onOut, true);
        document.addEventListener("pointerdown", dismiss, true);
        document.addEventListener("keydown", onKey, true);
        document.addEventListener("scroll", dismiss, true);
        return () => {
            document.removeEventListener("pointerover", onOver, true);
            document.removeEventListener("pointerout", onOut, true);
            document.removeEventListener("pointerdown", dismiss, true);
            document.removeEventListener("keydown", onKey, true);
            document.removeEventListener("scroll", dismiss, true);
            release();
        };
    }, []);

    useLayoutEffect(() => {
        const floating = tipRef.current;
        if (tip == null || floating == null) {
            return;
        }
        const place = () =>
            void computePosition(tip.anchor, floating, {
                strategy: "fixed",
                placement: tip.placement,
                middleware: [offset(6), flip(), shift({ padding: 8 })],
            }).then(({ x, y }) => {
                floating.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
                floating.style.visibility = "visible";
            });
        // the anchor can leave the DOM under the pointer (a click that re-renders), which fires no pointerout
        const stop = autoUpdate(tip.anchor, floating, () => {
            if (!tip.anchor.isConnected) {
                setTip(null);
                return;
            }
            place();
        });
        return stop;
    }, [tip]);

    if (tip == null) {
        return null;
    }
    const { label, keys } = splitTitle(tip.text);
    return (
        <div
            ref={tipRef}
            role="tooltip"
            data-title-tip
            style={{ position: "fixed", left: 0, top: 0, visibility: "hidden" }}
            className="pointer-events-none z-[1000] flex max-w-[360px] items-baseline gap-2.5 rounded-[6px] border border-edge-mid bg-surface-raised px-2 py-[5px] text-[12px] leading-[1.4] text-primary shadow-popover"
        >
            <span className="whitespace-pre-line">{label}</span>
            {keys ? <span className="flex-none whitespace-nowrap text-[11.5px] text-muted">{keys}</span> : null}
        </div>
    );
}
