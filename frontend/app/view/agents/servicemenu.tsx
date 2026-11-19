// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A held service's row menu in the Agent tree (spec 2026-10-20-apps-run-while-used-design.md): Stop, Restart and Hide,
// the browser, "Keep running", Pin to the rail, and its entry in Setup → Tools. There is no Start: showing the service
// starts it. Its entries and their order are servicesmodel.ts's (serviceMenuChoices); this gives each its icon and
// click. Stop and Restart wait for wavesrv's `services:changed` event to show the result; nothing here writes the row.

import { pushToast } from "@/app/cockpit/notificationstore";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { fireAndForget } from "@/util/util";
import { ExternalLink, EyeOff, Pencil, Pin, PinOff, RotateCcw, Square } from "lucide-react";
import { activeNavOrder } from "./activenav";
import type { AgentsViewModel } from "./agents";
import { selectAgentRow } from "./agenttree";
import { closedNeighbour } from "./cockpitsurfacemodel";
import { railFull, railPins } from "./railapps";
import { railPinsAtom, setRailPinned } from "./railappsstore";
import { canStop, serviceMenuChoices, type ServiceMenuKey } from "./servicesmodel";
import { restartService, servicesAtom, setServiceAutostart, setServiceHidden, stopService } from "./servicesstore";
import { openSetupTool } from "./setupstore";

// Stop and Restart show wavesrv's refusal: the row only changes on `services:changed`, so a refused one would
// otherwise look like a click that did nothing
async function serviceAction(s: ServiceStatus, verb: "stop" | "restart"): Promise<void> {
    try {
        await (verb === "stop" ? stopService(s.id) : restartService(s.id));
    } catch (e) {
        const text = (e instanceof Error ? e.message : String(e)).replace(/^Error:\s*/, "");
        pushToast({ title: `Couldn't ${verb} ${s.name}`, message: text, level: "error" });
    }
}

// Hide: the service goes on the hidden list, an up one is stopped, and the selection moves off its tab to the row
// beside it (as a closed tab hands its place on), so treeServiceInput, which keeps a hidden service only while its tab
// is selected, drops the row. Opening it again takes it off the list (agenttree.tsx).
function hideService(model: AgentsViewModel, s: ServiceStatus): void {
    if (canStop(s)) {
        fireAndForget(() => serviceAction(s, "stop"));
    }
    // hidden only once the selection is off its tab: a selected hidden service reads as opened again
    if (s.tabid == null || globalStore.get(model.focusIdAtom) !== s.tabid) {
        setServiceHidden(s.id, true);
        return;
    }
    const live = new Set(
        [...globalStore.get(model.agentsAtom), ...globalStore.get(model.terminalsAtom)]
            .map((a) => a.id)
            .filter((id) => id !== s.tabid)
    );
    const next = closedNeighbour(activeNavOrder(model), s.tabid, live);
    if (next != null) {
        selectAgentRow(model, next);
    } else {
        globalStore.set(model.focusIdAtom, undefined);
    }
    setServiceHidden(s.id, true);
}

export function serviceMenuItems(model: AgentsViewModel, s: ServiceStatus): ContextMenuItem[] {
    const services = globalStore.get(servicesAtom) ?? [];
    const pins = globalStore.get(railPinsAtom);
    const pinned = railPins(pins, services).some((p) => p.id === s.id);
    const act: Record<ServiceMenuKey, Pick<ContextMenuItem, "icon" | "type" | "click">> = {
        stop: { icon: <Square size={15} />, click: () => fireAndForget(() => serviceAction(s, "stop")) },
        restart: { icon: <RotateCcw size={15} />, click: () => fireAndForget(() => serviceAction(s, "restart")) },
        hide: { icon: <EyeOff size={15} />, click: () => hideService(model, s) },
        browser: { icon: <ExternalLink size={15} />, click: () => getApi().openExternal(s.url!) },
        keepRunning: {
            type: "checkbox",
            click: () => fireAndForget(() => setServiceAutostart(s.id, !s.autostart)),
        },
        pin: { icon: pinned ? <PinOff size={15} /> : <Pin size={15} />, click: () => setRailPinned(s.id, !pinned) },
        edit: { icon: <Pencil size={15} />, click: () => openSetupTool(model, s.id) },
    };
    return serviceMenuChoices(s, { pinned, railFull: railFull(pins, services) }).map((c): ContextMenuItem => {
        if (c.key === "separator") {
            return { type: "separator" };
        }
        const { key, ...shown } = c;
        return { ...act[key], ...shown };
    });
}

export function showServiceMenu(model: AgentsViewModel, s: ServiceStatus, e: React.MouseEvent): void {
    ContextMenuModel.getInstance().showContextMenu(serviceMenuItems(model, s), e);
}
