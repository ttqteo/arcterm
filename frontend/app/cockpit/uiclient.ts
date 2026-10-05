// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Serves the cockpit UI API (wsh ui) on the fixed "cockpit" route. Workers each run in their own tab and the
// frontend otherwise listens only on its boot tab's route, so a stable address is what lets any of them reach
// the one cockpit window. The decisions live in uiapi.ts; this file reads atoms and acts.

import { pushToast } from "@/app/cockpit/notificationstore";
import { buildCommandItems, postCloseContext, type CommandItem } from "@/app/cockpit/palette-commands";
import { globalStore } from "@/app/store/jotaiStore";
import { deriveKeyContext, lastKeyActivityTs } from "@/app/store/keybindings/dispatcher";
import { bindingsAtom } from "@/app/store/keybindings/store";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcResponseHelper, WshClient } from "@/app/store/wshclient";
import { DefaultRouter } from "@/app/store/wshrpcutil";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { getCanvas } from "@/app/view/agents/canvasstore";
import { currentReportIdAtom } from "@/app/view/agents/radarstore";
import { briefPeekRecordAtom } from "@/app/view/jarvis/jarvisstore";
import { activeRunIdAtom, activeSubjectAtom } from "@/app/view/jarvis/jarvissubjectstore";
import { openAddress } from "@/app/view/jarvis/openref";
import {
    AWAITING_CONFIRMATION,
    BUSY_ERROR,
    callerName,
    COCKPIT_ROUTE_ID,
    isBusy,
    parseSurfaceAddress,
    resolveAction,
    revealError,
    revealLeavesTrail,
    revealWaitsForUser,
    selectionFor,
    toUiActions,
    waitUntilIdle,
    type SelectionSnapshot,
} from "./uiapi";

// a reveal's failure belongs to the worker that asked, not in a toast at the user
const reportNothing = () => {};

class CockpitUiClient extends WshClient {
    model: AgentsViewModel;

    constructor(model: AgentsViewModel) {
        super(COCKPIT_ROUTE_ID);
        this.model = model;
    }

    async handle_uistate(_rh: RpcResponseHelper): Promise<UiState> {
        const surface = globalStore.get(this.model.surfaceAtom);
        const modalOpen = deriveKeyContext().modalOpen;
        return {
            surface,
            busy: isBusy(Date.now(), lastKeyActivityTs(), modalOpen),
            modalopen: modalOpen,
            selection: selectionFor(surface, this.snapshot()),
            actions: toUiActions(this.actions()),
        };
    }

    async handle_uireveal(rh: RpcResponseHelper, data: CommandUiRevealData): Promise<string> {
        if (revealWaitsForUser(data.address, data.callerblockid)) {
            await this.waitForUser();
        }
        const surfaceTarget = parseSurfaceAddress(data.address);
        if (surfaceTarget != null) {
            if ("error" in surfaceTarget) {
                throw new Error(surfaceTarget.error);
            }
            globalStore.set(this.model.surfaceAtom, surfaceTarget.surface);
            this.trail(data.callerblockid, data.address);
            return "";
        }
        // an empty cwd (Getwd failed) still names the caller, so a canvas reveal says where to run it from
        const caller = data.callerblockid ? { blockId: data.callerblockid, cwd: data.callercwd ?? "" } : undefined;
        // read before the landing attaches it
        const leavesTrail = revealLeavesTrail(data.address, this.canvasTopic(data.callerblockid));
        const result = await openAddress(
            this.model,
            data.address,
            { anchor: data.anchor || undefined, caller },
            reportNothing
        );
        // narrowed with `in`: the tsconfig is not strict, so the `ok` literal does not discriminate the union
        if ("reason" in result) {
            throw new Error(revealError(data.address, result.reason, result.message));
        }
        if (leavesTrail) {
            this.trail(data.callerblockid, data.address);
        }
        return result.notice ?? "";
    }

    async handle_uiinvoke(rh: RpcResponseHelper, data: CommandUiInvokeData): Promise<string> {
        await this.waitForUser();
        const resolved = resolveAction(this.actions(), data.actionid, globalStore.get(this.model.surfaceAtom));
        if ("error" in resolved) {
            throw new Error(resolved.error);
        }
        const item = resolved.item;
        if (item.destructive) {
            this.confirmFor(data.callerblockid, item);
            return AWAITING_CONFIRMATION;
        }
        const modalsBefore = globalStore.get(modalsModel.modalsAtom).length;
        if (item.run() === false) {
            throw new Error(`"${data.actionid}" did nothing here`);
        }
        // the action asked for confirmation itself (code:delete); its modal is the user's trail
        if (globalStore.get(modalsModel.modalsAtom).length > modalsBefore) {
            return AWAITING_CONFIRMATION;
        }
        this.trail(data.callerblockid, item.title);
        return "";
    }

    private async waitForUser(): Promise<void> {
        const idle = await waitUntilIdle({
            now: Date.now,
            lastKeyTs: lastKeyActivityTs,
            modalOpen: () => deriveKeyContext().modalOpen,
            sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        });
        if (!idle) {
            throw new Error(BUSY_ERROR);
        }
    }

    // the palette's own catalog, judged against the context one frame after a palette would close
    private actions(): CommandItem[] {
        const ctx = postCloseContext(globalStore.get(this.model.surfaceAtom));
        return buildCommandItems(globalStore.get(bindingsAtom), ctx);
    }

    private snapshot(): SelectionSnapshot {
        return {
            focusId: globalStore.get(this.model.focusIdAtom),
            subject: globalStore.get(activeSubjectAtom),
            activeRunIds: globalStore.get(activeRunIdAtom),
            peekRecordId: globalStore.get(briefPeekRecordAtom),
            radarReportId: globalStore.get(currentReportIdAtom),
        };
    }

    private confirmFor(blockId: string | undefined, item: CommandItem): void {
        modalsModel.pushModal("ConfirmModal", {
            title: `${this.caller(blockId)} wants to: ${item.title}`,
            message: "An agent asked to run this cockpit action. It can't be undone.",
            confirmLabel: item.title,
            destructive: true,
            onConfirm: () => item.run(),
        });
    }

    private roster() {
        return [...globalStore.get(this.model.agentsAtom), ...globalStore.get(this.model.terminalsAtom)];
    }

    private caller(blockId: string | undefined): string {
        return callerName(this.roster(), blockId);
    }

    private canvasTopic(blockId: string | undefined): string | undefined {
        const agent = blockId ? this.roster().find((a) => a.blockId === blockId) : undefined;
        return agent != null ? getCanvas(agent.id)?.topic : undefined;
    }

    // a worker moving the view is never unexplained
    private trail(blockId: string | undefined, what: string): void {
        pushToast({ title: `${this.caller(blockId)}: ${what}`, message: "", level: "info" });
    }
}

// returns the unregister, for the effect that owns the cockpit's lifetime
export function setupUiClient(model: AgentsViewModel): () => void {
    DefaultRouter.registerRoute(COCKPIT_ROUTE_ID, new CockpitUiClient(model));
    return () => DefaultRouter.unregisterRoute(COCKPIT_ROUTE_ID);
}
