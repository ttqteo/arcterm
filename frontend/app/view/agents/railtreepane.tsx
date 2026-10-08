// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent panel's Files tab body: the agent's worktree as a tree whose rows drag onto a terminal
// (docs/superpowers/specs/2026-10-08-rail-worktree-files-design.md). The pane is one focus owner (role="tree", tabIndex,
// data-owns-keys), like the Code surface's tree, so the arrow keys and Enter are its own while it holds focus. What is
// open, selected and under the cursor lives in an atom per agent (railtreestore.ts): the pane unmounts when the tab or
// the surface changes.

import { FileIcon } from "@/app/element/fileicon";
import { SkeletonLine } from "@/app/element/skeleton";
import { globalStore } from "@/app/store/jotaiStore";
import { visibleRows, type TreeRow } from "@/app/view/code/codetree";
import { treeKeyAction, type TreeKey } from "@/app/view/code/codetreekeys";
import { joinRepoPath, repoBasename } from "@/util/paths";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, type MouseEvent } from "react";
import { openFileInPanel } from "./agentrailstore";
import type { AgentsViewModel } from "./agents";
import { encodePathsDrag, setDraggedPathsCount } from "./pathdrop";
import {
    clickRow,
    dragPaths,
    moveCursorTo,
    shouldReloadTree,
    toggleExpanded,
    type ClickMod,
    type RailTreeState,
    type TreeReloadObservation,
} from "./railtree";
import {
    listIgnoredDirs,
    railListedAtom,
    railListingAtom,
    railTree,
    railTreeStateAtom,
    reloadTree,
} from "./railtreestore";

const KEYS: Record<string, TreeKey> = {
    ArrowDown: "next",
    ArrowUp: "prev",
    ArrowLeft: "collapse",
    ArrowRight: "expand",
    Enter: "activate",
};

const BTN =
    "flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-[6px] border border-edge-mid bg-transparent px-2 text-[11.5px] font-medium text-secondary hover:border-edge-strong";
const ICON_BTN =
    "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-muted hover:bg-surface-hover hover:text-secondary";

function clickMod(ev: MouseEvent): ClickMod {
    return ev.shiftKey ? "range" : ev.ctrlKey || ev.metaKey ? "toggle" : "none";
}

export function RailTreePane({
    model,
    agentId,
    cwd,
    agentState,
}: {
    model: AgentsViewModel;
    agentId: string;
    cwd: string;
    agentState: string | null | undefined;
}) {
    const listing = useAtomValue(railListingAtom(cwd));
    const listed = useAtomValue(railListedAtom(cwd));
    const stateAtom = railTreeStateAtom(agentId);
    const state = useAtomValue(stateAtom);
    const rowRefs = useRef(new Map<string, HTMLDivElement>());
    const seen = useRef<TreeReloadObservation | null>(null);

    // The pane only exists while the Files tab shows, so mounting is the tab being shown, and a later change of the
    // agent's state is one while it shows (a turn ending may have created files). The caller keys the pane by agent
    // and cwd, so `seen` is always one agent's.
    useEffect(() => {
        const next: TreeReloadObservation = { state: agentState, tabShown: true };
        if (shouldReloadTree(seen.current, next)) {
            fireAndForget(() => reloadTree(cwd, agentId));
        }
        seen.current = next;
    }, [agentState, cwd, agentId]);

    const tree = useMemo(() => railTree(listing, listed), [listing, listed]);
    const rows = useMemo(() => visibleRows(tree, new Set(state.expanded)), [tree, state.expanded]);

    // an ignored directory git reported as one entry shows its contents once listed: this covers every way a directory
    // opens, and an opened one that a listing nested further
    useEffect(() => {
        fireAndForget(() => listIgnoredDirs(cwd, state.expanded));
    }, [cwd, state.expanded, listing, listed]);

    // the keys move the cursor, which may be off-screen
    useEffect(() => {
        if (state.cursor != null) {
            rowRefs.current.get(state.cursor)?.scrollIntoView({ block: "nearest" });
        }
    }, [state.cursor]);

    // A handler reads the state from the store, not from this render: a click and the drag or key right after it can
    // beat a re-render. The rows are recomputed from it, since a plain click on a directory flips `expanded` itself.
    const current = (): { s: RailTreeState; rows: TreeRow[] } => {
        const s = globalStore.get(stateAtom);
        return { s, rows: visibleRows(tree, new Set(s.expanded)) };
    };
    const openFile = (path: string) => openFileInPanel(model, agentId, { abs: joinRepoPath(cwd, path), root: cwd });
    const reload = () => fireAndForget(() => reloadTree(cwd, agentId));

    const onKeyDown = (ev: React.KeyboardEvent) => {
        const key = KEYS[ev.key];
        if (key == null || ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) {
            return;
        }
        ev.preventDefault(); // the arrows would scroll the list under the cursor
        const { s, rows: now } = current();
        const action = treeKeyAction(now, s.cursor, key);
        if (action.kind === "move") {
            globalStore.set(stateAtom, moveCursorTo(s, action.path));
        } else if (action.kind === "toggle") {
            globalStore.set(stateAtom, toggleExpanded(s, action.path));
        } else if (action.kind === "open") {
            openFile(action.path);
        }
    };

    const renderRow = (row: TreeRow) => {
        const selected = state.selected.includes(row.path);
        const isCursor = row.path === state.cursor;
        return (
            <div
                key={row.path}
                ref={(el) => {
                    if (el == null) {
                        rowRefs.current.delete(row.path);
                    } else {
                        rowRefs.current.set(row.path, el);
                    }
                }}
                role="treeitem"
                title={row.path}
                data-rail-tree-row={row.path}
                data-ignored={row.ignored ? true : undefined}
                data-cursor={isCursor ? true : undefined}
                aria-selected={selected}
                aria-expanded={row.kind === "dir" ? row.expanded : undefined}
                draggable
                onClick={(ev) => {
                    const { s, rows: now } = current();
                    globalStore.set(stateAtom, clickRow(s, now, row.path, clickMod(ev)));
                }}
                onDoubleClick={() => {
                    if (row.kind === "file") {
                        openFile(row.path);
                    }
                }}
                onDragStart={(ev) => {
                    const { s, rows: now } = current();
                    const paths = dragPaths(s, now, row.path).map((p) => joinRepoPath(cwd, p));
                    for (const { mime, data } of encodePathsDrag(paths)) {
                        ev.dataTransfer.setData(mime, data);
                    }
                    ev.dataTransfer.effectAllowed = "copy";
                    setDraggedPathsCount(paths.length);
                }}
                onDragEnd={() => setDraggedPathsCount(0)}
                style={{ paddingLeft: 8 + row.depth * 12 }}
                className={cn(
                    "flex w-full cursor-pointer items-center gap-1.5 py-[3px] pr-2 text-left text-[12.5px]",
                    selected ? "bg-accent/15 text-primary hover:bg-accent/20" : "text-secondary hover:bg-surface-hover",
                    // dimmed like the Code tree: there, but outside what git tracks
                    row.ignored && "text-muted",
                    isCursor && "ring-1 ring-inset ring-accent/40"
                )}
            >
                {row.kind === "dir" ? (
                    row.expanded ? (
                        <ChevronDown size={13} strokeWidth={1.8} aria-hidden className="flex-none" />
                    ) : (
                        <ChevronRight size={13} strokeWidth={1.8} aria-hidden className="flex-none" />
                    )
                ) : (
                    // the chevron's width, so a file's icon lines up with its sibling folders' icons
                    <span className="w-[13px] flex-none" />
                )}
                <FileIcon
                    path={row.path}
                    dir={row.kind === "dir"}
                    expanded={row.kind === "dir" && row.expanded}
                    className={row.ignored ? "opacity-50" : undefined}
                />
                <span className="min-w-0 truncate">{row.name}</span>
            </div>
        );
    };

    const status = listing?.status ?? "loading"; // before the first load has started, it is about to
    const firstLoad = status === "loading" && rows.length === 0;
    let body: React.ReactNode;
    if (status === "error") {
        body = (
            <div className="flex flex-col items-start gap-2 px-3 py-3">
                <div className="text-[12px] font-semibold text-ink-hi">Could not list the files</div>
                <div data-rail-tree-error className="break-words text-[11.5px] leading-[1.5] text-ink-mid">
                    {listing?.error}
                </div>
                <button type="button" data-rail-tree-retry onClick={reload} className={BTN}>
                    Retry
                </button>
            </div>
        );
    } else if (status === "notrepo") {
        body = (
            <div data-rail-tree-notrepo className="px-3 py-3 text-[11.5px] leading-[1.5] text-muted">
                Not a git repository — the Files tab lists a git worktree.
            </div>
        );
    } else if (firstLoad) {
        body = (
            <div aria-hidden="true" className="flex flex-col gap-2 px-3 py-3">
                {["w-[55%]", "w-[40%]", "w-[65%]", "w-[50%]"].map((w, i) => (
                    <SkeletonLine key={i} className={cn("h-[10px]", w)} />
                ))}
            </div>
        );
    } else {
        body = (
            <>
                {listing?.truncated ? (
                    <div
                        data-rail-tree-truncated
                        className="flex-none border-b border-border px-3 py-1.5 text-[11px] text-muted"
                    >
                        Showing the first {listing.files.length.toLocaleString("en-US")} files
                    </div>
                ) : null}
                <div
                    role="tree"
                    aria-label="Worktree files"
                    aria-multiselectable
                    tabIndex={0}
                    data-owns-keys
                    onKeyDown={onKeyDown}
                    className="min-h-0 flex-1 select-none overflow-y-auto py-1.5 outline-none"
                >
                    {rows.map(renderRow)}
                    {rows.length === 0 ? <div className="px-3 py-2 text-[11.5px] text-muted">No files</div> : null}
                </div>
            </>
        );
    }

    return (
        <div data-rail-tree data-rail-tree-state={status} className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-2.5">
                <span title={cwd} className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ink-hi">
                    {repoBasename(cwd)}
                </span>
                <button
                    type="button"
                    data-rail-tree-refresh
                    aria-label="Refresh"
                    title="Refresh"
                    onClick={reload}
                    className={ICON_BTN}
                >
                    <RefreshCw
                        size={13}
                        aria-hidden
                        className={status === "loading" ? "animate-spin motion-reduce:animate-none" : undefined}
                    />
                </button>
            </div>
            {body}
        </div>
    );
}
