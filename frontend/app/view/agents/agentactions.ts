// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { WorkspaceService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget, stringToBase64 } from "@/util/util";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { dismissKey, toggleInSet } from "./cockpitsurfacemodel";
import { leadRunTabIds } from "./runlineage";

// The close-agent chord (bindings.ts), as a terminal app closes its tab: Windows Terminal's Ctrl+Shift+W on Windows,
// where Ctrl+W is the shell's delete-word, and the same shape on a Mac, ⌘⇧W.
export function closeAgentChord(): string {
    return "Mod:Shift:w";
}

function closeTabs(workspaceId: string, tabIds: string[]): void {
    fireAndForget(async () => {
        for (const id of tabIds) {
            await WorkspaceService.CloseTab(workspaceId, id);
        }
    });
}

// Close a whole session (its id is the tabId). Shows the same confirm modal as the header Close
// button, then CloseTab -> wcore.DeleteTab tears down the block and reassigns the active tab.
// Takes the VM rather than loose id/name strings so the prompt can never name one session while
// closing another — and so a plain terminal, which has no agent to stop, gets its own wording.
// Given the model, a lead whose run still holds other tabs is offered its whole run: closing the lead
// alone leaves those tabs under a lead-less run row, which read as a close that did nothing.
export function confirmCloseSession(
    vm: Pick<AgentVM, "id" | "name" | "kind">,
    model?: Pick<AgentsViewModel, "lineageAtom" | "agentsAtom">
) {
    const ws = globalStore.get(atoms.workspace);
    if (ws?.oid == null) {
        return;
    }
    const runTabIds =
        model && leadRunTabIds(globalStore.get(model.lineageAtom), globalStore.get(model.agentsAtom), vm.id);
    if (runTabIds) {
        const others = runTabIds.length - 1;
        modalsModel.pushModal("ConfirmModal", {
            title: "Close lead",
            message: `"${vm.name}" leads a run with ${others === 1 ? "1 other open session" : `${others} other open sessions`}. Close the whole run, or only the lead and leave its workers running? This can't be undone.`,
            confirmLabel: "Close run",
            altLabel: "Close lead only",
            destructive: true,
            onConfirm: () => closeTabs(ws.oid, runTabIds),
            onAlt: () => closeTabs(ws.oid, [vm.id]),
        });
        return;
    }
    const isTerminal = vm.kind === "terminal";
    const label = isTerminal ? "Close terminal" : "Close agent";
    modalsModel.pushModal("ConfirmModal", {
        title: label,
        message: isTerminal
            ? `Close the terminal "${vm.name}"? This ends its shell and can't be undone.`
            : `End the session for "${vm.name}"? This stops the agent and can't be undone.`,
        confirmLabel: label,
        destructive: true,
        onConfirm: () => fireAndForget(() => WorkspaceService.CloseTab(ws.oid, vm.id)),
    });
}

// Close every tab a run still holds. A run whose lead was closed stays in the roster for as long as any of its
// task tabs does, and those hide under its folds, so the run row is the one place to clear them from.
export function confirmCloseRun(title: string, tabIds: string[]) {
    const ws = globalStore.get(atoms.workspace);
    if (ws?.oid == null || tabIds.length === 0) {
        return;
    }
    const sessions = tabIds.length === 1 ? "its 1 open session" : `its ${tabIds.length} open sessions`;
    modalsModel.pushModal("ConfirmModal", {
        title: "Close run",
        message: `Close "${title}" and ${sessions}? This stops those agents and can't be undone.`,
        confirmLabel: "Close run",
        destructive: true,
        onConfirm: () => closeTabs(ws.oid, tabIds),
    });
}

// Close several sessions at once, with no confirm of its own: the caller asked (the Consumers panel's ticked rows).
export function closeSessions(tabIds: string[]): void {
    const ws = globalStore.get(atoms.workspace);
    if (ws?.oid == null || tabIds.length === 0) {
        return;
    }
    closeTabs(ws.oid, tabIds);
}

// NUDGE_INPUT is what the rail's Resume types: a quiet agent picks it up as a new turn
export const NUDGE_INPUT = "continue\r";

// driveAgent types into an agent's terminal; a card without a terminal block has nothing to drive
export function driveAgent(blockId: string | undefined, data: string): void {
    if (!blockId) {
        return;
    }
    fireAndForget(() =>
        RpcApi.ControllerInputCommand(TabRpcClient, { blockid: blockId, inputdata64: stringToBase64(data) })
    );
}

// interruptAgent cancels the current turn: Esc typed into the terminal, as the composer would
export function interruptAgent(blockId: string | undefined): void {
    driveAgent(blockId, "\x1b");
}

export function toggleAgentBackground(model: Pick<AgentsViewModel, "backgroundedIdsAtom">, id: string): void {
    globalStore.set(model.backgroundedIdsAtom, toggleInSet(globalStore.get(model.backgroundedIdsAtom), id));
}

export function dismissAgent(
    model: Pick<AgentsViewModel, "dismissedAtom">,
    agent: Pick<AgentVM, "id" | "idleSince">
): void {
    globalStore.set(model.dismissedAtom, new Set(globalStore.get(model.dismissedAtom)).add(dismissKey(agent)));
}
