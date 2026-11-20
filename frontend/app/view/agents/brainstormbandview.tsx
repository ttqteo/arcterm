// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The brainstorm part of the Chat band (docs/superpowers/specs/2026-11-14-chat-brainstorm-status-design.md): while a
// brainstorm is attached to the agent, its Chat always says how many boards it has (with a dot for the ones that are new
// since the Brainstorm tab was last looked at) and how many decisions are yours, and opens in place to the decisions and
// the boards. What it reads is brainstormband.ts (through `brainstormBandAtom`); this file draws it. It loads no board page
// until one is asked for (no thumbnail), so it costs no RAM in any number of Chat cells. A click on a board opens that board
// large in a dialog over the agent's cell (ChatBoardDialog, BoardPreview), whose page loads only while it is open, and takes
// that one board as seen; the link opens the Brainstorm tab, which takes them all as seen; expanding the part never does.
// The band's root (chatband.tsx) owns its own keys; the dialog is the cell's (agentsurface.tsx), so it opens over Chat and
// over the terminal alike, from the Brainstorm tab of the rail or the question card, and owns its keys.

import { useDimensionsWithCallbackRef } from "@/app/hook/useDimensions";
import { globalStore } from "@/app/store/jotaiStore";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronDown, Lightbulb, PanelsTopLeft, X } from "lucide-react";
import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type KeyboardEvent,
    type MouseEvent,
    type RefObject,
} from "react";
import type { AgentVM } from "./agentsviewmodel";
import { setAgentView } from "./agentview";
import type { BrainstormBandModel } from "./brainstormband";
import { BoardDialog } from "./brainstormrail";
import {
    brainstormAtom,
    brainstormBandAtom,
    chatBoardPreviewAtom,
    getBrainstorm,
    markBoardSeen,
} from "./brainstormstore";
import {
    boardUrl,
    canvasLayout,
    DEFAULT_BOARD_H,
    DEFAULT_BOARD_W,
    withContentHeights,
    type CanvasBoard,
} from "./canvasmodel";
import { BoardFrameView, CANVAS_TOP_PAD, useContentHeights, useSteadyFitWidth } from "./canvaspane";
import { focusChatBox } from "./chatinsert";
import { toggleBandPart } from "./initiativebandstore";
import { railBrainstormRows } from "./railbrainstorm";
import { SWAP_BTN } from "./swapbar";

// a mouse press must not take focus off whatever has it: the band's keys live on its root
const keepFocus = (e: MouseEvent) => e.preventDefault();

const boardsText = (n: number) => `${n} ${n === 1 ? "board" : "boards"}`;

/** Opens the agent's Brainstorm tab: the tab is what the user looks at, so it takes the board names as seen. */
export function openBrainstorm(agentId: string): void {
    setAgentView(agentId, "brainstorm", Date.now());
}

/** Whether a board of the agent's brainstorm can open over Chat now: wavesrv serves the design folder (the poller asks it
 *  to once the file lists a board) and the file names its canvas. When not, a board's click opens the Brainstorm tab.
 *  Takes the board as seen when it can. */
export function startBoardPreview(agentId: string, name: string): boolean {
    const s = getBrainstorm(agentId);
    if (s?.base == null || s.file?.canvas == null) {
        return false;
    }
    markBoardSeen(s.path, name, Date.now());
    return true;
}

/** Opens `name` large in the dialog over the agent's Chat, or the Brainstorm tab when the board cannot open there yet. */
export function openChatBoard(agentId: string, name: string): void {
    if (!startBoardPreview(agentId, name)) {
        openBrainstorm(agentId);
        return;
    }
    globalStore.set(chatBoardPreviewAtom(agentId), name);
}

/** The part's line: a lightbulb, `Brainstorm`, the board icon and `N boards` (not drawn with none), an accent dot and
 *  `N new` when boards are new, a divider, `Decided N`, a chevron. A brainstorm-only band shows the brainstorm's title
 *  too. In a narrow cell the words go and the icon, the board count with its dot and `Decided N` stay. The whole line is
 *  one button that expands or collapses the part. */
export function BrainstormLine({
    agent,
    bs,
    narrow,
    only,
    open,
}: {
    agent: AgentVM;
    bs: BrainstormBandModel;
    narrow: boolean;
    /** there is no initiative part beside this one */
    only: boolean;
    open: boolean;
}) {
    const boards = bs.boards.length;
    return (
        <button
            type="button"
            data-brainstorm-band={agent.id}
            aria-expanded={open}
            onMouseDown={keepFocus}
            onClick={() => toggleBandPart(agent.id, "brainstorm")}
            title={open ? "Collapse the brainstorm" : "Expand the brainstorm"}
            className={cn(
                "flex h-[36px] min-w-0 cursor-pointer items-center border-0 bg-transparent text-left text-secondary",
                // beside the initiative part it keeps its width (that part gives way); alone it gives way to the title
                only ? "flex-1 overflow-hidden" : "flex-[1_0_auto]",
                narrow ? "gap-[8px] px-3" : only ? "gap-[10px] px-4" : "gap-[10px] pl-[14px] pr-4"
            )}
        >
            <Lightbulb size={13} strokeWidth={1.7} aria-hidden className="flex-none text-warning" />
            {only ? (
                <span
                    data-bsband-title
                    title={bs.title}
                    className="min-w-0 max-w-[320px] truncate text-[12.5px] font-semibold text-ink-hi"
                >
                    {bs.title}
                </span>
            ) : null}
            {narrow && !only ? null : (
                <span
                    className={cn(
                        "flex-none text-[12.5px]",
                        only ? "font-normal text-muted" : "font-semibold text-ink-hi"
                    )}
                >
                    Brainstorm
                </span>
            )}
            {boards > 0 ? (
                <span
                    data-bsband-boards
                    title={narrow ? boardsText(boards) : undefined}
                    className="flex flex-none items-center gap-[6px] text-[12px] text-secondary"
                >
                    <PanelsTopLeft size={13} strokeWidth={1.6} aria-hidden className="flex-none text-muted" />
                    {narrow ? boards : boardsText(boards)}
                </span>
            ) : null}
            {bs.newCount > 0 ? (
                <span
                    data-bsband-new
                    title={narrow ? `${bs.newCount} new` : undefined}
                    className="flex flex-none items-center gap-[5px] text-[11.5px] font-semibold text-accent-soft"
                >
                    <span aria-hidden className="h-[6px] w-[6px] flex-none rounded-full bg-accent" />
                    {narrow ? bs.newCount : `${bs.newCount} new`}
                </span>
            ) : null}
            <span aria-hidden className="h-[14px] w-px flex-none bg-edge-mid" />
            <span data-bsband-decided className="flex-none text-[12px] text-secondary">
                Decided {bs.decided.length}
            </span>
            <span className="min-w-0 flex-1" />
            <ChevronDown
                size={14}
                strokeWidth={1.8}
                aria-hidden
                className={cn(
                    "flex-none text-muted transition-transform motion-reduce:transition-none",
                    open && "rotate-180"
                )}
            />
        </button>
    );
}

/** How far right of the body's own left edge the brainstorm part's content starts on the line: the part's left plus its
 *  own padding, both measured, so the body's columns sit under the part however far the initiative part beside it has
 *  shrunk (it is `flex-[0_1_380px]`, and gives way in a band under ~710px). Re-measured when the body or the part
 *  changes size; null until the first measurement, which lands before the first paint. Used only beside an initiative
 *  part: a brainstorm-only body and a narrow one have fixed paddings. */
function useContentLeft(bodyRef: RefObject<HTMLElement | null>, enabled: boolean): number | null {
    const [left, setLeft] = useState<number | null>(null);
    useLayoutEffect(() => {
        const body = bodyRef.current;
        const part = body?.closest("[data-chat-band]")?.querySelector<HTMLElement>("[data-brainstorm-band]");
        if (!enabled || body == null || part == null) {
            return;
        }
        const measure = () => {
            const pad = parseFloat(getComputedStyle(part).paddingLeft) || 0;
            const next = Math.round(part.getBoundingClientRect().left - body.getBoundingClientRect().left + pad);
            setLeft((was) => (was === next ? was : next));
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(body);
        ro.observe(part);
        return () => ro.disconnect();
    }, [enabled]);
    return left;
}

/** The expanded part, in two columns (one in a narrow cell): `Decided N` (a title, then its gist, per decision that is
 *  yours, in the design's order) and `Boards N` (a button per board: the board icon, its file name with `new` when it is
 *  new, the part it illustrates; then one `Open in Brainstorm (b)` link). The rows are buttons reached with Tab; there is
 *  no arrow-key cursor. Beside an initiative part the columns start where this part's content starts on the line. */
export function BrainstormBody({
    agent,
    bs,
    narrow,
    only,
    onBoard,
}: {
    agent: AgentVM;
    bs: BrainstormBandModel;
    narrow: boolean;
    only: boolean;
    /** a board's row was clicked: the root opens it over Chat */
    onBoard: (name: string) => void;
}) {
    const bodyRef = useRef<HTMLDivElement>(null);
    const beside = !narrow && !only;
    const left = useContentLeft(bodyRef, beside);
    return (
        <div
            ref={bodyRef}
            data-bsband-body
            style={beside && left != null ? { paddingLeft: left } : undefined}
            className={cn(
                "grid gap-x-6 gap-y-3 border-t border-edge-mid pb-4 pr-4 pt-[14px]",
                narrow ? "grid-cols-1 pl-4" : only ? "grid-cols-2 pl-[39px]" : "grid-cols-2"
            )}
        >
            <div className="flex min-w-0 flex-col gap-[2px]">
                <div className="mb-[6px] text-[11px] text-muted">Decided {bs.decided.length}</div>
                {bs.decided.length === 0 ? <div className="text-[12px] text-muted">Nothing is yours yet.</div> : null}
                {bs.decided.map((d) => (
                    <div key={d.id} data-bsband-decision={d.id} className="flex min-w-0 flex-col gap-px py-[5px]">
                        <span className="break-words text-[12px] font-semibold text-ink-hi">{d.title}</span>
                        <span className="break-words text-[12px] leading-[1.45] text-muted">{d.gist}</span>
                    </div>
                ))}
            </div>
            <div className="flex min-w-0 flex-col gap-[8px]">
                <div className="text-[11px] text-muted">Boards {bs.boards.length}</div>
                {bs.boards.length === 0 ? <div className="text-[12px] text-muted">No boards yet.</div> : null}
                {bs.boards.map((b) => (
                    <button
                        key={b.name}
                        type="button"
                        data-bsband-board={b.name}
                        data-new={b.isNew ? "" : undefined}
                        onMouseDown={keepFocus}
                        onClick={() => onBoard(b.name)}
                        title="Open the board"
                        className="flex min-w-0 cursor-pointer items-center gap-[10px] rounded-[6px] border-0 bg-transparent p-0 text-left hover:bg-surface-hover"
                    >
                        <PanelsTopLeft size={16} strokeWidth={1.5} aria-hidden className="flex-none text-muted" />
                        <span className="flex min-w-0 flex-col gap-px">
                            <span className="flex min-w-0 items-center gap-[6px] text-[12px] text-ink-hi">
                                <span className="min-w-0 truncate">{b.name}</span>
                                {b.isNew ? (
                                    <span className="flex-none text-[10.5px] font-semibold text-accent-soft">new</span>
                                ) : null}
                            </span>
                            <span className="truncate text-[11px] text-muted">{b.part}</span>
                        </span>
                    </button>
                ))}
                <button
                    type="button"
                    data-bsband-open-brainstorm
                    onMouseDown={keepFocus}
                    onClick={() => openBrainstorm(agent.id)}
                    className="mt-[2px] cursor-pointer self-start border-0 bg-transparent p-0 text-[12px] text-accent-soft hover:underline"
                >
                    Open in Brainstorm (b)
                </button>
            </div>
        </div>
    );
}

/** One board of the brainstorm, large, in the board dialog over the agent's cell: a head (the board's name and the part it
 *  illustrates, Open in Brainstorm, Close) over the board at the dialog's width. Its page loads when the dialog opens and
 *  goes when it closes. A click on the board, Esc or the scrim closes it, and ← / → step to the previous / next board
 *  (ChatBoardDialog owns the keys); it has no marking (the Brainstorm tab's open board has). The board's size is canvas.json's, which the poller reads with the file. */
export function BoardPreview({
    agent,
    name,
    part,
    onClose,
    onOpenBrainstorm,
}: {
    agent: AgentVM;
    name: string;
    part: string | null;
    onClose: () => void;
    onOpenBrainstorm: () => void;
}) {
    const s = useAtomValue(brainstormAtom(agent.id));
    const [measureRef, , rect] = useDimensionsWithCallbackRef<HTMLDivElement>();
    const fitWidth = useSteadyFitWidth(rect?.width ?? 0);
    const [heights, reportHeight] = useContentHeights(name);
    const board: CanvasBoard = s?.boards.find((b) => b.name === name) ?? {
        name,
        x: 0,
        y: 0,
        w: DEFAULT_BOARD_W,
        h: DEFAULT_BOARD_H,
    };
    const frame = canvasLayout(withContentHeights([board], heights), fitWidth).frames[0];
    const canvas = s?.file?.canvas;
    const src = s?.base != null && canvas != null ? boardUrl(s.base, canvas, name) : null;
    return (
        <div data-bsband-preview={name} className="flex h-full min-h-0 flex-col">
            <div className="flex flex-none items-center gap-[10px] border-b border-border px-[16px] py-[8px]">
                <PanelsTopLeft size={16} strokeWidth={1.5} aria-hidden className="flex-none text-muted" />
                <div className="flex min-w-0 flex-1 flex-col gap-px">
                    <span className="truncate text-[12.5px] font-semibold text-ink-hi">{name}</span>
                    {part != null ? <span className="truncate text-[11px] text-muted">{part}</span> : null}
                </div>
                <button
                    type="button"
                    data-bsband-preview-open
                    onMouseDown={keepFocus}
                    onClick={onOpenBrainstorm}
                    title={`Open in Brainstorm (${formatChordString("b")})`}
                    className={SWAP_BTN}
                >
                    Open in Brainstorm
                </button>
                <button
                    type="button"
                    data-bsband-preview-close
                    aria-label="Close the board"
                    title="Close the board (Esc)"
                    onMouseDown={keepFocus}
                    onClick={onClose}
                    className={cn(SWAP_BTN, "px-[6px]")}
                >
                    <X size={14} strokeWidth={1.9} aria-hidden />
                </button>
            </div>
            {/* the gutter is reserved so the scrollbar appearing cannot narrow the pane, change the fit and make itself
                disappear again (CanvasPane's reason too) */}
            <div
                ref={measureRef}
                className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-[16px] pb-[16px] [scrollbar-gutter:stable]"
                style={{ paddingTop: CANVAS_TOP_PAD }}
            >
                <div className="relative mx-auto" style={{ width: frame.width, height: frame.height }}>
                    <BoardFrameView
                        frame={frame}
                        selected
                        tile={false}
                        src={src}
                        reloadKey={0}
                        onOpen={onClose}
                        onContentHeight={(h) => reportHeight(name, h)}
                    >
                        <button
                            type="button"
                            aria-label="Close the board"
                            title="Close the board (Esc)"
                            onMouseDown={keepFocus}
                            onClick={onClose}
                            className="absolute inset-0 cursor-zoom-out border-0 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                        />
                    </BoardFrameView>
                </div>
            </div>
        </div>
    );
}

/** The board dialog of one agent's cell (agentsurface.tsx draws it beside the Chat layer): the board named by
 *  `chatBoardPreviewAtom` large over the whole cell, whether the agent shows Chat or its terminal. A chip of the rail's
 *  Brainstorm tab, a row of the question card or a board of the band opens it (`openChatBoard`).
 *
 *  Its root is `data-owns-keys`, so the dispatcher counts focus in it as editable and every single-key binding stands down;
 *  its handler answers instead: Esc closes it (and the keyboard goes back to where it was), `b` closes it and opens the
 *  Brainstorm tab, ← / → open the previous / next board in the order the Brainstorm tab draws them and stop at the first
 *  and the last. Opening takes the focus, so those keys answer at once. A board that leaves the brainstorm (or the
 *  brainstorm itself) closes it, and so does the cell leaving the screen. The layer takes no pointer events but the
 *  dialog's own, so a closed one never covers the terminal under it. */
export function ChatBoardDialog({ agent, barred }: { agent: AgentVM; barred: boolean }) {
    const bs = useAtomValue(brainstormBandAtom(agent.id));
    const previewAtom = chatBoardPreviewAtom(agent.id);
    const preview = useAtomValue(previewAtom);
    const setPreview = (name: string | null) => globalStore.set(previewAtom, name);
    const rootRef = useRef<HTMLDivElement>(null);
    // what had the focus when the dialog opened, to give it back on close
    const returnTo = useRef<HTMLElement | null>(null);
    const wasOpen = useRef(false);
    // the dialog keeps the last board drawn while it fades out
    const lastPreview = useRef<string | null>(null);
    if (preview != null) {
        lastPreview.current = preview;
    }
    const previewBoard = bs?.boards.find((b) => b.name === lastPreview.current) ?? null;

    useEffect(() => () => globalStore.set(previewAtom, null), [previewAtom]);
    useEffect(() => {
        if (preview != null && !bs?.boards.some((b) => b.name === preview)) {
            setPreview(null);
        }
    }, [preview, bs]);
    useEffect(() => {
        const open = preview != null;
        const root = rootRef.current;
        if (open && !wasOpen.current) {
            const active = document.activeElement;
            returnTo.current = active instanceof HTMLElement && !root?.contains(active) ? active : null;
            root?.focus({ preventScroll: true });
        } else if (!open && wasOpen.current) {
            const back = returnTo.current;
            returnTo.current = null;
            // only while the focus is still the dialog's (or lost with it): a click elsewhere meanwhile keeps it there
            const held =
                root != null && (root.contains(document.activeElement) || document.activeElement === document.body);
            if (held) {
                if (back?.isConnected) {
                    back.focus({ preventScroll: true });
                } else if (!focusChatBox(agent.id)) {
                    (document.activeElement as HTMLElement | null)?.blur();
                }
            }
        }
        wasOpen.current = open;
    }, [preview]);

    const toBrainstorm = () => {
        setPreview(null);
        openBrainstorm(agent.id);
    };
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (preview == null || e.nativeEvent.isComposing || e.ctrlKey || e.metaKey || e.altKey) {
            return;
        }
        const handled = () => {
            e.preventDefault();
            e.stopPropagation();
        };
        if (e.key === "Escape") {
            handled();
            setPreview(null);
        } else if (e.key === "b") {
            handled();
            toBrainstorm();
        } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            handled();
            const order = bs != null ? railBrainstormRows(bs).boardOrder : [];
            const at = order.indexOf(preview);
            const next = order[at + (e.key === "ArrowLeft" ? -1 : 1)];
            if (at >= 0 && next != null && startBoardPreview(agent.id, next)) {
                setPreview(next);
            }
        }
        // Tab still moves between the dialog's buttons; no other key acts behind the dialog
    };

    return (
        <div
            ref={rootRef}
            data-chat-board-dialog={agent.id}
            data-owns-keys
            tabIndex={-1}
            onKeyDown={onKeyDown}
            // against the cell, under its grid bar when it has one (the board split's layer sits the same way)
            className={cn(
                "pointer-events-none absolute bottom-0 left-0 right-0 z-30 outline-none [&>*]:pointer-events-auto",
                barred ? "top-[26px]" : "top-0"
            )}
        >
            <BoardDialog open={preview != null} onClose={() => setPreview(null)}>
                {lastPreview.current != null ? (
                    <BoardPreview
                        agent={agent}
                        name={lastPreview.current}
                        part={previewBoard?.part ?? null}
                        onClose={() => setPreview(null)}
                        onOpenBrainstorm={toBrainstorm}
                    />
                ) : null}
            </BoardDialog>
        </div>
    );
}
