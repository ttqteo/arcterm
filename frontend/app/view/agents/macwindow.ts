// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The float's macOS window chrome, from src-tauri/src/macwindow.rs: hide the traffic lights while folded into Sprout,
// and send the yellow button to Sprout while floating (it emits FLOAT_MINIMIZE_EVENT). No-ops elsewhere.

import { isMacOS } from "@/util/platformutil";
import { invoke } from "@tauri-apps/api/core";

export const FLOAT_MINIMIZE_EVENT = "float-minimize";

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
