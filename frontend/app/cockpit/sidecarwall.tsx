// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Sidecar wall: one tile per agent, fitted by count (spec 2026-11-13-sidecar-design.md, section 3; board
// D-fit-by-count.dc.html), and the footer that lists its keys. It draws the snapshot it is given and sends SidecarActs;
// it holds only the selection. The pure shape, selection and age rules are in sidecarwallmodel.ts, never a
// sidecarwall.ts: Vite and TS resolve .ts before .tsx, so that name would shadow this file. Nothing here animates.

import { cn } from "@/util/util";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { SidecarAct, SidecarMessage, SidecarSnapshot, SidecarTile, SidecarTileState } from "./sidecartypes";
import {
    ageText,
    canAnswer,
    moveSelection,
    nameSizePx,
    resolveSelection,
    WALL_GAP,
    wallKey,
    wallShape,
} from "./sidecarwallmodel";

export interface SidecarWallProps {
    snap: SidecarSnapshot;
    // `receivedAt` and `clock` are both Date.now() on the Sidecar page, and only their difference is used: a tile's age
    // is `snap.now + (clock - receivedAt) - tile.since`. `receivedAt` is when `snap` arrived; `clock` is bumped every 30 s.
    receivedAt: number;
    clock: number;
    send: (act: SidecarAct) => void;
}

const DOT: Record<SidecarTileState, string> = {
    asking: "bg-warning",
    working: "bg-success",
    review: "bg-accent",
    idle: "bg-muted",
    asleep: "bg-muted",
};

// the wall's inner box (its padding left out), the same box the ResizeObserver's contentRect names but read
// synchronously, so the first paint already has the right shape
function innerBox(el: HTMLElement): { w: number; h: number } {
    const cs = getComputedStyle(el);
    return {
        w: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
        h: el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
    };
}

export function SidecarWall({ snap, receivedAt, clock, send }: SidecarWallProps) {
    const tiles = snap.tiles;
    const count = tiles.length;
    const wallRef = useRef<HTMLDivElement>(null);
    const tileRefs = useRef(new Map<string, HTMLElement>());
    const [area, setArea] = useState({ w: 0, h: 0 });

    useLayoutEffect(() => {
        const el = wallRef.current;
        if (el == null) {
            return;
        }
        const measure = () => {
            const { w, h } = innerBox(el);
            setArea((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const shape = useMemo(() => wallShape(area.w, area.h, count), [area.w, area.h, count]);

    // the selection is an id, so it stays on its agent when the order changes; an agent that leaves moves it to the
    // tile now at the same index
    const ids = useMemo(() => tiles.map((t) => t.id), [tiles]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const prevIds = useRef<readonly string[]>([]);
    const selected = resolveSelection(selectedId, prevIds.current, ids);
    useEffect(() => {
        prevIds.current = ids;
        if (selected !== selectedId) {
            setSelectedId(selected);
        }
    });

    // the key handler reads the latest of these without being re-registered on each snapshot
    const live = useRef({ tiles, selected, cols: shape.cols, send });
    live.current = { tiles, selected, cols: shape.cols, send };
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.altKey || e.metaKey) {
                return;
            }
            const action = wallKey(e.key);
            if (action == null) {
                return;
            }
            const { tiles, selected, cols, send } = live.current;
            const index = tiles.findIndex((t) => t.id === selected);
            if (action.kind === "move") {
                e.preventDefault();
                if (tiles.length > 0) {
                    setSelectedId(tiles[moveSelection(index, action.key, cols, tiles.length)].id);
                }
                return;
            }
            // a held key sends once: a second Enter or answer would repeat what the first already did
            if (e.repeat || index < 0) {
                return;
            }
            if (action.kind === "open") {
                e.preventDefault();
                send({ kind: "open", id: tiles[index].id });
            } else if (canAnswer(tiles[index], action.option)) {
                e.preventDefault();
                send({ kind: "answer", id: tiles[index].id, option: action.option });
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // a scrolling wall keeps the selected tile on screen as the arrows move it
    useEffect(() => {
        if (shape.scroll && selected != null) {
            tileRefs.current.get(selected)?.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
    }, [selected, shape.scroll]);

    const sinceArrived = clock - receivedAt;
    const nameSize = nameSizePx(count);

    // the grid fills the wall: rows and columns split its inner box, except past the floor size, where the tiles keep
    // that height and the wall scrolls
    const gridStyle: CSSProperties =
        count === 0
            ? {}
            : {
                  display: "grid",
                  gridTemplateColumns: `repeat(${shape.cols}, minmax(0, 1fr))`,
                  gridTemplateRows: shape.scroll ? undefined : `repeat(${shape.rows}, minmax(0, 1fr))`,
                  gridAutoRows: shape.scroll ? `${shape.tileH}px` : undefined,
                  alignContent: shape.scroll ? "start" : undefined,
                  gap: WALL_GAP,
              };

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
                ref={wallRef}
                data-sidecar-wall
                data-cols={shape.cols}
                data-rows={shape.rows}
                data-msgs={shape.msgs}
                data-scroll={shape.scroll ? "true" : "false"}
                style={gridStyle}
                className={cn(
                    "min-h-0 min-w-0 flex-1 box-border px-5 py-4",
                    shape.scroll ? "overflow-y-auto overflow-x-hidden" : "overflow-hidden",
                    count === 0 && "flex items-center justify-center"
                )}
            >
                {count === 0 ? (
                    <div data-sidecar-empty className="text-[13px] text-muted">
                        No agents running
                    </div>
                ) : (
                    tiles.map((tile) => (
                        <Tile
                            key={tile.id}
                            tile={tile}
                            age={ageText(tile.since, snap.now, sinceArrived)}
                            selected={tile.id === selected}
                            msgs={shape.msgs}
                            nameSize={nameSize}
                            fit={shape.scroll ? "floor" : count <= 4 ? "roomy" : "normal"}
                            tileRef={(el) => {
                                if (el != null) {
                                    tileRefs.current.set(tile.id, el);
                                } else {
                                    tileRefs.current.delete(tile.id);
                                }
                            }}
                            onSelect={() => setSelectedId(tile.id)}
                            onOpen={() => send({ kind: "open", id: tile.id })}
                            onAnswer={(option) => send({ kind: "answer", id: tile.id, option })}
                        />
                    ))
                )}
            </div>
            <Footer />
        </div>
    );
}

// How much room a tile has: a few big tiles (roomy), the fitted wall (normal), or tiles held at the floor size, where
// the ask is squeezed to one line of question and one row of buttons so it still fits
type TileFit = "roomy" | "normal" | "floor";

function Tile(props: {
    tile: SidecarTile;
    age: string;
    selected: boolean;
    msgs: number;
    nameSize: number;
    fit: TileFit;
    tileRef: (el: HTMLElement | null) => void;
    onSelect: () => void;
    onOpen: () => void;
    onAnswer: (option: number) => void;
}) {
    const { tile, age, selected, msgs, fit } = props;
    const asking = tile.state === "asking";
    const dim = tile.state === "idle" || tile.state === "asleep";
    const rows = tile.messages.slice(-msgs);
    // at the floor size an asking tile is all header, band and ask: no whole message row fits, and a cut one would only
    // be a sliver under the band, so it shows none
    const hideRows = fit === "floor" && asking;
    return (
        <div
            ref={props.tileRef}
            data-sidecar-tile={tile.id}
            data-state={tile.state}
            data-selected={selected ? "true" : undefined}
            onClick={props.onSelect}
            onDoubleClick={props.onOpen}
            className={cn(
                "flex min-h-0 min-w-0 select-none flex-col overflow-hidden rounded-lg bg-surface-raised",
                asking ? "border-[1.5px] border-warning" : "border border-edge-strong",
                dim && "opacity-60",
                selected && "ring-2 ring-accent"
            )}
        >
            <div className="flex shrink-0 flex-col gap-0.5 px-3 pt-2.5">
                <div className="flex items-center gap-2">
                    <span className={cn("h-[7px] w-[7px] shrink-0 rounded-full", DOT[tile.state])} />
                    <span
                        className="min-w-0 truncate font-semibold text-primary"
                        style={{ fontSize: props.nameSize }}
                        title={tile.name}
                    >
                        {tile.name}
                    </span>
                    <span className="flex-1" />
                    <span className="whitespace-nowrap text-[11px] tabular-nums text-muted">{age}</span>
                </div>
                <div className="truncate pl-[15px] text-[12px] text-secondary">
                    {tile.project ? `${tile.project} · ${tile.runtime}` : tile.runtime}
                </div>
            </div>
            {asking && (
                <div className="mt-2 shrink-0 bg-warning px-3 py-[5px] text-[10.5px] font-bold tracking-[0.6px] text-on-warning">
                    WAITING ON YOU
                    {age !== "" && <span className="ml-1.5 font-medium tracking-normal">{age}</span>}
                </div>
            )}
            {/* Newest at the bottom, whole rows only. The column fills from the bottom (column-reverse) and wraps what
                does not fit into a second column that overflow clips, so a tile too short for every row drops its
                oldest ones outright instead of showing one cut in half. The DOM stays oldest first; `order` puts the
                newest at the bottom. */}
            <div className="flex min-h-0 flex-1 flex-col-reverse flex-wrap content-start gap-2 overflow-hidden px-3 pt-2">
                {hideRows ? null : rows.length === 0 ? (
                    <div data-sidecar-nomsgs className="text-[12px] text-muted">
                        No recent messages
                    </div>
                ) : (
                    rows.map((m, i) => (
                        <MessageRow
                            key={i}
                            m={m}
                            order={rows.length - 1 - i}
                            clamp={msgs <= 2 ? "line-clamp-2" : "line-clamp-3"}
                        />
                    ))
                )}
            </div>
            <div className="shrink-0 px-3 pb-2.5 pt-2">
                {tile.ask != null ? (
                    <AskBlock tile={tile} fit={fit} onAnswer={props.onAnswer} />
                ) : (
                    tile.ctxPct != null && <ContextBar pct={tile.ctxPct} />
                )}
            </div>
        </div>
    );
}

function MessageRow({ m, clamp, order }: { m: SidecarMessage; clamp: string; order: number }) {
    const tool = m.tool;
    return (
        <div data-sidecar-msg style={{ order }} className="flex w-full min-w-0 shrink-0 flex-col gap-1">
            {m.say != null && m.say !== "" && (
                <div className={cn("break-words text-[13px] leading-[1.4] text-primary", clamp)}>{m.say}</div>
            )}
            {tool != null && (
                <div className="flex min-w-0 items-center gap-2 text-[10.5px]">
                    <span className={cn("shrink-0 font-semibold", outcomeClass(tool.outcome))}>
                        {outcomeGlyph(tool.outcome)}
                    </span>
                    <span className="shrink-0 whitespace-nowrap font-semibold uppercase tracking-[0.4px] text-feed-summary">
                        {tool.verb}
                    </span>
                    <span className="min-w-0 truncate font-mono text-[11.5px] text-secondary">{tool.target}</span>
                </div>
            )}
        </div>
    );
}

// a tool that ran fine is ✓ and one that failed ✕; blocked is ✕ in the asking colour, and one with no outcome yet a dot
function outcomeGlyph(outcome: "ok" | "fail" | "blocked" | undefined): string {
    return outcome === "ok" ? "✓" : outcome === undefined ? "·" : "✕";
}

function outcomeClass(outcome: "ok" | "fail" | "blocked" | undefined): string {
    return outcome === "ok"
        ? "text-success"
        : outcome === "fail"
          ? "text-error"
          : outcome === "blocked"
            ? "text-warning"
            : "text-muted";
}

// An answerable ask is its question and its options as buttons 1-9. A sent one says so, in place of the buttons, until
// the snapshot shows the agent moved on. Any other ask (several questions, multi-select, a prompt in the agent's own
// terminal) shows its first question, and is answered in the main window.
function AskBlock(props: { tile: SidecarTile; fit: TileFit; onAnswer: (option: number) => void }) {
    const ask = props.tile.ask!;
    return (
        <div className="flex flex-col gap-2">
            <div
                className={cn(
                    "break-words text-[13.5px] font-semibold leading-[1.35] text-primary",
                    props.fit === "roomy" ? "line-clamp-3" : props.fit === "floor" ? "line-clamp-1" : "line-clamp-2"
                )}
                title={ask.question}
            >
                {ask.question}
            </div>
            {props.tile.sent === true ? (
                <div data-sidecar-sent className="text-[12px] font-semibold text-success">
                    ✓ Sent
                </div>
            ) : ask.answerable ? (
                <div className={cn("flex gap-1.5", props.fit === "floor" ? "overflow-hidden" : "flex-wrap")}>
                    {ask.options.slice(0, 9).map((label, i) => (
                        <button
                            key={i}
                            type="button"
                            tabIndex={-1}
                            data-sidecar-option={i + 1}
                            // a click must not leave the button holding focus: Enter belongs to the wall, not to it
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => {
                                e.stopPropagation();
                                props.onAnswer(i);
                            }}
                            onDoubleClick={(e) => e.stopPropagation()}
                            className="flex h-7 max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-edge-strong bg-surface-hover px-[9px] text-[12px] text-primary hover:bg-surface-selected active:scale-100"
                        >
                            <span className="font-mono text-[10.5px] text-muted">{i + 1}</span>
                            <span className="min-w-0 truncate">{label}</span>
                        </button>
                    ))}
                </div>
            ) : (
                <div data-sidecar-elsewhere className="text-[12px] text-muted">
                    Enter answers it in the main window
                </div>
            )}
        </div>
    );
}

function ContextBar({ pct }: { pct: number }) {
    return (
        <div className="flex items-center gap-2 text-[11px] tabular-nums text-muted">
            <div className="h-1 w-[54px] overflow-hidden rounded bg-edge-strong">
                <div className="h-1 bg-muted" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
            </div>
            <span>ctx {pct}%</span>
        </div>
    );
}

function Footer() {
    return (
        <div
            data-sidecar-footer
            className="flex h-7 shrink-0 items-center gap-[18px] border-t border-edge-mid px-4 text-[11.5px] text-muted"
        >
            <Hint keys="←↑↓→" label="move" />
            <Hint keys="Enter" label="open in the main window" />
            <Hint keys="1–9" label="answer" />
            <Hint keys="F11" label="full screen" />
        </div>
    );
}

function Hint({ keys, label }: { keys: string; label: string }) {
    return (
        <span>
            <kbd className="font-mono text-[11px] text-secondary">{keys}</kbd> {label}
        </span>
    );
}
