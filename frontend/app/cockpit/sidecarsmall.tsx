// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Sidecar small form (spec 2026-11-13-sidecar-design.md, section 1a; board F-small-asks): what waits on you and
// nothing else, for a window shrunk beside the person's work. The counts at its head, then one card per ask, oldest
// first, each answerable with 1-9 from the keyboard or a click. It draws the snapshot it is given and sends SidecarActs;
// it holds only the selection. The card's ask block is its own, not the wall's: sidecarwall.tsx keeps its AskBlock
// private, and the two are free to differ at this size. The pure rules are in sidecarlayout.ts. Nothing here animates.

import { cn } from "@/util/util";
import { useEffect, useMemo, useRef, useState } from "react";
import { smallAsks, smallKey } from "./sidecarlayout";
import { SidecarCounts } from "./sidecartitlebar";
import type { SidecarAct, SidecarSnapshot, SidecarTile } from "./sidecartypes";
import { ageText, resolveSelection } from "./sidecarwallmodel";

export interface SidecarSmallProps {
    snap: SidecarSnapshot;
    // `receivedAt` and `clock` are both Date.now() on the Sidecar page, and only their difference is used (the wall's rule)
    receivedAt: number;
    clock: number;
    send: (act: SidecarAct) => void;
}

export function SidecarSmall({ snap, receivedAt, clock, send }: SidecarSmallProps) {
    const cards = useMemo(() => smallAsks(snap), [snap]);

    // the selection is an id, so it stays on its agent when the order changes; an agent that leaves moves it to the card
    // now at the same index, and the first card starts selected
    const ids = useMemo(() => cards.map((c) => c.id), [cards]);
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
    const live = useRef({ cards, selected, send });
    live.current = { cards, selected, send };
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.altKey || e.metaKey) {
                return;
            }
            const { cards, selected, send } = live.current;
            const action = smallKey(
                e.key,
                cards,
                cards.findIndex((c) => c.id === selected)
            );
            if (action == null) {
                return;
            }
            e.preventDefault();
            if (action.kind === "select") {
                setSelectedId(cards[action.index].id);
            } else if (!e.repeat) {
                // a held key sends once: a second Enter or answer would repeat what the first already did
                send(
                    action.kind === "open"
                        ? { kind: "open", id: action.id }
                        : { kind: "answer", id: action.id, option: action.option }
                );
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // the arrows keep the selected card on screen when the cards scroll
    const cardRefs = useRef(new Map<string, HTMLElement>());
    useEffect(() => {
        if (selected != null) {
            cardRefs.current.get(selected)?.scrollIntoView({ block: "nearest" });
        }
    }, [selected]);

    const sinceArrived = clock - receivedAt;

    return (
        <div data-sidecar-small className="flex min-h-0 min-w-0 flex-1 flex-col">
            <SidecarCounts counts={snap.counts} className="shrink-0 gap-3 px-3 pb-2 pt-2.5 text-[12.5px]" />
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden px-2.5 pb-2.5">
                {cards.length === 0 ? (
                    <div
                        data-sidecar-small-empty
                        className="flex flex-1 items-center justify-center text-[13px] text-muted"
                    >
                        Nothing waits on you.
                    </div>
                ) : (
                    cards.map((tile) => (
                        <Card
                            key={tile.id}
                            tile={tile}
                            age={ageText(tile.since, snap.now, sinceArrived)}
                            selected={tile.id === selected}
                            cardRef={(el) => {
                                if (el != null) {
                                    cardRefs.current.set(tile.id, el);
                                } else {
                                    cardRefs.current.delete(tile.id);
                                }
                            }}
                            onSelect={() => setSelectedId(tile.id)}
                            onOpen={() => send({ kind: "open", id: tile.id })}
                            onAnswer={(option) => send({ kind: "answer", id: tile.id, option })}
                        />
                    ))
                )}
            </div>
        </div>
    );
}

function Card(props: {
    tile: SidecarTile;
    age: string;
    selected: boolean;
    cardRef: (el: HTMLElement | null) => void;
    onSelect: () => void;
    onOpen: () => void;
    onAnswer: (option: number) => void;
}) {
    const { tile, age } = props;
    const ask = tile.ask;
    return (
        <div
            ref={props.cardRef}
            data-sidecar-card={tile.id}
            data-selected={props.selected ? "true" : undefined}
            onClick={props.onSelect}
            onDoubleClick={props.onOpen}
            className={cn(
                "flex shrink-0 select-none flex-col gap-1.5 rounded-lg border-[1.5px] border-warning bg-surface-raised px-2.5 py-2",
                props.selected && "ring-2 ring-accent"
            )}
        >
            <div className="flex items-center gap-1.5">
                <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-warning" />
                <span className="shrink-0 text-[12.5px] font-semibold text-primary">{tile.name}</span>
                <span className="min-w-0 truncate text-[11.5px] text-secondary">{tile.project ?? ""}</span>
                <span className="flex-1" />
                <span className="whitespace-nowrap text-[11px] tabular-nums text-secondary">{age}</span>
            </div>
            {ask != null && (
                <>
                    <div
                        className="line-clamp-3 break-words text-[12.5px] font-semibold leading-[1.35] text-primary"
                        title={ask.question}
                    >
                        {ask.question}
                    </div>
                    {tile.sent === true ? (
                        <div data-sidecar-sent className="text-[12px] font-semibold text-success">
                            ✓ Sent
                        </div>
                    ) : ask.answerable ? (
                        <div className="flex flex-wrap gap-1.5">
                            {ask.options.slice(0, 9).map((label, i) => (
                                <button
                                    key={i}
                                    type="button"
                                    tabIndex={-1}
                                    data-sidecar-option={i + 1}
                                    // a click must not leave the button holding focus: Enter belongs to the form, not to it
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        props.onAnswer(i);
                                    }}
                                    onDoubleClick={(e) => e.stopPropagation()}
                                    className="flex h-6 max-w-full shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-edge-strong bg-surface-hover px-2 text-[11.5px] text-primary hover:bg-surface-selected active:scale-100"
                                >
                                    <span className="font-mono text-[10px] text-muted">{i + 1}</span>
                                    <span className="min-w-0 truncate">{label}</span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div data-sidecar-elsewhere className="text-[12px] text-muted">
                            Enter answers it in the main window
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
