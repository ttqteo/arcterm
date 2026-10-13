// frontend/app/view/code/codetreepane.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The directory tree, built from the same flat path list the finder indexes — one source of truth,
// so the two can never disagree about what exists.
//
// The pane is a single focus owner (role="tree" + tabIndex), not a stack of buttons: the Code
// keybindings are gated on this pane holding focus, and a focused row button would make Enter fire
// both the binding and the button's own click. It registers no list-nav controller — a two-focus
// surface owns its keys (see listnav.ts), and the shared "moving is selecting" contract would make
// every cursor step read a file over RPC.

import { FileIcon } from "@/app/element/fileicon";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { focusClaimed } from "@/app/store/keybindings/dispatcher";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { joinRepoPath } from "@/util/paths";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import {
    ChevronDown,
    ChevronRight,
    ChevronsDownUp,
    Columns2,
    FilePlus,
    FolderPlus,
    LocateFixed,
    Pencil,
    Pin,
    PinOff,
    Trash2,
    X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { nameErrorMessage, provisionalIndex, validateName } from "./codemutate";
import { pinsFor } from "./codepins";
import { CODE_PATH_MIME, codeTreeDragAtom, openSide } from "./codeside";
import { statusGlyph, type CodeStatus } from "./codestatus";
import {
    cancelEdit,
    checkStale,
    codeCursorAtom,
    codeDraftsAtom,
    codeEditAtom,
    codeExpandedAtom,
    codeFileAtom,
    codeIgnoredListedAtom,
    codeIndexAtom,
    codePinsAtom,
    codePlainAtom,
    codeProjectAtom,
    codeRowsAtom,
    codeStatusAtom,
    codeStatusDirsAtom,
    codeTreeFocusedAtom,
    confirmDelete,
    createEntry,
    draftKey,
    listIgnoredDirs,
    openPath,
    renamePath,
    revealPath,
    startCreate,
    startRename,
    toggleCodePin,
    toggleDir,
} from "./codestore";
import type { TreeRow } from "./codetree";
import { codeLocateAtom, collapseAllDirs, locateOpenFile } from "./codetreeactions";
import { revealInList } from "./treescroll";

export function CodeTreePane({ model }: { model: AgentsViewModel }) {
    void model;
    const rows = useAtomValue(codeRowsAtom);
    const cursor = useAtomValue(codeCursorAtom);
    const file = useAtomValue(codeFileAtom);
    const project = useAtomValue(codeProjectAtom);
    const drafts = useAtomValue(codeDraftsAtom);
    // read once for the whole pane rather than per row: hundreds of rows would otherwise mean
    // hundreds of subscriptions
    const status = useAtomValue(codeStatusAtom);
    const changedDirSet = useAtomValue(codeStatusDirsAtom);
    const edit = useAtomValue(codeEditAtom);
    const index = useAtomValue(codeIndexAtom);
    const expanded = useAtomValue(codeExpandedAtom);
    const ignoredListed = useAtomValue(codeIgnoredListedAtom);
    const pins = useAtomValue(codePinsAtom);
    const locate = useAtomValue(codeLocateAtom);
    const pinned = project == null ? [] : pinsFor(pins, project.path);
    const plain = useAtomValue(codePlainAtom);
    const openFile = file.kind === "none" ? null : file.path;
    const rowRefs = useRef(new Map<string, HTMLDivElement>());
    const treeRef = useRef<HTMLDivElement>(null);

    // the tree keys (j/k, arrows, Enter, n) need the tree focused, and arriving on Code left focus on
    // <body>, so they were dead until a click or Alt+T
    useEffect(() => {
        if (!focusClaimed()) {
            treeRef.current?.focus({ preventScroll: true });
        }
    }, []);

    // an ignored directory git reported as one entry shows its contents once listed; this covers every
    // way a directory opens (click, keys, a reveal), and an opened one that a listing nested further
    useEffect(() => {
        fireAndForget(listIgnoredDirs);
    }, [expanded, index, ignoredListed]);

    const paths = index?.paths ?? [];
    const provisional = edit?.kind === "create" ? provisionalIndex(rows, edit.dir) : -1;
    const provisionalDepth =
        edit?.kind === "create" && edit.dir !== "" ? (rows.find((r) => r.path === edit.dir)?.depth ?? -1) + 1 : 0;

    // a finder or search jump expands ancestors, which is invisible if the row it revealed is
    // off-screen; the cursor is what makes the landing visible, in the middle for a jump (treescroll.ts)
    useEffect(() => {
        if (cursor != null) {
            revealInList(treeRef.current, rowRefs.current.get(cursor));
        }
    }, [cursor, locate]);

    const provisionalInput =
        edit?.kind === "create" ? (
            <NameInput
                key="__provisional"
                initial=""
                dir={edit.dir}
                depth={provisionalDepth}
                existing={paths}
                onCommit={(name) => fireAndForget(() => createEntry(edit.dir, name, edit.isDir))}
            />
        ) : null;

    const renderRow = (row: TreeRow) => (
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
            // a file drags onto the editor area: the left half opens it, the right half to the side (codeeditorarea.tsx)
            draggable={row.kind === "file"}
            onDragStart={(ev) => {
                ev.dataTransfer.setData(CODE_PATH_MIME, row.path);
                ev.dataTransfer.effectAllowed = "copy";
                globalStore.set(codeTreeDragAtom, true);
            }}
            onDragEnd={() => globalStore.set(codeTreeDragAtom, false)}
            aria-selected={row.path === cursor}
            aria-expanded={row.kind === "dir" ? row.expanded : undefined}
            onClick={() => {
                globalStore.set(codeCursorAtom, row.path);
                if (row.kind === "dir") {
                    toggleDir(row.path);
                } else {
                    fireAndForget(() => openPath(row.path));
                }
            }}
            onContextMenu={(ev) => {
                // startCreate reads the cursor, so moving it first is what makes New File land where
                // the user pointed rather than where they last clicked
                globalStore.set(codeCursorAtom, row.path);
                ContextMenuModel.getInstance().showContextMenu(
                    [
                        ...(row.kind === "dir"
                            ? []
                            : [
                                  {
                                      label: "Open to the Side",
                                      icon: <Columns2 size={13} strokeWidth={1.8} />,
                                      accel: "Mod:\\",
                                      click: () => openSide(row.path),
                                  },
                                  pinned.includes(row.path)
                                      ? {
                                            label: "Unpin",
                                            icon: <PinOff size={13} strokeWidth={1.8} />,
                                            click: () => toggleCodePin(row.path),
                                        }
                                      : {
                                            label: "Pin",
                                            icon: <Pin size={13} strokeWidth={1.8} />,
                                            click: () => toggleCodePin(row.path),
                                        },
                                  { type: "separator" as const },
                              ]),
                        {
                            label: "New File",
                            icon: <FilePlus size={13} strokeWidth={1.8} />,
                            click: () => startCreate(false),
                        },
                        {
                            label: "New Folder",
                            icon: <FolderPlus size={13} strokeWidth={1.8} />,
                            click: () => startCreate(true),
                        },
                        { type: "separator" },
                        {
                            label: "Rename",
                            icon: <Pencil size={13} strokeWidth={1.8} />,
                            accel: "F2",
                            click: () => startRename(row.path),
                        },
                        {
                            label: "Delete",
                            icon: <Trash2 size={13} strokeWidth={1.8} />,
                            danger: true,
                            accel: "Delete",
                            click: () => confirmDelete(row.path, row.kind === "dir"),
                        },
                        { type: "separator" },
                        {
                            label: "Copy Path",
                            click: () => {
                                if (project != null) {
                                    void navigator.clipboard?.writeText(joinRepoPath(project.path, row.path));
                                }
                            },
                        },
                    ],
                    ev
                );
            }}
            style={{ paddingLeft: 8 + row.depth * 12 }}
            className={cn(
                "flex w-full cursor-pointer items-center gap-1.5 py-[3px] pr-2 text-left text-[12.5px] text-secondary hover:bg-accent/10 hover:text-primary",
                // dimmed like VS Code: there, but outside what git tracks
                row.ignored && "text-muted",
                row.path === openFile && "text-accent-soft",
                row.path === cursor && "bg-accent/10"
            )}
        >
            {row.kind === "dir" ? (
                row.expanded ? (
                    <ChevronDown size={13} strokeWidth={1.8} className="flex-none" />
                ) : (
                    <ChevronRight size={13} strokeWidth={1.8} className="flex-none" />
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

            {edit?.kind === "rename" && edit.path === row.path ? (
                <NameInput
                    initial={row.name}
                    dir={row.path.includes("/") ? row.path.slice(0, row.path.lastIndexOf("/")) : ""}
                    depth={0}
                    existing={paths.filter((p) => p !== row.path && !p.startsWith(`${row.path}/`))}
                    onCommit={(name) => fireAndForget(() => renamePath(row.path, name))}
                />
            ) : (
                <span className="min-w-0 truncate">{row.name}</span>
            )}
            <span className="ml-auto flex flex-none items-center gap-1.5">
                {row.kind === "file" && pinned.includes(row.path) ? (
                    <span aria-label="Pinned" title="Pinned" className="flex text-muted">
                        <Pin size={10} strokeWidth={1.8} />
                    </span>
                ) : null}
                {row.kind === "file" ? <StatusMark s={status?.get(row.path)} /> : null}
                {/* a collapsed directory is the only place the roll-up has anything to say:
                    expanded, the rows underneath speak for themselves */}
                {row.kind === "dir" && !row.expanded && changedDirSet.has(row.path) ? (
                    <span
                        aria-label="Contains changes"
                        title="Contains changes"
                        className="size-[5px] rounded-full bg-muted"
                    />
                ) : null}
                {/* drafts survive an unmount, so unsaved work can exist on a file you are not
                    looking at — the dot is the only thing that says so */}
                {row.kind === "file" && project != null && drafts.has(draftKey(project, row.path)) ? (
                    <span
                        aria-label="Unsaved edits"
                        title="Unsaved edits"
                        className="size-[6px] rounded-full bg-accent-soft"
                    />
                ) : null}
            </span>
        </div>
    );

    return (
        <div className="flex h-full flex-col border-r border-border">
            {/* above the rows rather than after them: a truncated list is the one too long to scroll to
                the end of, and a missing file otherwise just looks deleted */}
            {index?.truncated ? (
                <div
                    data-code-tree-truncated
                    className="flex-none border-b border-border px-3 py-1.5 text-[11px] text-muted"
                >
                    File list truncated — showing the first 20,000 files only.
                </div>
            ) : null}
            {pinned.length > 0 ? <PinnedFiles pinned={pinned} openFile={openFile} /> : null}
            <div
                ref={treeRef}
                role="tree"
                tabIndex={0}
                data-code-tree
                onFocus={() => {
                    globalStore.set(codeTreeFocusedAtom, true);
                    fireAndForget(checkStale);
                }}
                onBlur={() => globalStore.set(codeTreeFocusedAtom, false)}
                className="min-h-0 flex-1 select-none overflow-y-auto py-2 outline-none"
            >
                {rows.flatMap((row, i) => {
                    const out: React.ReactNode[] = [];
                    if (i === provisional) {
                        out.push(provisionalInput);
                    }
                    out.push(renderRow(row));
                    return out;
                })}
                {provisional >= rows.length ? provisionalInput : null}
            </div>
            {/* no .gitignore to honor here, so the walk's fixed skip set is stated rather than mysterious */}
            {plain ? (
                <div
                    data-code-tree-skipset
                    className="flex-none border-t border-border px-3 py-1.5 text-[11px] text-muted"
                >
                    Skipping node_modules, dist, target, dot-folders and other build output.
                </div>
            ) : null}
        </div>
    );
}

const TOOL_BTN =
    "flex size-6 flex-none cursor-pointer items-center justify-center rounded-[6px] text-muted hover:bg-surface-hover hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-default disabled:text-edge-strong disabled:hover:bg-transparent";

// the sidebar toolbar's Files buttons, beside its collapse: Locate shows the open file in the tree, Collapse All closes
// every folder
export function CodeTreeTools() {
    const file = useAtomValue(codeFileAtom);
    return (
        <>
            <button
                type="button"
                data-code-tree-locate
                aria-label="Locate the open file"
                title="Locate the open file in the tree"
                disabled={file.kind === "none"}
                onClick={locateOpenFile}
                className={TOOL_BTN}
            >
                <LocateFixed size={14} strokeWidth={1.8} aria-hidden />
            </button>
            <button
                type="button"
                data-code-tree-collapse
                aria-label="Collapse all folders"
                title="Collapse all folders"
                onClick={collapseAllDirs}
                className={TOOL_BTN}
            >
                <ChevronsDownUp size={14} strokeWidth={1.8} aria-hidden />
            </button>
        </>
    );
}

// Files pinned from the tree or the path bar, above the tree so they never scroll away. Opening one also reveals it in
// the tree, which is the answer to "where did that file live".
function PinnedFiles({ pinned, openFile }: { pinned: readonly string[]; openFile: string | null }) {
    return (
        <div data-code-pinned className="flex max-h-[40%] flex-none flex-col border-b border-border">
            <div className="flex-none px-3 pb-1 pt-2 text-[10.5px] text-muted">Pinned</div>
            <div className="min-h-0 overflow-y-auto pb-1.5">
                {pinned.map((rel) => {
                    const cut = rel.lastIndexOf("/");
                    const dir = cut === -1 ? "" : rel.slice(0, cut);
                    const name = cut === -1 ? rel : rel.slice(cut + 1);
                    return (
                        <div
                            key={rel}
                            data-code-pinned-row={rel}
                            title={rel}
                            onClick={() => {
                                revealPath(rel);
                                globalStore.set(codeCursorAtom, rel);
                                fireAndForget(() => openPath(rel));
                            }}
                            onContextMenu={(ev) =>
                                ContextMenuModel.getInstance().showContextMenu(
                                    [
                                        {
                                            label: "Open to the Side",
                                            icon: <Columns2 size={13} strokeWidth={1.8} />,
                                            click: () => openSide(rel),
                                        },
                                        {
                                            label: "Unpin",
                                            icon: <PinOff size={13} strokeWidth={1.8} />,
                                            click: () => toggleCodePin(rel),
                                        },
                                    ],
                                    ev
                                )
                            }
                            className={cn(
                                "group flex w-full cursor-pointer items-center gap-1.5 py-[3px] pl-3 pr-1.5 text-left text-[12.5px] text-secondary hover:bg-accent/10 hover:text-primary",
                                rel === openFile && "text-accent-soft"
                            )}
                        >
                            <FileIcon path={rel} />
                            <span className="min-w-0 flex-1 truncate">
                                {name}
                                {dir !== "" ? <span className="ml-1.5 text-[11px] text-muted">{dir}</span> : null}
                            </span>
                            <button
                                type="button"
                                data-code-unpin={rel}
                                aria-label={`Unpin ${name}`}
                                title="Unpin"
                                onClick={(ev) => {
                                    ev.stopPropagation();
                                    toggleCodePin(rel);
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

// Enter commits, Escape cancels, and the error shows while you type — the pre-check reads the index
// snapshot, so it can be wrong, which is why the write still surfaces the backend's error.
function NameInput({
    initial,
    dir,
    depth,
    existing,
    onCommit,
}: {
    initial: string;
    dir: string;
    depth: number;
    existing: readonly string[];
    onCommit: (name: string) => void;
}) {
    const [value, setValue] = useState(initial);
    // an unchanged rename is not an error, but an empty create is — so the skip only applies to a
    // name that is both non-empty and untouched
    const trimmed = value.trim();
    const err = trimmed !== "" && trimmed === initial ? null : validateName(value, dir, existing);
    return (
        <div style={{ paddingLeft: 8 + depth * 12 }} className="flex w-full items-center gap-1.5 py-[3px] pr-2">
            <input
                autoFocus
                value={value}
                data-code-name-input
                onChange={(e) => setValue(e.target.value)}
                onBlur={cancelEdit}
                onKeyDown={(e) => {
                    e.stopPropagation(); // the tree's j/k/n bindings must not eat what you type
                    if (e.key === "Escape") {
                        cancelEdit();
                    }
                    if (e.key === "Enter" && err == null) {
                        onCommit(trimmed);
                    }
                }}
                className="min-w-0 flex-1 select-text rounded-[4px] border border-border bg-surface px-1 py-[1px] text-[12px] text-primary outline-none"
            />
            {err != null ? (
                <span title={nameErrorMessage(err)} className="flex-none text-[10px] text-error">
                    {nameErrorMessage(err)}
                </span>
            ) : null}
        </div>
    );
}

function StatusMark({ s }: { s: CodeStatus | undefined }) {
    if (s == null) {
        return null;
    }
    const g = statusGlyph(s.status);
    return (
        <span data-code-status={g.letter} title={g.label} className={cn("text-[10.5px]", g.className)}>
            {g.letter}
        </span>
    );
}
