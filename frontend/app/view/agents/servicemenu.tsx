// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A held service's row menu in the Agent tree (spec 2026-10-20-held-services-design.md): the moves its state allows, the
// browser, "Keep running", and its entry in Setup → Tools. Start, Stop and Restart wait for wavesrv's
// `services:changed` event to show the result; nothing here writes the row.

import { ContextMenuModel } from "@/app/store/contextmenu";
import { getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { fireAndForget } from "@/util/util";
import { ExternalLink, Pencil, Pin, PinOff, Play, RotateCcw, Square } from "lucide-react";
import type { AgentsViewModel } from "./agents";
import { RAIL_FULL_TITLE, railFull, railPins } from "./railapps";
import { railPinsAtom, setRailPinned } from "./railappsstore";
import { canRestart, canStart, canStop } from "./servicesmodel";
import { restartService, servicesAtom, setServiceAutostart, startService, stopService } from "./servicesstore";
import { openSetupTool } from "./setupstore";

export function serviceMenuItems(model: AgentsViewModel, s: ServiceStatus): ContextMenuItem[] {
    const services = globalStore.get(servicesAtom) ?? [];
    const pins = globalStore.get(railPinsAtom);
    const pinned = railPins(pins, services).some((p) => p.id === s.id);
    return [
        {
            label: "Start",
            icon: <Play size={15} />,
            enabled: canStart(s),
            click: () => fireAndForget(() => startService(s.id)),
        },
        {
            label: "Stop",
            icon: <Square size={15} />,
            enabled: canStop(s),
            click: () => fireAndForget(() => stopService(s.id)),
        },
        {
            label: "Restart",
            icon: <RotateCcw size={15} />,
            enabled: canRestart(s),
            click: () => fireAndForget(() => restartService(s.id)),
        },
        { type: "separator" },
        ...(s.url
            ? [
                  {
                      label: "Open in the browser",
                      icon: <ExternalLink size={15} />,
                      click: () => getApi().openExternal(s.url!),
                  },
              ]
            : []),
        {
            label: "Keep running",
            type: "checkbox",
            checked: s.autostart,
            click: () => fireAndForget(() => setServiceAutostart(s.id, !s.autostart)),
        },
        {
            label: pinned ? "Unpin from the rail" : "Pin to the rail",
            icon: pinned ? <PinOff size={15} /> : <Pin size={15} />,
            enabled: pinned || !railFull(pins, services),
            title: !pinned && railFull(pins, services) ? RAIL_FULL_TITLE : undefined,
            click: () => setRailPinned(s.id, !pinned),
        },
        { type: "separator" },
        {
            label: "Edit in Setup → Tools",
            icon: <Pencil size={15} />,
            click: () => openSetupTool(model, s.id),
        },
    ];
}

export function showServiceMenu(model: AgentsViewModel, s: ServiceStatus, e: React.MouseEvent): void {
    ContextMenuModel.getInstance().showContextMenu(serviceMenuItems(model, s), e);
}
