// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The window's macOS chrome, from src-tauri/src/macwindow.rs: while folded into Sprout, hide the traffic lights, and
// when it folds over a full-screen app show the window on every Space, so Sprout shows there; and send the yellow
// button and ⌘M to Sprout while window:minimize says so (they emit MINIMIZE_EVENT). No-ops elsewhere. A click on the
// Dock icon emits REOPEN_EVENT (main.rs, macOS reopen), and so does one on the Windows taskbar button (foreground.rs
// watch_taskbar).

import { isMacOS } from "@/util/platformutil";
import { invoke } from "@tauri-apps/api/core";

export const MINIMIZE_EVENT = "window-minimize";
export const REOPEN_EVENT = "app-reopen";

export async function setFoldedChrome(folded: boolean): Promise<void> {
    if (isMacOS()) {
        await invoke("set_folded_chrome", { folded });
    }
}

export async function redirectMinimize(on: boolean): Promise<void> {
    if (isMacOS()) {
        await invoke("redirect_minimize", { on });
    }
}
