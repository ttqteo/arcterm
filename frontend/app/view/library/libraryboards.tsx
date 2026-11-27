// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Library → Boards: every board agents drew, reopened. A list of the app bar's project (every project when none is picked),
// newest first, a thumbnail on each row, with the open board beside it.
//   a live agent's board   its row shows the board alone over the Agent surface's centre, through the router
//                          (openref.ts), as its tree row does; the split stays as it was, and Library too
//   an ended agent's board its canvas (hand edits still save), the status line under it (boardstatus.tsx), and Open
//                          conversation, which reads the agent's session.
//                          Open beside Chat… hands it to a live Claude agent of its project, which takes it over
//                          (BoardTakeOverCommand), and opens it beside that agent's Chat
// Open in split, on a row's hover and in the open board's header, puts any board in a cell on the Agent surface: beside
// its agent while it runs, else beside the agent in focus, where its header's chat picker hands it to a chat to ask.
// Delete board, on a row's hover and in the open board's header, moves it to ~/.arc/trash (boarddelete.ts).
// Only one canvas per board: the split beside Chat drops its own while another surface shows, so this one never doubles up
// with it. Above the canvas sits the board's strip (the drawings row and the Edit switch, the same as in the split), and
// an empty board says so. The model is libraryboardsmodel.ts; the board's own parts are boards/.

import { layerFade } from "@/app/element/motiontokens";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronDown, Columns2, RefreshCw, Search, Trash2 } from "lucide-react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentsViewModel } from "../agents/agents";
import { sessionKey } from "../agents/sessionsruns";
import { retryBoardTurn, stopBoardTurn } from "../boards/boardactions";
import { BoardCanvas } from "../boards/boardcanvas";
import { parseBoardFile } from "../boards/boardmodel";
import { openBoard } from "../boards/boardsplitstore";
import { BoardStatus } from "../boards/boardstatus";
import { loadBoardConvert, loadBoardList, useBoardList, useBoardTalk } from "../boards/boardstore";
import { BoardStrip } from "../boards/boardstrip";
import { openTarget } from "../jarvis/openref";
import { confirmDeleteBoard, DELETE_BOARD_LABEL } from "./boarddelete";
import {
    boardRows,
    boardsEmptyText,
    boardsScope,
    boardsSelectionIn,
    noTakeoverText,
    splitAnchor,
    splitTitle,
    takeoverAgents,
    type BoardRow,
} from "./libraryboardsmodel";
import { libraryBoardSelAtom, showLibraryBoard, showLibrarySession } from "./librarystore";

const ENDED_LINE = "Its agent has ended.";

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// --- thumbnails: Excalidraw's SVG export of the board's file, drawn once per rev and only for rows on screen

const thumbs = new Map<string, { rev: string; url: string }>();

// the board file's drawing, as an image url; the file is read each time (that is how the rev is known) but the export, the
// costly part, runs only when the rev is not the cached one
async function thumbnailOf(project: string, boardId: string): Promise<string> {
    const read = await RpcApi.BoardReadCommand(TabRpcClient, { project, boardid: boardId });
    const key = `${project}/${boardId}`;
    const hit = thumbs.get(key);
    if (hit != null && hit.rev === read.rev) {
        return hit.url;
    }
    const scene = parseBoardFile(read.data);
    const { sceneThumbnail } = await loadBoardConvert();
    const url = await sceneThumbnail(scene);
    thumbs.set(key, { rev: read.rev, url });
    return url;
}

function Thumb({ row }: { row: BoardRow }) {
    const box = useRef<HTMLDivElement>(null);
    const [onScreen, setOnScreen] = useState(false);
    const [src, setSrc] = useState<string | null>(() => thumbs.get(row.key)?.url ?? null);

    useEffect(() => {
        const el = box.current;
        if (el == null) {
            return;
        }
        const seen = new IntersectionObserver((entries) => setOnScreen(entries.some((e) => e.isIntersecting)), {
            rootMargin: "120px",
        });
        seen.observe(el);
        return () => seen.disconnect();
    }, []);

    // read again when the board moved on (a turn drew, a hand edit saved): its activity time and facts say so
    const stamp = `${row.activets}|${row.summary}`;
    useEffect(() => {
        if (!onScreen || row.shapes === 0 || row.loaderror !== "") {
            return;
        }
        let cancelled = false;
        thumbnailOf(row.project, row.id).then(
            (url) => {
                if (!cancelled) {
                    setSrc(url);
                }
            },
            (e) => console.warn("boards: the thumbnail of", row.key, "failed", e)
        );
        return () => {
            cancelled = true;
        };
    }, [onScreen, row.project, row.id, row.key, row.shapes, row.loaderror, stamp]);

    return (
        <div
            ref={box}
            data-library-board-thumb={src != null ? "ready" : "none"}
            className="h-[44px] w-[64px] flex-none overflow-hidden rounded-[4px] border border-edge-strong bg-background"
        >
            {src != null ? <img src={src} alt="" draggable={false} className="h-full w-full object-contain" /> : null}
        </div>
    );
}

// --- the list

// Open in split: the board as a cell beside an agent on the Agent surface (libraryboardsmodel.ts splitAnchor), a row of its
// own in the Agent tree while it stays open. A row's copy is an icon on hover or focus; the open board's is a word in its
// header. Disabled with no agent to sit beside.
function OpenInSplitButton({
    model,
    row,
    variant,
}: {
    model: AgentsViewModel;
    row: BoardRow;
    variant: "icon" | "text";
}) {
    const roster = useAtomValue(model.agentsAtom);
    const focusId = useAtomValue(model.focusIdAtom);
    const anchor = splitAnchor(row, focusId, roster);
    const title = splitTitle(row, anchor);
    const open = () => {
        if (anchor != null) {
            openBoard(model, anchor, row.project, row.id);
        }
    };
    if (variant === "icon") {
        return (
            <button
                type="button"
                data-library-board-split={row.id}
                onClick={open}
                disabled={anchor == null}
                title={title}
                aria-label={`Open ${row.name} in split`}
                className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-[7px] border border-edge-strong bg-surface-raised text-muted hover:border-ink-faint hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50 disabled:hover:border-edge-strong disabled:hover:text-muted"
            >
                <Columns2 size={13} aria-hidden />
            </button>
        );
    }
    return (
        <button
            type="button"
            data-library-board-open-split
            onClick={open}
            disabled={anchor == null}
            title={title}
            className="flex flex-none cursor-pointer items-center gap-1 text-[12px] text-accent hover:text-accenthover disabled:cursor-default disabled:text-muted"
        >
            <Columns2 size={12} strokeWidth={2} aria-hidden />
            Open in split
        </button>
    );
}

// Delete board: the confirm, then the trash. A row's copy shows on hover or focus; the open board's sits in its header.
function DeleteBoardButton({ model, row, className }: { model: AgentsViewModel; row: BoardRow; className?: string }) {
    return (
        <button
            type="button"
            data-library-board-delete={row.id}
            onClick={() => confirmDeleteBoard(model, { project: row.project, boardId: row.id }, row.name)}
            title={DELETE_BOARD_LABEL}
            aria-label={`${DELETE_BOARD_LABEL} ${row.name}`}
            className={cn(
                "flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-[7px] border border-edge-strong bg-surface-raised text-muted hover:border-error hover:text-error focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                className
            )}
        >
            <Trash2 size={13} aria-hidden />
        </button>
    );
}

function BoardListRow({
    model,
    row,
    selected,
    showProject,
    onSelect,
}: {
    model: AgentsViewModel;
    row: BoardRow;
    selected: boolean;
    showProject: boolean;
    onSelect: () => void;
}) {
    return (
        <div className="group relative">
            <button
                type="button"
                data-library-board={row.id}
                data-library-board-project={row.project}
                data-library-board-agent={row.agentState}
                aria-current={selected ? "true" : undefined}
                onClick={onSelect}
                className={cn(
                    "flex w-full cursor-pointer gap-2.5 border-0 px-3.5 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                    selected ? "bg-surface-selected" : "bg-transparent hover:bg-surface-hover"
                )}
            >
                <Thumb row={row} />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span
                        data-library-board-name
                        className={cn("truncate text-[13px] text-primary", selected && "font-semibold")}
                    >
                        {row.name}
                    </span>
                    {showProject ? (
                        <span data-library-board-project-name className="truncate text-[11.5px] text-muted">
                            {row.project}
                        </span>
                    ) : null}
                    <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
                        {row.alive ? (
                            <span aria-hidden className="h-[6px] w-[6px] flex-none rounded-full bg-success" />
                        ) : null}
                        <span data-library-board-agent-line className="truncate">
                            {row.agent || "no agent"} · {row.agentState}
                        </span>
                    </span>
                    <span data-library-board-summary className="truncate text-[12px] text-muted">
                        {row.summary}
                    </span>
                </span>
            </button>
            <div className="absolute right-3 top-2.5 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                <OpenInSplitButton model={model} row={row} variant="icon" />
                <DeleteBoardButton model={model} row={row} />
            </div>
        </div>
    );
}

// --- the open board

function BoardDetail({ model, row }: { model: AgentsViewModel; row: BoardRow }) {
    const talk = useBoardTalk(row.project, row.id);
    const [error, setError] = useState<string | null>(null);
    const target = { project: row.project, boardId: row.id };
    const sessionId = talk?.agent?.sessionid;
    // nothing drawn and nothing asked (the row's shapes is 0 for the omitted wire field); a file that won't open has the
    // canvas's own line in its place
    const empty = row.shapes === 0 && row.loaderror === "" && talk != null && talk.turns.length === 0;

    // a rejection shows on the status line; the next action that goes clears it
    async function act(fn: () => Promise<void>): Promise<void> {
        try {
            await fn();
            setError(null);
        } catch (e) {
            setError(errorText(e));
        }
    }

    return (
        <div data-library-board-open={row.id} data-owns-keys className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex h-10 flex-none items-center gap-2.5 border-b border-edge-mid px-4 text-[12px]">
                <span
                    data-library-board-title
                    className="min-w-0 flex-none truncate text-[13px] font-semibold text-primary"
                >
                    {row.name}
                </span>
                <span data-library-board-state className="min-w-0 truncate text-muted">
                    {row.agent || "no agent"} · {row.agentState}
                    {row.alive ? "" : " · hand edits still save"}
                </span>
                <div className="flex-1" />
                <OpenInSplitButton model={model} row={row} variant="text" />
                {sessionId ? (
                    <button
                        type="button"
                        data-library-board-conversation
                        onClick={() => showLibrarySession(model, sessionKey({ runtime: "claude", id: sessionId }))}
                        className="flex-none cursor-pointer text-[12px] text-accent hover:text-accenthover"
                    >
                        Open conversation
                    </button>
                ) : null}
                <DeleteBoardButton model={model} row={row} />
            </div>
            {/* the strip (the drawings row and Edit) directly above the canvas; under it the status line, then the line
                saying where the board can be asked about */}
            <BoardStrip boardId={row.id} />
            <div className="relative min-h-0 min-w-0 flex-1">
                <BoardCanvas project={row.project} boardId={row.id} />
                <MotionConfig reducedMotion="user">
                    <AnimatePresence initial={false}>
                        {empty ? (
                            <motion.div
                                key="empty"
                                data-board-empty
                                variants={layerFade}
                                initial="initial"
                                animate="animate"
                                exit="exit"
                                // over the canvas, which stays under it: a press goes through to draw on it
                                className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-[13px] leading-[1.5] text-muted"
                            >
                                Nothing drawn yet. Press Edit to draw on it.
                            </motion.div>
                        ) : null}
                    </AnimatePresence>
                </MotionConfig>
            </div>
            <BoardStatus
                talk={talk}
                error={error}
                onStop={() => void act(() => stopBoardTurn(target))}
                onRetry={(turn) => void act(() => retryBoardTurn(target, turn.id))}
            />
            <div className="flex-none border-t border-edge-mid">
                {row.alive ? (
                    // the roster filled in after the row was picked: the agent is running, so its board opens on the Agent surface
                    <div className="flex flex-none items-center gap-2 px-3.5 py-2 text-[12px] text-muted">
                        <span data-library-board-running>The agent is running.</span>
                        <button
                            type="button"
                            data-library-board-open-beside-chat
                            onClick={() =>
                                void openTarget(model, { kind: "board", project: row.project, boardId: row.id })
                            }
                            className="cursor-pointer text-accent hover:text-accenthover"
                        >
                            Open on Agent
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-none flex-wrap items-center gap-x-2.5 gap-y-1 px-3.5 py-2 text-[12px]">
                        <span data-library-board-ended className="text-ink-faint">
                            {ENDED_LINE}
                        </span>
                        <OpenBesideChat
                            model={model}
                            row={row}
                            onPick={(tabId) =>
                                void act(async () => {
                                    await RpcApi.BoardTakeOverCommand(TabRpcClient, {
                                        project: row.project,
                                        boardid: row.id,
                                        tabid: tabId,
                                    });
                                    // beside the Chat of the agent just picked, as the button says
                                    openBoard(model, tabId, row.project, row.id);
                                })
                            }
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

// An ended agent's board, handed to a live Claude agent of its project: the menu lists them, and with none it says to
// start one. The menu opens upward, as the button sits at the foot of the open board.
function OpenBesideChat({
    model,
    row,
    onPick,
}: {
    model: AgentsViewModel;
    row: BoardRow;
    onPick: (tabId: string) => void;
}) {
    const roster = useAtomValue(model.agentsAtom);
    const agents = useMemo(() => takeoverAgents(roster, row.project), [roster, row.project]);
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) {
            return;
        }
        const onDown = (e: PointerEvent) => {
            if (!root.current?.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => document.removeEventListener("pointerdown", onDown, true);
    }, [open]);

    if (agents.length === 0) {
        return (
            <span data-library-board-no-takeover className="text-muted">
                {noTakeoverText(row.project)}
            </span>
        );
    }
    return (
        <div
            ref={root}
            className="relative self-start"
            onKeyDown={(e) => {
                if (open && e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(false);
                }
            }}
        >
            <button
                type="button"
                data-library-board-takeover
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
                className="flex cursor-pointer items-center gap-1 text-accent hover:text-accenthover"
            >
                Open beside Chat…
                <ChevronDown size={12} strokeWidth={2} aria-hidden />
            </button>
            {open ? (
                <div
                    role="menu"
                    aria-label={`Agents of ${row.project}`}
                    className="absolute bottom-full left-0 z-30 mb-1 flex min-w-[200px] flex-col rounded-[8px] border border-edge-mid bg-surface-raised py-1 shadow-popover-sm"
                >
                    <span className="px-3 pb-1 pt-0.5 text-[11.5px] text-muted">The agent you pick takes it over</span>
                    {agents.map((a) => (
                        <button
                            key={a.id}
                            type="button"
                            role="menuitem"
                            data-library-board-takeover-agent={a.id}
                            onClick={() => {
                                setOpen(false);
                                onPick(a.id);
                            }}
                            className="flex cursor-pointer items-center px-3 py-1.5 text-left text-[12px] text-secondary hover:bg-surface-hover hover:text-primary"
                        >
                            <span className="min-w-0 flex-1 truncate">{a.name}</span>
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

// --- the tab

export function LibraryBoards({ model }: { model: AgentsViewModel }) {
    const filter = useAtomValue(model.projectFilterAtom);
    const scope = boardsScope(filter);
    const sel = useAtomValue(libraryBoardSelAtom);
    const roster = useAtomValue(model.agentsAtom);
    const list = useBoardList(scope);
    // the open board may be of a project the app bar is not on (opened from outside): its own project's list names it
    const openList = useBoardList(sel?.project ?? scope);
    const [query, setQuery] = useState("");
    const [reloading, setReloading] = useState(false);

    // the list is kept current by board:update, which only a write through wavesrv sends: a board file copied into the
    // folder by hand (an import) shows when the tab opens, or on the Reload button
    function reloadList(): void {
        setReloading(true);
        loadBoardList(scope)
            .catch((e) => console.warn("boards: reloading the list failed", e))
            .finally(() => setReloading(false));
    }
    useEffect(() => {
        loadBoardList(scope).catch((e) => console.warn("boards: reading the list failed", e));
    }, [scope]);

    const rows = useMemo(() => boardRows(list, { query, roster, now: Date.now() }), [list, query, roster]);
    const open = useMemo(
        () => boardsSelectionIn(boardRows(openList, { query: "", roster, now: Date.now() }), sel),
        [openList, sel, roster]
    );

    function select(row: BoardRow): void {
        if (row.alive) {
            void openTarget(model, { kind: "board", project: row.project, boardId: row.id });
        } else {
            showLibraryBoard(model, row.project, row.id);
        }
    }

    if (list != null && list.length === 0) {
        return (
            <div
                data-library-boards-empty
                className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-[13px] text-muted"
            >
                {boardsEmptyText(scope, "")}
            </div>
        );
    }
    return (
        <div data-library-boards className="flex min-h-0 min-w-0 flex-1">
            <div className="flex w-[360px] flex-none flex-col overflow-hidden border-r border-edge-mid">
                <div className="m-3 flex flex-none items-center gap-1.5">
                    <label className="flex h-[32px] min-w-0 flex-1 items-center gap-2 rounded-[8px] border border-edge-strong bg-surface-raised pl-[10px] pr-2 focus-within:border-ink-faint">
                        <Search size={13} strokeWidth={1.8} className="flex-none text-muted" aria-hidden />
                        <input
                            data-library-boards-search
                            aria-label="Search boards"
                            placeholder="Search boards"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            className="min-w-0 flex-1 bg-transparent text-[13px] text-primary outline-none placeholder:text-muted"
                        />
                    </label>
                    <button
                        type="button"
                        data-library-boards-reload
                        aria-label="Reload boards"
                        title="Reload boards"
                        onClick={reloadList}
                        disabled={reloading}
                        className="flex h-[32px] w-[32px] flex-none cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent text-muted hover:bg-surface-hover hover:text-secondary disabled:cursor-default"
                    >
                        <RefreshCw
                            size={13}
                            aria-hidden
                            className={reloading ? "animate-spin motion-reduce:animate-none" : undefined}
                        />
                    </button>
                </div>
                <div data-library-boards-list className="min-h-0 flex-1 overflow-y-auto pb-2">
                    {list == null ? (
                        <div className="px-4 py-3 text-[12px] text-muted">Reading boards…</div>
                    ) : rows.length === 0 ? (
                        <div data-library-boards-none className="px-4 py-3 text-[12px] text-muted">
                            {boardsEmptyText(scope, query)}
                        </div>
                    ) : (
                        rows.map((row) => (
                            <BoardListRow
                                key={row.key}
                                model={model}
                                row={row}
                                selected={open?.key === row.key}
                                showProject={scope === ""}
                                onSelect={() => select(row)}
                            />
                        ))
                    )}
                </div>
            </div>
            {open != null ? (
                <BoardDetail key={open.key} model={model} row={open} />
            ) : (
                <div className="flex min-w-0 flex-1 items-center justify-center px-6 text-center text-[13px] text-muted">
                    Pick a board to read it here.
                </div>
            )}
        </div>
    );
}
