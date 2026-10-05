// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The graph peek: an overlay over the Stage, never a destination. You enter it from an object and leave it
// by opening one — every action here closes the overlay onto something. It layers over the thread as a
// sibling, never wrapping it, so peeking cannot remount live worker output.

import { modalBackdrop } from "@/app/element/motiontokens";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { SubLabel } from "@/app/view/agents/sectionlabel";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { Search, Waypoints } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { SHEET_BTN } from "./briefrunsheet";
import { REGION_LABEL } from "./briefstyle";
import type { PeekFocus } from "./graphfocus";
import { GraphSkeleton } from "./graphskeleton";
import { JarvisGraph } from "./jarvisgraph";
import { attributionStyle, mergeGraph } from "./jarvisgraphderive";
import {
    focusDossier,
    graphBaseAtom,
    graphBloomAtom,
    graphErrorAtom,
    graphLoadedAtom,
    graphSelectedIdAtom,
    loadGraph,
    selectBloomedRun,
    selectNode,
} from "./jarvisgraphstore";
import { openOrPeekAddress } from "./openref";

const KIND_TONE: Record<string, string> = {
    task: "text-graph-task",
    run: "text-graph-run",
    decision: "text-graph-decision",
    memory: "text-muted",
};

// enough matches to choose from without the panel becoming its own scrolling list; the overflow is
// reported rather than dropped silently.
const MAX_MATCHES = 12;

function ActionButton({
    label,
    primary,
    peek,
    onClick,
}: {
    label: string;
    primary?: boolean;
    peek?: boolean;
    onClick: (e: React.MouseEvent) => void;
}) {
    return (
        <button
            type="button"
            data-peek={peek ? "" : undefined}
            onClick={onClick}
            className={cn(
                "w-full cursor-pointer rounded-[8px] px-2 py-2 text-[11.5px] font-bold",
                primary
                    ? "bg-accent text-background hover:bg-accenthover"
                    : "border border-border bg-surface font-semibold text-secondary hover:text-primary"
            )}
        >
            {label}
        </button>
    );
}

export function GraphPeek({
    model,
    focus,
    onClose,
    onOpenRecord,
    canOpenRuns = true,
}: {
    model: AgentsViewModel;
    focus: PeekFocus;
    onClose: () => void;
    onOpenRecord: (dossierId: string) => void;
    // false in the Brief: runs have no Stage-sheet destination until B5, and a control that navigates
    // nowhere is worse than its absence
    canOpenRuns?: boolean;
}) {
    const base = useAtomValue(graphBaseAtom);
    const blooms = useAtomValue(graphBloomAtom);
    const loaded = useAtomValue(graphLoadedAtom);
    const error = useAtomValue(graphErrorAtom);
    const selectedId = useAtomValue(graphSelectedIdAtom);
    const [query, setQuery] = useState("");

    // refetch on every open, not only the first: a record captured since (every new run makes one) has no node
    // in a cached graph, so its map button would land on an empty panel. The cached graph stays on screen
    // until the refetch lands, and the canvas seeds positions from its cache, so known nodes do not move.
    useEffect(() => {
        fireAndForget(loadGraph);
    }, []);

    // the peek opens *from* an object, whatever the subject kind: bloom the record the subject resolves to
    // and then select the run node itself if that bloom brought it in, so the overlay arrives centred on
    // what the user was looking at rather than on the whole vault with nothing selected. Primitive deps —
    // `focus` is rebuilt on every render of the Stage.
    const { dossierId, runORef } = focus;
    useEffect(() => {
        if (dossierId == null) {
            // nothing to focus — the selection is module-scope, so leaving the previous one in place made
            // the peek claim a SELECTED NODE this open never resolved, and hid the honest empty state.
            selectNode(null);
            return;
        }
        fireAndForget(async () => {
            await focusDossier(dossierId);
            if (runORef != null) {
                selectBloomedRun(dossierId, runORef);
            }
        });
    }, [dossierId, runORef]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const merged = mergeGraph(base ?? { nodes: [], links: [] }, blooms);
    const node = selectedId != null ? merged.nodes.find((n) => n.id === selectedId) : undefined;
    const edges = selectedId != null ? merged.links.filter((l) => l.from === selectedId || l.to === selectedId) : [];

    // the way in when the subject resolves to no node — an unattributed run, a radar or memory thread, or
    // no subject at all. Selecting a match is enough: the canvas recenters on an off-screen selection.
    const q = query.trim().toLowerCase();
    const matches = q === "" ? [] : merged.nodes.filter((n) => n.label.toLowerCase().includes(q));

    // a peek shows the run over the graph, so the graph stays for the user to come back to
    const openRun = (runORef: string, e: React.MouseEvent) => {
        fireAndForget(() => openOrPeekAddress(model, runORef, e));
        if (!e.ctrlKey) {
            onClose();
        }
    };

    return (
        <motion.div
            variants={modalBackdrop}
            initial="initial"
            animate="animate"
            exit="exit"
            data-jarvis-graph-peek
            className="absolute inset-0 z-20 flex flex-col bg-background/95 backdrop-blur-[3px]"
        >
            <div className="flex flex-none items-center gap-2.5 border-b border-edge-faint bg-surface px-4 py-2.5">
                <Waypoints size={14} className="flex-none text-accent-soft" />
                <span className={cn(REGION_LABEL, "text-accent-soft")}>graph</span>
                {/* the count only: a task node's label is its record's whole objective, up to 10k characters */}
                <span className="text-[10.5px] tabular-nums text-muted">{merged.nodes.length} nodes</span>
                <div className="flex-1" />
                {/* no legend here: the canvas draws one in its bottom-left, sitting with the nodes it
                    labels. Two legends disagreed on case and order for the same four kinds. */}
                <button type="button" onClick={onClose} className={cn(SHEET_BTN, "inline-flex items-center gap-2")}>
                    Close
                    <span className="font-mono text-[10.5px] font-normal text-muted">Esc</span>
                </button>
            </div>
            <div className="flex min-h-0 flex-1">
                <div data-jarvis-graph-canvas className="relative min-w-0 flex-1">
                    {!loaded ? (
                        <GraphSkeleton />
                    ) : error ? (
                        <div className="flex h-full items-center justify-center text-[13px] text-muted">
                            Couldn’t read the vault.
                        </div>
                    ) : merged.nodes.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center gap-1.5 text-muted">
                            <span className="text-[14px] font-semibold text-primary">No vault yet</span>
                            <span className="text-[12px]">
                                Records, decisions and memory appear here as they’re captured.
                            </span>
                        </div>
                    ) : (
                        <JarvisGraph />
                    )}
                </div>
                <div className="flex w-[288px] flex-none flex-col gap-3 border-l border-border bg-surface p-3.5">
                    <div className="relative flex-none">
                        <Search
                            size={13}
                            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
                        />
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Find a node…"
                            aria-label="Find a node"
                            className="w-full rounded-[7px] border border-edge-mid bg-background py-1.5 pl-[30px] pr-2.5 text-[12px] text-primary placeholder:text-muted focus:border-accent focus:outline-none"
                        />
                    </div>
                    {q !== "" ? (
                        <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
                            <SubLabel>
                                {matches.length === 0
                                    ? "No node matches"
                                    : `${matches.length} match${matches.length === 1 ? "" : "es"}`}
                            </SubLabel>
                            {matches.slice(0, MAX_MATCHES).map((n) => (
                                <button
                                    key={n.id}
                                    type="button"
                                    onClick={() => selectNode(n.id)}
                                    className={cn(
                                        "flex cursor-pointer items-center gap-2 rounded-[7px] px-2 py-1.5 text-left hover:bg-surface-hover",
                                        n.id === selectedId && "bg-accentbg"
                                    )}
                                >
                                    <span
                                        className={cn(
                                            "min-w-10 flex-none text-[10.5px]",
                                            KIND_TONE[n.kind] ?? "text-muted"
                                        )}
                                    >
                                        {n.kind}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-secondary">
                                        {n.label}
                                    </span>
                                </button>
                            ))}
                            {matches.length > MAX_MATCHES ? (
                                <span className="px-2 text-[10.5px] tabular-nums text-muted">
                                    +{matches.length - MAX_MATCHES} more · narrow the filter
                                </span>
                            ) : null}
                        </div>
                    ) : node == null ? (
                        <span className="text-[12px] leading-[1.5] text-muted">Click a node, or find one above.</span>
                    ) : (
                        <>
                            <div className="flex flex-col gap-1.5">
                                <SubLabel>Selected node</SubLabel>
                                <span className="flex gap-2">
                                    <span
                                        className={cn(
                                            "text-[10.5px] font-semibold",
                                            KIND_TONE[node.kind] ?? "text-muted"
                                        )}
                                    >
                                        {node.kind}
                                    </span>
                                    {node.status ? (
                                        <span className="text-[10.5px] text-muted">{node.status}</span>
                                    ) : null}
                                </span>
                                {/* clamped: a task's label is its record's whole objective, which pushed Edges and
                                    the Open button off the panel */}
                                <span className="line-clamp-3 text-[13.5px] font-semibold leading-[1.35] text-primary [overflow-wrap:anywhere]">
                                    {node.label}
                                </span>
                            </div>
                            <div className="h-px bg-border" />
                            <div className="flex flex-col gap-2">
                                <SubLabel>Edges</SubLabel>
                                {edges.length === 0 ? (
                                    <span className="text-[11.5px] text-muted">No edge reaches this node.</span>
                                ) : (
                                    edges.map((l) => {
                                        const other = l.from === node.id ? l.to : l.from;
                                        const s = l.kind === "attribution" ? attributionStyle(l) : null;
                                        return (
                                            <div key={l.kind + other} className="flex items-center gap-2">
                                                <span
                                                    className="w-[22px] flex-none text-secondary"
                                                    style={{
                                                        borderTopStyle: s?.dashed ? "dashed" : "solid",
                                                        borderTopWidth: s?.width ?? 1,
                                                        borderTopColor: "currentColor",
                                                        opacity: s?.opacity ?? 1,
                                                    }}
                                                />
                                                <span className="min-w-0 flex-1 truncate text-[11.5px] text-secondary">
                                                    {merged.nodes.find((n) => n.id === other)?.label ?? other}
                                                </span>
                                                <span className="flex-none text-[10.5px] text-muted">
                                                    {l.kind === "attribution" ? `${l.state} · ${l.bucket}` : "wikilink"}
                                                </span>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                            <div className="h-px bg-border" />
                            <div className="flex flex-col gap-1.5">
                                <SubLabel>Open</SubLabel>
                                {node.kind === "run" && canOpenRuns ? (
                                    <ActionButton label="Open run" primary peek onClick={(e) => openRun(node.id, e)} />
                                ) : null}
                                {node.kind === "task" ? (
                                    <ActionButton
                                        label="Open record"
                                        primary
                                        onClick={() => {
                                            onOpenRecord(node.id);
                                            onClose();
                                        }}
                                    />
                                ) : null}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </motion.div>
    );
}
