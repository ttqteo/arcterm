// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Services popover's state (spec 2026-10-20-held-services-design.md): whether it is open and the control it hangs
// from. The services themselves are servicesstore.ts's; this is only the popover, like jobqueuestore.ts for Jobs.

import { globalStore } from "@/app/store/jotaiStore";
import { consumersOpenAtom } from "@/app/view/agents/consumersstore";
import { machineServersOpenAtom } from "@/app/view/agents/machineserversstore";
import { atom, type PrimitiveAtom } from "jotai";
import { jobQueueOpenAtom } from "./jobqueuestore";

export const servicesOpenAtom = atom(false) as PrimitiveAtom<boolean>;
// the control that opened the popover, which it hangs from (panelPlacement); null when code opened it
export const servicesOpenerAtom = atom<Element | null>(null) as PrimitiveAtom<Element | null>;

/** The chip's click: opens the popover from the chip, or closes it when it is open. It closes the Jobs, Servers and
 * Consumers popovers, so only one of them is open. */
export function toggleServices(opener: Element | null = null): void {
    globalStore.set(jobQueueOpenAtom, false);
    globalStore.set(machineServersOpenAtom, false);
    globalStore.set(consumersOpenAtom, null);
    if (globalStore.get(servicesOpenAtom)) {
        globalStore.set(servicesOpenAtom, false);
        return;
    }
    globalStore.set(servicesOpenerAtom, opener);
    globalStore.set(servicesOpenAtom, true);
}
