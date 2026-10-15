// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Ideas list of each agent session (pkg/ideastore), as the rail and an ended session's view read it. One atom per
// session id, loaded over wshrpc and reloaded when wavesrv says the session's list changed (`ideas:changed`, which the
// agent's `wsh idea`, this file's own writes and a nudge all publish). The list is the session's, not the block's, so a
// resumed session still has it. The end of the file is capturing a terminal selection as an idea: the chip's state, the
// watcher termwrap.ts installs on each terminal, and the shortcut's action.

import { pushToast } from "@/app/cockpit/notificationstore";
import { globalStore } from "@/app/store/jotaiStore";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WOS } from "@/store/global";
import type { Terminal } from "@xterm/xterm";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { useEffect } from "react";
import { debounce } from "throttle-debounce";
import { captureAction, cleanSelection, selectionAnchor, type Box } from "./ideacapture";
import { sessionIdFromTranscript, validSessionId } from "./ideasmodel";

// cast because a null initial value picks jotai's read-only overload under the non-strict tsconfig
export const ideasAtom = atomFamily(
    (_sessionId: string) => atom<SessionIdeas | null>(null) as PrimitiveAtom<SessionIdeas | null>
);

// the topics the user folded or opened by hand, per session (ideasmodel.sectionOpen reads them over its default): kept
// here and not in the section, which unmounts each time the rail closes it or shows another agent
export const ideasFoldAtom = atomFamily((_sessionId: string) => atom<Record<string, boolean>>({}));

// the sessions whose atom has been read: an event only reloads those (atomFamily cannot be enumerated)
const known = new Set<string>();
// a reload that overtakes an earlier one must not be overwritten by the earlier one's late answer
const loadSeq = new Map<string, number>();

let subscribed = false;
function subscribeIdeasChanged() {
    if (subscribed) {
        return;
    }
    subscribed = true;
    waveEventSubscribeSingle({
        eventType: "ideas:changed",
        handler: (event) => {
            const sessionId = (event.data as IdeasChangedData | undefined)?.sessionid;
            if (sessionId && known.has(sessionId)) {
                void loadIdeas(sessionId);
            }
        },
    });
}

// loadIdeas reads the session's list into its atom. A failure leaves the atom as it was and logs: the rail then shows
// what it showed before, which is nothing for a session whose list was never read.
export async function loadIdeas(sessionId: string): Promise<void> {
    if (!validSessionId(sessionId)) {
        return;
    }
    known.add(sessionId);
    subscribeIdeasChanged();
    const seq = (loadSeq.get(sessionId) ?? 0) + 1;
    loadSeq.set(sessionId, seq);
    try {
        const ideas = await RpcApi.IdeaListCommand(TabRpcClient, { sessionid: sessionId });
        if (loadSeq.get(sessionId) === seq) {
            globalStore.set(ideasAtom(sessionId), ideas);
        }
    } catch (err) {
        console.error(`loading the ideas of session ${sessionId} failed`, err);
    }
}

const noIdeas = atom<SessionIdeas | null>(null);

// useSessionIdeas reads a session's list and keeps it loaded while the caller shows; null session: nothing to read
export function useSessionIdeas(sessionId: string | null): SessionIdeas | null {
    const ideas = useAtomValue(sessionId != null ? ideasAtom(sessionId) : noIdeas);
    useEffect(() => {
        if (sessionId != null) {
            void loadIdeas(sessionId);
        }
    }, [sessionId]);
    return ideas;
}

export type IdeaUpdate = Omit<CommandIdeaUpdateData, "blockid" | "sessionid">;

// updateIdeas applies one op (edit, kind, drop, restore, merge, seen) and reloads the list. It resolves false and logs
// when wavesrv refuses the op, so a caller keeps its box open.
export async function updateIdeas(sessionId: string, op: IdeaUpdate): Promise<boolean> {
    try {
        await RpcApi.IdeaUpdateCommand(TabRpcClient, { ...op, sessionid: sessionId });
    } catch (err) {
        console.error(`ideas ${op.op} on session ${sessionId} failed`, err);
        return false;
    }
    await loadIdeas(sessionId);
    return true;
}

// markIdeasRead says the user has seen the list, so what is in it stops being new
export function markIdeasRead(sessionId: string): Promise<boolean> {
    return updateIdeas(sessionId, { op: "seen" });
}

// addIdea records an idea of the user's own (`by: "you"`) or, from a test, an agent's, and resolves the idea wavesrv made
// of it (its id is what Undo drops), or null, logged, when wavesrv refuses it
export async function addIdea(
    sessionId: string,
    text: string,
    by: "you" | "agent",
    kind = "idea"
): Promise<Idea | null> {
    let idea: Idea;
    try {
        idea = await RpcApi.IdeaAddCommand(TabRpcClient, { sessionid: sessionId, text, kind, by });
    } catch (err) {
        console.error(`adding an idea to session ${sessionId} failed`, err);
        return null;
    }
    await loadIdeas(sessionId);
    return idea;
}

// ---- the Ideas input: the shortcut with nothing selected asks the rail for it ----

export interface IdeasInputRequest {
    sessionId: string;
    at: number; // when, for inputRequestLive
}

// agentdetailsrail.tsx opens the session's Ideas section on one; the section's Add an idea box takes focus and clears it
export const ideasInputRequestAtom = atom<IdeasInputRequest | null>(null) as PrimitiveAtom<IdeasInputRequest | null>;

export function requestIdeasInput(sessionId: string): void {
    globalStore.set(ideasInputRequestAtom, { sessionId, at: Date.now() });
}

// ---- adding what is selected in a terminal (ideacapture.ts decides, termwrap.ts feeds it) ----

// the chip's anchor on one terminal: where the selection ends, and the cell grid to turn that into pixels
export interface IdeaChip {
    blockId: string;
    anchor: { col: number; row: number };
    cols: number;
    rows: number;
    screen: Box;
    dismissed: boolean; // a key was typed, or the terminal scrolled, since the selection was made
}

// one chip at a time: the latest selection made in any terminal. ideacapturechip.tsx draws it in that terminal's pane.
export const ideaChipAtom = atom<IdeaChip | null>(null) as PrimitiveAtom<IdeaChip | null>;

// what the shortcut reads from the terminal at the moment it is pressed, not from what the chip last saw
interface SelectionSource {
    text: () => string;
    clear: () => void;
}
const selectionSources = new Map<string, SelectionSource>();

// DEV only: the ideas-rail scenario drags a selection over a line of a terminal and reads back what is selected. With the
// WebGL renderer the text sits on a canvas, so the line is found in the buffer, and its place on screen worked out from it.
const devTerminals = new Map<string, Terminal>();

function trackForDev(blockId: string, terminal: Terminal): () => void {
    if (!import.meta.env.DEV) {
        return () => {};
    }
    devTerminals.set(blockId, terminal);
    (window as any).__arcIdeaCapture ??= {
        // the last screen row whose text is exactly `text`: where to press and where to release (viewport pixels) to select it
        locate: (id: string, text: string) => {
            const term = devTerminals.get(id);
            const screen = term?.element?.querySelector(".xterm-screen")?.getBoundingClientRect();
            if (term == null || screen == null) {
                return null;
            }
            const buf = term.buffer.active;
            const cw = screen.width / term.cols;
            const ch = screen.height / term.rows;
            for (let row = term.rows - 1; row >= 0; row--) {
                const line = buf.getLine(buf.viewportY + row)?.translateToString(true) ?? "";
                if (line.trim() === text) {
                    const first = line.search(/\S/);
                    return {
                        x0: screen.left + (first + 0.25) * cw,
                        x1: screen.left + (first + text.length + 0.6) * cw,
                        y: screen.top + (row + 0.5) * ch,
                    };
                }
            }
            return null;
        },
        selection: (id: string) => devTerminals.get(id)?.getSelection() ?? null,
    };
    return () => {
        if (devTerminals.get(blockId) === terminal) {
            devTerminals.delete(blockId);
        }
    };
}

// watchIdeaSelection follows one terminal's selection for the chip. The chip waits for the mouse to come up (a drag
// would drag it along), goes when the selection clears, a key is typed, or the terminal scrolls, and comes back with the
// next selection. It never takes focus, and the copy that term:copyonselect does is no part of it. Returns its undo.
export function watchIdeaSelection(blockId: string, terminal: Terminal, host: HTMLElement): () => void {
    const source: SelectionSource = { text: () => terminal.getSelection(), clear: () => terminal.clearSelection() };
    selectionSources.set(blockId, source);
    const forget = () => globalStore.set(ideaChipAtom, (prev) => (prev?.blockId === blockId ? null : prev));
    const dismiss = () =>
        globalStore.set(ideaChipAtom, (prev) =>
            prev?.blockId === blockId && !prev.dismissed ? { ...prev, dismissed: true } : prev
        );
    const refresh = () => {
        const end = terminal.getSelectionPosition()?.end;
        const anchor = end == null ? null : selectionAnchor(end, terminal.buffer.active.viewportY, terminal.rows);
        const screen = terminal.element?.querySelector(".xterm-screen")?.getBoundingClientRect();
        if (cleanSelection(terminal.getSelection()) == null || anchor == null || screen == null) {
            forget();
            return;
        }
        globalStore.set(ideaChipAtom, {
            blockId,
            anchor,
            cols: terminal.cols,
            rows: terminal.rows,
            screen: { left: screen.left, top: screen.top, width: screen.width, height: screen.height },
            dismissed: false,
        });
    };
    let pointerDown = false;
    const settle = debounce(60, () => {
        if (!pointerDown) {
            refresh();
        }
    });
    // xterm clears the old selection on a press, so its chip goes with it, not after the drag that follows
    const onDown = () => {
        pointerDown = true;
        forget();
    };
    const onUp = () => {
        if (pointerDown) {
            pointerDown = false;
            refresh();
        }
    };
    host.addEventListener("mousedown", onDown, true);
    document.addEventListener("mouseup", onUp, true);
    const subs = [terminal.onSelectionChange(settle), terminal.onKey(dismiss), terminal.onScroll(dismiss)];
    const untrack = trackForDev(blockId, terminal);
    return () => {
        untrack();
        host.removeEventListener("mousedown", onDown, true);
        document.removeEventListener("mouseup", onUp, true);
        settle.cancel();
        subs.forEach((s) => s.dispose());
        if (selectionSources.get(blockId) === source) {
            selectionSources.delete(blockId);
        }
        forget();
    };
}

// the agent session a terminal block carries (its transcript path), or null for a plain terminal or an agent that has
// not reported in yet
function sessionOfBlock(blockId: string): string | null {
    const block = WOS.getObjectValue<Block>(WOS.makeORef("block", blockId));
    const id = sessionIdFromTranscript(block?.meta?.["agent:transcriptpath"]);
    return validSessionId(id) ? id : null;
}

let capturing = false;

// runIdeaCapture is the shortcut and the chip's click. With a selection held in a terminal that has an agent session it
// adds the selection as an idea of yours, clears the selection and offers Undo; with none it asks the rail to open the
// Ideas input of the agent in focus (`focusedSessionId`, null when no agent session is).
export async function runIdeaCapture(focusedSessionId: string | null): Promise<void> {
    const chip = globalStore.get(ideaChipAtom);
    const source = chip != null ? selectionSources.get(chip.blockId) : undefined;
    const chipSession = chip != null ? sessionOfBlock(chip.blockId) : null;
    const selection = chipSession != null ? cleanSelection(source?.text()) : null;
    const focused = validSessionId(focusedSessionId) ? focusedSessionId : null;
    const sessionId = selection != null ? chipSession : focused;
    const action = captureAction({ selection, sessionId });
    if (action === "open-input") {
        requestIdeasInput(sessionId!);
        return;
    }
    if (action !== "add" || capturing) {
        return;
    }
    capturing = true;
    try {
        const idea = await addIdea(sessionId!, selection!, "you");
        if (idea == null) {
            pushToast({ title: "Couldn't add the idea", message: "", level: "error" });
            return;
        }
        source?.clear();
        globalStore.set(ideaChipAtom, null);
        pushToast({
            title: "Added to Ideas",
            message: "",
            level: "info",
            check: true,
            ttlMs: 5000,
            action: { label: "Undo", run: () => void updateIdeas(sessionId!, { op: "drop", ids: [idea.id] }) },
        });
    } finally {
        capturing = false;
    }
}
