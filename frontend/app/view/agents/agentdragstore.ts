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
let armedAt = 0;
let pending: ReturnType<typeof setTimeout> | null = null;
const FAILSAFE_GRACE_MS = 300;

// A drag whose source unmounts mid-drag (its agent exits) never fires dragend, which would leave the overlays up
// for good. dragend and drop reach window last (bubbling, after React's own handlers, so the overlay's onDrop has
// already run). pointermove and keydown mean the drag is over only once the grace period since the latest begin has
// passed (a stray one right after the start must not end it), and a pointermove only when no button is held: a
// native drag holds the primary button down, so a pointer event that does arrive during one is not the end of it.
function armFailsafe(): void {
    armedAt = performance.now();
    if (typeof window === "undefined" || disarm != null) {
        return;
    }
    const stop = () => endAgentDrag();
    const late = () => {
        if (performance.now() - armedAt > FAILSAFE_GRACE_MS) {
            endAgentDrag();
        }
    };
    const onMove = (e: PointerEvent) => {
        if (e.buttons === 0) {
            late();
        }
    };
    const onKey = late;
    window.addEventListener("dragend", stop);
    window.addEventListener("drop", stop);
    window.addEventListener("pointermove", onMove, { capture: true });
    window.addEventListener("keydown", onKey, { capture: true });
    disarm = () => {
        window.removeEventListener("dragend", stop);
        window.removeEventListener("drop", stop);
        window.removeEventListener("pointermove", onMove, { capture: true });
        window.removeEventListener("keydown", onKey, { capture: true });
        disarm = null;
    };
}

// onDragStart of anything that can be dropped on the grid. The drag data is only writable here, so it is set at once;
// the atom, which mounts the drop overlays, waits a tick: Chromium can cancel a drag the instant it starts when the
// page changes inside dragstart.
export function beginAgentDrag(e: DragSource, id: string): void {
    const dt = e.dataTransfer;
    if (dt == null) {
        return;
    }
    dt.setData(AGENT_DRAG_MIME, id);
    dt.effectAllowed = "move";
    armFailsafe();
    if (pending != null) {
        clearTimeout(pending);
    }
    pending = setTimeout(() => {
        pending = null;
        globalStore.set(agentDragAtom, { id });
    }, 0);
}

// The timer goes first, so a dragend that beats it is not undone by it.
export function endAgentDrag(): void {
    if (pending != null) {
        clearTimeout(pending);
        pending = null;
    }
    globalStore.set(agentDragAtom, null);
    disarm?.();
}
