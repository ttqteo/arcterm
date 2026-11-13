// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isTopModal } from "@/app/modals/modalstack";
import { globalStore } from "@/app/store/jotaiStore";
import { selectedTaskIdAtom } from "./dagstore";
import { atom, type PrimitiveAtom } from "jotai";
import type { AgentsViewModel } from "../agents/agents";
import type { AgentVM } from "../agents/agentsviewmodel";
import { returnToOrigin } from "../jarvis/returnsurface";

// The modal reads its owner run and channel off the loaded TaskGroup (dagmodal.tsx), never off channelId and
// runId here: a worker run's sheet once passed its own run, and the modal named the worker as the graph's owner.
// The two fields stay for the callers and tests that already carry them; nothing reads them for the owner.
export type DagModalState = {
    kind: "live";
    channelId: string;
    runId: string;
    dagOref: string;
    error: string;
};

// the DAG modal's id on the modal stack (modalstack.ts): on top, it takes Escape from the run sheet below it
export const DAG_MODAL_ID = "dag-modal";

// dagModalAgentsContextAtom carries the agents view model + live roster into the modal so its worker
// rail can resolve and navigate workers without a second navigation mechanism. Read-only for the
// modal; set by the Stage whenever the modal is open. Selection stays selectedTaskIdAtom.
export const dagModalAgentsContextAtom = atom<{ model: AgentsViewModel; agents: AgentVM[] } | null>(
    null
) as PrimitiveAtom<{ model: AgentsViewModel; agents: AgentVM[] } | null>;

export function setDagModalAgentsContext(model: AgentsViewModel, agents: AgentVM[]): void {
    globalStore.set(dagModalAgentsContextAtom, { model, agents });
}

export type DagModalAction =
    | { type: "open-live"; channelId: string; runId: string; dagOref: string }
    | { type: "escape" }
    | { type: "close" };

export const dagModalStateAtom = atom<DagModalState | null>(null) as PrimitiveAtom<DagModalState | null>;

export function reduceDagModalState(state: DagModalState | null, action: DagModalAction): DagModalState | null {
    switch (action.type) {
        case "open-live":
            return {
                kind: "live",
                channelId: action.channelId,
                runId: action.runId,
                dagOref: action.dagOref,
                error: "",
            };
        case "escape":
        case "close":
            return null;
        default:
            return state;
    }
}

export function dispatchDagModal(action: DagModalAction): void {
    globalStore.set(dagModalStateAtom, reduceDagModalState(globalStore.get(dagModalStateAtom), action));
}

function resetSelection(): void {
    globalStore.set(selectedTaskIdAtom, null);
}

export function openDagLive(channelId: string, runId: string, dagOref: string): void {
    resetSelection();
    dispatchDagModal({ type: "open-live", channelId, runId, dagOref });
}

// openDagTask opens the live DAG with one task already selected — the attention queue's "take me to
// it". Selection is set after the open because opening resets it.
export function openDagTask(channelId: string, runId: string, dagOref: string, taskId: string): void {
    openDagLive(channelId, runId, dagOref);
    globalStore.set(selectedTaskIdAtom, taskId);
}

// openRunSheetDag is a run sheet's way into its dag. A worker run's sheet lands on the worker's own task, since
// the dag belongs to the lead run and an unfocused graph would not say which task this sheet was about.
export function openRunSheetDag(run: Pick<Run, "id" | "channeloid" | "dagoref" | "taskid">, taskId?: string): void {
    const dagOref = "dag:" + run.dagoref;
    const task = taskId || run.taskid;
    if (task) {
        openDagTask(run.channeloid ?? "", run.id, dagOref, task);
    } else {
        openDagLive(run.channeloid ?? "", run.id, dagOref);
    }
}

// dismissDagModal shuts the modal without going back: leaving Jarvis by any route takes the modal with it,
// so a later visit never finds it still open
export function dismissDagModal(): void {
    resetSelection();
    dispatchDagModal({ type: "close" });
}

export function closeDagModal(): void {
    dismissDagModal();
    returnToOrigin("dag");
}

// Which of its keys the modal takes: Escape and Tab, and only while it is the top modal. A confirm, the Final shots
// viewer or another shell opened above it owns them, or one Escape would close two layers and Tab would be pulled
// into the panel behind. A floating popover (a route picker in Escalate or Adjust) portals outside the panel and
// registers on no stack, so focus inside one leaves it its own Tab and Escape too.
const FLOATING_PORTAL = "[data-floating-ui-portal]";

export function dagModalKey(key: string, focused?: Element | null): "escape" | "tab" | null {
    if (!isTopModal(DAG_MODAL_ID) || focused?.closest(FLOATING_PORTAL) != null) {
        return null;
    }
    return key === "Escape" ? "escape" : key === "Tab" ? "tab" : null;
}

// escapeDagModal is Esc inside the modal: a selection is the nearer thing to dismiss, so it goes first
export function escapeDagModal(): void {
    if (globalStore.get(selectedTaskIdAtom) != null) {
        resetSelection();
        return;
    }
    closeDagModal();
}

if (import.meta.env.DEV && typeof window !== "undefined") {
    window.__waveDagModalFixture = {
        setState: (state: DagModalState | null) => {
            resetSelection();
            globalStore.set(dagModalStateAtom, state);
        },
    };
}

declare global {
    interface Window {
        __waveDagModalFixture?: {
            setState: (state: DagModalState | null) => void;
        };
    }
}
