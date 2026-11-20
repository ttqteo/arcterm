// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent panel's Initiative tab: the agent's linked initiative, drawn from the pieces the Chat band's initiative part
// had (docs/superpowers/specs/2026-11-20-agent-rail-brainstorm-initiative-tabs-design.md, board B-initiative-tab). A head
// with the facts the band's line carried (title, progress, the chunk the agent is on, Mark done), then three sections that
// each fold on their header: Chunks (the band's window of rows, each with its status / rename menu and Work on this),
// Plan to review (planreviewsection.tsx, moved here from Overview) and the latest note on the agent's chunk. What it reads
// and decides is initiativeband.ts and railinitiative.ts; the writes are effortstore.ts, chatsuggeststore.ts (Mark done) and
// initiativebandstore.ts (the chunk switch); this file draws it and moves its cursor.
//
// The root is data-owns-keys, so the dispatcher counts focus in it as editable and every single-key binding stands down; its
// handler answers instead: m Mark done, n Add note, w Work on this, the arrows and Enter on the rows, a chunk's status menu
// keys while it is open, `i` back to the tab before this one, Esc back to the message box. Opened by the ◇ chip, `i` or the
// header's "N to review" chip, the tab takes focus (railInitiativeFocusAtom), so those keys work at once; the last of them
// also asks for Plan to review (railInitiativeSectionAtom), which the pane unfolds and scrolls into view.

import { HeadedSection } from "@/app/element/collapsiblerail";
import { KeyCap } from "@/app/element/keycap";
import { railSectionOpenAtom, sectionOpen, type RailSectionHeader } from "@/app/element/railsections";
import { globalStore } from "@/app/store/jotaiStore";
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
import { ChevronDown, ClipboardCheck, ListChecks, StickyNote } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { railInitiativeFocusAtom, railInitiativeSectionAtom, toggleRailInitiative } from "./agentrailstore";
import type { AgentsViewModel } from "./agents";
import { formatAgo, type AgentVM } from "./agentsviewmodel";
import { cellInputOf } from "./cellinput";
import { focusChatBox } from "./chatinsert";
import { markChunkDone } from "./chatsuggeststore";
import { bandRows, firstWorkOn, type BandRow } from "./initiativeband";
import { switchAndTell } from "./initiativebandstore";
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
import { PlanReviewSection } from "./planreviewsection";
import { usePlanReview } from "./planreviewstore";
import { initiativePaneState, noteHeading, paneNav, pickTarget, rowTag, type PaneList } from "./railinitiative";
import { focusSubagentAtom } from "./subagentsstore";

const CHUNKS_ID = "initiative-chunks";
const PLAN_ID = "initiative-plan";
const NOTE_ID = "initiative-note";

type Sub =
    | { kind: "menu"; label: string; list: PaneList; at: number } // a chunk's status menu, `at` the menu's own cursor
    | { kind: "rename"; label: string; list: PaneList; draft: string }
    | { kind: "note"; draft: string };

// a mouse press must not take focus off whatever has it: the pane's keys live on its root
const keepFocus = (e: MouseEvent) => e.preventDefault();

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const unique = <T,>(xs: readonly T[]): T[] => [...new Set(xs)];

/** The keyboard goes back to the agent's cell: its message box, else (in Terminal) its terminal, else nowhere. */
function focusCell(agentId: string): void {
    if (focusChatBox(agentId)) {
        return;
    }
    const input = cellInputOf(document, agentId);
    if (input != null) {
        input.focus({ preventScroll: true });
    } else {
        (document.activeElement as HTMLElement | null)?.blur();
    }
}

const unfold = (id: string) => globalStore.set(railSectionOpenAtom, (prev) => ({ ...prev, [id]: true }));

export function RailInitiativePane({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    // one pane per agent: the cursor, an open menu and a half-typed note are that agent's, not the next one's
    return <InitiativePane key={agent.id} model={model} agent={agent} />;
}

function InitiativeSection({
    id,
    icon,
    label,
    header,
    countClassName,
    children,
}: {
    id: string;
    icon: ReactNode;
    label: string;
    header: RailSectionHeader;
    countClassName?: string;
    children: ReactNode;
}) {
    return (
        <div data-rail-initiative-section={id} className="border-t border-edge-faint first:border-t-0">
            <HeadedSection section={{ id, icon, label, header, countClassName, content: children }} header={header} />
        </div>
    );
}

function InitiativePane({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const { oref, effort, rows: planRows, proposed } = usePlanReview(agent.effortId);
    const inSubagent = useAtomValue(focusSubagentAtom)?.parentId === agent.id;
    const stored = useAtomValue(railSectionOpenAtom);
    const rootRef = useRef<HTMLDivElement>(null);
    const [focused, setFocused] = useState(false);
    const [cursor, setCursor] = useState(0);
    const [allOpen, setAllOpen] = useState(false);
    const [sub, setSub] = useState<Sub | null>(null);
    // a failed write (Mark done, a chunk switch, a status, a rename, a note), under the head
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    // the initiative cannot be read: its message, and Retry
    const [loadError, setLoadError] = useState<string | null>(null);

    const loaded = effort != null;
    const load = () => {
        setLoadError(null);
        loadEffortDetail(oref).catch((e) => setLoadError(messageOf(e)));
    };
    useEffect(() => {
        // the rail re-reads the initiative as the agent works (useInitiativeReread, agentdetailsrail.tsx); this is the
        // first read, for an agent whose initiative nothing has cached
        if (!loaded && oref !== "") {
            load();
        }
    }, [loaded, oref]);

    const parentOref = effort?.parentoid ? "effort:" + effort.parentoid : null;
    const parent = useAtomValue(effortDetailAtom).get(parentOref ?? "");
    useEffect(() => {
        if (parentOref != null) {
            // the parent's title is decoration: a failed read leaves the plain link
            loadEffortDetail(parentOref).catch(() => {});
        }
    }, [parentOref]);

    const rows = useMemo(() => bandRows(effort ?? {}, agent.id), [effort, agent.id]);
    const nav = useMemo(() => paneNav(rows, allOpen), [rows, allOpen]);
    const cur = Math.min(cursor, Math.max(0, nav.length - 1));
    const chunks = effort?.chunks ?? [];
    const plan = planEditChunks(chunks);
    // an all-digit label would be read as a position, so each call names a chunk the way chunkRef says
    const refOf = (label: string) => chunkRef(plan, label);
    const byLabel = (label: string) => chunks.find((c) => c.label === label);
    const mine = effort != null ? agentChunk(effort, agent.id) : null;
    const mineRow = rows.all.find((r) => r.kind === "mine");
    const note = latestNoteEntry(mine);
    const state = initiativePaneState({ loaded, failed: loadError != null, onChunk: mine != null });

    // who holds the other chunks: the roster's names, read as one list so an unrelated agent's change redraws nothing
    const holderIds = useMemo(
        () =>
            unique(
                rows.all.flatMap((r) =>
                    r.holders.filter((h) => h.kind === "agent" && h.id !== agent.id).map((h) => h.id)
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

    // the rows answer the keys only while Chunks is unfolded: a folded section has no rows on screen
    const chunksHeader: RailSectionHeader = { count: rows.total };
    const chunksOpen = sectionOpen(stored, CHUNKS_ID, chunksHeader);

    const focusRoot = () => {
        const root = rootRef.current;
        if (root != null && !root.contains(document.activeElement)) {
            root.focus({ preventScroll: true });
        }
    };
    const scrollToCursor = () =>
        requestAnimationFrame(() =>
            rootRef.current
                ?.querySelector(
                    '[data-rail-initiative-row][aria-current="true"], [data-rail-initiative-all][aria-current="true"]'
                )
                ?.scrollIntoView({ block: "nearest" })
        );

    // Opened from outside (the ◇ chip, `i`, "N to review"): the tab takes the keyboard once it shows, so its keys work at
    // once, and clears the request
    const focusReq = useAtomValue(railInitiativeFocusAtom);
    useEffect(() => {
        if (focusReq === agent.id) {
            focusRoot();
            globalStore.set(railInitiativeFocusAtom, null);
        }
    }, [focusReq, agent.id]);
    // "N to review": Plan to review unfolded and in view, once the initiative is on screen to hold it
    const sectionReq = useAtomValue(railInitiativeSectionAtom)[agent.id];
    useEffect(() => {
        if (sectionReq == null || (!loaded && loadError == null)) {
            return;
        }
        if (sectionReq === "plan") {
            unfold(PLAN_ID);
            requestAnimationFrame(() =>
                rootRef.current
                    ?.querySelector(`[data-rail-initiative-section="${PLAN_ID}"]`)
                    ?.scrollIntoView({ block: "nearest" })
            );
        }
        globalStore.set(railInitiativeSectionAtom, (prev) => {
            const { [agent.id]: _done, ...rest } = prev;
            return rest;
        });
    }, [sectionReq, agent.id, loaded, loadError]);

    // true when it went through; a failure leaves the pane as it was and says why under the head
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
            setError(messageOf(e));
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
    // Work on this: the agent is told at once when its box is empty (switchAndTell); a draft takes the line along
    const workOn = (label: string) => {
        void run(() => switchAndTell(oref, agent.id, label, agent.sleeping == null));
    };
    const pickStatus = (label: string, status: string) => {
        setSub(null);
        void run(() => setChunkStatus(oref, refOf(label), status));
    };
    // closing a rename or a note: the keyboard goes to the root before the input unmounts, else it would fall to <body>
    const closeSub = () => {
        setSub(null);
        rootRef.current?.focus({ preventScroll: true });
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
        unfold(NOTE_ID);
        setSub({ kind: "note", draft: "" });
    };
    // a row opens its status / rename menu; the All chunks row opens or folds the full list
    const openAt = (index: number) => {
        const item = nav[index];
        if (item == null) {
            return;
        }
        setCursor(index);
        focusRoot();
        if (item.kind === "all") {
            setAllOpen((v) => !v);
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
    const chooseMenu = (label: string, list: PaneList, id: string) => {
        if (id === CHUNK_RENAME) {
            setSub({ kind: "rename", label, list, draft: label });
        } else {
            pickStatus(label, id);
        }
    };
    // Pick a chunk…: Chunks unfolds with the cursor on the first chunk that offers Work on this, in the window or else in
    // the full list, which opens for it
    const pick = () => {
        const target = pickTarget(rows);
        unfold(CHUNKS_ID);
        if (target != null) {
            setAllOpen(target.allOpen);
            setCursor(target.cursor);
            scrollToCursor();
        }
        focusRoot();
    };
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
    // the keys of the rows: w Work on this, the arrows, and Enter on the root itself; true when the key was one of them
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
            scrollToCursor();
            return true;
        }
        if (e.key === "Enter" && e.target === e.currentTarget) {
            handled();
            openAt(cur);
            return true;
        }
        return false;
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
            menuKey(e, handled);
            return;
        }
        if (e.key === "Escape") {
            handled();
            if (!focusChatBox(agent.id)) {
                (document.activeElement as HTMLElement | null)?.blur();
            }
        } else if (e.key === "i") {
            // back to the tab before this one, the keyboard to the agent's cell
            handled();
            toggleRailInitiative(agent.id);
            focusCell(agent.id);
        } else if (e.key === "m") {
            handled();
            markDone();
        } else if (e.key === "n") {
            handled();
            startNote();
        } else if (state !== "loading" && state !== "error" && chunksOpen && rowKey(e, handled)) {
            return;
        }
    };

    const rowView = (row: BandRow, list: PaneList, index: number) => {
        const label = row.label;
        const isMine = row.kind === "mine";
        const settled = row.status === "done" || row.status === "skipped";
        const isCur = focused && index === cur;
        const menuOpen = sub?.kind === "menu" && sub.label === label && sub.list === list ? sub : null;
        const renaming = sub?.kind === "rename" && sub.label === label && sub.list === list ? sub : null;
        const tag = rowTag(row, agent.id, nameOf);
        return (
            <div key={`${list}:${label}`} className="flex flex-col">
                <div
                    data-rail-initiative-row={label}
                    data-rail-initiative-row-kind={row.kind}
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
                    {/* the tag column: every row's tag ends at one edge, and Work on this takes the tag's place on hover and
                        on the cursor (the cell keeps the button's width, so the label never runs under it) */}
                    {renaming == null ? (
                        <span
                            className={cn(
                                "relative flex flex-none items-center justify-end",
                                row.workOn && "min-w-[104px]"
                            )}
                        >
                            {tag !== "" ? (
                                <span
                                    data-rail-initiative-tag
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
                                    data-rail-initiative-work-on
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
                                    Work on this
                                    <KeyCap
                                        chord="w"
                                        variant="inline"
                                        className="text-[10px] font-normal text-ink-mid"
                                    />
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
                        dataAttr="data-rail-initiative-menu"
                    />
                ) : null}
            </div>
        );
    };

    // the initiative is not on screen: loading, or unreadable with a Retry
    if (state === "loading" || state === "error") {
        return (
            <div
                ref={rootRef}
                data-rail-initiative={agent.id}
                data-owns-keys
                tabIndex={-1}
                onKeyDown={onKeyDown}
                className="flex min-h-0 flex-1 flex-col outline-none"
            >
                {state === "loading" ? (
                    <div data-rail-initiative-state="loading" className="px-3 py-3 text-[12px] text-muted">
                        Loading the initiative…
                    </div>
                ) : (
                    <div
                        data-rail-initiative-state="error"
                        role="alert"
                        className="flex flex-col items-start gap-[8px] px-3 py-3 text-[12px]"
                    >
                        <span className="text-error">This initiative could not be read.</span>
                        {loadError !== "" ? (
                            <span className="break-words text-[11px] text-muted">{loadError}</span>
                        ) : null}
                        <button type="button" data-rail-initiative-retry onClick={load} className={BTN}>
                            Retry
                        </button>
                    </div>
                )}
            </div>
        );
    }

    const initiative = effort!;
    const status = popoverStatus(initiative, agent.state);
    const progress = popoverProgress(initiative);
    // Pick a chunk… is there only when some chunk offers Work on this, window or not
    const canPick = firstWorkOn(rows.all) >= 0;
    const allIndex = rows.window.length;
    const noteHead = noteHeading(mineRow?.n ?? null, note != null ? Date.now() - note.ts : null);
    const planShown = !inSubagent && planRows.length > 0;

    return (
        <div
            ref={rootRef}
            data-rail-initiative={agent.id}
            data-owns-keys
            tabIndex={-1}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setFocused(false);
                }
            }}
            className="flex min-h-0 flex-1 flex-col outline-none"
        >
            <div
                data-rail-initiative-head
                className="flex flex-none flex-col gap-[6px] border-b border-edge-faint px-3 pb-[10px] pt-[10px]"
            >
                <div className="flex items-center gap-[6px]">
                    <span
                        data-rail-initiative-title
                        title={initiative.title}
                        className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-hi"
                    >
                        {initiative.title}
                    </span>
                    <button
                        type="button"
                        data-rail-initiative-open-jarvis
                        onMouseDown={keepFocus}
                        onClick={() => openInJarvis({ kind: "effort", effortId: agent.effortId! })}
                        className="flex-none cursor-pointer border-0 bg-transparent p-0 text-[11.5px] text-muted hover:text-secondary"
                    >
                        Open in Jarvis ↗
                    </button>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-[5px] text-[11px] text-muted">
                    {parentOref != null && parent != null ? (
                        <>
                            <button
                                type="button"
                                data-rail-initiative-parent
                                onMouseDown={keepFocus}
                                onClick={(e) => openInJarvis({ kind: "effort", effortId: initiative.parentoid! }, e)}
                                title={`Open ${parent.title} in Jarvis`}
                                className="min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-[11px] text-accent-soft hover:underline"
                            >
                                <span className="text-ink-mid">↳ Part of </span>
                                {parent.title}
                            </button>
                            <span aria-hidden>·</span>
                        </>
                    ) : null}
                    <span>{initiative.project || "no project"}</span>
                    <span aria-hidden>·</span>
                    <span className={cn("font-semibold", STATUS_TEXT[status.tone])}>{status.text}</span>
                </div>
                <div className="flex items-center gap-[8px]">
                    <span className="flex min-w-0 flex-1">
                        {progress.total > 0 ? <SegmentBar segments={progress.segments} className="w-full" /> : null}
                    </span>
                    <span
                        data-rail-initiative-progress
                        className="flex-none text-[11.5px] font-semibold tabular-nums text-secondary"
                    >
                        {progress.done}/{progress.total}
                    </span>
                </div>
                <div data-rail-initiative-on data-rail-initiative-state={state} className="flex items-center gap-[8px]">
                    {mine != null && mineRow != null ? (
                        <>
                            <span
                                title={mine.label}
                                className="flex min-w-0 flex-1 items-center gap-[6px] text-[12px] text-muted"
                            >
                                <span aria-hidden className="h-[8px] w-[8px] flex-none rounded-full bg-working" />
                                <span className="flex-none">On {mineRow.n} ·</span>
                                <span className="min-w-0 truncate text-[12.5px] text-ink-hi">{mine.label}</span>
                            </span>
                            <button
                                type="button"
                                data-rail-initiative-mark-done
                                disabled={busy}
                                onMouseDown={keepFocus}
                                onClick={markDone}
                                title="Mark done and move on to the next chunk (m)"
                                className={cn(BTN, "h-[24px] flex-none")}
                            >
                                Mark done
                                <KeyCap chord="m" variant="inline" className="text-[10px] font-normal text-ink-mid" />
                            </button>
                        </>
                    ) : (
                        <>
                            <span className="flex min-w-0 flex-1 items-center gap-[6px] text-[12px] text-muted">
                                <span
                                    aria-hidden
                                    className="h-[8px] w-[8px] flex-none rounded-full border-[1.5px] border-dashed border-muted"
                                />
                                <span className="min-w-0 truncate">No chunk for this agent</span>
                            </span>
                            {canPick ? (
                                <button
                                    type="button"
                                    data-rail-initiative-pick
                                    onMouseDown={keepFocus}
                                    onClick={pick}
                                    className={cn(BTN, "h-[24px] flex-none")}
                                >
                                    Pick a chunk…
                                </button>
                            ) : null}
                        </>
                    )}
                </div>
            </div>
            {error != null ? (
                <div
                    data-rail-initiative-error
                    role="alert"
                    className="flex-none break-words border-b border-edge-faint px-3 py-[6px] text-[11px] text-error"
                >
                    {error}
                </div>
            ) : null}
            <div data-rail-initiative-scroll className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3">
                <InitiativeSection
                    id={CHUNKS_ID}
                    icon={<ListChecks size={13} aria-hidden />}
                    label="Chunks"
                    header={chunksHeader}
                >
                    <div className="flex flex-col gap-[2px]">
                        {rows.window.map((r, i) => rowView(r, "window", i))}
                        {rows.total > 0 ? (
                            <div
                                data-rail-initiative-all
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
                            <div data-rail-initiative-all-list className="flex flex-col gap-[2px]">
                                {rows.all.map((r, i) => rowView(r, "all", allIndex + 1 + i))}
                            </div>
                        ) : null}
                    </div>
                </InitiativeSection>
                {planShown ? (
                    <InitiativeSection
                        id={PLAN_ID}
                        icon={<ClipboardCheck size={13} aria-hidden />}
                        label="Plan to review"
                        // a decided row stays for Undo after the last proposed one, so the section stays openable with no count
                        header={proposed > 0 ? { count: proposed } : {}}
                        countClassName="text-asking"
                    >
                        <PlanReviewSection key={agent.id} agent={agent} />
                    </InitiativeSection>
                ) : null}
                <InitiativeSection
                    id={NOTE_ID}
                    icon={<StickyNote size={13} aria-hidden />}
                    label={noteHead}
                    header={{}}
                >
                    <div className="flex flex-col gap-[8px]">
                        {mine == null || mineRow == null ? (
                            <div className="text-[11px] text-muted">Notes go on the chunk this agent is on.</div>
                        ) : note == null ? (
                            <div className="text-[11px] text-muted">No note on {mineRow.n} yet</div>
                        ) : null}
                        {note != null ? (
                            <div
                                data-rail-initiative-note
                                title={formatAgo(Date.now() - note.ts)}
                                className="line-clamp-6 break-words rounded-[8px] bg-background px-[10px] py-[8px] text-[12px] leading-[1.5] text-secondary"
                            >
                                {note.text}
                            </div>
                        ) : null}
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
                                className="h-[26px] min-w-0 rounded-[7px] border border-edge-strong bg-surface-code px-[9px] text-[11.5px] text-primary outline-none placeholder:text-ink-faint focus:border-accent"
                            />
                        ) : (
                            <div className="flex flex-wrap items-center gap-[6px]">
                                <button
                                    type="button"
                                    data-rail-initiative-add-note
                                    onMouseDown={keepFocus}
                                    onClick={() => {
                                        focusRoot();
                                        startNote();
                                    }}
                                    disabled={mine == null}
                                    title={
                                        mine == null ? "This agent is on no chunk" : `Add a note to ${mine.label} (n)`
                                    }
                                    className={BTN}
                                >
                                    Add note
                                    <KeyCap
                                        chord="n"
                                        variant="inline"
                                        className="text-[10px] font-normal text-ink-mid"
                                    />
                                </button>
                            </div>
                        )}
                    </div>
                </InitiativeSection>
            </div>
        </div>
    );
}
