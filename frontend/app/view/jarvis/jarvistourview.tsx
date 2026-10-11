// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Jarvis tour on screen: a dim with the real controls a step names left lit, a card beside them in Vietnamese or
// English, the header's ? menu that starts a track, and the once-only offer on the first visit. The state machine,
// the step content and the box math are in jarvistour.ts / jarvistourcontent.ts; what a step opens is in
// jarvistouractions.ts.

import { registerModal } from "@/app/modals/modalstack";
import { globalStore } from "@/app/store/jotaiStore";
import { buildJarvisTourBindings } from "@/app/store/keybindings/bindings";
import { useKeybindings } from "@/app/store/keybindings/store";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { cn } from "@/util/util";
import {
    autoUpdate,
    flip,
    offset,
    shift,
    useClick,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { CircleHelp } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import {
    markOffered,
    reconcile,
    shouldOffer,
    stepView,
    textOf,
    tourBack,
    tourNext,
    tourStart,
    type StepView,
    type TourLang,
    type TourPrepare,
    type TourState,
    type TourStep,
} from "./jarvistour";
import { closePrepare, openPrepare, targetRects } from "./jarvistouractions";
import { TOUR_TRACKS, TOUR_UI, trackOf } from "./jarvistourcontent";
import { tourAtom, tourLangAtom, tourMenuOpenAtom } from "./jarvistourstore";

const MODAL_ID = "jarvis-tour";
const WAIT_MS = 1000;
const POLL_MS = 50;
const MEASURE_MS = 250;

const CARD_CLASS = "rounded-[12px] border border-edge-strong bg-modalbg p-4 shadow-popover";

function viewport() {
    return { width: window.innerWidth, height: window.innerHeight };
}

function sameView(a: StepView, b: StepView): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function blurEditable() {
    const el = document.activeElement as HTMLElement | null;
    if (el != null && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) {
        el.blur();
    }
}

/** The VI | EN switch, the Profile's segment look; it sets the language every card and the ? menu read. */
function LangSwitch(): JSX.Element {
    const [lang, setLang] = useAtom(tourLangAtom);
    return (
        <div role="group" aria-label="Language" className="flex flex-none items-center gap-0.5">
            {(["vi", "en"] as TourLang[]).map((l) => (
                <button
                    key={l}
                    type="button"
                    data-jarvis-tour-lang-toggle={l}
                    aria-pressed={lang === l}
                    onClick={() => setLang(l)}
                    className={cn(
                        "h-[22px] cursor-pointer rounded-[6px] px-2 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        lang === l ? "bg-surface-raised text-ink-hi" : "text-ink-mid hover:text-ink-hi"
                    )}
                >
                    {l.toUpperCase()}
                </button>
            ))}
        </div>
    );
}

function TourLayer({ model, state }: { model: AgentsViewModel; state: TourState }): JSX.Element {
    const lang = useAtomValue(tourLangAtom);
    const setTour = useSetAtom(tourAtom);
    const track = trackOf(state.track);
    const total = track.steps.length;
    const step: TourStep = track.steps[Math.min(state.index, total - 1)];
    const ui = TOUR_UI[lang];
    const text = textOf(step, lang);
    const last = state.index + 1 >= total;

    // what this tour opened, so a step closes only its own and the end puts the Jarvis surface back as it was
    const openedRef = useRef<TourPrepare[]>([]);
    const unregisterRef = useRef<(() => void) | null>(null);
    const [ready, setReady] = useState(false);
    const [view, setView] = useState<StepView>({ kind: "center" });

    const handlers = {
        next: () => {
            const nx = tourNext(state, total);
            setTour(nx);
        },
        back: () => setTour(tourBack(state)),
        close: () => setTour(null),
    };
    // the bindings are registered once; they reach the current render's state through this ref
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;
    const bindings = useMemo(
        () =>
            buildJarvisTourBindings({
                next: () => handlersRef.current.next(),
                back: () => handlersRef.current.back(),
                close: () => handlersRef.current.close(),
            }),
        []
    );
    useKeybindings(bindings);

    // the end, by Skip, Done, Escape, or the Brief unmounting under a surface change: close what the tour opened
    useEffect(
        () => () => {
            for (const p of reconcile(openedRef.current, undefined).close) {
                closePrepare(p);
            }
            openedRef.current = [];
            unregisterRef.current?.();
            unregisterRef.current = null;
        },
        []
    );

    // each step: open what it needs, close what the last one opened and this one does not, then wait for its target
    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        setReady(false);
        const plan = reconcile(openedRef.current, step.prepare);
        for (const p of plan.close) {
            closePrepare(p);
            openedRef.current = openedRef.current.filter((o) => o !== p);
        }
        if (plan.open != null && openPrepare(plan.open, model)) {
            openedRef.current = [...openedRef.current, plan.open];
        }
        // the top of the modal stack only once what the step opened has registered its own shell (a Profile does so a
        // render after it opens), or it would sit above the tour and take its Escape
        const toTop = () => {
            unregisterRef.current?.();
            unregisterRef.current = registerModal(MODAL_ID);
            blurEditable();
        };
        const finish = () => {
            if (cancelled) {
                return;
            }
            toTop();
            // measured before the card shows, so it never appears centered for a frame and then jumps
            setView(stepView(step, targetRects(step), viewport()));
            setReady(true);
        };
        if (step.target == null && step.also == null) {
            setView({ kind: "center" });
            setReady(true);
            timer = setTimeout(() => !cancelled && toTop(), 120);
        } else {
            const started = Date.now();
            const poll = () => {
                if (cancelled) {
                    return;
                }
                if (targetRects(step).length > 0 || Date.now() - started >= WAIT_MS) {
                    finish();
                    return;
                }
                timer = setTimeout(poll, POLL_MS);
            };
            poll();
        }
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [state.track, state.index]);

    // measure while a step shows: the lit controls move with a resize, a scroll and the surface's own reflow
    useEffect(() => {
        if (!ready) {
            return;
        }
        const measure = () => {
            const next = stepView(step, targetRects(step), viewport());
            setView((prev) => (sameView(prev, next) ? prev : next));
        };
        measure();
        const id = setInterval(measure, MEASURE_MS);
        window.addEventListener("resize", measure);
        window.addEventListener("scroll", measure, true);
        return () => {
            clearInterval(id);
            window.removeEventListener("resize", measure);
            window.removeEventListener("scroll", measure, true);
        };
    }, [ready, state.track, state.index]);

    const { refs, floatingStyles } = useFloating({
        strategy: "fixed",
        placement: "bottom",
        middleware: [offset(12), flip(), shift({ padding: 12 })],
        whileElementsMounted: autoUpdate,
    });
    const box = ready && view.kind === "spot" ? view.boxes[0] : undefined;
    useEffect(() => {
        refs.setPositionReference(
            box == null ? null : { getBoundingClientRect: () => new DOMRect(box.left, box.top, box.width, box.height) }
        );
    }, [box?.left, box?.top, box?.width, box?.height, box == null]);

    const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
    const spot = ready && view.kind === "spot" ? view : null;

    // portaled: the Jarvis root is a positioned, clipped container, and the dim has to cover the Profile's shell
    return createPortal(
        <div
            data-jarvis-tour-view={ready ? view.kind : "waiting"}
            className="fixed inset-0 z-[80]"
            onPointerDown={stop}
            onMouseDown={stop}
            onClick={stop}
        >
            {spot != null ? (
                <>
                    <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full">
                        <defs>
                            {/* a mask is read by luminance, not drawn: white keeps the dim, black cuts a hole, so
                                these two fills are not theme colors */}
                            <mask id="jarvis-tour-mask">
                                <rect width="100%" height="100%" fill="white" />
                                {spot.boxes.map((b, i) => (
                                    <rect
                                        key={i}
                                        x={b.left}
                                        y={b.top}
                                        width={b.width}
                                        height={b.height}
                                        rx={8}
                                        fill="black"
                                    />
                                ))}
                            </mask>
                        </defs>
                        <rect width="100%" height="100%" className="fill-black/55" mask="url(#jarvis-tour-mask)" />
                    </svg>
                    {spot.boxes.map((b, i) => (
                        <div
                            key={i}
                            data-jarvis-tour-spot
                            className="pointer-events-none absolute rounded-[8px] ring-2 ring-accent"
                            style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
                        />
                    ))}
                </>
            ) : (
                <div className="absolute inset-0 bg-black/55" />
            )}
            {ready ? (
                <div
                    ref={spot != null ? refs.setFloating : undefined}
                    role="dialog"
                    aria-label={text.title}
                    data-jarvis-tour-card
                    data-jarvis-tour-step={step.id}
                    data-jarvis-tour-lang={lang}
                    style={spot != null ? floatingStyles : undefined}
                    className={cn(
                        "w-[340px]",
                        CARD_CLASS,
                        spot == null && "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                    )}
                >
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="text-[11.5px] text-muted">
                            {state.index + 1} / {total} · {track[lang].title}
                        </span>
                        <LangSwitch />
                    </div>
                    <h2 className="text-[14px] font-semibold text-ink-hi">{text.title}</h2>
                    <p className="mt-1.5 text-[13px] leading-[1.5] text-ink-mid">{text.body}</p>
                    <div className="mt-3.5 flex items-center justify-between gap-2">
                        <button
                            type="button"
                            data-jarvis-tour-skip
                            onClick={() => setTour(null)}
                            className="cursor-pointer rounded-[6px] px-1 text-[12px] text-muted hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            {ui.skip}
                        </button>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                data-jarvis-tour-back
                                disabled={state.index === 0}
                                onClick={handlers.back}
                                className="h-8 cursor-pointer rounded-[7px] border border-border bg-surface-raised px-3.5 text-[12.5px] font-semibold text-secondary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-40 disabled:hover:text-secondary"
                            >
                                {ui.back}
                            </button>
                            <button
                                type="button"
                                data-jarvis-tour-next
                                onClick={handlers.next}
                                className="h-8 cursor-pointer rounded-[7px] bg-accent px-3.5 text-[12.5px] font-semibold text-background hover:bg-accenthover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                                {last ? ui.done : ui.next}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>,
        document.body
    );
}

/** The tour itself: nothing while no track runs. Mounted once with the Brief, so leaving Jarvis ends a tour. */
export function JarvisTour({ model }: { model: AgentsViewModel }): JSX.Element | null {
    const state = useAtomValue(tourAtom);
    useEffect(() => () => globalStore.set(tourAtom, null), []);
    if (state == null) {
        return null;
    }
    // keyed by track: starting another track tears the first down (and closes what it opened) before the next opens
    return <TourLayer key={state.track} model={model} state={state} />;
}

/** The header's ? button: a menu of the four tracks. */
export function TourButton(): JSX.Element {
    const lang = useAtomValue(tourLangAtom);
    const setTour = useSetAtom(tourAtom);
    const ui = TOUR_UI[lang];
    // an atom, not local state: the dispatcher must see the menu open to leave Escape to it
    const [open, setOpen] = useAtom(tourMenuOpenAtom);
    useEffect(() => () => setOpen(false), [setOpen]);
    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange: setOpen,
        placement: "bottom-end",
        strategy: "fixed",
        middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
        whileElementsMounted: autoUpdate,
    });
    const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context)]);
    return (
        <>
            <button
                ref={refs.setReference}
                {...getReferenceProps()}
                type="button"
                data-jarvis-tour-button
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={ui.button}
                title={ui.button}
                className="flex h-[28px] w-[28px] flex-none cursor-pointer items-center justify-center rounded-[8px] border border-edge-mid bg-surface-raised text-ink-mid hover:border-edge-strong hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
                <CircleHelp aria-hidden size={14} strokeWidth={1.8} />
            </button>
            {open ? (
                <div
                    ref={refs.setFloating}
                    {...getFloatingProps()}
                    style={floatingStyles}
                    role="menu"
                    aria-label={ui.menu}
                    className="z-[60] w-[220px] rounded-[10px] border border-edge-strong bg-modalbg p-1 shadow-popover"
                >
                    <div className="px-2.5 pb-1 pt-1.5 text-[11.5px] text-muted">{ui.menu}</div>
                    {TOUR_TRACKS.map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            role="menuitem"
                            data-jarvis-tour-track={t.id}
                            onClick={() => {
                                setOpen(false);
                                setTour(tourStart(t.id));
                            }}
                            className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-[7px] px-2.5 py-1.5 text-left text-[13px] text-ink-hi hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            <span>{t[lang].title}</span>
                            <span className="text-[11.5px] text-muted">{t.steps.length}</span>
                        </button>
                    ))}
                </div>
            ) : null}
        </>
    );
}

/** The first-visit offer, under the header. Asked once: either answer is remembered. */
export function TourOffer(): JSX.Element | null {
    const lang = useAtomValue(tourLangAtom);
    const running = useAtomValue(tourAtom);
    const setTour = useSetAtom(tourAtom);
    const [offered, setOffered] = useState(() => shouldOffer(localStorage));
    if (!offered || running != null) {
        return null;
    }
    const ui = TOUR_UI[lang];
    const answer = (start: boolean) => {
        markOffered(localStorage);
        setOffered(false);
        if (start) {
            setTour(tourStart("brief"));
        }
    };
    return (
        <div
            data-jarvis-tour-offer
            role="dialog"
            aria-label={ui.offerTitle}
            className={cn("absolute right-4 top-[60px] z-30 w-[300px]", CARD_CLASS)}
        >
            <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-[14px] font-semibold text-ink-hi">{ui.offerTitle}</h2>
                <LangSwitch />
            </div>
            <p className="text-[13px] leading-[1.5] text-ink-mid">{ui.offerBody}</p>
            <div className="mt-3.5 flex items-center justify-end gap-2">
                <button
                    type="button"
                    data-jarvis-tour-offer-later
                    onClick={() => answer(false)}
                    className="h-[28px] cursor-pointer rounded-[8px] border border-edge-mid px-3 text-[12.5px] text-ink-mid hover:border-edge-strong hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    {ui.offerLater}
                </button>
                <button
                    type="button"
                    data-jarvis-tour-offer-start
                    onClick={() => answer(true)}
                    className="h-[28px] cursor-pointer rounded-[8px] bg-accent px-3 text-[12.5px] font-semibold text-background hover:bg-accenthover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                    {ui.offerStart}
                </button>
            </div>
        </div>
    );
}
