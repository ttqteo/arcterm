// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A held service's row menu in the Agent tree (spec 2026-10-20-apps-run-while-used-design.md): Stop and Restart, the
// browser, "Keep running", Pin to the rail, and its entry in Setup → Tools. There is no Start: showing the service
// starts it. Its entries and their order are servicesmodel.ts's (serviceMenuChoices); this gives each its icon and
// click. Stop and Restart wait for wavesrv's `services:changed` event to show the result; nothing here writes the row.

import { ContextMenuModel } from "@/app/store/contextmenu";
import { getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { fireAndForget } from "@/util/util";
import { ExternalLink, Pencil, Pin, PinOff, RotateCcw, Square } from "lucide-react";
import type { AgentsViewModel } from "./agents";
import { railFull, railPins } from "./railapps";
import { railPinsAtom, setRailPinned } from "./railappsstore";
import { serviceMenuChoices, type ServiceMenuKey } from "./servicesmodel";
import { restartService, servicesAtom, setServiceAutostart, stopService } from "./servicesstore";
import { openSetupTool } from "./setupstore";

export function serviceMenuItems(model: AgentsViewModel, s: ServiceStatus): ContextMenuItem[] {
    const services = globalStore.get(servicesAtom) ?? [];
    const pins = globalStore.get(railPinsAtom);
    const pinned = railPins(pins, services).some((p) => p.id === s.id);
    const act: Record<ServiceMenuKey, Pick<ContextMenuItem, "icon" | "type" | "click">> = {
        stop: { icon: <Square size={15} />, click: () => fireAndForget(() => stopService(s.id)) },
        restart: { icon: <RotateCcw size={15} />, click: () => fireAndForget(() => restartService(s.id)) },
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
