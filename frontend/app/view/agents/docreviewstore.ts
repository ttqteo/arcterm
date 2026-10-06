// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Per-agent Doc review state: which ask the review answers, whether it shows in place of the terminal, and the
// comments being written. Keyed by agent id like canvasstore.ts, in atoms because the header, the tree, the keys
// and the review view all read it. Session-only: nothing here survives an arcterm restart.
//
// Every "open the review" goes through openReview, which also keeps Spec and Plan reviews on their dialog.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { useEffect } from "react";
import { showTerminal } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import type { AgentAsk, AgentVM } from "./agentsviewmodel";
import { getCanvas, setCanvasMode } from "./canvasstore";
import { docReviewAtom, parseDocReview } from "./docreview";
import type { ProseComment } from "./proseanchor";

export type DocReviewMode = "terminal" | "review";
export type DocReviewTab = "changes" | "pdf";

// what the tray last tried to send; the sent line says it once the ask reads as sent
export interface LastSend {
    kind: "approve" | "request";
    comments: number;
}

export interface DocReviewState {
    askId: string;
    path: string;
    doc: "latex" | "markdown";
    mode: DocReviewMode;
    tab: DocReviewTab;
    wholeFile: boolean;
    comments: ProseComment[];
    generalNote: string;
    lastSend: LastSend | null;
}

export interface ShownContent {
    text: string;
    at: number;
}

const TABS: DocReviewTab[] = ["changes", "pdf"];

// cast because a null initial value picks jotai's read-only overload under the non-strict tsconfig
export const docReviewStateAtom = atomFamily(
    (_agentId: string) => atom<DocReviewState | null>(null) as PrimitiveAtom<DocReviewState | null>
);

// abs path → the file text the last review of it showed, and when: the next round diffs against it. Kept apart from
// the review state, which a new ask resets.
export const shownContentAtom = atomFamily(
    (_agentId: string) => atom<Record<string, ShownContent>>({}) as PrimitiveAtom<Record<string, ShownContent>>
);

// atomFamily can't be enumerated, and a roster sync has to drop the state of an agent that left the roster
const tracked = new Set<string>();

export function getDocReview(agentId: string): DocReviewState | null {
    return globalStore.get(docReviewStateAtom(agentId));
}

function updateDocReview(agentId: string, fn: (s: DocReviewState) => DocReviewState): void {
    const s = getDocReview(agentId);
    if (s != null) {
        globalStore.set(docReviewStateAtom(agentId), fn(s));
    }
}

function setState(agentId: string, s: DocReviewState | null): void {
    if (s == null) {
        tracked.delete(agentId);
    } else {
        tracked.add(agentId);
    }
    globalStore.set(docReviewStateAtom(agentId), s);
}

// A new ask is a new review: its comments, note, tab and last send start over. The mode stays, so a round-2 ask
// that arrives while you read the review keeps you in it, and one that arrives on the terminal leaves you there.
export function syncDocReview(agentId: string, ask: AgentAsk | undefined): void {
    const review = parseDocReview(ask);
    // parseDocReview gives a Doc review only a .tex or .md path; the check narrows the type
    const doc = review?.kind === "doc" && review.doc !== "canvas" ? review.doc : null;
    const prev = getDocReview(agentId);
    if (doc == null) {
        if (prev != null) {
            setState(agentId, null);
        }
        return;
    }
    const askId = ask?.askId ?? "";
    if (prev?.askId === askId) {
        return;
    }
    setState(agentId, {
        askId,
        path: review.path,
        doc,
        mode: prev?.mode ?? "terminal",
        tab: "changes",
        wholeFile: false,
        comments: [],
        generalNote: "",
        lastSend: null,
    });
}

export function syncDocReviews(agents: AgentVM[]): void {
    const present = new Set<string>();
    for (const a of agents) {
        present.add(a.id);
        syncDocReview(a.id, a.ask);
    }
    for (const id of [...tracked]) {
        if (!present.has(id)) {
            setState(id, null);
        }
    }
}

// in the always-mounted shell, so an ask answered or cleared on any surface clears its review
export function useDocReviewSync(model: AgentsViewModel): void {
    const agents = useAtomValue(model.agentsAtom);
    const key = agents.map((a) => `${a.id}:${a.ask?.askId ?? ""}`).join(",");
    useEffect(() => {
        syncDocReviews(agents);
    }, [key]);
}

// Review and canvas share the terminal's place, so showing the review puts a showing canvas back (agentview.ts
// switches all three).
export function setDocReviewMode(agentId: string, mode: DocReviewMode, now: number): void {
    if (getDocReview(agentId) == null) {
        return;
    }
    if (mode === "review" && getCanvas(agentId)?.mode === "canvas") {
        setCanvasMode(agentId, "terminal", now);
    }
    updateDocReview(agentId, (s) => (s.mode === mode ? s : { ...s, mode }));
}

// A Doc review shows in place of the agent's terminal, so opening it focuses that agent on the Agent surface; a
// Spec or Plan review opens its dialog over whatever is showing. The state is made first, so a surface that opens
// the review before the roster sync has run still lands in it.
export function openReview(model: AgentsViewModel, agentId: string): void {
    const agent = globalStore.get(model.agentsAtom).find((a) => a.id === agentId);
    const review = parseDocReview(agent?.ask);
    if (review == null) {
        return;
    }
    if (review.kind !== "doc") {
        globalStore.set(docReviewAtom, agentId);
        return;
    }
    syncDocReview(agentId, agent.ask);
    globalStore.set(model.focusIdAtom, agentId);
    globalStore.set(model.surfaceAtom, "agent");
    showTerminal();
    setDocReviewMode(agentId, "review", Date.now());
}

export function focusedDocReview(model: AgentsViewModel): DocReviewState | null {
    const id = globalStore.get(model.focusIdAtom);
    return id ? getDocReview(id) : null;
}

export function setDocReviewTab(agentId: string, tab: DocReviewTab): void {
    updateDocReview(agentId, (s) => ({ ...s, tab }));
}

// [ and ] walk the tabs; a note has only Changes
export function stepDocReviewTab(agentId: string, delta: number): void {
    updateDocReview(agentId, (s) => {
        if (s.doc !== "latex") {
            return s;
        }
        const n = TABS.length;
        return { ...s, tab: TABS[(((TABS.indexOf(s.tab) + delta) % n) + n) % n] };
    });
}

export function toggleWholeFile(agentId: string): void {
    updateDocReview(agentId, (s) => ({ ...s, wholeFile: !s.wholeFile }));
}

export function addComment(agentId: string, c: ProseComment): void {
    updateDocReview(agentId, (s) => ({ ...s, comments: [...s.comments, c] }));
}

export function updateComment(agentId: string, id: string, patch: Partial<ProseComment>): void {
    updateDocReview(agentId, (s) => ({
        ...s,
        comments: s.comments.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
}

export function removeComment(agentId: string, id: string): void {
    updateDocReview(agentId, (s) => ({ ...s, comments: s.comments.filter((c) => c.id !== id) }));
}

export function setGeneralNote(agentId: string, note: string): void {
    updateDocReview(agentId, (s) => ({ ...s, generalNote: note }));
}

export function setLastSend(agentId: string, send: LastSend | null): void {
    updateDocReview(agentId, (s) => ({ ...s, lastSend: send }));
}

export function recordShown(agentId: string, path: string, text: string, at: number): void {
    globalStore.set(shownContentAtom(agentId), (prev) => ({ ...prev, [path]: { text, at } }));
}
