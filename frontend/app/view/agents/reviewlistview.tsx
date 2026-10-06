// frontend/app/view/agents/reviewlistview.tsx
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The diff pane's Review mode: every changed file of the selection stacked in one scroll, a unified
// diff each, with line comments drafted beside the rows they are about. The rows, folds and ranges are
// reviewlist.ts; the comments and the one box are linecommentstore.ts. Rendered rows, not Monaco, so a
// comment card is just a row between two code rows.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { MAX_DIFF_BYTES } from "./diffcontentstore";
import { highlightLine } from "./highlight";
import { commentRef, commentSources, orderComments, type LineComment } from "./linecomments";
import {
    addComment,
    cancelBox,
    deleteComment,
    editComment,
    lineReviewAtom,
    openBox,
    setBoxText,
    type CommentBox,
} from "./linecommentstore";
import {
    reviewSections,
    rowsInRange,
    type ReviewPatchFileLike,
    type ReviewRow,
    type ReviewSection,
} from "./reviewlist";
import { fmtBytes } from "./runcompletion";

type LineRow = Extract<ReviewRow, { kind: "line" }>;

type PatchLoad =
    | { status: "loading" }
    | { status: "error"; error: string }
    | { status: "ok"; isRepo: boolean; files: ReviewPatchFileLike[] };

// a drag from a row's + across rows of the same file and side
interface Drag {
    path: string;
    side: LineRow["side"];
    from: string;
    over: string;
}

const META_TEXT = "text-[10.5px] text-muted";
const ACCENT_BTN =
    "flex cursor-pointer items-center gap-2 rounded-[8px] bg-accent px-[11px] py-[5px] text-[12px] font-semibold text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-50";
const SECONDARY_BTN =
    "flex cursor-pointer items-center gap-2 rounded-[8px] border border-edge-mid bg-surface-raised px-[11px] py-[5px] text-[12px] font-semibold text-secondary hover:border-edge-strong hover:bg-surface-hover";
const CHIP =
    "inline-flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full bg-accent text-[10.5px] font-bold leading-none text-background";
// the old number, new number and sign columns; cards and the box line up with the code after them
const ROW_GRID = "grid grid-cols-[44px_44px_18px_minmax(0,1fr)_30px]";
const BESIDE_CODE = "ml-[106px] mr-[30px]";

const EMPTY_REASON: Record<NonNullable<ReviewSection["empty"]>, string> = {
    binary: "Binary file — no text to show",
    toolarge: "Too large to show",
    renamed: "Renamed without changes",
    nochange: "No text changes",
};

// The DEV fault hook (window.__lineReviewFault) is read where a load starts: "slow" holds it 3 s,
// "error" fails it. One load only, then it clears itself.
async function devFault(): Promise<void> {
    if (!import.meta.env.DEV || typeof window === "undefined") {
        return;
    }
    const fault = window.__lineReviewFault;
    if (fault == null) {
        return;
    }
    window.__lineReviewFault = undefined;
    if (fault === "slow") {
        await new Promise((r) => setTimeout(r, 3000));
    } else if (fault === "error") {
        throw new Error("injected by __lineReviewFault");
    }
}

// An untracked binary file arrives as its raw bytes, which JSON leaves full of NULs or replacement
// characters; git's own sentence makes the model read it as binary rather than as text.
function asReviewFile(f: ReviewPatchFile): ReviewPatchFileLike {
    if (f.untracked && f.content != null && (f.content.includes("\u0000") || f.content.includes("�"))) {
        return { path: f.path, diff: `Binary files /dev/null and b/${f.path} differ\n` };
    }
    return f;
}

async function loadReviewPatch(cwd: string, source: string, base: string): Promise<PatchLoad> {
    await devFault();
    const r = await RpcApi.GitReviewPatchCommand(TabRpcClient, {
        cwd,
        ...(source === "worktree" ? { base } : { hash: source }),
        maxbytes: MAX_DIFF_BYTES,
    });
    return { status: "ok", isRepo: r.isrepo, files: (r.files ?? []).map(asReviewFile) };
}

function quoteOf(section: ReviewSection, box: CommentBox): string[] {
    return section.rows
        .filter(
            (r): r is LineRow =>
                r.kind === "line" && r.side === box.side && r.line >= box.startLine && r.line <= box.endLine
        )
        .map((r) => r.text);
}

const endKey = (c: { side: string; endLine: number }) => `${c.side}:${c.endLine}`;

export function ReviewList({
    repoKey,
    source,
    base,
    refreshKey,
    scrollTo,
    loading,
}: {
    repoKey: string; // the Diff scope's cwd
    source: string; // "worktree" or a commit hash
    base: string; // FilesState.ref, for the working tree
    // changes when the working tree does; a reload on it keeps the rows on screen
    refreshKey: string;
    // a file the commit pane's list asked for; n grows with each click
    scrollTo: { path: string; n: number } | null;
    loading: ReactNode;
}) {
    const state = useAtomValue(lineReviewAtom(repoKey));
    const [load, setLoad] = useState<PatchLoad>({ status: "loading" });
    const [attempt, setAttempt] = useState(0);
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
    const [drag, setDrag] = useState<Drag | null>(null);
    const anchor = useRef<{ path: string; key: string } | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const boxRef = useRef<HTMLTextAreaElement>(null);
    const loadedFor = useRef("");
    const scrolledTo = useRef(scrollTo?.n ?? 0);

    useEffect(() => {
        let alive = true;
        // a refresh of what is on screen keeps it; a new base or a retry shows the skeleton
        const target = `${base}|${attempt}`;
        if (loadedFor.current !== target) {
            setLoad({ status: "loading" });
        }
        fireAndForget(async () => {
            let next: PatchLoad;
            try {
                next = await loadReviewPatch(repoKey, source, base);
            } catch (e) {
                console.error("review patch load failed", e);
                next = { status: "error", error: String((e as Error)?.message ?? e) };
            }
            if (alive) {
                loadedFor.current = target;
                setLoad(next);
            }
        });
        return () => {
            alive = false;
        };
    }, [repoKey, source, base, attempt, refreshKey]);

    const files = load.status === "ok" ? load.files : null;
    const sections = useMemo(() => (files == null ? null : reviewSections(files, expanded)), [files, expanded]);

    useEffect(() => {
        if (scrollTo == null || scrollTo.n <= scrolledTo.current || sections == null) {
            return;
        }
        const header = listRef.current?.querySelector(`[data-review-file="${CSS.escape(scrollTo.path)}"]`);
        if (header != null) {
            scrolledTo.current = scrollTo.n;
            header.parentElement?.scrollIntoView({ block: "start" });
        }
    }, [scrollTo, sections]);

    const numbers = useMemo(() => {
        const ordered = orderComments(state.comments, commentSources(state.comments));
        return new Map(ordered.map((c, i) => [c.id, i + 1]));
    }, [state.comments]);

    // The box that holds text stays where it is and takes focus, so a typed note is never lost or hidden.
    const focusBox = () => {
        const box = globalStore.get(lineReviewAtom(repoKey)).box;
        if (box != null && collapsed.has(box.file)) {
            setCollapsed((prev) => {
                const next = new Set(prev);
                next.delete(box.file);
                return next;
            });
        }
        requestAnimationFrame(() => boxRef.current?.focus());
    };

    const openRange = (section: ReviewSection, from: string, to: string) => {
        const rows = (rowsInRange(section, from, to) ?? []) as LineRow[];
        if (rows.length === 0) {
            return;
        }
        const lines = rows.map((r) => r.line);
        const result = openBox(repoKey, {
            source,
            file: section.path,
            side: rows[0].side,
            startLine: Math.min(...lines),
            endLine: Math.max(...lines),
        });
        if (result === "kept") {
            focusBox();
        }
    };

    // Kept in a ref so the memoized rows get one stable set of handlers.
    const live = useRef({
        plusClick: (_s: ReviewSection, _r: LineRow, _shift: boolean) => {},
        plusDown: (_s: ReviewSection, _r: LineRow) => {},
        rowEnter: (_s: ReviewSection, _r: LineRow) => {},
    });
    live.current = {
        plusClick: (section, row, shift) => {
            const a = anchor.current;
            // shift-click extends from the last + on the same file; rowsInRange refuses a range across sides
            if (shift && a != null && a.path === section.path && rowsInRange(section, a.key, row.key) != null) {
                openRange(section, a.key, row.key);
                return;
            }
            anchor.current = { path: section.path, key: row.key };
            openRange(section, row.key, row.key);
        },
        plusDown: (section, row) => setDrag({ path: section.path, side: row.side, from: row.key, over: row.key }),
        rowEnter: (section, row) =>
            setDrag((d) =>
                d != null && d.path === section.path && d.side === row.side && d.over !== row.key
                    ? { ...d, over: row.key }
                    : d
            ),
    };
    const handlers = useMemo<RowHandlers>(
        () => ({
            plusClick: (s, r, shift) => live.current.plusClick(s, r, shift),
            plusDown: (s, r) => live.current.plusDown(s, r),
            rowEnter: (s, r) => live.current.rowEnter(s, r),
        }),
        []
    );

    // A drag that ends on another row opens the box on the range; one that ends where it started is the
    // click, which the button's own onClick handles.
    const dragRef = useRef(drag);
    dragRef.current = drag;
    useEffect(() => {
        if (drag == null) {
            return;
        }
        const up = () => {
            const d = dragRef.current;
            setDrag(null);
            const section = sections?.find((s) => s.path === d?.path);
            if (d != null && section != null && d.over !== d.from) {
                anchor.current = { path: d.path, key: d.from };
                openRange(section, d.from, d.over);
            }
        };
        window.addEventListener("pointerup", up);
        return () => window.removeEventListener("pointerup", up);
    }, [drag != null, sections]);

    if (load.status === "loading") {
        return (
            <div data-review-loading className="flex min-h-0 flex-1 flex-col">
                {loading}
            </div>
        );
    }
    if (load.status === "error") {
        return (
            <div data-review-error className="flex items-center gap-[10px] px-[18px] py-[14px] text-[12.5px]">
                <span className="min-w-0 flex-1 truncate text-error" title={load.error}>
                    Couldn’t load the review: {load.error}
                </span>
                <button data-review-retry onClick={() => setAttempt((n) => n + 1)} className={SECONDARY_BTN}>
                    Retry
                </button>
            </div>
        );
    }
    if (!load.isRepo || sections == null || sections.length === 0) {
        return (
            <div data-review-list className="px-[18px] py-[14px] text-[12.5px] text-muted">
                {load.isRepo ? "No changes to review" : "Not a git repository"}
            </div>
        );
    }

    const box = state.box != null && state.box.source === source ? state.box : null;
    const shown = state.comments.filter((c) => c.source === source && c.id !== box?.editingId);

    const toggle = (path: string) =>
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (!next.delete(path)) {
                next.add(path);
            }
            return next;
        });

    const boxView = (section: ReviewSection) =>
        box == null ? null : (
            <CommentBoxView
                key="box"
                box={box}
                ref={boxRef}
                onText={(t) => setBoxText(repoKey, t)}
                onAdd={() => addComment(repoKey, quoteOf(section, box))}
                onCancel={() => cancelBox(repoKey)}
            />
        );
    const cardView = (c: LineComment) => (
        <CommentCard
            key={c.id}
            comment={c}
            n={numbers.get(c.id) ?? 0}
            onEdit={() => {
                if (editComment(repoKey, c.id) === "kept") {
                    focusBox();
                }
            }}
            onDelete={() => deleteComment(repoKey, c.id)}
        />
    );

    return (
        <div data-review-list ref={listRef} className="min-h-0 flex-1 overflow-y-auto pb-[24px]">
            {sections.map((section) => {
                const isCollapsed = collapsed.has(section.path);
                const lineRows = section.rows.filter((r): r is LineRow => r.kind === "line");
                const rendered = new Set(lineRows.map((r) => r.key));
                const mine = shown.filter((c) => c.file === section.path);
                const boxHere = box != null && box.file === section.path;
                const preview =
                    drag != null && drag.path === section.path
                        ? new Set(((rowsInRange(section, drag.from, drag.over) ?? []) as LineRow[]).map((r) => r.key))
                        : null;
                const tinted = (r: LineRow) =>
                    (preview?.has(r.key) ?? false) ||
                    (boxHere && r.side === box.side && r.line >= box.startLine && r.line <= box.endLine);
                // a comment or the box whose last row is folded away or gone sits at the file's end
                const orphans = mine.filter((c) => !rendered.has(endKey(c)));
                const boxOrphan = boxHere && !rendered.has(endKey({ side: box.side, endLine: box.endLine }));
                return (
                    <section key={section.path} className="border-b border-edge-faint">
                        <FileHeader section={section} collapsed={isCollapsed} onToggle={() => toggle(section.path)} />
                        {isCollapsed ? null : section.empty ? (
                            <div
                                data-review-empty={section.empty}
                                className="px-[18px] py-[12px] text-[12px] text-muted"
                            >
                                {EMPTY_REASON[section.empty]}
                                {section.empty === "toolarge" && section.size ? ` (${fmtBytes(section.size)})` : null}
                                {section.oldPath ? (
                                    <span className="ml-[8px] font-mono text-ink-faint">from {section.oldPath}</span>
                                ) : null}
                            </div>
                        ) : (
                            <div className="py-[4px]">
                                {section.rows.map((row) => {
                                    if (row.kind === "fold") {
                                        return (
                                            <button
                                                key={row.id}
                                                data-review-fold={row.id}
                                                onClick={() => setExpanded((prev) => new Set(prev).add(row.id))}
                                                className="flex h-[24px] w-full items-center bg-surface pl-[106px] text-left font-mono text-[11px] text-muted hover:bg-surface-hover hover:text-ink-hi"
                                            >
                                                ⋯ {row.hidden} unchanged lines
                                            </button>
                                        );
                                    }
                                    const after = mine.filter((c) => endKey(c) === row.key);
                                    const boxAfter =
                                        boxHere && endKey({ side: box.side, endLine: box.endLine }) === row.key;
                                    return (
                                        <div key={row.key}>
                                            <Row section={section} row={row} tinted={tinted(row)} handlers={handlers} />
                                            {after.map(cardView)}
                                            {boxAfter ? boxView(section) : null}
                                        </div>
                                    );
                                })}
                                {orphans.map(cardView)}
                                {boxOrphan ? boxView(section) : null}
                            </div>
                        )}
                    </section>
                );
            })}
        </div>
    );
}

function FileHeader({
    section,
    collapsed,
    onToggle,
}: {
    section: ReviewSection;
    collapsed: boolean;
    onToggle: () => void;
}) {
    return (
        <button
            data-review-file={section.path}
            aria-expanded={!collapsed}
            onClick={onToggle}
            title={section.path}
            className="sticky top-0 z-[2] flex h-[36px] w-full items-center gap-[8px] border-b border-edge-faint bg-surface px-[14px] text-left hover:bg-surface-hover"
        >
            {collapsed ? (
                <ChevronRight size={14} className="flex-none text-muted" />
            ) : (
                <ChevronDown size={14} className="flex-none text-muted" />
            )}
            <span className="flex-none font-mono text-[12px] font-semibold text-ink-hi">{section.name}</span>
            <span className="min-w-0 truncate font-mono text-[11px] text-muted">{section.dir}</span>
            <div className="flex-1" />
            <span className="flex-none text-[11px] font-bold tabular-nums text-diff-added">+{section.adds}</span>
            <span className="flex-none text-[11px] font-bold tabular-nums text-diff-removed">−{section.dels}</span>
        </button>
    );
}

interface RowHandlers {
    plusClick: (section: ReviewSection, row: LineRow, shift: boolean) => void;
    plusDown: (section: ReviewSection, row: LineRow) => void;
    rowEnter: (section: ReviewSection, row: LineRow) => void;
}

// memoized: typing in the box re-renders the list, and a file is every one of its lines
const Row = memo(function Row({
    section,
    row,
    tinted,
    handlers,
}: {
    section: ReviewSection;
    row: LineRow;
    tinted: boolean;
    handlers: RowHandlers;
}) {
    const tokens = useMemo(() => highlightLine(row.text), [row.text]);
    return (
        <div
            data-review-row={row.key}
            onPointerEnter={() => handlers.rowEnter(section, row)}
            className={cn(
                ROW_GRID,
                "group font-mono text-[12px] leading-[20px]",
                tinted
                    ? "bg-accent/10"
                    : row.change === "add"
                      ? "bg-diff-added/15"
                      : row.change === "del"
                        ? "bg-diff-removed/10"
                        : null
            )}
        >
            <span className="select-none pr-[8px] text-right tabular-nums text-ink-faint">{row.oldNo}</span>
            <span className="select-none pr-[8px] text-right tabular-nums text-ink-faint">{row.newNo}</span>
            <span
                className={cn(
                    "select-none text-center",
                    row.change === "add" ? "text-diff-added" : row.change === "del" ? "text-diff-removed" : null
                )}
            >
                {row.sign}
            </span>
            <span className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {tokens.map((t, i) => (
                    <span key={i} className={t.cls}>
                        {t.t}
                    </span>
                ))}
            </span>
            <span className="flex items-start justify-center pt-[1px]">
                <button
                    data-review-add
                    title="Comment on this line (shift-click or drag for a range)"
                    aria-label={`Comment on line ${row.line}`}
                    onPointerDown={(e) => {
                        if (e.button !== 0 || e.shiftKey) {
                            return;
                        }
                        e.preventDefault(); // no text selection while dragging a range
                        handlers.plusDown(section, row);
                    }}
                    onClick={(e) => handlers.plusClick(section, row, e.shiftKey)}
                    className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-accent text-background opacity-0 hover:bg-accenthover focus-visible:opacity-100 group-hover:opacity-100"
                >
                    <Plus size={12} strokeWidth={2.6} />
                </button>
            </span>
        </div>
    );
});

function CommentBoxView({
    box,
    ref,
    onText,
    onAdd,
    onCancel,
}: {
    box: CommentBox;
    ref: Ref<HTMLTextAreaElement>;
    onText: (text: string) => void;
    onAdd: () => void;
    onCancel: () => void;
}) {
    const blank = box.text.trim() === "";
    const ref0: LineComment = { ...box, id: "", quote: [], note: "" };
    return (
        <div
            data-review-box
            className={cn(
                BESIDE_CODE,
                "my-[8px] flex flex-col gap-2 rounded-[8px] border border-accent bg-surface-raised px-3 py-[10px] font-sans"
            )}
        >
            <span className={cn(META_TEXT, "font-mono")}>{commentRef(ref0)}</span>
            <textarea
                ref={ref}
                rows={3}
                autoFocus
                value={box.text}
                placeholder="Leave a comment"
                onChange={(e) => onText(e.target.value)}
                // the surface's Ctrl+Enter stands down in an editable target, so the box handles its own keys
                onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        onAdd();
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        onCancel();
                    }
                }}
                className="resize-none rounded-[7px] border border-edge-mid bg-background px-[9px] py-[7px] text-[13px] leading-[1.5] text-primary outline-none placeholder:text-muted focus:border-accent"
            />
            <div className="flex justify-end gap-2">
                <button type="button" onClick={onCancel} className={SECONDARY_BTN}>
                    Cancel
                </button>
                <button type="button" disabled={blank} onClick={onAdd} className={ACCENT_BTN}>
                    Add Comment
                </button>
            </div>
        </div>
    );
}

function CommentCard({
    comment,
    n,
    onEdit,
    onDelete,
}: {
    comment: LineComment;
    n: number;
    onEdit: () => void;
    onDelete: () => void;
}) {
    return (
        <div
            data-review-card={comment.id}
            className={cn(
                BESIDE_CODE,
                "my-[8px] flex flex-col gap-[6px] rounded-[8px] border border-edge-mid bg-surface-raised px-3 py-[10px] font-sans"
            )}
        >
            <div className="flex items-center gap-2">
                <span className={CHIP}>{n}</span>
                <span data-review-card-ref className={cn(META_TEXT, "min-w-0 truncate font-mono")}>
                    {commentRef(comment)}
                </span>
                <div className="flex-1" />
                <button
                    type="button"
                    data-review-card-delete
                    aria-label={`Delete comment ${n}`}
                    onClick={onDelete}
                    className="flex cursor-pointer p-[2px] text-muted hover:text-primary"
                >
                    <X size={13} strokeWidth={2} aria-hidden />
                </button>
            </div>
            <button
                type="button"
                data-review-card-note
                title="Edit"
                onClick={onEdit}
                className="cursor-text whitespace-pre-wrap text-left text-[13px] leading-[1.5] text-primary"
            >
                {comment.note}
            </button>
        </div>
    );
}

declare global {
    interface Window {
        // DEV: "slow" holds the next review patch load 3 s, "error" fails it; cleared after one load
        __lineReviewFault?: "slow" | "error";
    }
}
