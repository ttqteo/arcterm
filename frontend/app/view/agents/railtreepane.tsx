// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent panel's Files tab body: the agent's worktree as a tree whose rows drag onto a terminal
// (docs/superpowers/specs/2026-10-08-rail-worktree-files-design.md). The pane is one focus owner (role="tree", tabIndex,
// data-owns-keys), like the Code surface's tree, so the arrow keys and Enter are its own while it holds focus. What is
// open, selected and under the cursor lives in an atom per agent (railtreestore.ts): the pane unmounts when the tab or
// the surface changes. The files pinned in Code for this folder list above the tree, and pin from here too: one list
// (codepins.ts), so a pin on either side shows on the other. Files and folders dropped from the OS (Finder, Explorer)
// are copied into the folder under the pointer (railfiledrop.ts); the originals stay where they are. The tree's own rows
// dropped on one of its folders move there (railmove.ts).

import { isUnderRoot, toRel } from "@/app/cockpit/openfileroute";
import { FileIcon } from "@/app/element/fileicon";
import { SkeletonLine } from "@/app/element/skeleton";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { pinsFor } from "@/app/view/code/codepins";
import { codePinsAtom, toggleCodePinIn } from "@/app/view/code/codestore";
import { visibleRows, type TreeRow } from "@/app/view/code/codetree";
import { treeKeyAction, type TreeKey } from "@/app/view/code/codetreekeys";
import { pathMenuItems } from "@/app/view/code/pathmenu";
import { revealInList } from "@/app/view/code/treescroll";
import { joinRepoPath, repoBasename } from "@/util/paths";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import {
    ChevronDown,
    ChevronRight,
    ChevronsDownUp,
    LocateFixed,
    Pin,
    PinOff,
    RefreshCw,
    Search,
    X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { openFileInPanel, railPanelsAtom } from "./agentrailstore";
import { activeFile } from "./agentrailtabs";
import type { AgentsViewModel } from "./agents";
import { encodePathsDrag, isPathsDrag, setDraggedPathsCount } from "./pathdrop";
import { dropDirFor, dropHintLabel, type DropEntryLike } from "./railfiledrop";
import { copyDropInto, moveRowsInto, railDropProgressAtom } from "./railfiledropstore";
import { filterRows, matchSpan } from "./railfilter";
import { moveHintLabel, planMove, setTreeDrag, treeDrag } from "./railmove";
import {
    clickRow,
    collapseAll,
    dragPaths,
    moveCursorTo,
    revealRow,
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
import { isFileDrag } from "./uploadfile";

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
    "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-muted hover:bg-surface-hover hover:text-secondary disabled:cursor-default disabled:text-edge-strong disabled:hover:bg-transparent";

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
    const pinned = pinsFor(useAtomValue(codePinsAtom), cwd);
    // the file the File tab holds, when it is in this tree: what Locate finds
    const shownPanel = useAtomValue(railPanelsAtom)[agentId];
    const shownFile = shownPanel != null ? activeFile(shownPanel)?.current : null;
    const shownRel = shownFile != null && isUnderRoot(cwd, shownFile.abs) ? toRel(cwd, shownFile.abs) : null;
    // bumped by Locate, so the tree scrolls to the file even when its cursor was on it already
    const [locate, setLocate] = useState(0);
    const rowRefs = useRef(new Map<string, HTMLDivElement>());
    const treeRef = useRef<HTMLDivElement>(null);
    const seen = useRef<TreeReloadObservation | null>(null);
    // the folder (repo-relative, "" the root) OS files over the tree would be copied into
    const [dropDir, setDropDir] = useState<string | null>(null);
    // whether what is over the tree is its own rows, which move, rather than OS files, which copy
    const [dropMoves, setDropMoves] = useState(false);
    const copying = useAtomValue(railDropProgressAtom)[cwd];
    // the filter box: while it holds text the tree lists only the files whose name has it, their folders open
    const [query, setQuery] = useState("");
    const filtering = query.trim() !== "";
    const filterRef = useRef<HTMLInputElement>(null);

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
    const filtered = useMemo(
        () => (filtering ? filterRows(listing?.files ?? [], query) : null),
        [filtering, listing?.files, query]
    );
    const rows = useMemo(
        () => filtered?.rows ?? visibleRows(tree, new Set(state.expanded)),
        [filtered, tree, state.expanded]
    );

    // an ignored directory git reported as one entry shows its contents once listed: this covers every way a directory
    // opens, and an opened one that a listing nested further
    useEffect(() => {
        fireAndForget(() => listIgnoredDirs(cwd, state.expanded));
    }, [cwd, state.expanded, listing, listed]);

    // the keys move the cursor, which may be off-screen; a pinned file or Locate jumps it, to the middle (treescroll.ts)
    useEffect(() => {
        if (state.cursor != null) {
            revealInList(treeRef.current, rowRefs.current.get(state.cursor));
        }
    }, [state.cursor, locate]);

    // A handler reads the state from the store, not from this render: a click and the drag or key right after it can
    // beat a re-render. The rows are recomputed from it, since a plain click on a directory flips `expanded` itself.
    const current = (): { s: RailTreeState; rows: TreeRow[] } => {
        const s = globalStore.get(stateAtom);
        return { s, rows: filtered?.rows ?? visibleRows(tree, new Set(s.expanded)) };
    };
    const openFile = (path: string) => openFileInPanel(model, agentId, { abs: joinRepoPath(cwd, path), root: cwd });
    const reload = () => fireAndForget(() => reloadTree(cwd, agentId));
    const openPinned = (rel: string) => {
        globalStore.set(stateAtom, revealRow(globalStore.get(stateAtom), rel));
        openFile(rel);
    };
    const locateShown = () => {
        if (shownRel != null) {
            globalStore.set(stateAtom, revealRow(globalStore.get(stateAtom), shownRel));
            setLocate((n) => n + 1);
        }
    };

    // Esc leaves the filter with the cursor where it was, revealed in the whole tree
    const clearFilter = () => {
        setQuery("");
        const s = globalStore.get(stateAtom);
        if (s.cursor != null) {
            globalStore.set(stateAtom, revealRow(s, s.cursor));
            setLocate((n) => n + 1);
        }
        treeRef.current?.focus();
    };
    const onFilterKeyDown = (ev: React.KeyboardEvent) => {
        if (ev.key === "Escape") {
            ev.preventDefault();
            ev.stopPropagation();
            if (filtering) {
                clearFilter();
            } else {
                treeRef.current?.focus();
            }
            return;
        }
        if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp" && ev.key !== "Enter") {
            return;
        }
        ev.preventDefault();
        const { s, rows: now } = current();
        if (ev.key === "Enter") {
            const file =
                now.find((r) => r.path === s.cursor && r.kind === "file") ?? now.find((r) => r.kind === "file");
            if (file != null) {
                globalStore.set(stateAtom, moveCursorTo(s, file.path));
                openFile(file.path);
            }
            return;
        }
        const action = treeKeyAction(now, s.cursor, ev.key === "ArrowDown" ? "next" : "prev");
        if (action.kind === "move") {
            globalStore.set(stateAtom, moveCursorTo(s, action.path));
        }
    };

    const onKeyDown = (ev: React.KeyboardEvent) => {
        if (ev.key === "/" && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
            ev.preventDefault();
            filterRef.current?.focus();
            return;
        }
        if (ev.key === "Escape" && filtering) {
            ev.preventDefault();
            ev.stopPropagation();
            clearFilter();
            return;
        }
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

    // A drag over the tree: the row under the pointer names the folder, the root when there is none. OS files ("Files")
    // are copied in; the tree's own rows move, and only when the drop would move something. A drag of paths from
    // anywhere else is not the tree's to take.
    const rowAt = (target: EventTarget | null): TreeRow | null => {
        const path = (target as Element | null)?.closest?.("[data-rail-tree-row]")?.getAttribute("data-rail-tree-row");
        return path == null ? null : (rows.find((r) => r.path === path) ?? null);
    };
    const ownDrag = (types: readonly string[]) => {
        const drag = treeDrag();
        return isPathsDrag(types) && drag?.cwd === cwd ? drag : null;
    };
    const onFilesOver = (ev: React.DragEvent<HTMLDivElement>) => {
        const own = ownDrag(ev.dataTransfer.types);
        if (own != null) {
            const dir = dropDirFor(rowAt(ev.target));
            if (planMove(own.rels, dir).moves.length === 0) {
                setDropDir(null); // no default prevented: the pointer says it cannot drop here
                return;
            }
            ev.preventDefault();
            ev.dataTransfer.dropEffect = "move";
            setDropMoves(true);
            setDropDir(dir);
            return;
        }
        if (!isFileDrag(ev.dataTransfer.types)) {
            return;
        }
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "copy";
        setDropMoves(false);
        setDropDir(dropDirFor(rowAt(ev.target)));
    };
    const onFilesLeave = (ev: React.DragEvent<HTMLDivElement>) => {
        if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) {
            setDropDir(null);
        }
    };
    const onFilesDrop = (ev: React.DragEvent<HTMLDivElement>) => {
        const own = ownDrag(ev.dataTransfer.types);
        if (own != null) {
            ev.preventDefault();
            ev.stopPropagation();
            setDropDir(null);
            setTreeDrag(null);
            fireAndForget(() => moveRowsInto(cwd, agentId, own.rels, dropDirFor(rowAt(ev.target))));
            return;
        }
        if (!isFileDrag(ev.dataTransfer.types)) {
            return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        setDropDir(null);
        // read now: a drop's items are unreadable once this event returns; the entries they give stay readable
        const entries = Array.from(ev.dataTransfer.items ?? [])
            .filter((i) => i.kind === "file")
            .map((i) => (i.webkitGetAsEntry?.() ?? null) as DropEntryLike | null);
        const files = Array.from(ev.dataTransfer.files ?? []);
        fireAndForget(() => copyDropInto(cwd, agentId, dropDirFor(rowAt(ev.target)), entries, files));
    };

    const renderRow = (row: TreeRow) => {
        const selected = state.selected.includes(row.path);
        const isCursor = row.path === state.cursor;
        const dropInto = dropDir != null && dropDir !== "" && row.kind === "dir" && row.path === dropDir;
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
                data-drop-target={dropInto ? true : undefined}
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
                    const rels = dragPaths(s, now, row.path);
                    const paths = rels.map((p) => joinRepoPath(cwd, p));
                    for (const { mime, data } of encodePathsDrag(paths)) {
                        ev.dataTransfer.setData(mime, data);
                    }
                    // copy for a terminal, which types the paths; move for a folder of this tree
                    ev.dataTransfer.effectAllowed = "copyMove";
                    setDraggedPathsCount(paths.length);
                    setTreeDrag({ cwd, rels });
                }}
                onDragEnd={() => {
                    setDraggedPathsCount(0);
                    setTreeDrag(null);
                    setDropDir(null);
                }}
                onContextMenu={(ev) => {
                    // a folder has only the path items: pins are files
                    const on = pinned.includes(row.path);
                    ContextMenuModel.getInstance().showContextMenu(
                        [
                            ...(row.kind === "file"
                                ? [
                                      {
                                          label: on ? "Unpin" : "Pin",
                                          icon: on ? (
                                              <PinOff size={13} strokeWidth={1.8} />
                                          ) : (
                                              <Pin size={13} strokeWidth={1.8} />
                                          ),
                                          click: () => toggleCodePinIn(cwd, row.path),
                                      },
                                      { type: "separator" as const },
                                  ]
                                : []),
                            ...pathMenuItems(joinRepoPath(cwd, row.path), row.path),
                        ],
                        ev
                    );
                }}
                style={{ paddingLeft: 8 + row.depth * 12 }}
                className={cn(
                    "flex w-full cursor-pointer items-center gap-1.5 py-[3px] pr-2 text-left text-[12.5px]",
                    selected ? "bg-accent/15 text-primary hover:bg-accent/20" : "text-secondary hover:bg-surface-hover",
                    // dimmed like the Code tree: there, but outside what git tracks
                    row.ignored && "text-muted",
                    isCursor && "ring-1 ring-inset ring-accent/40",
                    dropInto && "bg-accent/15 text-primary ring-1 ring-inset ring-accent"
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
                <span className="min-w-0 truncate">
                    {filtering ? <Highlighted name={row.name} query={query} /> : row.name}
                </span>
                {row.kind === "file" && pinned.includes(row.path) ? (
                    <span aria-label="Pinned" title="Pinned" className="ml-auto flex flex-none text-muted">
                        <Pin size={10} strokeWidth={1.8} />
                    </span>
                ) : null}
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
                {pinned.length > 0 && !filtering ? (
                    <PinnedFiles
                        pinned={pinned}
                        cwd={cwd}
                        onOpen={openPinned}
                        onUnpin={(rel) => toggleCodePinIn(cwd, rel)}
                    />
                ) : null}
                <div
                    ref={treeRef}
                    role="tree"
                    aria-label="Worktree files"
                    aria-multiselectable
                    tabIndex={0}
                    data-owns-keys
                    data-drop-target={dropDir === "" ? true : undefined}
                    onKeyDown={onKeyDown}
                    onDragOver={onFilesOver}
                    onDragLeave={onFilesLeave}
                    onDrop={onFilesDrop}
                    className={cn(
                        "min-h-0 flex-1 select-none overflow-y-auto py-1.5 outline-none",
                        dropDir === "" && "bg-accent/5 ring-1 ring-inset ring-accent"
                    )}
                >
                    {rows.map(renderRow)}
                    {rows.length === 0 ? (
                        <div data-rail-filter-empty className="px-3 py-2 text-[11.5px] text-muted">
                            {filtering ? `No file name has “${query.trim()}”` : "No files"}
                        </div>
                    ) : null}
                </div>
                {dropDir != null || copying != null ? (
                    <div
                        data-rail-drop-strip
                        className="flex-none truncate border-t border-border px-3 py-1.5 text-[11px] text-accent-soft"
                    >
                        {dropDir != null
                            ? dropMoves
                                ? moveHintLabel(dropDir)
                                : dropHintLabel(dropDir)
                            : copying?.label}
                    </div>
                ) : null}
                {/* no .gitignore to honor here, so the walk's fixed skip set is stated, as under the Code tree */}
                {listing?.plain ? (
                    <div
                        data-rail-tree-plain
                        className="flex-none border-t border-border px-3 py-1.5 text-[11px] leading-[1.5] text-muted"
                    >
                        Not a git repository. Skipping node_modules, dist, target, dot-folders and other build output.
                    </div>
                ) : null}
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
                    data-rail-tree-locate
                    aria-label="Locate the open file"
                    title="Locate the File tab's file in the tree"
                    disabled={shownRel == null}
                    onClick={locateShown}
                    className={ICON_BTN}
                >
                    <LocateFixed size={13} aria-hidden />
                </button>
                <button
                    type="button"
                    data-rail-tree-collapse
                    aria-label="Collapse all folders"
                    title="Collapse all folders"
                    onClick={() => globalStore.set(stateAtom, collapseAll(globalStore.get(stateAtom)))}
                    className={ICON_BTN}
                >
                    <ChevronsDownUp size={13} aria-hidden />
                </button>
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
            <div className="flex-none border-b border-border px-2.5 py-2">
                <label
                    className={cn(
                        "flex h-7 items-center gap-1.5 rounded-[6px] border bg-background px-2",
                        filtering ? "border-accent" : "border-edge-mid focus-within:border-edge-strong"
                    )}
                >
                    <Search size={13} aria-hidden className="flex-none text-muted" />
                    <input
                        ref={filterRef}
                        data-rail-filter
                        aria-label="Filter files"
                        placeholder="Filter files"
                        value={query}
                        onChange={(ev) => setQuery(ev.target.value)}
                        onKeyDown={onFilterKeyDown}
                        spellCheck={false}
                        className="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-primary outline-none placeholder:text-ink-faint"
                    />
                    {filtering ? (
                        <>
                            <span data-rail-filter-count className="flex-none text-[11px] tabular-nums text-muted">
                                {filtered?.count === 1 ? "1 match" : `${filtered?.count ?? 0} matches`}
                            </span>
                            <button
                                type="button"
                                aria-label="Clear the filter"
                                title="Clear the filter (Esc)"
                                onClick={clearFilter}
                                className="flex size-4 flex-none cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-muted hover:text-primary"
                            >
                                <X size={12} aria-hidden />
                            </button>
                        </>
                    ) : (
                        <kbd className="flex-none rounded-[4px] border border-edge-mid px-1 font-mono text-[10.5px] leading-4 text-muted">
                            /
                        </kbd>
                    )}
                </label>
            </div>
            {body}
        </div>
    );
}

function Highlighted({ name, query }: { name: string; query: string }) {
    const span = matchSpan(name, query);
    if (span == null) {
        return <>{name}</>;
    }
    return (
        <>
            {name.slice(0, span[0])}
            <span className="font-semibold text-primary">{name.slice(span[0], span[1])}</span>
            {name.slice(span[1])}
        </>
    );
}

// The Code surface's Pinned list (codetreepane.tsx PinnedFiles) for this folder: a click opens the file in the panel and
// reveals it in the tree for Back, and a row drags onto a terminal like a tree row.
function PinnedFiles({
    pinned,
    cwd,
    onOpen,
    onUnpin,
}: {
    pinned: readonly string[];
    cwd: string;
    onOpen: (rel: string) => void;
    onUnpin: (rel: string) => void;
}) {
    return (
        <div data-rail-pinned className="flex max-h-[40%] flex-none flex-col border-b border-border">
            <div className="flex-none px-3 pb-1 pt-2 text-[10.5px] text-muted">Pinned</div>
            <div className="min-h-0 overflow-y-auto pb-1.5">
                {pinned.map((rel) => {
                    const cut = rel.lastIndexOf("/");
                    const dir = cut === -1 ? "" : rel.slice(0, cut);
                    const name = cut === -1 ? rel : rel.slice(cut + 1);
                    return (
                        <div
                            key={rel}
                            data-rail-pinned-row={rel}
                            title={rel}
                            draggable
                            onClick={() => onOpen(rel)}
                            onDragStart={(ev) => {
                                for (const { mime, data } of encodePathsDrag([joinRepoPath(cwd, rel)])) {
                                    ev.dataTransfer.setData(mime, data);
                                }
                                ev.dataTransfer.effectAllowed = "copy";
                                setDraggedPathsCount(1);
                            }}
                            onDragEnd={() => setDraggedPathsCount(0)}
                            onContextMenu={(ev) =>
                                ContextMenuModel.getInstance().showContextMenu(
                                    [
                                        {
                                            label: "Unpin",
                                            icon: <PinOff size={13} strokeWidth={1.8} />,
                                            click: () => onUnpin(rel),
                                        },
                                        { type: "separator" },
                                        ...pathMenuItems(joinRepoPath(cwd, rel), rel),
                                    ],
                                    ev
                                )
                            }
                            className="group flex w-full cursor-pointer items-center gap-1.5 py-[3px] pl-3 pr-1.5 text-left text-[12.5px] text-secondary hover:bg-surface-hover"
                        >
                            <FileIcon path={rel} />
                            <span className="min-w-0 flex-1 truncate">
                                {name}
                                {dir !== "" ? <span className="ml-1.5 text-[11px] text-muted">{dir}</span> : null}
                            </span>
                            <button
                                type="button"
                                data-rail-unpin={rel}
                                aria-label={`Unpin ${name}`}
                                title="Unpin"
                                onClick={(ev) => {
                                    ev.stopPropagation();
                                    onUnpin(rel);
                                }}
                                className="flex size-4 flex-none cursor-pointer items-center justify-center rounded-[4px] text-muted opacity-0 hover:text-primary focus-visible:opacity-100 group-hover:opacity-100"
                            >
                                <X size={11} strokeWidth={1.8} />
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
