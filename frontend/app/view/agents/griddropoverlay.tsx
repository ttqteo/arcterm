// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The zones that appear over a grid cell while an agent is being dragged: centre swaps (or replaces), an edge
// splits the cell along it (only the edges the cell can be split along are offered), and with Alt (Option) held the whole cell types the dragged agent's @mention at its prompt. One overlay per
// cell, a child of the cell, so it is exactly the cell's size; it renders nothing at all unless an agent drag is
// active, and never over the cell being dragged.

import { pushToast } from "@/app/cockpit/notificationstore";
import { focusTerm, pasteIntoTerm } from "@/app/view/term/termpaste";
import { isMacOS } from "@/util/platformutil";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { agentDragAtom, endAgentDrag } from "./agentdragstore";
import type { DropZone, GridState } from "./agentgrid";
import { mentionToken } from "./agentrowmodel";
import {
    AGENT_DRAG_MIME,
    allowedZones,
    isAgentDrag,
    mentionDropText,
    resolveDrop,
    zoneBox,
    zoneFromPoint,
    zoneLabel,
} from "./griddrop";
import { currentGrid, dropAgentOnGrid, type GridModel } from "./gridstore";

interface OverlayProps {
    model: GridModel;
    id: string; // the cell's agent
    grid: GridState; // the grid the surface drew (what the overlay shows; a drop re-reads the grid)
    mentionTo: string | null; // the cell's terminal block when its prompt takes an @mention (griddrop.ts mentionTarget)
}

const MENTION_KEY = isMacOS() ? "⌥" : "Alt";

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

function ActiveOverlay({ model, id, grid, mentionTo, dragId }: OverlayProps & { dragId: string }) {
    const [zone, setZone] = useState<DropZone | null>(null);
    const [mention, setMention] = useState(false);
    const zones = allowedZones(grid, id, dragId);
    const moving = grid.ids.includes(dragId);

    const zoneAt = (e: React.DragEvent<HTMLDivElement>): DropZone => {
        const z = zoneFromPoint(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY);
        return zones.includes(z) ? z : "center";
    };
    const onOver = (e: React.DragEvent<HTMLDivElement>) => {
        if (!isAgentDrag(e.dataTransfer.types)) {
            return;
        }
        e.preventDefault(); // a drop is only delivered to a target that accepted the dragover
        const mentioning = mentionTo != null && e.altKey;
        if (mentioning !== mention) {
            setMention(mentioning);
        }
        e.dataTransfer.dropEffect = mentioning ? "copy" : "move";
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
        setMention(false);
        endAgentDrag();
        if (mentionTo != null && e.altKey) {
            // typed, not sent: the person writes the message after it and presses Enter
            if (!pasteIntoTerm(mentionTo, mentionDropText(dropped))) {
                pushToast({ title: "The terminal is not ready for input", message: "", level: "warn" });
                return;
            }
            focusTerm(mentionTo);
            return;
        }
        // dropAgentOnGrid's index is a position in the grid it reads now (currentGrid), which can have moved on since
        // this overlay rendered; a target that has left the grid takes no drop
        const target = resolveDrop(currentGrid(model), id, dropped, picked);
        if (target == null) {
            return;
        }
        dropAgentOnGrid(model, dropped, target.index, target.zone);
        focusCellSoon(dropped);
    };

    const box = mention ? { left: 0, top: 0, width: 100, height: 100 } : zone != null ? zoneBox(zone) : null;
    return (
        <div
            aria-hidden="true"
            data-agent-drop-overlay={id}
            data-drop-zones={zones.join(" ")}
            data-drop-zone={zone ?? ""}
            onDragEnter={onOver}
            onDragOver={onOver}
            onDragLeave={() => {
                setZone(null);
                setMention(false);
            }}
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
                    <span className="flex flex-col items-center gap-[2px] text-[12px] font-semibold text-accent-soft">
                        {mention ? `Mention ${mentionToken(dragId)}` : zoneLabel(zone, moving)}
                        {mentionTo != null && !mention ? (
                            <span className="text-[10.5px] font-medium text-muted">hold {MENTION_KEY} to mention</span>
                        ) : null}
                    </span>
                </div>
            ) : null}
        </div>
    );
}
