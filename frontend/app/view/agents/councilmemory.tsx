// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Memory tab of the council's rail (boards C-merged, C-add and C-empty in .superpowers/design/council-memory;
// councilmemorymodel.ts derives what it draws): what the discussion has reached, which every seat reads before it
// answers. Top to bottom: the Add form (opened from the tab strip, or by the held card's Edit), the one card that waits (a
// suggestion with Make it the direction / Dismiss and the messages it rests on as links, or a held direction with its
// reason and Edit / Set anyway / Discard), then one list: the Direction pinned on top (its earlier ones under Earlier · N)
// and the entries, newest first, each with a badge whose tooltip says what its kind means. An entry's actions (Chốt, Edit,
// Remove) and its details (who, from what, when) show on hover and on focus; an empty memory shows the four badges as a
// legend. Every move is a `directionCouncil` or `memoryCouncil` call through the discussion's `acts`, one at a time (a set,
// pin or edit of the direction is checked first, so its button reads Checking… while it runs); a refusal shows under the
// form or editor and, as for the thumbs, in the discussion's header. Every part carries a data-council-memory-* attribute
// for the CDP scenario `council-memory`.

import { PopoverReveal } from "@/app/element/popoverreveal";
import { cn } from "@/util/util";
import { useAtom } from "jotai";
import { ChevronDown, ChevronRight, Info, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Actions } from "./councilactions";
import {
    ADD_KINDS,
    cardKicker,
    cardLinks,
    chosenLine,
    directionSource,
    entryDetails,
    KIND_LABEL,
    KIND_MEANING,
    kindTakesWhy,
    memoryEntries,
    memoryIsEmpty,
    newEntryIds,
    replacedRows,
    shownCard,
    type DirectionSource,
    type MemoryKind,
} from "./councilmemorymodel";
import { memorySeenAtom } from "./councilmemoryseen";
import { directionCouncil, memoryCouncil, type CouncilCall, type CouncilDirectionAction } from "./councilstore";

// the action keys: every move shares one of two prefixes, so the panel holds still while any one runs (a pin from the
// channel included: its check is on the same direction)
const DIRECTION = "direction:";
const MEMORY = "memory:";

const primaryButton =
    "h-[28px] cursor-pointer rounded-[6px] border-0 bg-accent px-3 text-[12.5px] font-semibold text-background outline-none hover:bg-accenthover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";
const secondaryButton =
    "h-[28px] cursor-pointer rounded-[6px] border border-edge-mid bg-surface-raised px-3 text-[12.5px] text-secondary outline-none hover:border-edge-strong hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";
const ghostButton =
    "h-[28px] cursor-pointer rounded-[6px] border-0 bg-transparent px-[8px] text-[12.5px] text-muted outline-none hover:text-secondary focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";
// an action on a row's badge line: plain words, as the board draws them
const rowButton =
    "flex cursor-pointer items-center gap-1 rounded-[4px] border-0 bg-transparent p-0 text-[12px] text-secondary outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50";
const linkButton =
    "cursor-pointer rounded-[4px] border-0 bg-transparent p-0 text-[12px] text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent";
const FIELD =
    "rounded-[8px] border border-edge-mid bg-surface text-primary outline-none placeholder:text-muted focus-within:border-edge-strong focus:border-edge-strong";
// a row's actions show while the row is hovered or holds focus, so a keyboard reaches them (they are never display:none)
const REVEAL = "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100";

// the badge of each kind: whole class names, so Tailwind finds them
const BADGE: Record<MemoryKind, string> = {
    direction: "bg-surface-selected font-semibold text-primary",
    agreed: "bg-pill text-success-soft",
    ruledout: "bg-pill text-secondary",
    open: "bg-pill text-warning-soft",
};

// what the Add form's text field is called, by kind
const ADD_LABEL: Record<MemoryKind, string> = {
    direction: "The direction",
    agreed: "What was agreed",
    ruledout: "What was ruled out",
    open: "What is still open",
};

/** The Add form's starting point: the kind picked and the text in it. `seq` tells a new opening from a re-render, so the
 *  form starts afresh (the held card's Edit opens it again with another text). */
export interface AddDraft {
    kind: MemoryKind;
    text: string;
    seq: number;
}

// the entry or direction whose text is being edited in place (`id` is the entry's, or DIRECTION_ID)
interface Editing {
    id: string;
    text: string;
    why: string;
}
const DIRECTION_ID = "direction";

/** The council's Memory tab. `onShow` scrolls the channel to the messages a suggestion rests on and answers whether any of
 *  them is there; `onOpenSource` opens the thread of the idea or message a direction or an entry came from; `adding` is
 *  the Add form (null while it is closed) and `onAdding` opens or closes it (the tab strip's + Add is in the rail). */
export function MemoryPanel({
    c,
    acts,
    onShow,
    onOpenSource,
    adding,
    onAdding,
}: {
    c: Council;
    acts: Actions;
    onShow: (ids: readonly string[]) => boolean;
    onOpenSource: (source: DirectionSource) => void;
    adding: AddDraft | null;
    onAdding: (draft: AddDraft | null) => void;
}) {
    const [editing, setEditing] = useState<Editing | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const [gone, setGone] = useState<number | null>(null); // the card (by its time) whose messages Show could not find
    const [pinning, setPinning] = useState<string | null>(null); // the entry whose Chốt is being checked
    const [earlierOpen, setEarlierOpen] = useState(false);
    const [seen, setSeen] = useAtom(memorySeenAtom);
    // the time the tab was last open, taken as it opens: what came in after it carries a dot for as long as the tab shows
    const [since] = useState(() => seen[c.id]);
    const card = shownCard(c);
    const chosen = c.memory?.chosen;
    const replaced = replacedRows(c);
    const entries = useMemo(() => memoryEntries(c), [c]);
    const fresh = useMemo(() => newEntryIds(c, since), [c, since]);
    const held = card?.kind === "held";
    const busy = [...acts.busy].some((k) => k.startsWith(DIRECTION) || k.startsWith(MEMORY));
    const checking = (action: CouncilDirectionAction) => acts.busy.has(`${DIRECTION}${action}`);

    // the tab is being looked at: what is in it now is seen, and what comes in while it shows is too
    useEffect(() => {
        setSeen((m) => ({ ...m, [c.id]: Date.now() }));
    }, [c.id, entries.length, setSeen]);

    // one move: the shared actions run it one at a time, and a refusal is kept here as well, under the form or editor
    const go = (key: string, what: string, fn: () => Promise<CouncilCall<void>>): Promise<boolean> => {
        setFailed(null);
        return acts.run(key, what, async () => {
            const r = await fn();
            if (r.ok === false) {
                setFailed(`${what} failed: ${r.error}`);
            }
            return r;
        });
    };
    const direction = (what: string, action: CouncilDirectionAction, text?: string) =>
        go(`${DIRECTION}${action}`, what, () => directionCouncil(c.id, action, text));

    const add = async (kind: MemoryKind, text: string, why: string): Promise<boolean> => {
        const ok =
            kind === "direction"
                ? await direction("Set the direction", "set", text)
                : await go(`${MEMORY}add`, "Add to memory", () =>
                      memoryCouncil(c.id, "add", { kind, text, why: kindTakesWhy(kind) ? why : "" })
                  );
        if (ok) {
            onAdding(null);
        }
        return ok;
    };
    const save = async () => {
        if (editing == null) {
            return;
        }
        const text = editing.text.trim();
        const why = editing.why.trim();
        if (text === "") {
            return;
        }
        const ok =
            editing.id === DIRECTION_ID
                ? await direction("Edit the direction", "edit", text)
                : await go(`${MEMORY}edit`, "Edit the entry", () =>
                      memoryCouncil(c.id, "edit", { entry: editing.id, text, why })
                  );
        if (ok) {
            setEditing(null);
        }
    };
    // Chốt on an entry: it becomes the direction through the pre-set check, and leaves the list once set
    const chot = async (e: CouncilMemoryEntry) => {
        setPinning(e.id);
        await go(`${DIRECTION}pin`, "Chốt", () => directionCouncil(c.id, "pin", e.text, undefined, e.id));
        setPinning(null);
    };
    const remove = (e: CouncilMemoryEntry) =>
        void go(`${MEMORY}remove`, "Remove", () => memoryCouncil(c.id, "remove", { entry: e.id }));
    // the held direction's text goes into the Add form with Direction picked, to be changed, then Add: a plain set, so an
    // entry the held pin came from stays in the list
    const editHeld = (text: string) => onAdding({ kind: "direction", text, seq: Date.now() });
    // a check suggestion rests on messages; an all green one on its idea
    const show = (ids: readonly string[], at: number) => setGone(onShow(ids) ? null : at);
    const open = (id: string) => {
        const source = directionSource(c, id);
        if (source != null) {
            onOpenSource(source);
        }
    };
    const edit = (id: string, text: string, why: string) => {
        setFailed(null);
        setEditing({ id, text, why });
    };

    return (
        <div
            id="council-rail-memory"
            role="tabpanel"
            aria-label="Memory"
            data-council-memory
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6 pt-2 [scrollbar-gutter:stable]"
        >
            {adding != null && (
                <AddForm
                    key={adding.seq}
                    draft={adding}
                    busy={busy}
                    checking={checking("set")}
                    onAdd={add}
                    onCancel={() => {
                        setFailed(null);
                        onAdding(null);
                    }}
                />
            )}

            {failed != null && editing == null && (
                <p role="alert" data-council-memory-error className="m-0 -mt-1 flex-none text-[12.5px] text-error-soft">
                    {failed}
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
                    <span
                        data-council-memory-card-text
                        className="break-words text-[13.5px] leading-[1.45] text-primary"
                    >
                        {card.text}
                    </span>
                    {((card.reason != null && card.reason !== "") || (!held && cardLinks(card).length > 0)) && (
                        <span data-council-memory-reason className="break-words text-[12px] leading-[1.45] text-muted">
                            {card.reason}
                            {!held &&
                                cardLinks(card).map((id) => (
                                    <span key={id}>
                                        {" "}
                                        <button
                                            type="button"
                                            data-council-memory-reason-link={id}
                                            onClick={() => show([id], card.at)}
                                            className={linkButton}
                                        >
                                            {id}
                                        </button>
                                    </span>
                                ))}
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
                                    onClick={() => void direction("Set anyway", "setanyway")}
                                    className={cn(secondaryButton, "text-muted")}
                                >
                                    Set anyway
                                </button>
                                <button
                                    type="button"
                                    data-council-memory-action="discard"
                                    disabled={busy}
                                    onClick={() => void direction("Discard", "discard")}
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
                                    onClick={() => void direction("Make it the direction", "accept")}
                                    className={primaryButton}
                                >
                                    Make it the direction
                                </button>
                                <button
                                    type="button"
                                    data-council-memory-action="dismiss"
                                    disabled={busy}
                                    onClick={() => void direction("Dismiss", "dismiss")}
                                    className={ghostButton}
                                >
                                    Dismiss
                                </button>
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

            {memoryIsEmpty(c) && <EmptyLegend />}

            {(chosen != null || entries.length > 0) && (
                <section aria-label="Memory" className="flex flex-none flex-col">
                    {chosen != null && (
                        <div
                            data-council-memory-direction
                            className="group -mx-2 flex flex-col gap-[6px] rounded-[6px] px-2 pb-[14px] pt-[10px] hover:bg-surface focus-within:bg-surface"
                        >
                            {editing?.id === DIRECTION_ID ? (
                                <Editor
                                    editing={editing}
                                    original={{ text: chosen.text, why: "" }}
                                    why={false}
                                    label="Edit the direction"
                                    busy={busy}
                                    saving={checking("edit")}
                                    failed={failed}
                                    onChange={setEditing}
                                    onSave={() => void save()}
                                    onCancel={() => {
                                        setFailed(null);
                                        setEditing(null);
                                    }}
                                />
                            ) : (
                                <>
                                    <span
                                        data-council-memory-direction-text
                                        className="break-words text-[15px] font-medium leading-[1.5] text-primary"
                                    >
                                        {chosen.text}
                                    </span>
                                    <div className="flex items-center gap-3 text-[12px] text-muted">
                                        <Badge kind="direction" />
                                        <span className="flex-1" />
                                        <div
                                            className={cn(
                                                "flex items-center gap-3",
                                                earlierOpen ? "opacity-100" : REVEAL
                                            )}
                                        >
                                            {replaced.length > 0 && (
                                                <button
                                                    type="button"
                                                    data-council-memory-action="earlier"
                                                    aria-expanded={earlierOpen}
                                                    onClick={() => setEarlierOpen((o) => !o)}
                                                    className={rowButton}
                                                >
                                                    {earlierOpen ? (
                                                        <ChevronDown size={12} strokeWidth={2} aria-hidden />
                                                    ) : (
                                                        <ChevronRight size={12} strokeWidth={2} aria-hidden />
                                                    )}
                                                    Earlier · {replaced.length}
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                data-council-memory-action="edit"
                                                disabled={busy}
                                                onClick={() => edit(DIRECTION_ID, chosen.text, "")}
                                                className={rowButton}
                                            >
                                                Edit
                                            </button>
                                            <button
                                                type="button"
                                                data-council-memory-action="unpin"
                                                disabled={busy}
                                                onClick={() => void direction("Unpin", "unpin")}
                                                className={rowButton}
                                            >
                                                {checking("unpin") ? "Unpinning…" : "Unpin"}
                                            </button>
                                            <Details>
                                                <DirectionLine c={c} chosen={chosen} onOpenSource={onOpenSource} />
                                            </Details>
                                        </div>
                                    </div>
                                </>
                            )}
                            {earlierOpen && replaced.length > 0 && (
                                <div
                                    data-council-memory-earlier
                                    className="mt-1 flex flex-col gap-3 border-0 border-l-2 border-solid border-edge-mid pl-3"
                                >
                                    {replaced.map((row, i) => (
                                        <div
                                            key={i}
                                            data-council-memory-earlier-row
                                            className="flex flex-col gap-[3px]"
                                        >
                                            <span className="break-words text-[12.5px] leading-[1.45] text-muted">
                                                {row.text}
                                            </span>
                                            <span className="text-[12px] tabular-nums text-ink-faint">{row.line}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {entries.map((e) => {
                        const kind = e.kind as MemoryKind;
                        const details = entryDetails(e);
                        const mine = editing?.id === e.id;
                        return (
                            <div
                                key={e.id}
                                data-council-memory-entry={e.id}
                                data-kind={e.kind}
                                className="group -mx-2 flex flex-col gap-[6px] rounded-[6px] border-0 border-t border-solid border-edge-faint px-2 py-3 hover:bg-surface focus-within:bg-surface"
                            >
                                {mine ? (
                                    <Editor
                                        editing={editing}
                                        original={{ text: e.text, why: e.why ?? "" }}
                                        why={kindTakesWhy(kind)}
                                        label={`Edit ${KIND_LABEL[kind].toLowerCase()}`}
                                        busy={busy}
                                        saving={acts.busy.has(`${MEMORY}edit`)}
                                        failed={failed}
                                        onChange={setEditing}
                                        onSave={() => void save()}
                                        onCancel={() => {
                                            setFailed(null);
                                            setEditing(null);
                                        }}
                                    />
                                ) : (
                                    <>
                                        <span
                                            data-council-memory-entry-text
                                            className="break-words text-[13.5px] leading-[1.5] text-primary"
                                        >
                                            {e.text}
                                        </span>
                                        {kindTakesWhy(kind) && (e.why ?? "") !== "" && (
                                            <span
                                                data-council-memory-entry-why
                                                className="break-words text-[12.5px] leading-[1.45] text-muted"
                                            >
                                                {e.why}
                                            </span>
                                        )}
                                        <div className="flex items-center gap-[6px] text-[12px] tabular-nums text-muted">
                                            <Badge kind={kind} />
                                            {fresh.has(e.id) && (
                                                <span
                                                    role="img"
                                                    aria-label="New"
                                                    data-council-memory-new
                                                    className="h-[6px] w-[6px] flex-none rounded-full bg-accent-soft"
                                                />
                                            )}
                                            <span className="flex-1" />
                                            <div className={cn("flex items-center gap-3", REVEAL)}>
                                                <button
                                                    type="button"
                                                    data-council-memory-action="chot"
                                                    disabled={busy}
                                                    onClick={() => void chot(e)}
                                                    className={rowButton}
                                                >
                                                    {pinning === e.id ? "Checking…" : "Chốt"}
                                                </button>
                                                <button
                                                    type="button"
                                                    data-council-memory-action="edit"
                                                    disabled={busy}
                                                    onClick={() => edit(e.id, e.text, e.why ?? "")}
                                                    className={rowButton}
                                                >
                                                    Edit
                                                </button>
                                                <Details>
                                                    {details.who == null ? (
                                                        <span>You · {details.time}</span>
                                                    ) : (
                                                        <>
                                                            <span className="text-primary">{details.who}</span>
                                                            <span className="tabular-nums">
                                                                {details.messages.map((id) => (
                                                                    <span key={id}>
                                                                        {directionSource(c, id) != null ? (
                                                                            <button
                                                                                type="button"
                                                                                data-council-memory-message={id}
                                                                                onClick={() => open(id)}
                                                                                className={linkButton}
                                                                            >
                                                                                {id}
                                                                            </button>
                                                                        ) : (
                                                                            id
                                                                        )}
                                                                        {" · "}
                                                                    </span>
                                                                ))}
                                                                {details.time}
                                                            </span>
                                                        </>
                                                    )}
                                                </Details>
                                                <button
                                                    type="button"
                                                    data-council-memory-action="remove"
                                                    aria-label="Remove"
                                                    title="Remove"
                                                    disabled={busy}
                                                    onClick={() => remove(e)}
                                                    className={rowButton}
                                                >
                                                    <X size={13} strokeWidth={2} aria-hidden />
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        );
                    })}
                </section>
            )}
        </div>
    );
}

// a kind's badge: the word, with what it means as its tooltip
function Badge({ kind }: { kind: MemoryKind }) {
    return (
        <span
            data-council-memory-badge={kind}
            title={KIND_MEANING[kind]}
            className={cn("flex-none whitespace-nowrap rounded-full px-[7px] py-px text-[11px]", BADGE[kind])}
        >
            {KIND_LABEL[kind]}
        </span>
    );
}

// the empty tab (board C-empty): one muted line and the four badges with their meanings as a legend
function EmptyLegend() {
    return (
        <>
            <p data-council-memory-empty className="m-0 flex-none text-[12.5px] leading-[1.55] text-muted">
                Nothing yet. What the seats agree on, rule out or leave open shows up here after each round.
            </p>
            <dl
                data-council-memory-legend
                className="m-0 grid flex-none grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-3 gap-y-[10px] text-[12.5px] leading-[1.45]"
            >
                {ADD_KINDS.map((kind) => (
                    <div key={kind} className="contents">
                        <dt className="justify-self-start">
                            <Badge kind={kind} />
                        </dt>
                        <dd className="m-0 text-secondary">{KIND_MEANING[kind]}</dd>
                    </div>
                ))}
            </dl>
        </>
    );
}

// the info button of a row and the small popover it opens on hover or focus; what is inside says who made the row, from
// what and when. It hangs from the button with no gap, so the pointer can cross onto it (its message ids are links)
function Details({ children }: { children: ReactNode }) {
    const [open, setOpen] = useState(false);
    return (
        <span
            className="relative flex"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            onFocus={() => setOpen(true)}
            onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setOpen(false);
                }
            }}
        >
            <button
                type="button"
                aria-label="Details"
                aria-expanded={open}
                data-council-memory-details
                onKeyDown={(e) => {
                    if (e.key === "Escape") {
                        setOpen(false);
                    }
                }}
                className="flex cursor-pointer items-center rounded-[4px] border-0 bg-transparent p-0 text-secondary outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-accent"
            >
                <Info size={13} strokeWidth={2} aria-hidden />
            </button>
            <PopoverReveal open={open} origin="top right" className="absolute right-[-10px] top-full z-[2] pt-[6px]">
                <div
                    role="group"
                    aria-label="Details"
                    data-council-memory-popover
                    className="flex flex-col gap-1 whitespace-nowrap rounded-[8px] border border-edge-strong bg-surface-raised px-[11px] py-[9px] text-[12px] leading-[1.45] text-secondary shadow-popover-sm"
                >
                    {children}
                </div>
            </PopoverReveal>
        </span>
    );
}

// how the direction was set, when, and the idea or message it came from as a link to that thread
function DirectionLine({
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
        <span data-council-memory-chosen-line className="tabular-nums">
            {how} · {time}
            {source != null && (
                <>
                    {" · from "}
                    <button
                        type="button"
                        data-council-memory-source={source.id}
                        title={`Open ${source.label}`}
                        onClick={() => onOpenSource(source)}
                        className={linkButton}
                    >
                        {source.label}
                    </button>
                </>
            )}
        </span>
    );
}

// the in-place editor of an entry's text (and a Ruled out entry's why), or of the direction's text; Escape cancels
function Editor({
    editing,
    original,
    why,
    label,
    busy,
    saving,
    failed,
    onChange,
    onSave,
    onCancel,
}: {
    editing: Editing;
    original: { text: string; why: string };
    why: boolean;
    label: string;
    busy: boolean;
    saving: boolean;
    failed: string | null;
    onChange: (e: Editing) => void;
    onSave: () => void;
    onCancel: () => void;
}) {
    const text = editing.text.trim();
    const changed = text !== original.text || (why && editing.why.trim() !== original.why);
    return (
        <div
            data-council-memory-editor
            className="flex flex-col gap-2"
            onKeyDown={(e) => {
                if (e.key === "Escape") {
                    onCancel();
                }
            }}
        >
            <textarea
                aria-label={label}
                data-council-memory-edit-text
                rows={3}
                autoFocus
                value={editing.text}
                onChange={(e) => onChange({ ...editing, text: e.target.value })}
                className={cn(FIELD, "w-full resize-none px-3 py-2 text-[13.5px] leading-[1.5]")}
            />
            {why && (
                <input
                    type="text"
                    aria-label="Why"
                    placeholder="Why (optional)"
                    data-council-memory-edit-why
                    value={editing.why}
                    onChange={(e) => onChange({ ...editing, why: e.target.value })}
                    className={cn(FIELD, "h-[32px] w-full px-3 text-[12.5px]")}
                />
            )}
            {failed != null && (
                <p role="alert" data-council-memory-error className="m-0 text-[12.5px] text-error-soft">
                    {failed}
                </p>
            )}
            <div className="flex gap-2">
                <button
                    type="button"
                    data-council-memory-action="save"
                    disabled={busy || text === "" || !changed}
                    onClick={onSave}
                    className={primaryButton}
                >
                    {saving ? "Checking…" : "Save"}
                </button>
                <button
                    type="button"
                    data-council-memory-action="cancel"
                    disabled={busy}
                    onClick={onCancel}
                    className={ghostButton}
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}

// the Add form (board C-add): the kind picked, the text, a why for Ruled out, Add and Cancel. Direction is a set: it goes
// through the pre-set check and may come back held on the card
function AddForm({
    draft,
    busy,
    checking,
    onAdd,
    onCancel,
}: {
    draft: AddDraft;
    busy: boolean;
    checking: boolean;
    onAdd: (kind: MemoryKind, text: string, why: string) => Promise<boolean>;
    onCancel: () => void;
}) {
    const [kind, setKind] = useState<MemoryKind>(draft.kind);
    const [text, setText] = useState(draft.text);
    const [why, setWhy] = useState("");
    const ready = text.trim() !== "";
    return (
        <form
            aria-label="Add to memory"
            data-council-memory-add
            onSubmit={(e) => {
                e.preventDefault();
                if (ready && !busy) {
                    void onAdd(kind, text.trim(), why.trim());
                }
            }}
            onKeyDown={(e) => {
                if (e.key === "Escape") {
                    onCancel();
                }
            }}
            className="flex flex-none flex-col gap-[10px] rounded-[8px] border border-edge-strong bg-surface px-3 py-[10px]"
        >
            <div
                role="radiogroup"
                aria-label="Kind"
                className="flex gap-[2px] self-start rounded-[6px] bg-background p-[2px]"
            >
                {ADD_KINDS.map((k) => (
                    <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={kind === k}
                        data-council-memory-kind={k}
                        onClick={() => setKind(k)}
                        className={cn(
                            "h-[24px] cursor-pointer whitespace-nowrap rounded-[5px] border-0 px-[9px] text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-accent",
                            kind === k
                                ? "bg-surface-selected font-semibold text-primary"
                                : "bg-transparent text-muted hover:text-secondary"
                        )}
                    >
                        {KIND_LABEL[k]}
                    </button>
                ))}
            </div>
            <input
                type="text"
                autoFocus
                aria-label={ADD_LABEL[kind]}
                placeholder={`${ADD_LABEL[kind]}…`}
                data-council-memory-add-text
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="min-w-0 border-0 bg-transparent p-0 text-[13.5px] text-primary outline-none placeholder:text-muted"
            />
            {kindTakesWhy(kind) && (
                <input
                    type="text"
                    aria-label="Why"
                    placeholder="Why (optional)"
                    data-council-memory-add-why
                    value={why}
                    onChange={(e) => setWhy(e.target.value)}
                    className="min-w-0 border-0 bg-transparent p-0 text-[12.5px] text-primary outline-none placeholder:text-muted"
                />
            )}
            <div className="flex gap-2 pt-[2px]">
                <button
                    type="submit"
                    data-council-memory-action="add"
                    disabled={busy || !ready}
                    className={primaryButton}
                >
                    {checking ? "Checking…" : "Add"}
                </button>
                <button
                    type="button"
                    data-council-memory-action="cancel"
                    disabled={busy}
                    onClick={onCancel}
                    className={ghostButton}
                >
                    Cancel
                </button>
            </div>
        </form>
    );
}
