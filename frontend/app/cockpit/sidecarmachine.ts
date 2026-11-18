// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The machine figures on the Sidecar page, apart from the snapshot. They move on nearly every 5 s poll, and the bridge
// sends them alone (sidecar:machine) when nothing else changed; the page keeps them in its own state and hands them
// down through this context, so the parts that show them (the RAM ring and line, the band's words) redraw while the
// dashboard, memoized on the snapshot, does not.

import { createContext, useContext } from "react";
import type { SidecarMachine } from "./sidecartypes";

export const SidecarMachineContext = createContext<SidecarMachine | undefined>(undefined);

/** The page's latest machine figures: the last snapshot's, or a sidecar:machine since; none before a reading. */
export function useSidecarMachine(): SidecarMachine | undefined {
    return useContext(SidecarMachineContext);
}
