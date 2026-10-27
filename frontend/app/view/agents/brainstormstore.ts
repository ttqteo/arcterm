// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Per-agent brainstorm state, all in one map: the poller reads every attached brainstorm, and the tree line and
// the attention popup need unfocused agents' questions, so the set must be enumerable as well as keyed.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type Atom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import type { AgentsViewModel } from "./agents";
import {
    brainstormFilePath,
    seenMark,
    shownFile,
    type BrainstormFile,
    type SeenMark,
    type SentLine,
} from "./brainstormmodel";
import type { CanvasBoard } from "./canvasmodel";

export type BrainstormState = {
    topic: string;
    path: string;
    cwd: string;
    mode: "terminal" | "brainstorm";
    // the last good contents: a read that fails to parse never replaces them
    file: BrainstormFile | null;
    // shown only after two consecutive failed reads, so an agent mid-write never flashes an error
    error: string | null;
    failedReads: number;
    removed: boolean;
    modifiedMs: number | null;
    // when brainstorm mode was last shown: the compaction banner and the unseen mark compare against it
    lastViewedMs: number;
    board: string | null;
    // "Open the design" pressed on the exited card
    showDesign: boolean;
    // the design opened over the question or the working note; kept here so a board's Back returns to it
    designOpen: boolean;
    boards: CanvasBoard[];
    // where wavesrv serves the project's design folder; null until the poller has asked it to
    base: string | null;
    // the last line Arc sent, until the agent has taken it (the poller settles it)
    sent: SentLine | null;
    // the send time of the last `brainstorm: check` the agent took, until Arc's check record is newer than it: with
    // none newer, the agent ended its turn without starting the check
    sentCheckAt: number | null;
    // the check review's cursor row and the rows opened to their was/now; here because the keybindings and the
    // asking rail's links act on them from outside the review
    review: { cursor: string | null; open: Record<string, boolean> };
};

// what every view draws: the file, with a pending sent line read as the agent writing
export function shownBrainstormFile(s: BrainstormState | null | undefined): BrainstormFile | null {
    return s?.file != null ? shownFile(s.file, s.sent) : null;
}

// the tab meta key holding the attached brainstorm.json's absolute path
export const SESSION_BRAINSTORM = "session:brainstorm";

export const brainstormsAtom = atom<Record<string, BrainstormState>>({}) as PrimitiveAtom<
    Record<string, BrainstormState>
>;

export const brainstormAtom = atomFamily(
    (agentId: string): Atom<BrainstormState | null> => atom((get) => get(brainstormsAtom)[agentId] ?? null)
);

export function getBrainstorm(agentId: string): BrainstormState | null {
    return globalStore.get(brainstormsAtom)[agentId] ?? null;
}

export function updateBrainstorm(agentId: string, fn: (s: BrainstormState) => BrainstormState): void {
    const all = globalStore.get(brainstormsAtom);
    const s = all[agentId];
    if (s != null) {
        globalStore.set(brainstormsAtom, { ...all, [agentId]: fn(s) });
    }
}

// what the user has seen of each brainstorm, keyed by its file's path: apart from the per-agent state, so a resume in a
// new agent, or the pane's remount on a surface switch, keeps it
export const brainstormSeenAtom = atom<Record<string, SeenMark>>({}) as PrimitiveAtom<Record<string, SeenMark>>;

export function markBrainstormSeen(path: string, f: BrainstormFile): void {
    globalStore.set(brainstormSeenAtom, { ...globalStore.get(brainstormSeenAtom), [path]: seenMark(f) });
}

// the first read is what the user is taken to have seen: what is new is measured from there
export function baselineBrainstormSeen(path: string, f: BrainstormFile): void {
    if (!(path in globalStore.get(brainstormSeenAtom))) {
        markBrainstormSeen(path, f);
    }
}

// one brainstorm per agent: the agent reveals on every write, so the same one keeps its state, and any other
// (a new topic, or the same topic in another project) starts over in its place
export function attachBrainstorm(agentId: string, a: { topic: string; cwd: string }, now: number): void {
    const prev = getBrainstorm(agentId);
    if (prev != null && prev.topic === a.topic && prev.cwd === a.cwd) {
        return;
    }
    const next: BrainstormState = {
        topic: a.topic,
        path: brainstormFilePath(a.cwd, a.topic),
        cwd: a.cwd,
        mode: "terminal",
        file: null,
        error: null,
        failedReads: 0,
        removed: false,
        modifiedMs: null,
        lastViewedMs: now,
        board: null,
        showDesign: false,
        designOpen: false,
        boards: [],
        base: null,
        sent: null,
        sentCheckAt: null,
        review: { cursor: null, open: {} },
    };
    globalStore.set(brainstormsAtom, { ...globalStore.get(brainstormsAtom), [agentId]: next });
}

export function detachBrainstorm(agentId: string): void {
    const all = globalStore.get(brainstormsAtom);
    if (agentId in all) {
        const { [agentId]: _gone, ...rest } = all;
        globalStore.set(brainstormsAtom, rest);
    }
}

// the tab meta is what re-attaches a brainstorm after a restart, so a dismissed one has to lose it too
export async function dismissBrainstorm(agentId: string): Promise<void> {
    detachBrainstorm(agentId);
    try {
        await RpcApi.SetMetaCommand(TabRpcClient, { oref: `tab:${agentId}`, meta: { [SESSION_BRAINSTORM]: null } });
    } catch (e) {
        console.warn("brainstorm dismiss: clearing session:brainstorm failed", agentId, e);
    }
}

export function brainstormOwner(topic: string): string | null {
    const all = globalStore.get(brainstormsAtom);
    return Object.keys(all).find((id) => all[id].topic === topic) ?? null;
}

export function setBrainstormMode(agentId: string, mode: "terminal" | "brainstorm", now: number): void {
    updateBrainstorm(agentId, (s) => (mode === "brainstorm" ? { ...s, mode, lastViewedMs: now } : { ...s, mode }));
}

export function openBrainstormBoard(agentId: string, board: string | null): void {
    updateBrainstorm(agentId, (s) => ({ ...s, board }));
}

export function openBrainstormDesign(agentId: string, open: boolean): void {
    updateBrainstorm(agentId, (s) => ({ ...s, designOpen: open }));
}

// ids is the review's rows in cursor order; a cursor not among them (none yet, or its row gone) starts at the first
export function moveReviewCursor(agentId: string, ids: string[], delta: 1 | -1): void {
    if (ids.length === 0) {
        return;
    }
    updateBrainstorm(agentId, (s) => {
        const at = s.review.cursor != null ? ids.indexOf(s.review.cursor) : -1;
        const next = at < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, at + delta));
        return { ...s, review: { ...s.review, cursor: ids[next] } };
    });
}

export function setReviewCursor(agentId: string, id: string): void {
    updateBrainstorm(agentId, (s) => ({ ...s, review: { ...s.review, cursor: id } }));
}

export function toggleReviewRow(agentId: string, id: string): void {
    updateBrainstorm(agentId, (s) => ({
        ...s,
        review: { ...s.review, open: { ...s.review.open, [id]: !s.review.open[id] } },
    }));
}

// read through the per-agent atom, the one watchFocusedCanvas (whenstate.ts) subscribes for the key predicates
export function focusedBrainstorm(model: AgentsViewModel): BrainstormState | null {
    const id = globalStore.get(model.focusIdAtom);
    return id ? globalStore.get(brainstormAtom(id)) : null;
}
