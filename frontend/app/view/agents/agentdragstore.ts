// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Whether an agent is being dragged (from a tree row or a cell's bar), and which one. The drop overlays
// (griddropoverlay.tsx) exist only while this is set, so nothing sits over xterm the rest of the time.

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { AGENT_DRAG_MIME } from "./griddrop";

export const agentDragAtom = atom<{ id: string } | null>(null);

interface DragSource {
    dataTransfer: { setData(format: string, data: string): void; effectAllowed: string } | null;
}

let disarm: (() => void) | null = null;
const FAILSAFE_GRACE_MS = 300;

// A drag whose source unmounts mid-drag (its agent exits) never fires dragend, which would leave the overlays up
// for good. dragend and drop reach window last (bubbling, after React's own handlers, so the overlay's onDrop has
// already run); pointermove and keydown only arrive once the drag is over, and are ignored for a moment after it
// starts so a stray one cannot end it at once.
function armFailsafe(): void {
    if (typeof window === "undefined" || disarm != null) {
        return;
    }
    const armedAt = performance.now();
    const stop = () => endAgentDrag();
    const stopLate = () => {
        if (performance.now() - armedAt > FAILSAFE_GRACE_MS) {
            endAgentDrag();
        }
    };
    window.addEventListener("dragend", stop);
    window.addEventListener("drop", stop);
    window.addEventListener("pointermove", stopLate, true);
    window.addEventListener("keydown", stopLate, true);
    disarm = () => {
        window.removeEventListener("dragend", stop);
        window.removeEventListener("drop", stop);
        window.removeEventListener("pointermove", stopLate, true);
        window.removeEventListener("keydown", stopLate, true);
        disarm = null;
    };
}

// onDragStart of anything that can be dropped on the grid.
export function beginAgentDrag(e: DragSource, id: string): void {
    const dt = e.dataTransfer;
    if (dt == null) {
        return;
    }
    dt.setData(AGENT_DRAG_MIME, id);
    dt.effectAllowed = "move";
    globalStore.set(agentDragAtom, { id });
    armFailsafe();
}

export function endAgentDrag(): void {
    globalStore.set(agentDragAtom, null);
    disarm?.();
}
