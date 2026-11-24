// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The zones that appear over a grid cell while an agent is being dragged: centre swaps (or replaces), an edge
// splits the cell along it (only the edges the cell can be split along are offered), and with Alt (Option) held the whole cell types the dragged agent's @mention at its prompt. A board dropped on the centre of a Claude agent's cell
// reads that agent's chat from then on (tiesBoard), and takes a cell right of it when it had none. One overlay per
// cell, a child of the cell, so it is exactly the cell's size; it renders nothing at all unless an agent drag is
// active, and never over the cell being dragged.

import { pushToast } from "@/app/cockpit/notificationstore";
import { MOTION } from "@/app/element/motiontokens";
import { focusTerm, pasteIntoTerm } from "@/app/view/term/termpaste";
import { isMacOS } from "@/util/platformutil";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { moveBoardToChat } from "../boards/boardactions";
import { boardCellRef } from "../boards/boardcell";
import { ensureBoardOpen } from "../boards/boardsplitstore";
import { agentDragAtom, endAgentDrag } from "./agentdragstore";
import type { DropZone, GridState } from "./agentgrid";
import { mentionToken } from "./agentrowmodel";
import { cellInputOf, chatInputOf } from "./cellinput";
import { insertIntoChatBox } from "./chatinsert";
import {
    AGENT_DRAG_MIME,
    allowedZones,
    isAgentDrag,
    mentionDropText,
    resolveDrop,
    tiedBoardZone,
    tiesBoard,
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
    cell?: { agent?: string; kind?: string }; // the cell's tab, so a board dropped on its centre can tie to its chat
}

// read per render: at module load setPlatform has not run yet, so the platform still reads as macOS
const mentionKey = () => (isMacOS() ? "⌥" : "Alt");

const FOCUS_DELAY_MS = 120; // let the xterm become visible

// The drop leaves DOM focus on the row that was dragged; hand it to the cell that took the agent so typing goes there.
function focusCellSoon(id: string): void {
    window.setTimeout(() => cellInputOf(document, id)?.focus({ preventScroll: true }), FOCUS_DELAY_MS);
}

export function GridDropOverlay(props: OverlayProps) {
    const drag = useAtomValue(agentDragAtom);
    if (drag == null || drag.id === props.id) {
        return null;
    }
    // a fresh component per drag, so the hovered zone never outlives it
    return <ActiveOverlay {...props} dragId={drag.id} />;
}

function ActiveOverlay({ model, id, grid, mentionTo: tabMention, cell, dragId }: OverlayProps & { dragId: string }) {
    const [zone, setZone] = useState<DropZone | null>(null);
    const [mention, setMention] = useState(false);
    const zones = allowedZones(grid, id, dragId);
    const moving = grid.ids.includes(dragId);
    // a board is no agent to @mention, and its centre drop on a Claude agent ties it to that chat
    const board = boardCellRef(dragId);
    const mentionTo = board != null ? null : tabMention;
    const ties = tiesBoard(dragId, cell);

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
            // typed, not sent: the person writes the message after it and presses Enter. A cell that shows Chat takes it
            // in its message box (and focuses it): the xterm under the chat layer is not typed into.
            if (chatInputOf(document, id) != null) {
                if (!insertIntoChatBox(id, mentionDropText(dropped))) {
                    pushToast({ title: "The message box is not ready for input", message: "", level: "warn" });
                }
                return;
            }
            if (!pasteIntoTerm(mentionTo, mentionDropText(dropped))) {
                pushToast({ title: "The terminal is not ready for input", message: "", level: "warn" });
                return;
            }
            focusTerm(mentionTo);
            return;
        }
        // a board dragged from its tree row may not be open yet: open it, so it can be a cell
        if (board != null) {
            ensureBoardOpen(board);
        }
        if (board != null && ties && picked === "center") {
            // the board reads this chat from now on, and sits right of it when it had no cell
            const place = tiedBoardZone(currentGrid(model), id, dropped);
            if (place != null) {
                const at = resolveDrop(currentGrid(model), id, dropped, place);
                if (at != null) {
                    dropAgentOnGrid(model, dropped, at.index, at.zone);
                }
            }
            moveBoardToChat(board, id).catch((err: unknown) =>
                pushToast({
                    title: "The board kept its chat",
                    message: err instanceof Error ? err.message : String(err),
                    level: "warn",
                })
            );
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

    const box = mention ? FULL_BOX : zone != null ? zoneBox(zone) : null;
    return (
        <motion.div
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: MOTION.durMicro, ease: MOTION.easeFluid }}
            className="absolute inset-0 z-30 bg-background/40"
        >
            <ZoneHighlight box={box}>
                {box != null && zone != null ? (
                    <span className="flex flex-col items-center gap-[2px] text-[12px] font-semibold text-accent-soft">
                        {mention ? `Mention ${mentionToken(dragId)}` : zoneLabel(zone, moving, ties)}
                        {mentionTo != null && !mention ? (
                            <span className="text-[10.5px] font-medium text-muted">hold {mentionKey()} to mention</span>
                        ) : null}
                    </span>
                ) : null}
            </ZoneHighlight>
        </motion.div>
    );
}

const FULL_BOX = { left: 0, top: 0, width: 100, height: 100 };

// The highlighted half (or the whole cell) the drop would take. Once shown it stays mounted for the drag and glides on
// the shape spring from zone to zone, as VS Code's editor drop target does, instead of jumping; when the pointer leaves
// the cell it fades out where it was, so coming back fades it in there rather than sliding in from a corner.
function ZoneHighlight({
    box,
    children,
}: {
    box: { left: number; top: number; width: number; height: number } | null;
    children: React.ReactNode;
}) {
    const [last, setLast] = useState(box);
    if (box != null && box !== last) {
        setLast(box);
    }
    const reduce = useReducedMotion();
    if (last == null) {
        return null;
    }
    const at = { left: `${last.left}%`, top: `${last.top}%`, width: `${last.width}%`, height: `${last.height}%` };
    return (
        <motion.div
            className={cn(
                "pointer-events-none absolute flex items-center justify-center overflow-hidden rounded-[6px]",
                "border-2 border-dashed border-accent bg-accentbg"
            )}
            initial={{ opacity: 0, ...at }}
            animate={{ opacity: box != null ? 1 : 0, ...at }}
            transition={
                reduce
                    ? { duration: 0 }
                    : {
                          left: MOTION.spring,
                          top: MOTION.spring,
                          width: MOTION.spring,
                          height: MOTION.spring,
                          opacity: { duration: MOTION.durMicro, ease: MOTION.easeFluid },
                      }
            }
        >
            {children}
        </motion.div>
    );
}
