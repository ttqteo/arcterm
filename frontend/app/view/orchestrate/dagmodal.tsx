// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { modalBackdrop, modalPanel } from "@/app/element/motiontokens";
import { focusTrapTarget, takeModalFocus } from "@/app/modals/modalfocus";
import { useWaveObjectValue } from "@/app/store/wos";
import { useAtomValue } from "jotai";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useEffect, useRef, useState, type JSX } from "react";
import { harnessesAtom } from "../agents/harnessstore";
import { channelProjectLabel } from "../agents/projectlabel";
import { projectsAtom } from "../agents/projectsstore";
import { DagGraphView } from "./daggraph";
import { closeDagModal, dagModalStateAtom, dismissDagModal, escapeDagModal, type DagModalState } from "./dagmodalstate";
import { ModelPicksBanner } from "./modelpicksview";
import { timelineLayout, type TimelineLayout } from "./timelinefilter";
import { TimelineRail } from "./timelinerail";

const DAG_MODAL_HEADING_ID = "dag-modal-heading";
const FOCUSABLE_SELECTOR =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function DagModal() {
    const state = useAtomValue(dagModalStateAtom);
    const panelRef = useRef<HTMLDivElement>(null);
    const open = state != null;
    const layout = useTimelineLayout();

    // the modal's state is global but the surface hosting it unmounts on switch
    useEffect(() => dismissDagModal, []);

    // the panel arrives blank and the graph mounts once it has: mounting ReactFlow in the click's frame
    // held the modal off screen, and mounting it mid-entrance dropped the animation's frames
    const [entered, setEntered] = useState(false);
    useEffect(() => {
        if (!open) setEntered(false);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                escapeDagModal();
                return;
            }
            if (event.key !== "Tab") return;
            event.preventDefault();
            event.stopPropagation();
            const panel = panelRef.current;
            if (!panel) return;
            const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
            const target = focusTrapTarget(focusables, document.activeElement, event.shiftKey);
            (target ?? panel).focus();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        return takeModalFocus(panelRef.current, document.activeElement as HTMLElement | null);
    }, [open]);

    return (
        <MotionConfig reducedMotion="user">
            <AnimatePresence>
                {state ? (
                    <motion.div
                        key="dag-modal-backdrop"
                        variants={modalBackdrop}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        data-dag-modal-kind={state.kind}
                        // no backdrop-blur: under a 95% scrim it shows nothing, and WebView2 re-blurs the whole
                        // window every frame anything under it moves, which stuttered the open
                        className="absolute inset-0 z-30 flex items-center justify-center bg-background/95 p-4"
                        onMouseDown={(event) => {
                            if (event.target === event.currentTarget) closeDagModal();
                        }}
                    >
                        <motion.div
                            ref={panelRef}
                            variants={modalPanel}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby={DAG_MODAL_HEADING_ID}
                            tabIndex={-1}
                            onAnimationComplete={(definition) => {
                                if (definition === "animate") setEntered(true);
                            }}
                            onMouseDown={(event) => event.stopPropagation()}
                            className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-edge-strong bg-modalbg shadow-popover outline-none"
                        >
                            <div className="flex flex-none items-center gap-3 border-b border-border bg-surface px-4 py-3">
                                <div className="min-w-0 flex-1">
                                    <h2 id={DAG_MODAL_HEADING_ID} className="text-title font-bold text-primary">
                                        Route DAG
                                    </h2>
                                    <ModalSubtitle channelId={state.channelId} runId={state.runId} />
                                </div>
                                <button
                                    type="button"
                                    onClick={closeDagModal}
                                    className="cursor-pointer rounded-md border border-border bg-surface px-3 py-1.5 text-[11px] font-semibold text-secondary hover:border-edge-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                >
                                    Close · Esc
                                </button>
                            </div>
                            <div className={"min-h-0 flex flex-1 " + (layout === "drawer" ? "flex-col" : "")}>
                                {/* the banner spans the graph only, so the timeline keeps the full height */}
                                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                                    <ModelPicksBanner dagOref={state.dagOref} runId={state.runId} />
                                    <div className="min-h-0 flex-1">
                                        <LiveDagModal state={state} entered={entered} />
                                    </div>
                                </div>
                                <TimelineRail channelId={state.channelId} runId={state.runId} layout={layout} />
                            </div>
                        </motion.div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </MotionConfig>
    );
}

// ModalSubtitle names which run this graph belongs to: the project it runs in, and the run by its short
// prefix — because the pair of raw uuids this replaced identified the graph to the database and to nobody
// else, and the project is the half a reader actually recognises.
function ModalSubtitle({ channelId, runId }: { channelId: string; runId: string }) {
    const [channel] = useWaveObjectValue<Channel>(`channel:${channelId}`);
    const projects = useAtomValue(projectsAtom);
    return (
        <p className="text-[10.5px] uppercase tracking-[.1em] text-muted">
            {channelProjectLabel(channel, projects) || channelId} · {runId.slice(0, 13)}
        </p>
    );
}

// useTimelineLayout tracks whether the modal is wide enough to show live work and history side by
// side. Mirrors the nav rail's window-resize pattern; the decision itself is the pure timelineLayout.
function useTimelineLayout(): TimelineLayout {
    const [layout, setLayout] = useState(() => timelineLayout(window.innerWidth));
    useEffect(() => {
        const onResize = () => setLayout(timelineLayout(window.innerWidth));
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);
    return layout;
}

// a panel whose entrance never reports done (an interrupted animation) still gets its graph
const ENTER_FALLBACK_MS = 600;

function LiveDagModal({
    state,
    entered,
}: {
    state: Extract<DagModalState, { kind: "live" }>;
    entered: boolean;
}): JSX.Element {
    const [owner, loading] = useWaveObjectValue<Run>(`run:${state.runId}`);
    const harnesses = useAtomValue(harnessesAtom);
    const [late, setLate] = useState(false);
    useEffect(() => {
        const t = window.setTimeout(() => setLate(true), ENTER_FALLBACK_MS);
        return () => window.clearTimeout(t);
    }, []);
    // blank, not a skeleton: the DAG's shape is only known once it lays out, so node-shaped blocks would lie
    if (!(entered || late) || loading || owner == null) {
        return <div className="h-full w-full bg-background" />;
    }
    return <DagGraphView oref={state.dagOref} owner={owner} harnesses={harnesses} />;
}
