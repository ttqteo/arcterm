// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The A/B/C chips Arc draws over a clickable prototype's variant slots (docs/superpowers/specs/2026-11-27-prototype-
// feedback-design.md): one segmented chip per slot, on the slot's top-right edge, like swapping a component instance in
// Figma. The board reports where each slot is (protomodel.ts ProtoReport); a click on a letter only says which one was
// picked, and the letter that stays pressed is the one the board reports showing next (shownLetter), never the click.
// Drawn inside a BoardFrameView's frame, in the board's page px times the frame's scale.

import { cn } from "@/util/util";
import { Fragment, useState } from "react";
import { HIDE_WHILE_CAPTURING, shownLetter, type ProtoReport } from "./protomodel";

// the chip sits half out of its slot, as board D draws it: this far above the slot's top edge and in from its right edge
const CHIP_RISE = 12;
const CHIP_INSET = 12;
// a slot at the very top of the page would put its chip above the frame, where the frame's overflow clips it
const CHIP_MIN_TOP = 2;

export function SlotChips({
    report,
    scale,
    onPick,
}: {
    report: ProtoReport;
    // the frame's scale: the board's page px times this are the frame's px
    scale: number;
    onPick: (slotId: string, letter: string) => void;
}) {
    // the slot whose chip the pointer or the keyboard is on, whose region is outlined
    const [on, setOn] = useState<string | null>(null);
    return (
        <>
            {report.slots.map((slot) => {
                const { x, y, w, h } = slot.rect;
                const shown = shownLetter(slot);
                const hot = on === slot.id;
                return (
                    <Fragment key={slot.id}>
                        {hot ? (
                            <div
                                data-slot-outline={slot.id}
                                className={cn(
                                    "pointer-events-none absolute z-20 rounded-[8px] border-[1.5px] border-dashed border-accent",
                                    HIDE_WHILE_CAPTURING
                                )}
                                style={{ left: x * scale, top: y * scale, width: w * scale, height: h * scale }}
                            />
                        ) : null}
                        <div
                            role="group"
                            aria-label={`Variant of ${slot.label}`}
                            data-slot-chip={slot.id}
                            data-slot-shown={shown}
                            // a press on a chip is never the start of a mark, and does not move focus off the surface's keys
                            onPointerDown={(e) => e.stopPropagation()}
                            onMouseDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onPointerEnter={() => setOn(slot.id)}
                            onPointerLeave={() => setOn((cur) => (cur === slot.id ? null : cur))}
                            onFocus={() => setOn(slot.id)}
                            onBlur={() => setOn((cur) => (cur === slot.id ? null : cur))}
                            className={cn(
                                "absolute z-20 flex -translate-x-full cursor-default select-none gap-[2px] rounded-[6px] border border-accent bg-surface-raised p-[2px]",
                                HIDE_WHILE_CAPTURING
                            )}
                            style={{
                                left: (x + w) * scale - CHIP_INSET,
                                top: Math.max(CHIP_MIN_TOP, y * scale - CHIP_RISE),
                            }}
                        >
                            {slot.letters.map((letter) => (
                                <button
                                    key={letter}
                                    type="button"
                                    data-slot-letter={letter}
                                    aria-pressed={letter === shown}
                                    title={`${slot.label}: ${letter}`}
                                    onClick={() => onPick(slot.id, letter)}
                                    className={cn(
                                        "min-w-[24px] cursor-pointer rounded-[4px] border-0 px-[9px] py-[2px] text-[12px] font-semibold leading-[1.4] outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                        letter === shown
                                            ? "bg-surface-selected text-primary"
                                            : "bg-transparent text-muted hover:text-secondary"
                                    )}
                                >
                                    {letter}
                                </button>
                            ))}
                        </div>
                    </Fragment>
                );
            })}
        </>
    );
}
