// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The zones that appear over a grid cell while an agent is being dragged: centre swaps (or replaces), an edge
// inserts. One overlay per cell, a child of the cell, so it is exactly the cell's size; it renders nothing at all
// unless an agent drag is active, and never over the cell being dragged.

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { agentDragAtom, endAgentDrag } from "./agentdragstore";
import type { DropZone } from "./agentgrid";
import { AGENT_DRAG_MIME, allowedZones, isAgentDrag, resolveDrop, zoneBox, zoneFromPoint, zoneLabel } from "./griddrop";
import { currentGrid, dropAgentOnGrid, type GridModel } from "./gridstore";

interface OverlayProps {
    model: GridModel;
    id: string; // the cell's agent
    ids: readonly string[]; // every cell of the grid the surface drew, in order (what the overlay shows; a drop re-reads the grid)
}

const FOCUS_DELAY_MS = 120; // let the xterm become visible

// The drop leaves DOM focus on the row that was dragged; hand it to the cell that took the agent so typing goes there.
function focusCellSoon(id: string): void {
    window.setTimeout(() => {
        const term = document.querySelector<HTMLElement>(`[data-agent-terminal="${id}"] .xterm-helper-textarea`);
        if (term?.checkVisibility()) {
            term.focus({ preventScroll: true });
        }
    }, FOCUS_DELAY_MS);
}

export function GridDropOverlay(props: OverlayProps) {
    const drag = useAtomValue(agentDragAtom);
    if (drag == null || drag.id === props.id) {
        return null;
    }
    // a fresh component per drag, so the hovered zone never outlives it
    return <ActiveOverlay {...props} dragId={drag.id} />;
}

function ActiveOverlay({ model, id, ids, dragId }: OverlayProps & { dragId: string }) {
    const [zone, setZone] = useState<DropZone | null>(null);
    const zones = allowedZones(ids.length);
    const moving = ids.includes(dragId);

    const zoneAt = (e: React.DragEvent<HTMLDivElement>): DropZone => {
        const z = zoneFromPoint(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY);
        return zones.includes(z) ? z : "center";
    };
    const onOver = (e: React.DragEvent<HTMLDivElement>) => {
        if (!isAgentDrag(e.dataTransfer.types)) {
            return;
        }
        e.preventDefault(); // a drop is only delivered to a target that accepted the dragover
        e.dataTransfer.dropEffect = "move";
        const z = zoneAt(e);
        if (z !== zone) {
            setZone(z);
        }
    };
    const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
        if (!isAgentDrag(e.dataTransfer.types)) {
            return;
        }
        e.preventDefault();
        const dropped = e.dataTransfer.getData(AGENT_DRAG_MIME) || dragId;
        const picked = zoneAt(e);
        setZone(null);
        endAgentDrag();
        // dropAgentOnGrid's index is a position in the grid it reads now (currentGrid), which can have moved on since
        // this overlay rendered; a target that has left the grid takes no drop
        const target = resolveDrop(currentGrid(model).ids, id, picked);
        if (target == null) {
            return;
        }
        dropAgentOnGrid(model, dropped, target.index, target.zone);
        focusCellSoon(dropped);
    };

    const box = zone != null ? zoneBox(zone) : null;
    return (
        <div
            aria-hidden="true"
            data-agent-drop-overlay={id}
            data-drop-zones={zones.join(" ")}
            data-drop-zone={zone ?? ""}
            onDragEnter={onOver}
            onDragOver={onOver}
            onDragLeave={() => setZone(null)}
            onDrop={onDrop}
            className="absolute inset-0 z-30 bg-background/40"
        >
            {box != null && zone != null ? (
                <div
                    className={cn(
                        "pointer-events-none absolute flex items-center justify-center rounded-[6px]",
                        "border-2 border-dashed border-accent bg-accentbg"
                    )}
                    style={{
                        left: `${box.left}%`,
                        top: `${box.top}%`,
                        width: `${box.width}%`,
                        height: `${box.height}%`,
                    }}
                >
                    <span className="text-[12px] font-semibold text-accent-soft">{zoneLabel(zone, moving)}</span>
                </div>
            ) : null}
        </div>
    );
}
