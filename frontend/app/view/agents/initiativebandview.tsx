// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The initiative band under a linked agent's Chat header (docs/superpowers/specs/2026-11-14-chat-initiative-link-design.md):
// one line that says which initiative the agent works on, how far it is and which chunk the agent is on, and that opens in
// place, pushing the conversation down and never covering it, to the chunks around it, the latest note and the one
// action the band adds: moving the agent to another chunk (Work on this). It replaces the header's ◇ chip and its popover
// in Chat; the Terminal view keeps those. What it reads and decides is initiativeband.ts, and what it sends is
// initiativebandstore.ts and effortstore.ts; this file draws it and moves its cursor.
//
// The keys are the band's own while focus is in it (the root is data-owns-keys, so the dispatcher counts focus here as
// editable and every single-key binding stands down): m Mark done, n Add note, w Work on this, the arrows and Enter on
// the rows, Esc or i collapse and hand the keyboard back to the message box. The one global `i` (agent:initiative) opens
// the band's initiative part by toggleBandPart, and the band takes focus as it opens.

import { KeyCap } from "@/app/element/keycap";
import { springReveal } from "@/app/element/motiontokens";
import { SegmentBar } from "@/app/view/jarvis/briefrowviews";
import {
    appendChunkNote,
    effortDetailAtom,
    loadEffortDetail,
    renameChunk,
    setChunkStatus,
} from "@/app/view/jarvis/effortstore";
import { openOrPeek, openTarget } from "@/app/view/jarvis/openref";
import { chunkRef } from "@/app/view/jarvis/trackeredit";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { ChevronDown, Diamond } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { AgentsViewModel } from "./agents";
import { formatAgo, type AgentVM } from "./agentsviewmodel";
import { usePartMotion } from "./chatfooter";
import { focusChatBox } from "./chatinsert";
import { markChunkDone } from "./chatsuggeststore";
import {
    bandLabels,
    bandRows,
    firstWorkOn,
    holderTag,
    NARROW_BAND_PX,
    type BandHolder,
    type BandRow,
} from "./initiativeband";
import { setBandPart, switchAgentChunk, toggleBandPart, useBandPart } from "./initiativebandstore";
import { BTN, ChunkStatusMenu, CURSOR_RING, ROW, STATUS_TEXT } from "./initiativechunkmenu";
import {
    agentChunk,
    CHUNK_RENAME,
    chunkMenuItems,
    latestNoteEntry,
    popoverProgress,
    popoverStatus,
    stepRow,
} from "./initiativepopovermodel";
import { planEditChunks } from "./planreviewmodel";
import { useInitiativeReread, usePlanReview } from "./planreviewstore";
import { openRailSection } from "./railsection";

type List = "window" | "all";

// what the cursor moves over: the window's rows, the All chunks row, then the full list's rows while it is open
type Nav = { kind: "row"; row: BandRow; list: List } | { kind: "all" };

type Sub =
    | { kind: "menu"; label: string; list: List; at: number } // a chunk's status menu, `at` the menu's own cursor
    | { kind: "rename"; label: string; list: List; draft: string }
    | { kind: "note"; draft: string };

// the full list scrolls past this height (px)
const ALL_MAX_H = 240;

// a mouse press must not take focus off whatever has it: the band's keys live on its root
const keepFocus = (e: MouseEvent) => e.preventDefault();

const unique = <T,>(xs: readonly T[]): T[] => [...new Set(xs)];

export function InitiativeBand({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const { oref, effort, proposed } = usePlanReview(agent.effortId);
    // the band shows what the initiative is now: a card's write and the agent's own `wsh effort` land as the agent works
    useInitiativeReread(agent.effortId, agent.state, false);
    const open = useBandPart(agent.id) === "initiative";
    const rootRef = useRef<HTMLDivElement>(null);
    const [cursor, setCursor] = useState(0);
    const [allOpen, setAllOpen] = useState(false);
    const [sub, setSub] = useState<Sub | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [focused, setFocused] = useState(false);
    const [narrow, setNarrow] = useState(false);
    // the initiative cannot be read: deleted while this agent still names it
    const [gone, setGone] = useState(false);
    const missing = effort == null;
    useEffect(() => {
        if (missing) {
            loadEffortDetail(oref).catch(() => setGone(true));
        }
    }, [missing, oref]);

    const parentOref = effort?.parentoid ? "effort:" + effort.parentoid : null;
    const parent = useAtomValue(effortDetailAtom).get(parentOref ?? "");
    useEffect(() => {
        if (parentOref != null) {
            // the parent's title is decoration: a failed read leaves the plain link
            loadEffortDetail(parentOref).catch(() => {});
        }
    }, [parentOref]);

    const rows = useMemo(() => bandRows(effort ?? {}, agent.id), [effort, agent.id]);
    const nav = useMemo<Nav[]>(
        () => [
            ...rows.window.map((row): Nav => ({ kind: "row", row, list: "window" })),
            { kind: "all" },
            ...(allOpen ? rows.all.map((row): Nav => ({ kind: "row", row, list: "all" })) : []),
        ],
        [rows, allOpen]
    );
    const cur = Math.min(cursor, Math.max(0, nav.length - 1));
    const chunks = effort?.chunks ?? [];
    const plan = planEditChunks(chunks);
    // an all-digit label would be read as a position, so each call names a chunk the way chunkRef says
    const refOf = (label: string) => chunkRef(plan, label);
    const byLabel = (label: string) => chunks.find((c) => c.label === label);
    const mine = effort != null ? agentChunk(effort, agent.id) : null;
    const mineRow = rows.all.find((r) => r.kind === "mine");
    const note = latestNoteEntry(mine);

    // who holds the other chunks: the roster's names, read as one list so an unrelated agent's change redraws nothing
    const holderIds = useMemo(
        () =>
            unique(
                rows.all.flatMap((r) =>
                    r.holders.filter((h) => h.kind === "agent" && h.id !== agent.id).map((h: BandHolder) => h.id)
                )
            ).sort(),
        [rows, agent.id]
    );
    const names = useAtomValue(
        useMemo(
            () =>
                selectAtom(
                    model.agentsAtom,
                    (roster) => holderIds.map((id) => roster.find((a) => a.id === id)?.name),
                    (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
                ),
            [model, holderIds]
        )
    );
    const nameOf = (tabId: string) => names[holderIds.indexOf(tabId)];
    const tagOf = (row: BandRow): string => {
        if (row.kind === "mine") {
            return "this agent";
        }
        if (row.kind === "next") {
            return "next";
        }
        if (row.status === "done" || row.status === "skipped") {
            return row.status;
        }
        const others = unique(
            row.holders
                .filter((h) => !(h.kind === "agent" && h.id === agent.id))
                .map((h) => holderTag(h, agent.id, nameOf))
        );
        if (others.length > 0) {
            return others.join(", ");
        }
        return row.status === "pending" ? "" : row.status;
    };

    // the band's width, not the window's: it sits in a cell that may be a quarter of the screen. A cell that is not on
    // screen has no width, and keeps what it measured.
    useLayoutEffect(() => {
        const el = rootRef.current;
        if (el == null) {
            return;
        }
        const apply = (w: number) => {
            if (w > 0) {
                setNarrow(w < NARROW_BAND_PX);
            }
        };
        apply(el.getBoundingClientRect().width);
        const ro = new ResizeObserver((entries) => apply(entries[entries.length - 1].contentRect.width));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const focusRoot = () => {
        const root = rootRef.current;
        if (root != null && !root.contains(document.activeElement)) {
            root.focus({ preventScroll: true });
        }
    };
    // Opening takes the focus (a click, `i`, Pick a chunk…), so the keys below answer at once; collapsing hands it back to
    // the message box when the band held it. A band that starts open (remembered) takes nothing.
    const wasOpen = useRef(open);
    useEffect(() => {
        if (open && !wasOpen.current) {
            focusRoot();
        } else if (!open && wasOpen.current) {
            setSub(null);
            setError(null);
            const root = rootRef.current;
            if (root != null && root.contains(document.activeElement) && !focusChatBox(agent.id)) {
                (document.activeElement as HTMLElement).blur();
            }
        }
        wasOpen.current = open;
    }, [open]);

    // true when it went through; a failure leaves the band as it was and says why under the rows
    const run = async (send: () => Promise<void>): Promise<boolean> => {
        if (busyRef.current) {
            return false;
        }
        busyRef.current = true;
        setError(null);
        setBusy(true);
        try {
            await send();
            return true;
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return false;
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    };

    // the one Mark done Chat's initiative chip uses too (chatsuggeststore.ts): it carries the agent to the next chunk
    const markDone = () => {
        if (mine != null) {
            void run(() => markChunkDone(oref, mine.label, agent.id));
        }
    };
    const workOn = (label: string) => {
        void run(() => switchAgentChunk(oref, agent.id, label));
    };
    const pickStatus = (label: string, status: string) => {
        setSub(null);
        void run(() => setChunkStatus(oref, refOf(label), status));
    };
    const closeSub = () => {
        setSub(null);
        focusRoot();
    };
    const saveRename = () => {
        if (sub?.kind !== "rename") {
            return;
        }
        const next = sub.draft.trim();
        if (next === "" || next === sub.label) {
            closeSub();
            return;
        }
        void run(() => renameChunk(oref, plan, sub.label, next)).then((ok) => ok && closeSub());
    };
    const saveNote = () => {
        if (sub?.kind !== "note" || mine == null) {
            return;
        }
        const text = sub.draft.trim();
        if (text === "") {
            closeSub();
            return;
        }
        void run(() => appendChunkNote(oref, refOf(mine.label), text)).then((ok) => ok && closeSub());
    };
    const startNote = () => {
        if (mine == null) {
            return;
        }
        setBandPart(agent.id, "initiative");
        setSub({ kind: "note", draft: "" });
    };
    const toggleAll = () => setAllOpen((v) => !v);
    // a row opens its status / rename menu; the All chunks row opens or folds the full list
    const openAt = (index: number) => {
        const item = nav[index];
        if (item == null) {
            return;
        }
        setCursor(index);
        focusRoot();
        if (item.kind === "all") {
            toggleAll();
            return;
        }
        const items = chunkMenuItems(byLabel(item.row.label)?.status ?? "");
        setSub({
            kind: "menu",
            label: item.row.label,
            list: item.list,
            at: Math.max(
                0,
                items.findIndex((i) => i.current)
            ),
        });
    };
    const chooseMenu = (label: string, list: List, id: string) => {
        if (id === CHUNK_RENAME) {
            setSub({ kind: "rename", label, list, draft: label });
        } else {
            pickStatus(label, id);
        }
    };
    // Pick a chunk…: the band opens with the cursor on the first chunk that offers Work on this, in the window or else in
    // the full list, which opens for it
    const pick = () => {
        setBandPart(agent.id, "initiative");
        const inWindow = firstWorkOn(rows.window);
        if (inWindow >= 0) {
            setCursor(inWindow);
        } else {
            const inAll = firstWorkOn(rows.all);
            if (inAll >= 0) {
                setAllOpen(true);
                setCursor(rows.window.length + 1 + inAll);
            }
        }
        focusRoot();
    };
    const reviewOnRail = () => openRailSection(agent.id, "plan");
    const openInJarvis = (target: { kind: "effort"; effortId: string }, e?: MouseEvent) => {
        fireAndForget(() => (e != null ? openOrPeek(model, target, e) : openTarget(model, target)));
    };

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        // an input (rename, note) keeps its own typing, and a chord belongs to the app
        if (
            e.nativeEvent.isComposing ||
            e.ctrlKey ||
            e.metaKey ||
            e.altKey ||
            (e.target as HTMLElement).tagName === "INPUT"
        ) {
            return;
        }
        const handled = () => {
            e.preventDefault();
            e.stopPropagation();
        };
        if (sub?.kind === "menu") {
            const items = chunkMenuItems(byLabel(sub.label)?.status ?? "");
            if (e.key === "Escape") {
                handled();
                setSub(null);
            } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                handled();
                setSub({ ...sub, at: stepRow(items.length, sub.at, e.key === "ArrowDown" ? 1 : -1) });
            } else if (e.key === "Enter") {
                handled();
                chooseMenu(sub.label, sub.list, items[sub.at].id);
            }
            return;
        }
        if (e.key === "Escape" || e.key === "i") {
            handled();
            if (open) {
                setBandPart(agent.id, null);
            } else if (!focusChatBox(agent.id)) {
                (document.activeElement as HTMLElement | null)?.blur();
            }
        } else if (e.key === "m") {
            handled();
            markDone();
        } else if (e.key === "n") {
            handled();
            startNote();
        } else if (e.key === "w" && open) {
            const item = nav[cur];
            handled();
            if (item?.kind === "row" && item.row.workOn) {
                workOn(item.row.label);
            }
        } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && open) {
            handled();
            setCursor(stepRow(nav.length, cur, e.key === "ArrowDown" ? 1 : -1));
        } else if (e.key === "Enter" && e.target === e.currentTarget) {
            handled();
            if (open) {
                openAt(cur);
            } else {
                setBandPart(agent.id, "initiative");
            }
        }
    };

    const rowView = (row: BandRow, list: List, index: number) => {
        const label = row.label;
        const isMine = row.kind === "mine";
        const settled = row.status === "done" || row.status === "skipped";
        const isCur = focused && index === cur;
        const menuOpen = sub?.kind === "menu" && sub.label === label && sub.list === list ? sub : null;
        const renaming = sub?.kind === "rename" && sub.label === label && sub.list === list ? sub : null;
        const tag = tagOf(row);
        return (
            <div key={`${list}:${label}`} className="flex flex-col">
                <div
                    data-band-row={row.kind}
                    data-chunk-label={label}
                    aria-current={index === cur}
                    onMouseDown={keepFocus}
                    onClick={() => openAt(index)}
                    title="Set its status, or rename it"
                    className={cn(
                        ROW,
                        "group min-h-[28px]",
                        isMine ? "bg-surface-selected" : "hover:bg-surface-hover",
                        isCur && CURSOR_RING
                    )}
                >
                    <span
                        aria-hidden
                        className={cn(
                            "h-[8px] w-[8px] flex-none rounded-full",
                            isMine
                                ? "bg-working"
                                : row.status === "done"
                                  ? "bg-success/45"
                                  : "border-[1.5px] border-edge-strong"
                        )}
                    />
                    <span className="w-[18px] flex-none text-right font-mono text-[11px] text-muted">{row.n}</span>
                    {renaming != null ? (
                        <input
                            autoFocus
                            value={renaming.draft}
                            aria-label={`Rename ${label}`}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => setSub({ kind: "rename", label, list, draft: e.target.value })}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    saveRename();
                                } else if (e.key === "Escape") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    closeSub();
                                }
                            }}
                            onBlur={() => setSub((s) => (s?.kind === "rename" ? null : s))}
                            className="min-w-0 flex-1 rounded-[5px] border border-edge-strong bg-surface-code px-[6px] py-[2px] text-[12px] text-primary outline-none focus:border-accent"
                        />
                    ) : (
                        <span
                            title={label}
                            className={cn(
                                "min-w-0 flex-1 truncate text-[12.5px]",
                                settled ? "text-muted line-through" : isMine ? "text-ink-hi" : "text-secondary"
                            )}
                        >
                            {label}
                        </span>
                    )}
                    {/* the tag column: every row's tag ends at one edge, and Work on this takes the tag's place on hover and on
                        the cursor (the cell keeps the button's width, so the label never runs under it) */}
                    {renaming == null ? (
                        <span
                            className={cn(
                                "relative flex flex-none items-center justify-end",
                                row.workOn && "min-w-[88px]"
                            )}
                        >
                            {tag !== "" ? (
                                <span
                                    data-band-tag
                                    className={cn(
                                        "text-[10.5px] text-ink-mid",
                                        row.workOn && (isCur ? "invisible" : "group-hover:invisible")
                                    )}
                                >
                                    {tag}
                                </span>
                            ) : null}
                            {row.workOn ? (
                                <button
                                    type="button"
                                    data-band-work-on
                                    disabled={busy}
                                    onMouseDown={keepFocus}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        workOn(label);
                                    }}
                                    title={`Move this agent to “${label}” (w)`}
                                    className={cn(
                                        BTN,
                                        "absolute right-0 top-1/2 h-[22px] -translate-y-1/2 px-[8px] text-[11px] opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
                                        isCur && "opacity-100"
                                    )}
                                >
                                    Work on this
                                </button>
                            ) : null}
                        </span>
                    ) : null}
                </div>
                {menuOpen != null ? (
                    <ChunkStatusMenu
                        status={byLabel(label)?.status ?? ""}
                        at={menuOpen.at}
                        onHover={(i) => setSub({ ...menuOpen, at: i })}
                        onChoose={(id) => chooseMenu(label, list, id)}
                        dataAttr="data-band-menu"
                    />
                ) : null}
            </div>
        );
    };

    const status = effort != null ? popoverStatus(effort, agent.state) : null;
    const progress = effort != null ? popoverProgress(effort) : null;
    const labels = bandLabels(narrow);
    const bodyMotion = usePartMotion(springReveal);
    // Pick a chunk… is there only when some chunk offers Work on this, window or not
    const canPick = firstWorkOn(rows.all) >= 0;
    const allIndex = rows.window.length;
    const errorView =
        error != null ? (
            <div data-band-error role="alert" className="break-words text-[11px] text-error">
                {error}
            </div>
        ) : null;

    return (
        <div
            ref={rootRef}
            data-initiative-band={agent.id}
            data-band-open={open && effort != null ? "" : undefined}
            data-band-narrow={narrow ? "" : undefined}
            data-owns-keys
            tabIndex={-1}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setFocused(false);
                }
            }}
            className="flex-none border-b border-edge-mid bg-surface outline-none"
        >
            <div
                data-band-line
                onClick={effort != null ? () => toggleBandPart(agent.id, "initiative") : undefined}
                className={cn(
                    "flex h-[36px] items-center px-4",
                    narrow ? "gap-[8px] px-3" : "gap-[10px]",
                    effort != null && "cursor-pointer",
                    focused && !open && CURSOR_RING
                )}
            >
                <Diamond size={13} strokeWidth={1.8} aria-hidden className="flex-none text-accent-soft" />
                <span
                    data-band-title
                    title={effort?.title}
                    style={{ maxWidth: labels.titleMax }}
                    className={cn(
                        "min-w-0 truncate text-[12.5px] font-semibold",
                        effort != null ? "text-ink-hi" : "flex-1 font-normal text-muted"
                    )}
                >
                    {effort?.title ?? (gone ? "This initiative no longer exists." : "Loading the initiative…")}
                </span>
                {effort != null && progress != null ? (
                    <>
                        {labels.segments && progress.total > 0 ? (
                            <span data-band-segments className="flex w-[120px] flex-none">
                                <SegmentBar segments={progress.segments} className="w-full" />
                            </span>
                        ) : null}
                        <span
                            data-band-progress
                            className="flex-none text-[11.5px] font-semibold tabular-nums text-secondary"
                        >
                            {progress.done}/{progress.total}
                        </span>
                        {narrow ? null : <span aria-hidden className="h-[16px] w-px flex-none bg-edge-mid" />}
                        {mine != null && mineRow != null ? (
                            <span data-band-on className="flex min-w-0 flex-1 items-center gap-[6px]">
                                <span aria-hidden className="h-[8px] w-[8px] flex-none rounded-full bg-working" />
                                <span className="flex-none text-[12px] text-muted">On</span>{" "}
                                <span className="flex-none font-mono text-[11px] text-muted">{mineRow.n}</span>{" "}
                                <span title={mine.label} className="min-w-0 truncate text-[12.5px] text-ink-hi">
                                    {mine.label}
                                </span>
                            </span>
                        ) : (
                            <span
                                data-band-on
                                className="flex min-w-0 flex-1 items-center gap-[6px] text-[12.5px] text-muted"
                            >
                                <span
                                    aria-hidden
                                    className="h-[8px] w-[8px] flex-none rounded-full border-[1.5px] border-dashed border-muted"
                                />
                                <span className="min-w-0 truncate">No chunk for this agent</span>
                            </span>
                        )}
                        {mine == null && canPick ? (
                            <button
                                type="button"
                                data-band-pick
                                onMouseDown={keepFocus}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    pick();
                                }}
                                className={cn(BTN, "h-[24px]")}
                            >
                                Pick a chunk…
                            </button>
                        ) : null}
                        {mine != null ? (
                            <button
                                type="button"
                                data-band-mark-done
                                disabled={busy}
                                onMouseDown={keepFocus}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    markDone();
                                }}
                                title="Mark done and move on to the next chunk (m)"
                                className={cn(BTN, "h-[24px]", narrow && "px-[7px] text-[11px]")}
                            >
                                {labels.markDone}
                                {narrow ? null : (
                                    <kbd className="font-mono text-[10px] font-normal text-ink-mid">m</kbd>
                                )}
                            </button>
                        ) : null}
                        <button
                            type="button"
                            data-band-toggle
                            aria-expanded={open}
                            aria-label={open ? "Collapse the initiative" : "Expand the initiative"}
                            onMouseDown={keepFocus}
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleBandPart(agent.id, "initiative");
                            }}
                            className="flex size-[22px] flex-none cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent p-0 text-muted hover:text-primary"
                        >
                            <ChevronDown
                                size={14}
                                strokeWidth={1.8}
                                aria-hidden
                                className={cn(
                                    "transition-transform motion-reduce:transition-none",
                                    open && "rotate-180"
                                )}
                            />
                        </button>
                    </>
                ) : null}
            </div>
            {!open && errorView != null ? <div className="px-4 pb-[8px]">{errorView}</div> : null}
            <AnimatePresence initial={false}>
                {open && effort != null && status != null ? (
                    <motion.div key="body" {...bodyMotion} className="overflow-hidden">
                        <div
                            className={cn(
                                "grid gap-x-6 gap-y-3 border-t border-edge-mid pb-4 pr-4 pt-[14px]",
                                narrow ? "grid-cols-1 pl-4" : "grid-cols-2 pl-[39px]"
                            )}
                        >
                            <div className="flex min-w-0 flex-col gap-[2px]">
                                <div className="mb-[4px] flex flex-wrap items-baseline gap-x-[5px] text-[11px] text-muted">
                                    {parentOref != null && parent != null ? (
                                        <>
                                            <button
                                                type="button"
                                                data-band-parent
                                                onMouseDown={keepFocus}
                                                onClick={(e) =>
                                                    openInJarvis({ kind: "effort", effortId: effort.parentoid! }, e)
                                                }
                                                title={`Open ${parent.title} in Jarvis`}
                                                className="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-[11px] text-accent-soft hover:underline"
                                            >
                                                <span className="text-ink-mid">↳ Part of </span>
                                                {parent.title}
                                            </button>
                                            <span aria-hidden>·</span>
                                        </>
                                    ) : null}
                                    <span>{effort.project || "no project"}</span>
                                    <span aria-hidden>·</span>
                                    <span className={cn("font-semibold", STATUS_TEXT[status.tone])}>{status.text}</span>
                                </div>
                                {rows.window.map((r, i) => rowView(r, "window", i))}
                                {rows.total > 0 ? (
                                    <div
                                        data-band-all
                                        role="button"
                                        tabIndex={-1}
                                        aria-expanded={allOpen}
                                        aria-current={allIndex === cur}
                                        onMouseDown={keepFocus}
                                        onClick={() => openAt(allIndex)}
                                        className={cn(
                                            ROW,
                                            "text-[11.5px] text-muted hover:bg-surface-hover hover:text-primary",
                                            focused && allIndex === cur && CURSOR_RING
                                        )}
                                    >
                                        <ChevronDown
                                            size={12}
                                            strokeWidth={1.8}
                                            aria-hidden
                                            className={cn(
                                                "flex-none transition-transform motion-reduce:transition-none",
                                                allOpen && "rotate-180"
                                            )}
                                        />
                                        All chunks ({rows.total})
                                    </div>
                                ) : null}
                                {allOpen ? (
                                    <div
                                        data-band-all-list
                                        style={{ maxHeight: ALL_MAX_H }}
                                        // the rows reach 8px past their column (-mx), which the scroller holds as padding so
                                        // it grows no horizontal bar
                                        className="-mx-[8px] flex flex-col gap-[2px] overflow-y-auto px-[8px]"
                                    >
                                        {rows.all.map((r, i) => rowView(r, "all", allIndex + 1 + i))}
                                    </div>
                                ) : null}
                                {proposed > 0 ? (
                                    <button
                                        type="button"
                                        data-band-review
                                        onMouseDown={keepFocus}
                                        onClick={reviewOnRail}
                                        className="mt-[4px] flex cursor-pointer items-center gap-[6px] self-start border-0 bg-transparent p-0 text-[11.5px] text-asking hover:underline"
                                    >
                                        <span
                                            aria-hidden
                                            className="h-[8px] w-[8px] rounded-full border-[1.5px] border-dashed border-asking"
                                        />
                                        {proposed} proposed · Review on the rail
                                    </button>
                                ) : null}
                                {errorView != null ? <div className="mt-[4px]">{errorView}</div> : null}
                            </div>
                            <div className="flex min-w-0 flex-col gap-[10px]">
                                <div className="text-[11px] text-muted">
                                    {mine != null && mineRow != null
                                        ? note != null
                                            ? `Latest note on ${mineRow.n} · ${formatAgo(Date.now() - note.ts)}`
                                            : `No note on ${mineRow.n} yet`
                                        : "Notes go on the chunk this agent is on."}
                                </div>
                                {note != null ? (
                                    <div
                                        data-band-note
                                        className="line-clamp-4 break-words rounded-[8px] bg-background px-[10px] py-[8px] text-[12px] leading-[1.5] text-secondary"
                                    >
                                        {note.text}
                                    </div>
                                ) : null}
                                <div className="flex flex-wrap items-center gap-[6px]">
                                    {sub?.kind === "note" ? (
                                        <input
                                            autoFocus
                                            value={sub.draft}
                                            aria-label={`Add a note to ${mine?.label ?? "the chunk"}`}
                                            placeholder={`Note on ${mine?.label ?? "the chunk"}`}
                                            onChange={(e) => setSub({ kind: "note", draft: e.target.value })}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    saveNote();
                                                } else if (e.key === "Escape") {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    closeSub();
                                                }
                                            }}
                                            onBlur={() => setSub((s) => (s?.kind === "note" ? null : s))}
                                            className="h-[26px] min-w-0 flex-1 rounded-[7px] border border-edge-strong bg-surface-code px-[9px] text-[11.5px] text-primary outline-none placeholder:text-ink-faint focus:border-accent"
                                        />
                                    ) : (
                                        <>
                                            <button
                                                type="button"
                                                data-band-add-note
                                                onMouseDown={keepFocus}
                                                onClick={() => {
                                                    focusRoot();
                                                    startNote();
                                                }}
                                                disabled={mine == null}
                                                title={
                                                    mine == null
                                                        ? "This agent is on no chunk"
                                                        : `Add a note to ${mine.label} (n)`
                                                }
                                                className={BTN}
                                            >
                                                Add note
                                                <kbd className="font-mono text-[10px] font-normal text-ink-mid">n</kbd>
                                            </button>
                                            <button
                                                type="button"
                                                data-band-open-jarvis
                                                onMouseDown={keepFocus}
                                                onClick={() =>
                                                    openInJarvis({ kind: "effort", effortId: agent.effortId! })
                                                }
                                                className={BTN}
                                            >
                                                Open in Jarvis ↗
                                            </button>
                                            <span className="flex-1" />
                                            <KeyCap
                                                chord="Escape"
                                                variant="inline"
                                                className="text-[10.5px] text-ink-mid"
                                            />
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </div>
    );
}
