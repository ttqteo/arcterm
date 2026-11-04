// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Memory tab of the council's rail (boards Memory-tab and Memory-held in .superpowers/design/council-ideas-memory;
// councilmemorymodel.ts derives what it draws): the one direction the seats read before the Report. Top to bottom: the
// caption, an input to write a direction, the one card that waits (a suggestion with Make it the direction / Dismiss /
// Show the messages, or a held direction with its reason and Edit / Set anyway / Discard), the Chosen direction with its
// line, its source link, Edit and Unpin, and what it Replaced, struck through. With no direction and no card the tab is
// the input and one muted line. Every move is a `directionCouncil` action through the discussion's `acts`, one at a time
// (a set, pin or edit is checked first, so its button reads Checking… while it runs); a refusal shows under the input and,
// as for the thumbs, in the discussion's header. Every part carries a data-council-memory-* attribute for the CDP
// scenario `council-memory`.

import { cn } from "@/util/util";
import { useRef, useState } from "react";
import type { Actions } from "./councilactions";
import {
    cardKicker,
    chosenLine,
    memoryEmpty,
    replacedRows,
    shownCard,
    type DirectionSource,
} from "./councilmemorymodel";
import { directionCouncil, type CouncilDirectionAction } from "./councilstore";

// the action keys: every direction move shares the prefix, so the panel holds still while any one runs (a pin from the
// channel included: its check is on the same direction)
const KEY = "direction:";

const primaryButton =
    "h-[28px] cursor-pointer rounded-[6px] border-0 bg-accent px-3 text-[12.5px] font-semibold text-background outline-none hover:bg-accenthover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";
const secondaryButton =
    "h-[28px] cursor-pointer rounded-[6px] border border-edge-mid bg-surface-raised px-3 text-[12.5px] text-secondary outline-none hover:border-edge-strong hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";
const ghostButton =
    "h-[28px] cursor-pointer rounded-[6px] border-0 bg-transparent px-[6px] text-[12.5px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";
// Edit and Unpin under the chosen direction: plain words, as the board draws them
const textButton =
    "cursor-pointer rounded-[4px] border-0 bg-transparent p-0 text-[12px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";
const FIELD =
    "rounded-[8px] border border-edge-mid bg-surface text-primary outline-none placeholder:text-muted focus-within:border-edge-strong focus:border-edge-strong";

/** The council's Memory tab. `onShow` scrolls the channel to a suggestion's messages and answers whether any of them is
 *  there; `onOpenSource` opens the thread of the idea or message the chosen direction came from. */
export function MemoryPanel({
    c,
    acts,
    onShow,
    onOpenSource,
}: {
    c: Council;
    acts: Actions;
    onShow: (ids: readonly string[]) => boolean;
    onOpenSource: (source: DirectionSource) => void;
}) {
    const [draft, setDraft] = useState("");
    const [editing, setEditing] = useState<string | null>(null); // the chosen direction's text while it is being edited
    const [failed, setFailed] = useState<string | null>(null);
    const [gone, setGone] = useState<number | null>(null); // the card (by its time) whose messages Show could not find
    const input = useRef<HTMLInputElement>(null);
    const card = shownCard(c);
    const chosen = c.memory?.chosen;
    const replaced = replacedRows(c);
    const held = card?.kind === "held";
    const busy = [...acts.busy].some((k) => k.startsWith(KEY));
    const checking = (action: CouncilDirectionAction) => acts.busy.has(`${KEY}${action}`);

    // one move: the shared actions run it one at a time, and a refusal is kept here as well, under the input
    const go = (what: string, action: CouncilDirectionAction, text?: string): Promise<boolean> => {
        setFailed(null);
        return acts.run(`${KEY}${action}`, what, async () => {
            const r = await directionCouncil(c.id, action, text);
            if (r.ok === false) {
                setFailed(`${what} failed: ${r.error}`);
            }
            return r;
        });
    };
    const set = async () => {
        const text = draft.trim();
        if (text !== "" && (await go("Set the direction", "set", text))) {
            setDraft("");
        }
    };
    const save = async () => {
        const text = (editing ?? "").trim();
        if (text !== "" && (await go("Edit the direction", "edit", text))) {
            setEditing(null);
        }
    };
    // the held direction's text goes back into the input to be changed, then Set
    const editHeld = (text: string) => {
        setDraft(text);
        input.current?.focus();
    };
    // a check suggestion rests on messages; an all green one on its idea
    const show = (ids: readonly string[], at: number) => setGone(onShow(ids) ? null : at);

    return (
        <div
            id="council-rail-memory"
            role="tabpanel"
            aria-label="Memory"
            data-council-memory
            className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-6 pb-[22px] pt-[4px] [scrollbar-gutter:stable]"
        >
            <span data-council-memory-caption className="flex-none text-[12px] text-muted">
                the seats read this before the Report
            </span>

            <form
                data-council-memory-form
                onSubmit={(e) => {
                    e.preventDefault();
                    void set();
                }}
                className={cn(FIELD, "flex h-[38px] flex-none items-center gap-2 pl-3 pr-[6px]")}
            >
                <input
                    ref={input}
                    type="text"
                    aria-label="Set the direction"
                    placeholder="Set the direction…"
                    data-council-memory-input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-primary outline-none placeholder:text-muted"
                />
                <button
                    type="submit"
                    data-council-memory-action="set"
                    disabled={busy || draft.trim() === ""}
                    className="h-[26px] flex-none cursor-pointer rounded-[6px] border border-edge-mid bg-surface-raised px-[10px] text-[12px] text-muted outline-none hover:border-edge-strong hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50"
                >
                    {checking("set") ? "Checking…" : "Set"}
                </button>
            </form>

            {failed != null && (
                <p
                    role="alert"
                    data-council-memory-error
                    className="m-0 -mt-[6px] flex-none text-[12.5px] text-error-soft"
                >
                    {failed}
                </p>
            )}

            {memoryEmpty(c) && (
                <p data-council-memory-empty className="m-0 flex-none text-[12.5px] leading-[1.5] text-muted">
                    Pin a message with Chốt, or write the direction here.
                </p>
            )}

            {card != null && (
                <section
                    aria-label={held ? "Held by the check" : "Suggested change"}
                    data-council-memory-card={card.kind}
                    className="flex flex-none flex-col gap-2 rounded-[8px] border border-edge-mid bg-surface px-[14px] py-3"
                >
                    <span
                        data-council-memory-kicker
                        className={cn("text-[11px]", held ? "text-warning-soft" : "text-accent-soft")}
                    >
                        {cardKicker(card)}
                    </span>
                    <span data-council-memory-card-text className="break-words text-[13px] leading-[1.45] text-primary">
                        {card.text}
                    </span>
                    {card.reason != null && card.reason !== "" && (
                        <span data-council-memory-reason className="break-words text-[12px] leading-[1.45] text-muted">
                            {card.reason}
                        </span>
                    )}
                    <div className="flex flex-wrap gap-2 pt-[2px]">
                        {held ? (
                            <>
                                <button
                                    type="button"
                                    data-council-memory-action="edit-held"
                                    disabled={busy}
                                    onClick={() => editHeld(card.text)}
                                    className={cn(secondaryButton, "text-primary")}
                                >
                                    Edit
                                </button>
                                <button
                                    type="button"
                                    data-council-memory-action="setanyway"
                                    disabled={busy}
                                    onClick={() => void go("Set anyway", "setanyway")}
                                    className={cn(secondaryButton, "text-muted")}
                                >
                                    Set anyway
                                </button>
                                <button
                                    type="button"
                                    data-council-memory-action="discard"
                                    disabled={busy}
                                    onClick={() => void go("Discard", "discard")}
                                    className={ghostButton}
                                >
                                    Discard
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    type="button"
                                    data-council-memory-action="accept"
                                    disabled={busy}
                                    onClick={() => void go("Make it the direction", "accept")}
                                    className={primaryButton}
                                >
                                    Make it the direction
                                </button>
                                <button
                                    type="button"
                                    data-council-memory-action="dismiss"
                                    disabled={busy}
                                    onClick={() => void go("Dismiss", "dismiss")}
                                    className={cn(secondaryButton, "text-muted")}
                                >
                                    Dismiss
                                </button>
                                {(card.messages?.length ?? 0) > 0 || (card.from ?? "") !== "" ? (
                                    <button
                                        type="button"
                                        data-council-memory-action="show"
                                        onClick={() =>
                                            show(
                                                card.messages != null && card.messages.length > 0
                                                    ? card.messages
                                                    : [card.from ?? ""],
                                                card.at
                                            )
                                        }
                                        className={ghostButton}
                                    >
                                        Show the messages
                                    </button>
                                ) : null}
                            </>
                        )}
                    </div>
                    {gone === card.at && (
                        <span role="status" data-council-memory-gone className="text-[12px] text-muted">
                            Those messages are not in the channel now.
                        </span>
                    )}
                </section>
            )}

            {chosen != null && (
                <section
                    aria-label="Chosen direction"
                    data-council-memory-chosen
                    className="flex flex-none flex-col gap-[6px]"
                >
                    <span className="text-[12px] font-semibold text-secondary">Chosen direction</span>
                    {editing == null ? (
                        <>
                            <span
                                data-council-memory-chosen-text
                                className="break-words text-[14px] leading-[1.5] text-primary"
                            >
                                {chosen.text}
                            </span>
                            <ChosenLine c={c} chosen={chosen} onOpenSource={onOpenSource} />
                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    data-council-memory-action="edit"
                                    disabled={busy}
                                    onClick={() => setEditing(chosen.text)}
                                    className={textButton}
                                >
                                    Edit
                                </button>
                                <button
                                    type="button"
                                    data-council-memory-action="unpin"
                                    disabled={busy}
                                    onClick={() => void go("Unpin", "unpin")}
                                    className={textButton}
                                >
                                    {checking("unpin") ? "Unpinning…" : "Unpin"}
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <textarea
                                aria-label="Edit the chosen direction"
                                data-council-memory-edit-input
                                rows={3}
                                autoFocus
                                value={editing}
                                onChange={(e) => setEditing(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Escape") {
                                        setEditing(null);
                                    }
                                }}
                                className={cn(FIELD, "w-full resize-none px-3 py-2 text-[14px] leading-[1.5]")}
                            />
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    data-council-memory-action="save"
                                    disabled={busy || editing.trim() === "" || editing.trim() === chosen.text}
                                    onClick={() => void save()}
                                    className={primaryButton}
                                >
                                    {checking("edit") ? "Checking…" : "Save"}
                                </button>
                                <button
                                    type="button"
                                    data-council-memory-action="cancel"
                                    disabled={busy}
                                    onClick={() => setEditing(null)}
                                    className={ghostButton}
                                >
                                    Cancel
                                </button>
                            </div>
                        </>
                    )}
                </section>
            )}

            {replaced.length > 0 && (
                <section
                    aria-label="Replaced"
                    data-council-memory-replaced
                    className="flex flex-none flex-col border-t border-border pt-3"
                >
                    <span className="pb-[6px] text-[12px] font-semibold text-muted">Replaced</span>
                    {replaced.map((row, i) => (
                        <div
                            key={i}
                            data-council-memory-replaced-row
                            className="flex flex-col gap-1 border-t border-edge-faint py-[9px]"
                        >
                            <span
                                data-council-memory-replaced-text
                                className="break-words text-[12.5px] leading-[1.45] text-muted line-through"
                            >
                                {row.text}
                            </span>
                            <span data-council-memory-replaced-line className="text-[12px] tabular-nums text-ink-faint">
                                {row.line}
                            </span>
                        </div>
                    ))}
                </section>
            )}
        </div>
    );
}

// who set the chosen direction, when, and the idea or message it came from as a link to that thread
function ChosenLine({
    c,
    chosen,
    onOpenSource,
}: {
    c: Council;
    chosen: CouncilMemoryDirection;
    onOpenSource: (source: DirectionSource) => void;
}) {
    const { how, time, source } = chosenLine(c, chosen);
    return (
        <span data-council-memory-chosen-line className="text-[12px] tabular-nums text-muted">
            {how} · {time}
            {source != null && (
                <>
                    {" · from "}
                    <button
                        type="button"
                        data-council-memory-source={source.id}
                        title={`Open ${source.label}`}
                        onClick={() => onOpenSource(source)}
                        className="cursor-pointer rounded-[4px] border-0 bg-transparent p-0 text-[12px] text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        {source.label}
                    </button>
                </>
            )}
        </span>
    );
}
