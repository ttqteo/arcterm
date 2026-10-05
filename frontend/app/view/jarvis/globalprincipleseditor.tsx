// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Controlled editor for the global principle list. Separate from PrinciplesEditor on purpose: a project
// edits a *patch* against a baseline (override / disable / inherit), and none of those three affordances
// mean anything when the list you are editing IS the baseline. Global scope is a plain ordered list, and
// reduceGlobalPrinciples is its pure reducer.

import { cn } from "@/util/util";
import { PlusIcon, PRINCIPLE_ADD_BTN, PROFILE_PANEL } from "./principleseditor";
import { reduceGlobalPrinciples, type GlobalPrincipleAction } from "./profilemodel";

// text that reads as plain until hovered or focused, so the list is a list and not a stack of inputs
const INLINE_BOX =
    "field-sizing-content min-h-[34px] w-full resize-none rounded-[6px] border px-2 py-1.5 text-[13px] leading-[1.5] text-ink-hi placeholder:text-muted outline-none focus:border-accent/40 focus:bg-background";
const ICON_BTN =
    "flex h-6 w-6 cursor-pointer items-center justify-center rounded-[5px] text-ink-mid hover:bg-surface-raised hover:text-secondary disabled:cursor-default disabled:text-edge-strong disabled:hover:bg-transparent";

function Icon({ d }: { d: string }) {
    return (
        <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d={d} />
        </svg>
    );
}

function IconButton({
    label,
    d,
    onClick,
    disabled = false,
    danger = false,
}: {
    label: string;
    d: string;
    onClick: () => void;
    disabled?: boolean;
    danger?: boolean;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className={cn(ICON_BTN, danger && "hover:text-error")}
        >
            <Icon d={d} />
        </button>
    );
}

export function GlobalPrinciplesEditor({
    principles,
    notes,
    disabled = false,
    onChange,
}: {
    principles: Principle[];
    // by principle id: the projects an edit to it will not reach
    notes: Record<string, { text: string; warn: boolean } | null>;
    disabled?: boolean;
    onChange: (list: Principle[]) => void;
}) {
    const dispatch = (action: GlobalPrincipleAction) => onChange(reduceGlobalPrinciples(principles, action));
    const last = principles.length - 1;
    return (
        <fieldset
            disabled={disabled}
            data-jarvis-global-principles="editor"
            className="m-0 flex min-w-0 flex-col border-0 p-0 disabled:opacity-60"
        >
            <div className={PROFILE_PANEL}>
                {principles.map((p, i) => {
                    const num = i + 1;
                    const note = notes[p.id];
                    return (
                        <div key={p.id} className="flex items-start gap-2 py-2 pr-2.5 pl-1.5">
                            <span
                                aria-hidden="true"
                                className="w-[18px] flex-none pt-2 text-right text-[11px] tabular-nums text-ink-faint"
                            >
                                {num}
                            </span>
                            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                                <textarea
                                    aria-label={`Global principle ${num}`}
                                    value={p.text}
                                    onChange={(e) => dispatch({ type: "update", id: p.id, text: e.target.value })}
                                    placeholder="New principle…"
                                    className={cn(
                                        INLINE_BOX,
                                        p.text === ""
                                            ? "border-dashed border-edge-strong bg-background"
                                            : "border-transparent bg-transparent hover:border-edge-mid"
                                    )}
                                />
                                {note != null ? (
                                    <span
                                        className={cn(
                                            "flex items-center gap-1.5 pl-2 text-[11.5px]",
                                            note.warn ? "text-asking" : "text-muted"
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "h-[5px] w-[5px] flex-none rounded-full",
                                                note.warn ? "bg-asking" : "bg-muted"
                                            )}
                                        />
                                        {note.text}
                                    </span>
                                ) : null}
                            </div>
                            <div className="flex flex-none items-center gap-0.5 pt-1">
                                <IconButton
                                    label={`Move principle ${num} up`}
                                    d="m18 15-6-6-6 6"
                                    disabled={i === 0}
                                    onClick={() => dispatch({ type: "move", id: p.id, dir: -1 })}
                                />
                                <IconButton
                                    label={`Move principle ${num} down`}
                                    d="m6 9 6 6 6-6"
                                    disabled={i === last}
                                    onClick={() => dispatch({ type: "move", id: p.id, dir: 1 })}
                                />
                                <IconButton
                                    label={`Delete principle ${num}`}
                                    d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"
                                    danger
                                    onClick={() => dispatch({ type: "delete", id: p.id })}
                                />
                            </div>
                        </div>
                    );
                })}
                <button
                    type="button"
                    onClick={() =>
                        dispatch({ type: "add", principle: { id: `custom-${crypto.randomUUID()}`, text: "" } })
                    }
                    className={PRINCIPLE_ADD_BTN}
                >
                    <PlusIcon />
                    Add a global principle
                </button>
            </div>
        </fieldset>
    );
}
