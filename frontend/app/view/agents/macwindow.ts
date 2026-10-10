// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The window's macOS chrome, from src-tauri/src/macwindow.rs: hide the traffic lights while folded into Sprout, and send
// the yellow button and ⌘M to Sprout while window:minimize says so (they emit MINIMIZE_EVENT). No-ops elsewhere.

import { isMacOS } from "@/util/platformutil";
import { invoke } from "@tauri-apps/api/core";

export const MINIMIZE_EVENT = "window-minimize";

export async function setTrafficLightsHidden(hidden: boolean): Promise<void> {
    if (isMacOS()) {
        await invoke("set_traffic_lights_hidden", { hidden });
    }
}

export async function redirectMinimize(on: boolean): Promise<void> {
    if (isMacOS()) {
        await invoke("redirect_minimize", { on });
    }
}
