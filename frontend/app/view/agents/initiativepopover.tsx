// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The initiative popover on the agent header: the initiative this agent works on, opened in place so the person does not
// leave the agent for Jarvis. The chunk the agent is on (Mark done, its latest note), the next two, the plan waiting for
// review, and Add note. Its keys (m, n, the arrows, Enter, Esc) are its own while it is open: the root is
// data-owns-keys, and the single-key Agent bindings yield to initiativePopoverAtom (bindings.ts).

import { KeyCap } from "@/app/element/keycap";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { globalStore } from "@/app/store/jotaiStore";
import { SegmentBar } from "@/app/view/jarvis/briefrowviews";
import {
    advanceChunk,
    appendChunkNote,
    effortDetailAtom,
    loadEffortDetail,
    renameChunk,
    setChunkStatus,
} from "@/app/view/jarvis/effortstore";
import { openOrPeek, openTarget } from "@/app/view/jarvis/openref";
import { chunkRef } from "@/app/view/jarvis/trackeredit";
import { cn, fireAndForget } from "@/util/util";
import {
    autoUpdate,
    flip,
    FloatingPortal,
    offset,
    shift,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { Check, Pencil } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { AgentsViewModel } from "./agents";
import { formatAgo, type AgentVM } from "./agentsviewmodel";
import {
    CHUNK_RENAME,
    chunkMenuItems,
    latestNoteEntry,
    popoverProgress,
    popoverRows,
    popoverStatus,
    stepRow,
    type PopoverStatusTone,
} from "./initiativepopovermodel";
import { planEditChunks } from "./planreviewmodel";
import { useInitiativeReread, usePlanReview } from "./planreviewstore";
import { openRailSection } from "./railsection";
import { SectionLabel } from "./sectionlabel";

// The agent whose initiative popover is open (its header's), else null. It is read by the key bindings: while it is set
// the popover owns the keys.
export const initiativePopoverAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

const STATUS_TEXT: Record<PopoverStatusTone, string> = {
    success: "text-success",
    working: "text-working",
    asking: "text-asking",
    muted: "text-ink-mid",
    faint: "text-ink-faint",
};

const BTN =
    "inline-flex h-[26px] cursor-pointer items-center gap-[6px] whitespace-nowrap rounded-[7px] border border-edge-mid bg-surface-raised px-[10px] text-[11.5px] font-semibold text-secondary hover:border-edge-strong hover:bg-surface-hover disabled:cursor-default disabled:opacity-50";
const ROW = "flex min-h-[26px] cursor-pointer items-center gap-[9px] rounded-[6px] px-[8px] -mx-[8px]";
const CURSOR_RING = "ring-1 ring-inset ring-accent/60";

type Sub =
    | { kind: "menu"; label: string; at: number } // a chunk's status menu, `at` the menu's own cursor
    | { kind: "rename"; label: string; draft: string }
    | { kind: "note"; draft: string };

function PopoverBody({
    model,
    agent,
    close,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    close: (restoreFocus?: boolean) => void;
}) {
    const { oref, effort, proposed } = usePlanReview(agent.effortId);
    // the popover shows what the initiative is now, and the header's chip reads it again as the agent works
    useInitiativeReread(agent.effortId, agent.state, false);
    const rootRef = useRef<HTMLDivElement>(null);
    const [cursor, setCursor] = useState(0);
    const [sub, setSub] = useState<Sub | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
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

    const rows = useMemo(() => popoverRows(effort ?? {}, agent.id), [effort, agent.id]);
    const cur = Math.min(cursor, Math.max(0, rows.length - 1));
    const chunks = effort?.chunks ?? [];
    const plan = planEditChunks(chunks);
    // an all-digit label would be read as a position, so each call names a chunk the way chunkRef says
    const refOf = (label: string) => chunkRef(plan, label);
    const byLabel = (label: string) => chunks.find((c) => c.label === label);
    const mine = rows[0]?.kind === "current" ? byLabel(rows[0].label) : undefined;
    const note = latestNoteEntry(mine);

    // focus is the popover's own, and it stays there when a menu or an input that held it goes away
    useEffect(() => {
        const root = rootRef.current;
        if (root != null && !root.contains(document.activeElement)) {
            root.focus({ preventScroll: true });
        }
    }, [sub, busy]);

    // true when it went through; a failure leaves the popover as it was and says why under the rows
    const run = async (send: () => Promise<void>): Promise<boolean> => {
        if (busy) {
            return false;
        }
        setError(null);
        setBusy(true);
        try {
            await send();
            return true;
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return false;
        } finally {
            setBusy(false);
        }
    };

    // From the active chunk it is `advance` (done, and the next one active). From any other chunk the agent is on it
    // marks that chunk done, and moves on only when nothing is active, since `advance` would finish another chunk.
    const markDone = () => {
        if (mine == null) {
            return;
        }
        void run(async () => {
            if (mine.status === "active") {
                await advanceChunk(oref);
                return;
            }
            await setChunkStatus(oref, refOf(mine.label), "done");
            const after = globalStore.get(effortDetailAtom).get(oref);
            if (!(after?.chunks ?? []).some((c) => c.status === "active")) {
                await advanceChunk(oref);
            }
        });
    };
    const pickStatus = (label: string, status: string) => {
        setSub(null);
        void run(() => setChunkStatus(oref, refOf(label), status));
    };
    const saveRename = () => {
        if (sub?.kind !== "rename") {
            return;
        }
        const next = sub.draft.trim();
        if (next === "" || next === sub.label) {
            setSub(null);
            return;
        }
        void run(() => renameChunk(oref, plan, sub.label, next)).then((ok) => ok && setSub(null));
    };
    const saveNote = () => {
        if (sub?.kind !== "note" || mine == null) {
            return;
        }
        const text = sub.draft.trim();
        if (text === "") {
            setSub(null);
            return;
        }
        void run(() => appendChunkNote(oref, refOf(mine.label), text)).then((ok) => ok && setSub(null));
    };
    const startNote = () => {
        if (mine != null) {
            setSub({ kind: "note", draft: "" });
        }
    };
    const openMenu = (index: number) => {
        const row = rows[index];
        if (row == null) {
            return;
        }
        setCursor(index);
        const items = chunkMenuItems(byLabel(row.label)?.status ?? "");
        setSub({
            kind: "menu",
            label: row.label,
            at: Math.max(
                0,
                items.findIndex((i) => i.current)
            ),
        });
    };
    const chooseMenu = (label: string, id: string) => {
        if (id === CHUNK_RENAME) {
            setSub({ kind: "rename", label, draft: label });
        } else {
            pickStatus(label, id);
        }
    };
    const reviewOnRail = () => {
        openRailSection(agent.id, "plan");
        close();
    };
    const openInJarvis = (target: { kind: "effort"; effortId: string }, e?: React.MouseEvent) => {
        close(false);
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
                chooseMenu(sub.label, items[sub.at].id);
            }
            return;
        }
        if (e.key === "Escape" || e.key === "i") {
            handled();
            close();
        } else if (e.key === "m") {
            handled();
            markDone();
        } else if (e.key === "n") {
            handled();
            startNote();
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            handled();
            setCursor(stepRow(rows.length, cur, e.key === "ArrowDown" ? 1 : -1));
        } else if (e.key === "Enter" && e.target === e.currentTarget) {
            handled();
            openMenu(cur);
        }
    };

    // a mouse press must not take focus off the popover's root: its keys live there
    const keepFocus = (e: React.MouseEvent) => e.preventDefault();

    const rowView = (row: (typeof rows)[number], index: number) => {
        const chunk = byLabel(row.label);
        const isMine = row.kind === "current";
        const label = row.label;
        const menuOpen = sub?.kind === "menu" && sub.label === label;
        const renaming = sub?.kind === "rename" && sub.label === label ? sub : null;
        return (
            <div key={row.kind + label} className="flex flex-col">
                <div
                    data-popover-row={row.kind}
                    data-chunk-label={label}
                    aria-current={index === cur}
                    onMouseDown={keepFocus}
                    onClick={() => openMenu(index)}
                    title="Set its status, or rename it"
                    className={cn(
                        ROW,
                        isMine ? "min-h-[30px] bg-surface-selected" : "hover:bg-surface-hover",
                        index === cur && CURSOR_RING
                    )}
                >
                    <span
                        aria-hidden
                        className={cn(
                            "h-[8px] w-[8px] flex-none rounded-full",
                            isMine ? "bg-working" : "border-[1.5px] border-edge-strong"
                        )}
                    />
                    {renaming != null ? (
                        <input
                            autoFocus
                            value={renaming.draft}
                            aria-label={`Rename ${label}`}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => setSub({ kind: "rename", label, draft: e.target.value })}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    saveRename();
                                } else if (e.key === "Escape") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setSub(null);
                                }
                            }}
                            onBlur={() => setSub((s) => (s?.kind === "rename" ? null : s))}
                            className="min-w-0 flex-1 rounded-[5px] border border-edge-strong bg-surface-code px-[6px] py-[2px] text-[12px] text-primary outline-none focus:border-accent"
                        />
                    ) : (
                        <span
                            title={label}
                            className={cn(
                                "min-w-0 flex-1 truncate",
                                isMine ? "text-[12.5px] text-ink-hi" : "text-[12px] text-secondary"
                            )}
                        >
                            {label}
                        </span>
                    )}
                    {isMine && renaming == null ? (
                        <button
                            type="button"
                            data-popover-mark-done
                            onMouseDown={keepFocus}
                            onClick={(e) => {
                                e.stopPropagation();
                                markDone();
                            }}
                            title="Mark done and move on to the next chunk (m)"
                            className={cn(BTN, "h-[22px] gap-[6px] px-[8px] text-[11px]")}
                        >
                            Mark done
                            <kbd className="font-mono text-[10px] font-normal text-ink-mid">m</kbd>
                        </button>
                    ) : null}
                    {!isMine && renaming == null ? (
                        <span className="flex-none text-[10.5px] text-ink-mid">next</span>
                    ) : null}
                </div>
                {isMine && note != null ? (
                    <div className="line-clamp-2 pl-[17px] pt-[6px] text-[11px] leading-[1.45] text-muted">
                        Latest note · {formatAgo(Date.now() - note.ts)}: {note.text}
                    </div>
                ) : null}
                {menuOpen && sub?.kind === "menu" ? (
                    <div
                        role="menu"
                        data-popover-menu
                        className="mb-[2px] mt-[4px] flex flex-col rounded-[7px] border border-edge-mid bg-surface p-[3px]"
                    >
                        {chunkMenuItems(chunk?.status ?? "").map((item, i) => (
                            <div
                                key={item.id}
                                role="menuitem"
                                data-menu-item={item.id}
                                onMouseDown={keepFocus}
                                onMouseMove={() => setSub({ ...sub, at: i })}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    chooseMenu(label, item.id);
                                }}
                                className={cn(
                                    "flex h-[24px] cursor-pointer items-center gap-[8px] rounded-[5px] px-[8px] text-[11.5px]",
                                    item.id === CHUNK_RENAME && "mt-[2px] border-t border-edge-mid",
                                    i === sub.at
                                        ? "bg-surface-selected text-primary"
                                        : "text-secondary hover:bg-surface-hover"
                                )}
                            >
                                {item.id === CHUNK_RENAME ? (
                                    <Pencil size={11} aria-hidden className="flex-none text-ink-mid" />
                                ) : (
                                    <span className="flex w-[11px] flex-none justify-center text-accent">
                                        {item.current ? <Check size={11} strokeWidth={2.4} aria-hidden /> : null}
                                    </span>
                                )}
                                {item.label}
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>
        );
    };

    const status = effort != null ? popoverStatus(effort, agent.state) : null;
    const progress = effort != null ? popoverProgress(effort) : null;
    const nextRows = rows.map((r, i) => ({ r, i })).filter((x) => x.r.kind === "next");

    return (
        <div
            ref={rootRef}
            role="dialog"
            aria-label="Initiative"
            data-initiative-popover
            data-owns-keys
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="flex w-[340px] flex-col rounded-[10px] border border-edge-mid bg-surface-raised shadow-popover-xl outline-none"
        >
            <div className="flex flex-col gap-[8px] border-b border-edge-mid px-[14px] pb-[11px] pt-[13px]">
                <div className="flex items-center gap-[8px]">
                    <span className="min-w-0 truncate text-[10.5px] text-ink-mid">
                        Initiative · {effort?.project || "no project"}
                    </span>
                    <span className="flex-1" />
                    {status != null ? (
                        <span className={cn("flex-none text-[10.5px] font-semibold", STATUS_TEXT[status.tone])}>
                            ● {status.text}
                        </span>
                    ) : null}
                </div>
                <div className="break-words text-[14px] font-semibold text-ink-hi">
                    {effort?.title ?? (gone ? "This initiative no longer exists." : "Loading the initiative…")}
                </div>
                {/* until the parent is read, and for good when it is gone (a deleted initiative leaves its children
                    holding its id): no link rather than one that opens nothing */}
                {parentOref != null && parent != null ? (
                    <button
                        type="button"
                        data-popover-parent
                        onMouseDown={keepFocus}
                        onClick={(e) => openInJarvis({ kind: "effort", effortId: effort!.parentoid! }, e)}
                        title={`Open ${parent?.title ?? "the parent initiative"} in Jarvis`}
                        className="cursor-pointer self-start border-0 bg-transparent p-0 text-left text-[11px] text-accent-soft hover:underline"
                    >
                        <span className="text-ink-mid">↳ Part of </span>
                        {parent?.title ?? "its parent initiative"}
                    </button>
                ) : null}
                {progress != null && progress.total > 0 ? (
                    <div className="flex items-center gap-[8px]">
                        <SegmentBar segments={progress.segments} className="flex-1" />
                        <span className="flex-none text-[11px] font-semibold tabular-nums text-secondary">
                            {progress.done}/{progress.total}
                        </span>
                    </div>
                ) : null}
            </div>
            <div className="flex flex-col gap-[6px] px-[14px] py-[10px]">
                <SectionLabel>This agent is on</SectionLabel>
                {mine != null ? (
                    rowView(rows[0], 0)
                ) : (
                    <div className="text-[11.5px] text-muted">
                        {effort == null ? "" : "No chunk yet: it takes the active one."}
                    </div>
                )}
            </div>
            {nextRows.length > 0 || proposed > 0 ? (
                <div className="flex flex-col gap-[2px] px-[14px] pb-[10px] pt-[4px]">
                    {nextRows.length > 0 ? <SectionLabel className="mb-[3px]">Next</SectionLabel> : null}
                    {nextRows.map(({ r, i }) => rowView(r, i))}
                    {proposed > 0 ? (
                        <button
                            type="button"
                            data-popover-review
                            onMouseDown={keepFocus}
                            onClick={reviewOnRail}
                            className="mt-[4px] flex cursor-pointer items-center gap-[6px] self-start border-0 bg-transparent p-0 text-[11px] text-asking hover:underline"
                        >
                            <span
                                aria-hidden
                                className="h-[8px] w-[8px] rounded-full border-[1.5px] border-dashed border-asking"
                            />
                            {proposed} proposed · Review on the rail
                        </button>
                    ) : null}
                </div>
            ) : null}
            {error != null ? (
                <div role="alert" className="break-words px-[14px] pb-[8px] text-[11px] text-error">
                    {error}
                </div>
            ) : null}
            <div className="flex items-center gap-[6px] border-t border-edge-mid px-[14px] py-[10px]">
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
                                setSub(null);
                            }
                        }}
                        onBlur={() => setSub((s) => (s?.kind === "note" ? null : s))}
                        className="h-[26px] min-w-0 flex-1 rounded-[7px] border border-edge-strong bg-surface-code px-[9px] text-[11.5px] text-primary outline-none placeholder:text-ink-faint focus:border-accent"
                    />
                ) : (
                    <>
                        <button
                            type="button"
                            data-popover-add-note
                            onMouseDown={keepFocus}
                            onClick={startNote}
                            disabled={mine == null}
                            title={mine == null ? "This agent is on no chunk yet" : `Add a note to ${mine.label} (n)`}
                            className={BTN}
                        >
                            Add note
                            <kbd className="font-mono text-[10px] font-normal text-ink-mid">n</kbd>
                        </button>
                        <button
                            type="button"
                            data-popover-open-jarvis
                            onMouseDown={keepFocus}
                            onClick={() => openInJarvis({ kind: "effort", effortId: agent.effortId! })}
                            className={BTN}
                        >
                            Open in Jarvis
                        </button>
                        <span className="flex-1" />
                        <KeyCap chord="Escape" variant="inline" className="text-[10.5px] text-ink-mid" />
                    </>
                )}
            </div>
        </div>
    );
}

export function InitiativePopover({
    model,
    agent,
    anchor,
}: {
    model: AgentsViewModel;
    agent: AgentVM;
    anchor: HTMLElement | null;
}) {
    const open = useAtomValue(initiativePopoverAtom) === agent.id;
    const surface = useAtomValue(model.surfaceAtom);
    const returnTo = useRef<HTMLElement | null>(null);
    const wasOpen = useRef(false);
    const restore = useRef(true);
    const close = useCallback(
        (restoreFocus = true) => {
            restore.current = restoreFocus;
            if (globalStore.get(initiativePopoverAtom) === agent.id) {
                globalStore.set(initiativePopoverAtom, null);
            }
        },
        [agent.id]
    );
    // What had focus when it opened, before the popover takes it (a layout effect runs ahead of the body's own focus),
    // and back to it on Esc. A close that leaves for another surface skips it.
    useLayoutEffect(() => {
        if (open && !wasOpen.current) {
            returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            restore.current = true;
        }
    }, [open]);
    const anchorRef = useRef(anchor);
    anchorRef.current = anchor;
    useEffect(() => {
        if (!open && wasOpen.current && restore.current) {
            // the body held focus when nothing in particular did (a click that did not focus the link): the link then
            const el = returnTo.current;
            const target =
                el != null && el !== document.body && el.isConnected
                    ? el
                    : anchorRef.current?.isConnected
                      ? anchorRef.current
                      : document.querySelector<HTMLElement>("[data-cockpit-surface-wrap]");
            target?.focus({ preventScroll: true });
        }
        wasOpen.current = open;
    }, [open]);
    // Only the Agent surface stays mounted off screen, and the popover is portalled to the body: it must not follow the
    // person to another surface. Nor may a stale agent id keep the single-key bindings yielding.
    useEffect(() => {
        if (open && surface !== "agent") {
            close(false);
        }
    }, [open, surface, close]);
    useEffect(
        () => () => {
            if (globalStore.get(initiativePopoverAtom) === agent.id) {
                globalStore.set(initiativePopoverAtom, null);
            }
        },
        [agent.id]
    );

    const { refs, floatingStyles, context } = useFloating({
        open,
        onOpenChange: (next) => {
            if (!next) {
                close();
            }
        },
        placement: "bottom-start",
        strategy: "fixed",
        elements: { reference: anchor },
        middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
        whileElementsMounted: open ? autoUpdate : undefined,
    });
    // Escape is the body's own (it consumes the key there); this is the press outside, which the link itself is not
    const { getFloatingProps } = useInteractions([useDismiss(context, { escapeKey: false })]);
    // React events bubble through a portal to the header it was opened from: a click or a right-click in the popover
    // is not the header's
    const contained = {
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
        onContextMenu: (e: React.MouseEvent) => e.stopPropagation(),
    };
    return (
        <FloatingPortal>
            <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps(contained)} className="z-[80]">
                <PopoverReveal open={open} origin="top left">
                    <PopoverBody model={model} agent={agent} close={close} />
                </PopoverReveal>
            </div>
        </FloatingPortal>
    );
}
