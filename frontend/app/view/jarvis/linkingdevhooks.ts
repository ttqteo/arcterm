// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// DEV-ONLY seam for the resource-linking CDP scenario, installed by BriefSurface and never imported in a
// production build. __openAddress drives the one router with an address and its hint, including the case no
// rendered link can reach: an address the parser rejects.

import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import type { AddressHint } from "./address";
import { heldRecordLoads } from "./briefpeekview";
import { briefPeekRecordAtom, briefSheetOpenAtom } from "./jarvisstore";
import { activeSubjectAtom, loadRecordDetail, recordDetailAtom, recordDetailErrorAtom } from "./jarvissubjectstore";
import { openAddress, peekAddress } from "./openref";
import { peekItemAtom, startPeek, type PeekTarget } from "./peekstore";
import { landOn } from "./returnsurface";

// __peekProbe reads what a peek must leave alone (the host's selection) and the peek's own item, for the
// peek-ctrl-click scenario. __peekAddress peeks each kind for peek-item-views, and __peekLoading holds a peek in
// its loading frame, which a real load leaves too quickly to photograph.
// __recordPeekFor opens the Brief's record modal on any id, past the router's check that the record is listed,
// which is the only way to its failed read. opts.detail seeds the cache first, so a state no RPC can create (a
// record with no objective) can be drawn on a made-up id; opts.hold opens it without reading, so the skeleton
// holds for a screenshot.
export function installLinkingDevHooks(model: AgentsViewModel): void {
    const w = window as unknown as {
        __openAddress?: (address: string, hint?: AddressHint) => Promise<unknown>;
        __peekAddress?: (address: string, hint?: AddressHint) => Promise<unknown>;
        __peekLoading?: (target: PeekTarget) => void;
        __peekProbe?: () => unknown;
        __recordPeekFor?: (id: string, opts?: { detail?: DossierDetail; hold?: boolean }) => void;
    };
    w.__openAddress = (address, hint) => openAddress(model, address, hint ?? undefined);
    w.__peekAddress = (address, hint) => peekAddress(model, address, hint ?? undefined);
    w.__peekLoading = (target) => {
        startPeek(target);
    };
    w.__recordPeekFor = (id, opts) => {
        heldRecordLoads.delete(id);
        if (opts?.detail != null) {
            globalStore.set(recordDetailAtom, { ...globalStore.get(recordDetailAtom), [id]: opts.detail });
        }
        if (opts?.hold) {
            heldRecordLoads.add(id);
            // a failed read left by an earlier pass would draw in place of the skeleton
            const errors = { ...globalStore.get(recordDetailErrorAtom) };
            delete errors[id];
            globalStore.set(recordDetailErrorAtom, errors);
        } else {
            loadRecordDetail(id);
        }
        globalStore.set(briefPeekRecordAtom, id);
        landOn(model.surfaceAtom, "jarvis");
    };
    w.__peekProbe = () => ({
        surface: globalStore.get(model.surfaceAtom),
        subject: globalStore.get(activeSubjectAtom),
        sheetOpen: globalStore.get(briefSheetOpenAtom),
        peekItem: globalStore.get(peekItemAtom),
    });
}
