// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The initiative part of the Chat band under an agent's header (docs/superpowers/specs/2026-11-14-chat-initiative-link-design.md):
// one line that says which initiative the agent works on, how far it is and which chunk the agent is on, and that opens in
// place, pushing the conversation down and never covering it, to the chunks around it, the latest note and the one
// action the band adds: moving the agent to another chunk (Work on this). It replaces the header's ◇ chip and its popover
// in Chat; the Terminal view keeps those. What it reads and decides is initiativeband.ts, and what it sends is
// initiativebandstore.ts and effortstore.ts; this file draws it and moves its cursor.
//
// The band's root is chatband.tsx, which also holds the brainstorm part (brainstormbandview.tsx) and places the pieces
// this hook returns: the part's line, its expanded view, and its keys. The root is data-owns-keys, so the dispatcher counts
// focus in the band as editable and every single-key binding stands down; the root's key handler calls these: m Mark done,
// n Add note, w Work on this, the arrows and Enter on the rows (while this part is open), and, while a chunk's status menu
// is open, the menu's own keys. The one global `i` (agent:initiative) opens this part by toggleBandPart.

import { KeyCap } from "@/app/element/keycap";
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
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import type { AgentsViewModel } from "./agents";
import { formatAgo, type AgentVM } from "./agentsviewmodel";
import { markChunkDone } from "./chatsuggeststore";
import { bandLabels, bandRows, firstWorkOn, holderTag, type BandHolder, type BandRow } from "./initiativeband";
import {
    dismissBandHint,
    setBandPart,
    showBandHint,
    switchAndTell,
    toggleBandPart,
    useBandHint,
    type BandPart,
} from "./initiativebandstore";
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

// the band's how-to, over its rows until Got it (initiativebandstore.ts useBandHint); ? on the line shows it again
const HINT_STEPS = [
    "This agent works on the highlighted chunk. The line above always says which one.",
    "When it is finished, press Mark done (m). The agent moves on to the next chunk.",
    "To move it, hover another chunk and press Switch to this chunk (w). The agent is told at once.",
];

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

/** What the band's root places of the initiative part. Every field is inert (`active` false, nothing drawn) for an agent
 *  that has no initiative, so the root calls the hook for every agent and the hook's own state stays put. */
export type InitiativePart = {
    /** the agent has an initiative */
    active: boolean;
    /** this part is the expanded one */
    open: boolean;
    /** the part's line: the ◇, the title, how far it is, the chunk the agent is on, Pick a chunk… / Mark done, the chevron */
    line: ReactNode;
    /** the expanded view; null while it is collapsed or the initiative is not loaded */
    body: ReactNode;
    /** a failed write, shown under the line while the part is collapsed (the expanded view holds its own) */
    error: ReactNode;
    /** a chunk's status menu is open: it owns the arrows, Enter and Esc, and the root passes every key to `menuKey` */
    menuOpen: boolean;
    menuKey: (e: KeyboardEvent<HTMLDivElement>, handled: () => void) => void;
    /** `w`, the arrows and Enter on the rows; true when the key was one of them (and `handled` was called). Called only
     *  while this part is open. */
    rowKey: (e: KeyboardEvent<HTMLDivElement>, handled: () => void) => boolean;
    markDone: () => void;
    startNote: () => void;
};

type InitiativePartArgs = {
    model: AgentsViewModel;
    agent: AgentVM;
    /** which part of the band is expanded */
    part: BandPart | null;
    /** the band is narrow (a cell under NARROW_BAND_PX) */
    narrow: boolean;
    /** the band's root has focus inside it */
    focused: boolean;
    /** a brainstorm part is drawn beside this one */
    brainstormBeside: boolean;
    /** takes the keyboard into the band's root, unless it is in it already */
    focusRoot: () => void;
};

export function useInitiativePart({
    model,
    agent,
    part,
    narrow,
    focused,
    brainstormBeside,
    focusRoot,
}: InitiativePartArgs): InitiativePart {
    const active = agent.effortId != null;
    const { oref, effort, proposed } = usePlanReview(agent.effortId);
    // the band shows what the initiative is now: a card's write and the agent's own `wsh effort` land as the agent works
    useInitiativeReread(agent.effortId, agent.state, false);
    const open = active && part === "initiative";
    const hint = useBandHint();
    const [cursor, setCursor] = useState(0);
    const [allOpen, setAllOpen] = useState(false);
    const [sub, setSub] = useState<Sub | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    // the initiative cannot be read: deleted while this agent still names it
    const [gone, setGone] = useState(false);
    const missing = active && effort == null;
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

    // Leaving this part (collapsed, or the brainstorm part opened over it) drops a half-done menu, rename or note and the
    // error under the rows. Taking the focus as a part opens, and handing it back to the message box when the band closes
    // for good, are the root's (chatband.tsx).
    const wasOpen = useRef(open);
    useEffect(() => {
        if (!open && wasOpen.current) {
            setSub(null);
            setError(null);
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
    // Switch to this chunk: the agent is told at once when its box is empty (switchAndTell); a draft takes the line along
    const workOn = (label: string) => {
        void run(() => switchAndTell(oref, agent.id, label, agent.sleeping == null));
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

    // while a chunk's status menu is open it owns Esc, the arrows and Enter, and every other key does nothing
    const menuKey = (e: KeyboardEvent<HTMLDivElement>, handled: () => void) => {
        if (sub?.kind !== "menu") {
            return;
        }
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
    };
    // the keys of the open rows: w Work on this, the arrows, and Enter on the root itself
    const rowKey = (e: KeyboardEvent<HTMLDivElement>, handled: () => void): boolean => {
        if (e.key === "w") {
            const item = nav[cur];
            handled();
            if (item?.kind === "row" && item.row.workOn) {
                workOn(item.row.label);
            }
            return true;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            handled();
            setCursor(stepRow(nav.length, cur, e.key === "ArrowDown" ? 1 : -1));
            return true;
        }
        if (e.key === "Enter" && e.target === e.currentTarget) {
            handled();
            openAt(cur);
            return true;
        }
        return false;
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
                                row.workOn && "min-w-[132px]"
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
                                    title={`Move this agent to “${label}” and tell it now (w)`}
                                    className={cn(
                                        BTN,
                                        "absolute right-0 top-1/2 h-[22px] -translate-y-1/2 px-[8px] text-[11px] opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
                                        isCur && "opacity-100"
                                    )}
                                >
                                    Switch to this chunk
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
    const labels = bandLabels(narrow, brainstormBeside);
    // Pick a chunk… is there only when some chunk offers Work on this, window or not
    const canPick = firstWorkOn(rows.all) >= 0;
    const allIndex = rows.window.length;
    const errorView =
        error != null ? (
            <div data-band-error role="alert" className="break-words text-[11px] text-error">
                {error}
            </div>
        ) : null;
    // Mark done sits on the line for an initiative-only band; beside a brainstorm part it leaves the line for room (the `m`
    // key stays) and is in the expanded view instead
    const markDoneButton =
        mine != null ? (
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
                {narrow ? null : <kbd className="font-mono text-[10px] font-normal text-ink-mid">m</kbd>}
            </button>
        ) : null;

    const line = (
        <div
            data-band-line
            onClick={effort != null ? () => toggleBandPart(agent.id, "initiative") : undefined}
            className={cn(
                "flex h-[36px] min-w-0 items-center",
                brainstormBeside ? "flex-[0_1_380px]" : "flex-1",
                narrow ? "gap-[8px] px-3" : "gap-[10px] px-4",
                effort != null && "cursor-pointer"
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
                        <span
                            data-band-segments
                            className={cn("flex flex-none", brainstormBeside ? "w-[64px]" : "w-[120px]")}
                        >
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
                            {labels.chunkLabel ? (
                                <span title={mine.label} className="min-w-0 truncate text-[12.5px] text-ink-hi">
                                    {mine.label}
                                </span>
                            ) : null}
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
                    {brainstormBeside ? null : markDoneButton}
                    {narrow ? null : (
                        <button
                            type="button"
                            data-band-help
                            aria-label="How the band works"
                            title="How the band works"
                            onMouseDown={keepFocus}
                            onClick={(e) => {
                                e.stopPropagation();
                                showBandHint();
                                setBandPart(agent.id, "initiative");
                            }}
                            className="flex size-[22px] flex-none cursor-pointer items-center justify-center rounded-[6px] border border-edge-mid bg-transparent p-0 text-[11.5px] font-semibold text-muted hover:text-primary"
                        >
                            ?
                        </button>
                    )}
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
                            className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")}
                        />
                    </button>
                </>
            ) : null}
        </div>
    );

    const hintView = hint ? (
        <div className={cn("border-t border-edge-mid pr-4 pt-[14px]", narrow ? "pl-4" : "pl-[39px]")}>
            <div
                data-band-hint
                className="flex items-start gap-4 rounded-[10px] border border-edge-strong bg-background px-[14px] py-3"
            >
                <ol className={cn("m-0 grid flex-1 list-none gap-4 p-0", narrow ? "grid-cols-1" : "grid-cols-3")}>
                    {HINT_STEPS.map((text, i) => (
                        <li key={i} className="flex items-start gap-[9px]">
                            <span className="flex size-5 flex-none items-center justify-center rounded-full border border-edge-strong text-[11px] font-semibold text-ink-mid">
                                {i + 1}
                            </span>
                            <span className="text-[12.5px] leading-[1.5] text-secondary">{text}</span>
                        </li>
                    ))}
                </ol>
                <button
                    type="button"
                    data-band-hint-dismiss
                    onMouseDown={keepFocus}
                    onClick={(e) => {
                        e.stopPropagation();
                        dismissBandHint();
                        focusRoot();
                    }}
                    className={cn(BTN, "h-[26px] flex-none")}
                >
                    Got it
                </button>
            </div>
        </div>
    ) : null;

    const body =
        open && effort != null && status != null ? (
            <>
                {hintView}
                <div
                    className={cn(
                        "grid gap-x-6 gap-y-3 pb-4 pr-4 pt-[14px]",
                        hint ? "" : "border-t border-edge-mid",
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
                                        onClick={() => openInJarvis({ kind: "effort", effortId: agent.effortId! })}
                                        className={BTN}
                                    >
                                        Open in Jarvis ↗
                                    </button>
                                    {brainstormBeside ? markDoneButton : null}
                                    <span className="flex-1" />
                                    <KeyCap chord="Escape" variant="inline" className="text-[10.5px] text-ink-mid" />
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </>
        ) : null;

    return {
        active,
        open,
        line: active ? line : null,
        body,
        error: !open && errorView != null ? <div className="px-4 pb-[8px]">{errorView}</div> : null,
        menuOpen: sub?.kind === "menu",
        menuKey,
        rowKey,
        markDone,
        startNote,
    };
}
