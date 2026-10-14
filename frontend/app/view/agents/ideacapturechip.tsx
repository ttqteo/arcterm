// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// "Add as idea": the chip that shows beside the end of a selection in an agent's terminal (Capture-Selection.dc.html).
// It never takes focus, so typing still reaches the agent: a press on it does not move focus off the terminal. Click it
// or press the shortcut to add the selection to the agent's Ideas. Where it shows and when is ideacapture.ts; the state
// the terminal feeds it is in ideasstore.ts.

import { KeyCap } from "@/app/element/keycap";
import { useAtomValue } from "jotai";
import { Lightbulb } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { chipPlacement, chipVisible } from "./ideacapture";
import { validSessionId } from "./ideasmodel";
import { ideaChipAtom, runIdeaCapture } from "./ideasstore";

// the chip's chord, as the keybinding names it (bindings.ts `idea-capture`)
export const IDEA_CAPTURE_CHORD = "Mod:Shift:i";

// IdeaCaptureChip draws inside its terminal's pane (the pane is its positioning parent). `sessionId` is the agent session
// of the terminal's block, null for a plain terminal.
export function IdeaCaptureChip({ blockId, sessionId }: { blockId: string; sessionId: string | null }) {
    const chip = useAtomValue(ideaChipAtom);
    const ref = useRef<HTMLDivElement>(null);
    const [at, setAt] = useState<{ left: number; top: number } | null>(null);
    const shown =
        chip != null &&
        chip.blockId === blockId &&
        chipVisible({ hasSelection: true, hasSession: validSessionId(sessionId), typedSinceSelect: chip.dismissed });

    // placed once it has a size to place, before it paints
    useLayoutEffect(() => {
        const el = ref.current;
        const hostBox = el?.offsetParent?.getBoundingClientRect();
        if (!shown || el == null || hostBox == null) {
            setAt(null);
            return;
        }
        setAt(
            chipPlacement({
                anchor: chip.anchor,
                cols: chip.cols,
                rows: chip.rows,
                screen: chip.screen,
                host: { left: hostBox.left, top: hostBox.top, width: hostBox.width, height: hostBox.height },
                chip: { width: el.offsetWidth, height: el.offsetHeight },
            })
        );
    }, [shown, chip]);

    if (!shown) {
        return null;
    }
    return (
        <div
            ref={ref}
            data-ideas-capture-chip
            style={{ left: at?.left ?? 0, top: at?.top ?? 0, visibility: at == null ? "hidden" : "visible" }}
            // a press must not move focus off the terminal, or the next key would not reach the agent
            onMouseDown={(e) => e.preventDefault()}
            className="absolute z-10 flex items-center gap-[8px] rounded-[6px] border border-edge-mid bg-surface-raised py-[4px] pl-[10px] pr-[6px] shadow-lg"
        >
            <button
                type="button"
                tabIndex={-1}
                data-ideas-capture-add
                onClick={() => void runIdeaCapture(null)}
                className="flex cursor-pointer items-center gap-[6px] border-0 bg-transparent p-0 text-[12px] text-primary"
            >
                <Lightbulb size={13} strokeWidth={1.8} aria-hidden />
                Add as idea
            </button>
            <KeyCap chord={IDEA_CAPTURE_CHORD} variant="inline" />
        </div>
    );
}
