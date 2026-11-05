// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The brainstorm's right rail: Boards beside Decided so far (or the builder check's own rail), one width the user drags.
// The pure rules (widths, columns, tabs, board heads) are in brainstormmodel.ts; this file draws them.
//
// Boards tab: every board of the open question's part (or of every part, with no question open) as a scaled live tile
// headed by its option, tied to that option by optionHoverAtom. Clicking a tile opens that one board large, from the
// agent's canvas state, in a dialog over the brainstorm pane (the question and the rail keep their widths under it); the
// canvas's own marking works there, and a board tied to an option offers that option's pick under it.

import { modalBackdrop, modalPanel } from "@/app/element/motiontokens";
import { useDimensionsWithCallbackRef } from "@/app/hook/useDimensions";
import { getApi } from "@/app/store/global";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { atom, useAtom, useAtomValue, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { SquareCheck, SquareDashed, X } from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
    type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import type { AgentVM } from "./agentsviewmodel";
import {
    boardPick,
    clampRailWidth,
    RAIL_MIN_W,
    RAIL_MIN_W_CHECK,
    RAIL_TILE_GAP,
    railBoardHeads,
    railColumns,
    railGroups,
    railReadout,
    railStacks,
    railTabs,
    spikeUrl,
    type BoardPick,
    type BrainstormFile,
    type RailBoardHead,
    type RailGroup,
    type RailTab,
} from "./brainstormmodel";
import { sendBrainstorm } from "./brainstormsend";
import { openBrainstormBoard, type BrainstormState } from "./brainstormstore";
import { MarkLayer, MarkTray } from "./canvasmarking";
import {
    boardLabel,
    boardUrl,
    canvasDir,
    canvasLayout,
    DEFAULT_BOARD_H,
    DEFAULT_BOARD_W,
    paneState,
    shownBoard,
    withContentHeights,
} from "./canvasmodel";
import { BoardFrameView, CANVAS_TOP_PAD, ServerDown, useContentHeights, useSteadyFitWidth } from "./canvaspane";
import { attachCanvas, canvasStateAtom, setMarking, type CanvasState } from "./canvasstore";
import { SWAP_BTN, SWAP_BTN_ON, SWAP_PRIMARY_BTN } from "./swapbar";

// The option index hovered or ticked in the question, or null. The options set it (and clear it), and so does a board's
// tile in the rail: the option lights up beside the board it is tied to, and the board beside its option.
export const optionHoverAtom = atomFamily(
    (_agentId: string) => atom<number | null>(null) as PrimitiveAtom<number | null>
);

// The part the rail is asked to show. A new nonce, even for the same part, switches the rail to Boards and scrolls to the
// part's group, so the same click twice still moves it.
export type RailFocus = { partId: string; nonce: number };

export type BrainstormRailProps = {
    agent: AgentVM;
    s: BrainstormState;
    f: BrainstormFile;
    // the rail's other tab: Decided so far in the design, the builder check's own rail in the check. `tabbed` is true
    // when a tab strip sits above it (the rail has a Boards tab too), false when it is the whole rail
    second: { label: string; render: (tabbed: boolean) => ReactNode };
    // the rail's smallest width: RAIL_MIN_W in the design, RAIL_MIN_W_CHECK in the check
    minWidth?: number;
    // a question is open (it decides which tabs there are, railTabs)
    question: boolean;
    focus: RailFocus | null;
};

// one number for the design and the check; every access can throw (private window, blocked site data), and the rail
// then opens at its default share
const WIDTH_KEY = "brainstorm.railWidth";

function readStoredWidth(): number | null {
    try {
        const raw = localStorage.getItem(WIDTH_KEY);
        const n = raw == null ? NaN : Number(raw);
        return Number.isFinite(n) ? n : null;
    } catch (e) {
        console.warn("brainstorm rail: reading the stored width failed", e);
        return null;
    }
}

function writeStoredWidth(width: number): void {
    try {
        localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
    } catch (e) {
        console.warn("brainstorm rail: storing the width failed", e);
    }
}

// The pane's container query stacks the rail under the question below QUESTION_MIN_W + the rail's smallest width: 640px
// in the design, 820px in the check (railStacks). Tailwind needs the classes spelled out, so the two cutoffs live here
// and in RailRow, and nowhere else.
const STACKED = {
    design: {
        aside: "@max-[640px]:w-full @max-[640px]:min-w-0 @max-[640px]:max-w-none @max-[640px]:border-l-0 @max-[640px]:border-t",
        handle: "@max-[640px]:hidden",
    },
    check: {
        aside: "@max-[820px]:w-full @max-[820px]:min-w-0 @max-[820px]:max-w-none @max-[820px]:border-l-0 @max-[820px]:border-t",
        handle: "@max-[820px]:hidden",
    },
};

export function BrainstormRail({ agent, s, f, second, minWidth = RAIL_MIN_W, question, focus }: BrainstormRailProps) {
    const check = minWidth === RAIL_MIN_W_CHECK;
    const stack = check ? STACKED.check : STACKED.design;
    const { tabs, first } = railTabs(f, s.base, { question, check });
    const hasBoards = tabs.includes("boards");
    // with a question open only its part's boards show; with none, every part's, each under its part's title
    const groups = hasBoards ? railGroups(f, s.base, question ? f.question?.part : undefined) : [];
    const shownNames = groups.flatMap((g) => g.boards);

    // each question (or the lack of one) opens on its own first tab, but the tab the user picks stays until then
    const [tab, setTab] = useState<RailTab>(first);
    const tabKey = question ? `q${f.question?.n}` : "none";
    const [seenKey, setSeenKey] = useState(tabKey);
    if (seenKey !== tabKey) {
        setSeenKey(tabKey);
        setTab(first);
    }
    const shownTab: RailTab = tabs.includes(tab) ? tab : first;

    // a board opened large needs the Boards tab, one of the shown boards and its canvas: [ ] and Esc act on it, so it
    // never stays set while it is not on screen (the next question has no boards, or the user went to the other tab)
    const canvas = useAtomValue(canvasStateAtom(agent.id));
    const widened = s.board != null && shownTab === "boards" && canvas != null && shownNames.includes(s.board);
    useEffect(() => {
        if (s.board != null && !widened) {
            openBrainstormBoard(agent.id, null);
        }
    }, [s.board, widened, agent.id]);
    // the tiles stay drawn under the open board's dialog, but are not for pointing at or scrolling to there
    const tilesDrawn = shownTab === "boards";
    const tilesShown = tilesDrawn && !widened;

    // the pane is the rail's parent: its width bounds the rail, and the measure before first paint keeps the rail from
    // opening at the smallest width and jumping. The row around the question and the rail (RailRow) holds the open
    // board's dialog, so it covers both and nothing above them
    const rootRef = useRef<HTMLElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const [paneW, setPaneW] = useState(0);
    const [dialogHost, setDialogHost] = useState<HTMLElement | null>(null);
    useLayoutEffect(() => {
        setDialogHost(rootRef.current?.closest<HTMLElement>("[data-brainstorm-rail-row]") ?? null);
        const pane = rootRef.current?.parentElement;
        if (pane == null) {
            return;
        }
        setPaneW(pane.clientWidth);
        const ro = new ResizeObserver(([entry]) => setPaneW(entry.contentRect.width));
        ro.observe(pane);
        return () => ro.disconnect();
    }, []);

    const [stored, setStored] = useState<number | null>(readStoredWidth);
    const [live, setLive] = useState<number | null>(null);
    const stacked = paneW > 0 && railStacks(paneW, minWidth);
    const width = clampRailWidth(live ?? stored, paneW, minWidth);
    const drag = useRef<{ x: number; start: number; last: number } | null>(null);
    const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, start: width, last: width };
        setLive(width);
    };
    const moveDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        if (d != null) {
            d.last = clampRailWidth(d.start + d.x - e.clientX, paneW, minWidth);
            setLive(d.last);
        }
    };
    const endDrag = () => {
        const d = drag.current;
        if (d != null) {
            drag.current = null;
            setLive(null);
            setStored(d.last);
            writeStoredWidth(d.last);
        }
    };

    // the tiles' columns follow the inner width of the groups' box, which the drag changes every frame
    const [measureRef, , innerRect] = useDimensionsWithCallbackRef<HTMLDivElement>();
    const innerW = innerRect?.width ?? 0;
    const columns = Math.max(1, ...groups.map((g) => railColumns(innerW, g.boards.length))) as 1 | 2;
    const tileW = (innerW - RAIL_TILE_GAP * (columns - 1)) / columns;

    // hovering a tile lights the option it shows, and the option's hover lights its tile (and brings it into view,
    // unless the pointer is on that very tile, which would move under it)
    const [hovered, setHovered] = useAtom(optionHoverAtom(agent.id));
    const tileHover = useRef<number | null>(null);
    const hoverTile = (option: number | null) => {
        tileHover.current = option;
        setHovered(option);
    };
    useEffect(() => {
        // a tile that goes away under the pointer (covered by the open board, other tab) never sends its leave
        if (!tilesShown && tileHover.current != null) {
            hoverTile(null);
        }
    }, [tilesShown]);
    useEffect(
        () => () => {
            if (tileHover.current != null) {
                setHovered(null);
            }
        },
        []
    );
    useEffect(() => {
        if (hovered != null && tilesShown && tileHover.current !== hovered) {
            bodyRef.current
                ?.querySelector(`[data-brainstorm-rail-board][data-linked-option="${hovered}"]`)
                ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
    }, [hovered, tilesShown]);

    // a new focus opens that part's boards: back to the tiles, on Boards, scrolled to its group. A part with no boards in
    // the rail leaves the rail alone, so opening a row of notes does not pull the user off Decided so far
    const handled = useRef<number | null>(null);
    const [scrollTo, setScrollTo] = useState<string | null>(null);
    useEffect(() => {
        if (focus == null || handled.current === focus.nonce) {
            return;
        }
        handled.current = focus.nonce;
        if (groups.some((g) => g.partId === focus.partId)) {
            if (s.board != null) {
                openBrainstormBoard(agent.id, null);
            }
            setTab("boards");
            setScrollTo(focus.partId);
        }
    }, [focus?.nonce]);
    useEffect(() => {
        if (scrollTo != null && tilesShown) {
            bodyRef.current
                ?.querySelector(`[data-brainstorm-rail-group="${CSS.escape(scrollTo)}"]`)
                ?.scrollIntoView({ block: "start", behavior: "smooth" });
            setScrollTo(null);
        }
    }, [scrollTo, tilesShown]);

    const close = () => openBrainstormBoard(agent.id, null);
    const pick = (t: RailTab) => {
        // the Boards tab again leaves an open board for the tiles
        if (t === "boards" && s.board != null) {
            close();
        }
        setTab(t);
    };
    const count = groups.reduce((n, g) => n + g.boards.length, 0) || groups.reduce((n, g) => n + g.spikes.length, 0);
    const headOf = (name: string): RailBoardHead | null =>
        groups.flatMap((g) => railBoardHeads(f, g.partId, s.boards)).find((h) => h.name === name) ?? null;

    return (
        <aside
            ref={rootRef}
            data-brainstorm-board-rail
            style={hasBoards ? ({ "--rail-w": `${width}px` } as CSSProperties) : undefined}
            className={cn(
                "flex flex-none overflow-hidden border-l border-border bg-surface",
                hasBoards ? "w-[var(--rail-w)]" : check ? "w-[460px]" : "w-[32%] min-w-[280px] max-w-[500px]",
                stack.aside
            )}
        >
            {hasBoards ? (
                <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize the rail"
                    title="Drag to resize"
                    data-brainstorm-rail-handle
                    onPointerDown={startDrag}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onLostPointerCapture={endDrag}
                    className={cn(
                        "group flex w-[12px] flex-none cursor-col-resize touch-none select-none items-center justify-center",
                        stack.handle
                    )}
                >
                    <div
                        className={cn(
                            "h-[44px] w-[4px] rounded-[2px] group-hover:bg-ink-faint",
                            live != null ? "bg-ink-faint" : "bg-edge-strong"
                        )}
                    />
                </div>
            ) : null}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {hasBoards ? (
                    <div
                        role="tablist"
                        aria-label="Rail tabs"
                        className="flex flex-none flex-wrap items-center gap-x-[6px] gap-y-[4px] px-[16px] pb-[10px] pt-[14px]"
                    >
                        <RailTabChip id="boards" selected={shownTab === "boards"} onClick={() => pick("boards")}>
                            Boards · {count}
                        </RailTabChip>
                        <RailTabChip id="second" selected={shownTab === "second"} onClick={() => pick("second")}>
                            {second.label}
                        </RailTabChip>
                        {shownTab === "boards" ? (
                            <span data-brainstorm-rail-readout className="ml-auto text-[11px] tabular-nums text-muted">
                                {railReadout(columns, stacked ? paneW : width, paneW)}
                            </span>
                        ) : null}
                    </div>
                ) : null}
                <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto">
                    {!tilesDrawn ? (
                        second.render(hasBoards)
                    ) : (
                        <div role="tabpanel" className="px-[16px] pb-[16px] pt-[2px]">
                            <div ref={measureRef} className="flex flex-col gap-[22px]">
                                {groups.map((g) => (
                                    <RailGroupView
                                        key={g.partId}
                                        f={f}
                                        s={s}
                                        group={g}
                                        heading={groups.length > 1 || g.boards.length === 0}
                                        columns={columns}
                                        tileW={tileW}
                                        hovered={hovered}
                                        onHover={hoverTile}
                                        onOpen={(name) => {
                                            hoverTile(null);
                                            attachCanvas(
                                                agent.id,
                                                {
                                                    topic: f.canvas!,
                                                    dir: canvasDir(s.cwd, f.canvas!),
                                                    projectDir: s.cwd,
                                                    board: name,
                                                },
                                                Date.now()
                                            );
                                            openBrainstormBoard(agent.id, name);
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
            {dialogHost != null
                ? createPortal(
                      <BoardDialog open={widened} onClose={close}>
                          {canvas != null ? (
                              <WidenedBoard
                                  agent={agent}
                                  s={s}
                                  f={f}
                                  cs={canvas}
                                  question={question}
                                  head={headOf}
                                  onClose={close}
                              />
                          ) : null}
                      </BoardDialog>,
                      dialogHost
                  )
                : null}
        </aside>
    );
}

// The open board's dialog: over the question and the rail, inside the brainstorm pane rather than over the app, so the
// pane's own keys stay live under it (Esc closes it, [ ] and ← → step the boards, through agent:brainstorm-back and the
// canvas keys; it is not one of the app's modals, which would stand those keys down). A click on the scrim closes it.
function BoardDialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
    return (
        <MotionConfig reducedMotion="user">
            <AnimatePresence>
                {open ? (
                    <motion.div
                        key="board-dialog"
                        data-brainstorm-board-dialog
                        variants={modalBackdrop}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        onMouseDown={(e) => {
                            if (e.target === e.currentTarget) {
                                onClose();
                            }
                        }}
                        className="absolute inset-0 z-20 flex items-stretch justify-center bg-black/60 p-[20px] backdrop-blur-sm"
                    >
                        <motion.div
                            variants={modalPanel}
                            role="dialog"
                            aria-label="Board"
                            className="flex min-h-0 w-full min-w-0 max-w-[1600px] flex-col overflow-hidden rounded-[14px] border border-edge-strong bg-modalbg shadow-popover"
                        >
                            {children}
                        </motion.div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </MotionConfig>
    );
}

function RailTabChip({
    id,
    selected,
    onClick,
    children,
}: {
    id: RailTab;
    selected: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            role="tab"
            data-brainstorm-rail-tab={id}
            aria-selected={selected}
            onClick={onClick}
            className={cn(
                "cursor-pointer rounded-[6px] border-0 px-[12px] py-[6px] text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                selected
                    ? "bg-surface-selected font-semibold text-primary"
                    : "bg-transparent text-muted hover:text-secondary"
            )}
        >
            {children}
        </button>
    );
}

// a part's boards in columns, then its spikes. A part with spikes and no boards is its title and the links
function RailGroupView({
    f,
    s,
    group,
    heading,
    columns,
    tileW,
    hovered,
    onHover,
    onOpen,
}: {
    f: BrainstormFile;
    s: BrainstormState;
    group: RailGroup;
    heading: boolean;
    columns: 1 | 2;
    tileW: number;
    hovered: number | null;
    onHover: (option: number | null) => void;
    onOpen: (board: string) => void;
}) {
    const heads = railBoardHeads(f, group.partId, s.boards);
    return (
        <section data-brainstorm-rail-group={group.partId} className="flex scroll-mt-[4px] flex-col gap-[10px]">
            {heading ? <h3 className="m-0 text-[12.5px] font-semibold text-secondary">{group.title}</h3> : null}
            {group.boards.length > 0 ? (
                <div className={cn("grid gap-[16px]", columns === 2 ? "grid-cols-2" : "grid-cols-1")}>
                    {group.boards.map((name) => {
                        const head = heads.find((h) => h.name === name) ?? {
                            name,
                            letter: null,
                            label: name,
                            option: null,
                        };
                        const board = s.boards.find((b) => b.name === name);
                        return (
                            <BoardTile
                                key={name}
                                name={name}
                                head={head}
                                lit={head.option != null && head.option === hovered}
                                w={board?.w ?? DEFAULT_BOARD_W}
                                h={board?.h ?? DEFAULT_BOARD_H}
                                tileW={tileW}
                                src={boardUrl(s.base!, f.canvas!, name)}
                                onHover={onHover}
                                onOpen={() => onOpen(name)}
                            />
                        );
                    })}
                </div>
            ) : null}
            {group.spikes.length > 0 ? <RailSpikes base={s.base!} canvas={f.canvas!} spikes={group.spikes} /> : null}
        </section>
    );
}

// the option letter and label above a board, or the board's own title when it shows no option
function BoardHead({ head, letterClass }: { head: Pick<RailBoardHead, "letter" | "label">; letterClass: string }) {
    return (
        <div data-brainstorm-rail-board-head className="flex min-w-0 items-baseline gap-[8px]">
            {head.letter != null ? (
                <>
                    <span className={cn("flex-none text-[12px] font-bold", letterClass)}>{head.letter}</span>
                    <span aria-hidden="true" className="-mx-[3px] flex-none text-[12px] text-muted">
                        ·
                    </span>
                </>
            ) : null}
            <span title={head.label} className="min-w-0 truncate text-[12.5px] font-semibold text-primary">
                {head.label}
            </span>
        </div>
    );
}

// The whole board at the column's width and its own aspect, as an iframe scaled down from the board's size. The cover
// button takes the pointer (the page behind is not for operating here) and opens the board large.
function BoardTile({
    name,
    head,
    lit,
    w,
    h,
    tileW,
    src,
    onHover,
    onOpen,
}: {
    name: string;
    head: RailBoardHead;
    lit: boolean;
    w: number;
    h: number;
    tileW: number;
    src: string;
    onHover: (option: number | null) => void;
    onOpen: () => void;
}) {
    // a tile shows an option only when it is linked to one; the others leave the option rows alone
    const hover = (option: number | null) => {
        if (head.option != null) {
            onHover(option);
        }
    };
    return (
        <div className="flex min-w-0 flex-col gap-[8px]">
            <BoardHead head={head} letterClass={lit ? "text-accent" : "text-muted"} />
            <div
                data-brainstorm-rail-board={name}
                data-linked-option={head.option ?? undefined}
                onMouseEnter={() => hover(head.option)}
                onMouseLeave={() => hover(null)}
                className={cn(
                    "relative overflow-hidden rounded-[8px] border bg-background",
                    lit ? "border-accent outline outline-1 outline-accent" : "border-edge-mid"
                )}
                style={{ aspectRatio: `${w} / ${h}` }}
            >
                {tileW > 0 ? (
                    <iframe
                        src={src}
                        title={name}
                        tabIndex={-1}
                        loading="lazy"
                        sandbox="allow-scripts allow-same-origin"
                        className="pointer-events-none absolute left-0 top-0 border-0"
                        style={{ width: w, height: h, transform: `scale(${(tileW - 2) / w})`, transformOrigin: "0 0" }}
                    />
                ) : null}
                <button
                    type="button"
                    aria-label={`Open ${head.label} large`}
                    title="Open large"
                    onClick={onOpen}
                    className="absolute inset-0 cursor-pointer border-0 bg-transparent outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                />
            </div>
        </div>
    );
}

// a spike is a live page to feel, not a board to look at, so it opens in the browser rather than the canvas
function RailSpikes({ base, canvas, spikes }: { base: string; canvas: string; spikes: string[] }) {
    return (
        <div data-brainstorm-spikes className="flex flex-wrap items-baseline gap-x-[14px] gap-y-[4px]">
            <span className="text-[11.5px] text-muted">{spikes.length > 1 ? "Live spikes" : "Live spike"}</span>
            {spikes.map((path) => (
                <button
                    key={path}
                    type="button"
                    data-brainstorm-spike={path}
                    title={spikeUrl(base, canvas, path)}
                    onClick={() => getApi().openExternal(spikeUrl(base, canvas, path))}
                    className="cursor-pointer border-0 bg-transparent p-0 text-[11.5px] text-accent-soft hover:underline"
                >
                    {path}
                </button>
            ))}
        </div>
    );
}

// The board the agent's canvas has selected, so [ and ] stepping it moves this view. It sits alone in the element
// sendCanvasMarks reads for its picture (data-canvas-scroll around one data-canvas-board). The canvas poller fills the
// state a beat after the tile's click, so the brainstorm's own board list and base stand in until it has. A board tied
// to an option of the question on screen offers that option's pick under it (boardPick), sent as the option's row sends
// it; the dialog closes once it is sent.
function WidenedBoard({
    agent,
    s,
    f,
    cs,
    question,
    head,
    onClose,
}: {
    agent: AgentVM;
    s: BrainstormState;
    f: BrainstormFile;
    cs: CanvasState;
    question: boolean;
    head: (name: string) => RailBoardHead | null;
    onClose: () => void;
}) {
    const [measureRef, , rect] = useDimensionsWithCallbackRef<HTMLDivElement>();
    const fitWidth = useSteadyFitWidth(rect?.width ?? 0);
    const [heights, reportHeight] = useContentHeights(`${cs.topic}:${cs.reloadKey}`);
    // marks are drawn over the board on screen, so leaving it drops them and the marking mode with them
    useEffect(() => () => setMarking(agent.id, false), [agent.id]);
    const base = cs.base ?? s.base;
    const seen: CanvasState = cs.boards.length > 0 ? cs : { ...cs, boards: s.boards };
    const pane = cs.status === "probing" && base != null ? "board" : paneState(cs);
    const board = shownBoard(seen);
    const frame = canvasLayout(withContentHeights([board], heights), fitWidth).frames[0];
    const marking = cs.marking && pane === "board";
    const shown = head(board.name) ?? {
        name: board.name,
        letter: null,
        label: board.title ?? boardLabel(board.name),
        option: null,
    };
    const offer = boardPick(f, shown, question);
    return (
        <div data-brainstorm-rail-widened className="flex h-full min-h-0 flex-col">
            <div className="flex flex-none items-center gap-[8px] border-b border-border px-[16px] py-[8px]">
                <div className="min-w-0 flex-1">
                    <BoardHead head={shown} letterClass="text-muted" />
                </div>
                <button
                    type="button"
                    data-brainstorm-rail-mark
                    title={`Mark parts of the board (${formatChordString("m")})`}
                    aria-pressed={marking}
                    disabled={pane !== "board"}
                    onClick={() => setMarking(agent.id, !cs.marking)}
                    className={cn(SWAP_BTN, marking && SWAP_BTN_ON)}
                >
                    {/* on, the toggle reads as a ticked box, so it no longer looks like the same button turned orange */}
                    {marking ? (
                        <SquareCheck size={14} strokeWidth={1.8} aria-hidden />
                    ) : (
                        <SquareDashed size={14} strokeWidth={1.8} aria-hidden />
                    )}
                    Mark
                </button>
                <button
                    type="button"
                    data-brainstorm-rail-close
                    aria-label="Close the board"
                    title="Close the board (Esc)"
                    onClick={onClose}
                    className={cn(SWAP_BTN, "px-[6px]")}
                >
                    <X size={14} strokeWidth={1.9} aria-hidden />
                </button>
            </div>
            {pane === "server-down" ? (
                <ServerDown />
            ) : pane === "removed" ? (
                <p className="m-0 p-[16px] text-[12.5px] leading-[1.5] text-muted">
                    {cs.topic} was removed. Its folder under .superpowers/design is gone.
                </p>
            ) : (
                // the gutter is reserved so the scrollbar appearing cannot narrow the pane, change the fit and make itself
                // disappear again (CanvasPane's reason too)
                <div
                    ref={measureRef}
                    data-canvas-scroll
                    className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-[16px] pb-[16px] [scrollbar-gutter:stable]"
                    style={{ paddingTop: CANVAS_TOP_PAD }}
                >
                    <div className="relative mx-auto" style={{ width: frame.width, height: frame.height }}>
                        <BoardFrameView
                            frame={frame}
                            selected
                            tile={false}
                            src={pane === "board" && base != null ? boardUrl(base, cs.topic, board.name) : null}
                            reloadKey={cs.reloadKey}
                            onOpen={onClose}
                            onContentHeight={(h) => reportHeight(board.name, h)}
                        >
                            {marking ? (
                                <MarkLayer agentId={agent.id} marks={cs.marks} />
                            ) : (
                                <button
                                    type="button"
                                    data-brainstorm-rail-unwiden
                                    aria-label="Close the board"
                                    title="Close the board (Esc)"
                                    onClick={onClose}
                                    className="absolute inset-0 cursor-zoom-out border-0 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                                />
                            )}
                        </BoardFrameView>
                    </div>
                </div>
            )}
            {marking ? (
                <MarkTray agent={agent} marks={cs.marks} />
            ) : offer != null ? (
                <BoardPickBar agent={agent} offer={offer} onSent={onClose} />
            ) : null}
        </div>
    );
}

// under a board tied to an option: that option's pick, the one send the dialog offers. Marking replaces it with the
// marks' tray, so the bottom of the dialog holds one send at a time
function BoardPickBar({ agent, offer, onSent }: { agent: AgentVM; offer: BoardPick; onSent: () => void }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const send = async () => {
        setBusy(true);
        setError(null);
        try {
            await sendBrainstorm(agent, { kind: "answer", text: offer.label });
            onSent();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };
    return (
        <div
            data-brainstorm-board-pick-bar
            className="flex flex-none items-center gap-[12px] border-t border-border px-[16px] py-[10px]"
        >
            <button
                type="button"
                data-brainstorm-board-pick={offer.option}
                disabled={busy}
                onClick={() => void send()}
                title={offer.label}
                className={cn(SWAP_PRIMARY_BTN, "min-w-0 max-w-[60%]")}
            >
                <span className="min-w-0 truncate">
                    Pick {offer.letter} · {offer.label}
                </span>
            </button>
            {offer.leaning != null ? (
                <span className="flex-none text-[12px] text-accent-soft">{offer.leaning}</span>
            ) : null}
            {error != null ? (
                <span role="alert" className="min-w-0 truncate text-[12px] text-error" title={error}>
                    {error}
                </span>
            ) : null}
        </div>
    );
}

// The row that holds the question's column and the rail, and the one place a narrow pane is decided: below the
// question's smallest width plus the rail's (640px in the design, 820px in the check, railStacks) the rail goes under the
// question at full width, and the row scrolls as a whole. The container is the outer div, because a container query
// reaches only what is inside the container; `question` is what fills the column, which keeps what the question has
// always had: the rest of the row, the background, and room to shrink. The outer div also holds the open board's dialog
// (BoardDialog), which covers the whole row.
const ROW_STACKED = {
    design: { row: "@max-[640px]:flex-col @max-[640px]:overflow-y-auto", question: "@max-[640px]:flex-none" },
    check: { row: "@max-[820px]:flex-col @max-[820px]:overflow-y-auto", question: "@max-[820px]:flex-none" },
};

export function RailRow({
    question,
    rail,
    minWidth = RAIL_MIN_W,
}: {
    question: ReactNode;
    rail: ReactNode;
    // the rail's smallest width, the same as the BrainstormRail inside it is given
    minWidth?: number;
}) {
    const stack = minWidth === RAIL_MIN_W_CHECK ? ROW_STACKED.check : ROW_STACKED.design;
    return (
        <div data-brainstorm-rail-row className="@container relative flex min-h-0 flex-1 flex-col">
            <div className={cn("flex min-h-0 flex-1", stack.row)}>
                <div className={cn("flex min-w-0 flex-1 flex-col bg-background", stack.question)}>{question}</div>
                {rail}
            </div>
        </div>
    );
}
