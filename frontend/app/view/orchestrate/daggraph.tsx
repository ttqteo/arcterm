import { useDimensionsWithCallbackRef } from "@/app/hook/useDimensions";
import { globalStore } from "@/app/store/jotaiStore";
import { isEditableTarget } from "@/app/store/keybindings/dispatcher";
import { GraphSkeleton } from "@/app/view/jarvis/graphskeleton";
import { fireAndForget } from "@/util/util";
import {
    applyNodeChanges,
    Background,
    ReactFlow,
    ReactFlowProvider,
    useNodesState,
    useReactFlow,
    useViewport,
    type Edge,
    type Node,
    type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { atom, useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    edgeStyle,
    factOf,
    graphKey,
    nodeInView,
    openView,
    relatives,
    ZOOM_MAX,
    ZOOM_MIN,
    type EdgeFocus,
} from "./dagcanvas";
import { DagDetailRail, openTaskFromGraph } from "./dagdetailrail";
import { taskBriefs, useDagDigest } from "./dagdigest";
import { DagGraphHeader } from "./daggraph-header";
import { CARD_H, CARD_W, computeLayout, edgeKey, laneBand, lanesOf, type Point } from "./daglayout";
import {
    applyOffsets,
    dagLayoutOffsetsAtom,
    withOffsets,
    type LayoutOffsetStore,
    type Offsets,
} from "./daglayoutstore";
import { dagModalAgentsContextAtom } from "./dagmodalstate";
import { dagEdgeTypes, dagNodeTypes, type DagCardData, type LaneBandData, type RoutedEdgeData } from "./dagnodes";
import { buildViewData, hoveredTaskAtom, mergeReadyIds, selectedTaskIdAtom, useDagGroup } from "./dagstore";
import { enterOpensTask } from "./taskcorrelate";
import { stageEntries, type StageEntry } from "./taskroute";

// fitView's padding, as a fraction of the pane
const FIT_PADDING = 0.1;
const PAN_MS = 200;

const STAGE_DOT: Record<StageEntry["tone"], string> = {
    done: "border-success bg-success",
    failed: "border-warning bg-warning",
    open: "border-ink-faint",
};

// without the roster context there is no shared ticker; the card facts then read the clock at render
const NO_TICK_ATOM = atom(0);

// a band carries its lane's ids so it can follow a card while it is dragged
type BandNodeData = LaneBandData & { ids: string[] };

// the per-run graph: ReactFlow canvas fed by the pure view data + left-to-right layout. The provider
// must wrap the component that calls useReactFlow (the hook reads the provider's context).
export function DagGraphView({ oref, owner, harnesses }: { oref: string; owner: Run; harnesses: HarnessInfo[] }) {
    return (
        <ReactFlowProvider>
            <DagGraphInner oref={oref} owner={owner} harnesses={harnesses} />
        </ReactFlowProvider>
    );
}

// sanitizeStore drops what a hand-edited or foreign localStorage value could hold, so withOffsets and the
// per-dag lookup never meet a null entry or a non-object store
function sanitizeStore(raw: unknown): LayoutOffsetStore {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: LayoutOffsetStore = {};
    for (const [oid, entry] of Object.entries(raw as Record<string, unknown>)) {
        const e = entry as { at?: unknown; offsets?: unknown } | null;
        if (e == null || typeof e !== "object" || typeof e.at !== "number") continue;
        if (e.offsets == null || typeof e.offsets !== "object") continue;
        out[oid] = { at: e.at, offsets: e.offsets as Offsets };
    }
    return out;
}

// withLiveBands re-derives each lane band from its cards' current positions, so a band follows a drag
function withLiveBands(nodes: Node[]): Node[] {
    const live = new Map<string, Point>(nodes.filter((n) => n.type === "dagTask").map((n) => [n.id, n.position]));
    return nodes.map((n) => {
        if (n.type !== "laneBand") return n;
        const d = n.data as unknown as BandNodeData;
        const rect = laneBand(d.ids, live);
        if (rect == null) return n;
        const r = d.rect;
        if (rect.x === r.x && rect.y === r.y && rect.w === r.w && rect.h === r.h) return n;
        return { ...n, position: { x: rect.x, y: rect.y }, data: { ...d, rect } };
    });
}

function DagGraphInner({ oref, owner, harnesses }: { oref: string; owner: Run; harnesses: HarnessInfo[] }) {
    const [group, loading] = useDagGroup(oref);
    const selectedId = useAtomValue(selectedTaskIdAtom);
    const hovered = useAtomValue(hoveredTaskAtom);
    const agentsCtx = useAtomValue(dagModalAgentsContextAtom);
    const tick = useAtomValue(agentsCtx?.model.nowAtom ?? NO_TICK_ATOM);
    const [rawStore, setStore] = useAtom(dagLayoutOffsetsAtom);
    const { fitView, getNode, getViewport, getZoom, setCenter, zoomTo } = useReactFlow();
    const [paneRef, paneElRef, paneRect] = useDimensionsWithCallbackRef<HTMLDivElement>();
    const [descOpen, setDescOpen] = useState(false);
    // owner is the dag's own run (LiveDagModal loads run:<runId>), so its ids address the digest
    const digestState = useDagDigest(owner.channeloid ?? "", owner.id, oref);
    const mergeReady = useMemo(
        () => mergeReadyIds(digestState.digest, digestState.stale),
        [digestState.digest, digestState.stale]
    );
    // a stale digest's per-task facts stay out of the peek, as its merge-ready set stays off the buttons
    const digestById = useMemo(
        () => new Map((digestState.stale ? [] : (digestState.digest?.tasks ?? [])).map((td) => [td.taskid, td])),
        [digestState.digest, digestState.stale]
    );

    const tasks = group?.tasks;
    const oid = group?.oid ?? "";
    // the layout depends only on ids and deps, so a state change does not re-run it
    const shapeKey = (tasks ?? []).map((t) => t.id + ":" + (t.deps ?? []).join(",")).join("|");
    const layout = useMemo(() => computeLayout(tasks ?? []), [shapeKey]);
    const lanes = useMemo(() => lanesOf(tasks ?? []), [shapeKey]);
    const store = useMemo(() => sanitizeStore(rawStore), [rawStore]);
    const storedOffsets = store[oid]?.offsets;
    const positions = useMemo(() => applyOffsets(layout.pos, storedOffsets), [layout, storedOffsets]);
    // a selection naming a task this group lacks dims nothing
    const rel = useMemo(
        () => (tasks && selectedId && tasks.some((t) => t.id === selectedId) ? relatives(tasks, selectedId) : null),
        [tasks, selectedId]
    );

    const onHover = useCallback((id: string | null) => {
        if (id != null) {
            globalStore.set(hoveredTaskAtom, { id, from: "graph" });
            return;
        }
        // a timeline hover belongs to the timeline; leaving a card clears only the graph's own
        if (globalStore.get(hoveredTaskAtom)?.from === "graph") globalStore.set(hoveredTaskAtom, null);
    }, []);
    // closing the modal under the pointer never fires the card's pointer-leave
    useEffect(() => () => onHover(null), [onHover]);

    const { built, edges } = useMemo(() => {
        if (loading || !group) return { built: [] as Node[], edges: [] as Edge[] };
        const { nodes: vnodes } = buildViewData(group, owner, harnesses, mergeReady);
        const byId = new Map(group.tasks.map((t) => [t.id, t]));
        const briefs = taskBriefs(group);
        const nowMs = tick || Date.now();
        const inRel = (id: string) => rel == null || id === selectedId || rel.up.has(id) || rel.down.has(id);
        const taskNodes: Node[] = vnodes.map((v) => {
            const task = byId.get(v.id)!;
            const data: DagCardData = {
                task,
                view: v,
                fact: factOf(task, { byId, digest: digestById.get(v.id), mergeReady, nowMs }),
                selected: v.id === selectedId,
                dimmed: !inRel(v.id),
                hovered: hovered?.id === v.id,
                digestTask: digestById.get(v.id),
                briefs,
                onHover,
            };
            return { id: v.id, type: "dagTask", position: positions.get(v.id) ?? { x: 0, y: 0 }, data };
        });
        const bandNodes: Node[] = [];
        for (const ids of lanes) {
            if (ids.length < 2) continue;
            const rect = laneBand(ids, positions);
            if (rect == null) continue;
            const data: BandNodeData = { rect, dimmed: !ids.some(inRel), ids };
            bandNodes.push({
                id: `lane:${ids[0]}`,
                type: "laneBand",
                position: { x: rect.x, y: rect.y },
                data,
                zIndex: -1,
                selectable: false,
                draggable: false,
                focusable: false,
                // ReactFlow gives a node pointer events whenever onNodeClick is set; a band must let a drag pan
                style: { pointerEvents: "none" },
            });
        }
        const graphHover = hovered?.from === "graph" && byId.has(hovered.id) ? hovered.id : null;
        const focus: EdgeFocus | null =
            selectedId && rel
                ? { id: selectedId, rel, selected: true }
                : graphHover
                  ? { id: graphHover, rel: relatives(group.tasks, graphHover), selected: false }
                  : null;
        const reactEdges: Edge[] = [];
        for (const t of group.tasks) {
            for (const d of t.deps ?? []) {
                const src = byId.get(d);
                if (src == null) continue;
                const data: RoutedEdgeData = {
                    via: layout.via.get(edgeKey(d, t.id)) ?? [],
                    style: edgeStyle(src, t, focus),
                };
                reactEdges.push({ id: edgeKey(d, t.id), source: d, target: t.id, type: "routed", data });
            }
        }
        return { built: [...bandNodes, ...taskNodes], edges: reactEdges };
    }, [
        digestById,
        group,
        harnesses,
        hovered,
        lanes,
        layout,
        loading,
        mergeReady,
        onHover,
        owner,
        positions,
        rel,
        selectedId,
        tick,
    ]);

    // nodes live in ReactFlow state so a drag renders as it happens; a rebuild keeps what ReactFlow measured
    // and leaves a node that is mid-drag where the pointer has it
    const [nodes, setNodes] = useNodesState<Node>([]);
    useEffect(() => {
        setNodes((prev) => {
            const prevById = new Map(prev.map((n) => [n.id, n]));
            return withLiveBands(
                built.map((n) => {
                    const p = prevById.get(n.id);
                    if (p == null) return n;
                    return { ...p, ...n, position: p.dragging ? p.position : n.position };
                })
            );
        });
    }, [built, setNodes]);
    const onNodesChange = useCallback(
        (changes: NodeChange[]) => setNodes((prev) => withLiveBands(applyNodeChanges(changes, prev))),
        [setNodes]
    );

    const onNodeDragStop = (_e: unknown, _node: Node, dragged: Node[]) => {
        const offsets: Offsets = { ...(storedOffsets ?? {}) };
        for (const n of dragged) {
            const base = layout.pos.get(n.id);
            if (n.type !== "dagTask" || base == null) continue;
            const off = { x: n.position.x - base.x, y: n.position.y - base.y };
            if (off.x === 0 && off.y === 0) delete offsets[n.id];
            else offsets[n.id] = off;
        }
        setStore(withOffsets(store, oid, offsets, Date.now()));
    };

    const fitAll = useCallback(() => void fitView({ padding: FIT_PADDING, minZoom: ZOOM_MIN, maxZoom: 1 }), [fitView]);

    const resetLayout = () => {
        setStore(withOffsets(store, oid, {}, Date.now()));
        fitAll();
    };

    const paneSize = useCallback(() => {
        const box = paneElRef.current?.getBoundingClientRect();
        return box ? { w: box.width, h: box.height } : { w: 0, h: 0 };
    }, [paneElRef]);

    // the opening view (spec D9), once per dag, after the pane has a size: fitting a 0x0 pane would pick
    // the focus set for every graph
    const openedFor = useRef<string | null>(null);
    useEffect(() => {
        if (!tasks || tasks.length === 0 || nodes.length === 0 || openedFor.current === oid) return;
        const pane = paneSize();
        if (pane.w <= 0 || pane.h <= 0) return;
        openedFor.current = oid;
        const { fitIds, minZoom } = openView(
            tasks,
            positions,
            pane,
            lanes.some((l) => l.length > 1)
        );
        void fitView({ padding: FIT_PADDING, minZoom, maxZoom: 1, nodes: fitIds?.map((id) => ({ id })) });
    }, [fitView, lanes, nodes.length, oid, paneRect, paneSize, positions, tasks]);

    // a new selection starts with its description closed
    useEffect(() => setDescOpen(false), [selectedId]);

    // bring the selection back on screen when selecting it, or the rail growing under it, hid it. The viewport
    // is read, not a dependency: a pan by hand must not snap back to the selection.
    useEffect(() => {
        if (!selectedId || openedFor.current !== oid) return;
        const pos = getNode(selectedId)?.position ?? positions.get(selectedId);
        const pane = paneSize();
        if (pos == null || pane.w <= 0 || pane.h <= 0) return;
        const viewport = getViewport();
        if (nodeInView(viewport, pos, pane)) return;
        void setCenter(pos.x + CARD_W / 2, pos.y + CARD_H / 2, { zoom: viewport.zoom, duration: PAN_MS });
    }, [selectedId, descOpen, paneRect]);

    useEffect(() => {
        if (!tasks) return;
        const onKey = (e: KeyboardEvent) => {
            // shift is not a skip: "+" is shift+= on most layouts
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.key === "Enter") {
                const task = tasks.find((t) => t.id === selectedId);
                if (task && enterOpensTask(document.activeElement)) {
                    e.preventDefault();
                    fireAndForget(() => openTaskFromGraph(task));
                }
                return;
            }
            if (isEditableTarget(document.activeElement)) return;
            const r = graphKey(e.key, { tasks, selected: selectedId, layer: layout.layer, pos: positions });
            if (r.kind === "none") return;
            e.preventDefault();
            if (r.kind === "select") {
                globalStore.set(selectedTaskIdAtom, r.id);
                const card = document.querySelector(`[data-dag-node="${CSS.escape(r.id)}"]`);
                (card?.closest(".react-flow__node") as HTMLElement | null)?.focus({ preventScroll: true });
            } else if (r.kind === "fit") {
                fitAll();
            } else {
                void zoomTo(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, getZoom() * r.factor)));
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [fitAll, getZoom, layout, positions, selectedId, tasks, zoomTo]);

    if (loading || !group) {
        return <GraphSkeleton />;
    }

    const selectedTask = selectedId ? group.tasks.find((t) => t.id === selectedId) : undefined;
    const selectedView = selectedTask
        ? (built.find((n) => n.id === selectedTask.id)?.data as unknown as DagCardData | undefined)?.view
        : undefined;
    return (
        <div className="relative flex h-full min-h-0 w-full min-w-0 flex-col bg-background">
            <DagGraphHeader group={group} owner={owner} />
            <div className="flex flex-none items-center gap-[18px] border-b border-border bg-surface px-4 py-1.5 text-[10.5px] tabular-nums text-ink-mid">
                <span>
                    Run route · {owner.runtime || "unavailable"} / {owner.model || "default"}
                </span>
                {stageEntries(group, owner, tick || Date.now()).map((s) => (
                    <span key={s.key} title={s.detail} className="flex items-center gap-1.5">
                        <span className={`h-[7px] w-[7px] rounded-full border ${STAGE_DOT[s.tone]}`} />
                        {s.text}
                    </span>
                ))}
            </div>
            <div ref={paneRef} className="relative min-h-0 flex-1">
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={dagNodeTypes}
                    edgeTypes={dagEdgeTypes}
                    onNodesChange={onNodesChange}
                    nodesDraggable
                    nodesConnectable={false}
                    elementsSelectable={false}
                    disableKeyboardA11y
                    // Backspace would otherwise delete a focused card from the canvas state
                    deleteKeyCode={null}
                    // double-click means "open" on a node; zooming on it too would move the graph under the click
                    zoomOnDoubleClick={false}
                    minZoom={ZOOM_MIN}
                    maxZoom={ZOOM_MAX}
                    colorMode="dark"
                    proOptions={{ hideAttribution: true }}
                    onNodeClick={(_e, n) => {
                        if (n.type === "dagTask") globalStore.set(selectedTaskIdAtom, n.id);
                    }}
                    onNodeDoubleClick={(_e, n) => {
                        const task = group.tasks.find((t) => t.id === n.id);
                        if (task) fireAndForget(() => openTaskFromGraph(task));
                    }}
                    onNodeDragStop={onNodeDragStop}
                    onPaneClick={() => globalStore.set(selectedTaskIdAtom, null)}
                >
                    <Background gap={24} size={1} color="color-mix(in srgb, var(--color-ink-mid) 14%, transparent)" />
                </ReactFlow>
                <div className="absolute right-3 top-3 z-[5] flex flex-col items-end gap-1.5">
                    <ZoomCluster onFit={fitAll} />
                    {store[oid] != null ? (
                        <button
                            type="button"
                            onClick={resetLayout}
                            className="flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-edge-mid bg-surface-raised px-2 py-1 text-[11.5px] font-semibold text-secondary hover:border-edge-strong"
                        >
                            <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                                className="text-ink-mid"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                                <path d="M3 3v5h5" />
                            </svg>
                            Reset layout
                        </button>
                    ) : null}
                </div>
            </div>
            {selectedTask && selectedView ? (
                <DagDetailRail
                    group={group}
                    owner={owner}
                    view={selectedView}
                    task={selectedTask}
                    descOpen={descOpen}
                    onToggleDesc={() => setDescOpen((o) => !o)}
                />
            ) : null}
        </div>
    );
}

const ZOOM_BTN = "flex cursor-pointer justify-center px-2 py-1.5 text-ink-mid hover:bg-surface-hover";

function ZoomIcon({ d }: { d: string }) {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d={d} />
        </svg>
    );
}

// its own component so a pan or zoom frame re-renders only the cluster, not the graph
function ZoomCluster({ onFit }: { onFit: () => void }) {
    const { zoom } = useViewport();
    const { zoomIn, zoomOut } = useReactFlow();
    return (
        <div className="flex flex-col overflow-hidden rounded-[7px] border border-edge-mid bg-surface-raised">
            <div className="border-b border-edge-mid py-1 text-center text-[10.5px] tabular-nums text-ink-mid">
                {Math.round(zoom * 100)}%
            </div>
            <button type="button" onClick={onFit} aria-label="Fit graph" title="Fit graph (f)" className={ZOOM_BTN}>
                <ZoomIcon d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </button>
            <button
                type="button"
                onClick={() => void zoomIn()}
                aria-label="Zoom in"
                title="Zoom in (+)"
                className={`${ZOOM_BTN} border-t border-edge-mid`}
            >
                <ZoomIcon d="M12 5v14M5 12h14" />
            </button>
            <button
                type="button"
                onClick={() => void zoomOut()}
                aria-label="Zoom out"
                title="Zoom out (-)"
                className={`${ZOOM_BTN} border-t border-edge-mid`}
            >
                <ZoomIcon d="M5 12h14" />
            </button>
        </div>
    );
}
